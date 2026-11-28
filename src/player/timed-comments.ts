import type { ChatRow } from './../components/use-live-chat-session'

/** Structured rich-text run extracted from a YouTube comment. */
export type TimedCommentRun = {
  text: string
  url?: string | null
  videoId?: string | null
  startSeconds?: number | null
  browseId?: string | null
}

/** Minimal top-level comment shape needed to build timed overlay cues. */
export type TimedCommentInput = {
  id: string
  text: string
  runs?: readonly TimedCommentRun[] | null
  likeCountText?: string | null
  author?: {
    id: string
    name: string
    avatar?: string | null
    handle?: string | null
  } | null
}

/** One top-level comment scheduled at a validated timestamp on the active video. */
export type TimedCommentCue = {
  id: string
  videoId: string
  timestampSeconds: number
  likeCount: number
  text: string
  runs: TimedCommentRun[]
  author: TimedCommentInput['author']
}

/** Stateful playback tracker driving `stepTimedCommentClock`. */
export type TimedCommentClockState = {
  lastTime: number | undefined
  seeking: boolean
  lastEmittedTimestamp: number | undefined
}

const COMPACT_LIKE_RE = /^(\d+(?:[.,]\d+)?)\s*([kmb])?$/i
const CONNECTOR_PUNCTUATION_RE = /[\s\-:\u2013\u2014|/\\,.;\u2022\u00b7()[\]{}~]+/gu

const hasStructuredTimestamp = (run: TimedCommentRun): boolean =>
  typeof run.startSeconds === 'number' && Number.isFinite(run.startSeconds)

/**
 * Parses compact or comma-formatted YouTube like counts (`42`, `1,234`, `1.2K`, `3M`)
 * into a comparable non-negative number for resolving timestamp collisions.
 */
export const parseLikeCountText = (text?: string | null): number => {
  if (!text) return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (/^\d[\d,]+$/.test(trimmed)) {
    const plain = Number(trimmed.replaceAll(',', ''))
    return Number.isFinite(plain) && plain >= 0 ? plain : 0
  }
  const match = COMPACT_LIKE_RE.exec(trimmed)
  if (!match) return 0
  const base = Number(match[1]!.replace(',', '.'))
  if (!Number.isFinite(base) || base < 0) return 0
  const suffix = match[2]?.toUpperCase()
  const multiplier = suffix === 'B'
    ? 1_000_000_000
    : suffix === 'M'
      ? 1_000_000
      : suffix === 'K'
        ? 1_000
        : 1
  return base * multiplier
}

/**
 * Returns `true` when removing structured timestamp runs leaves only whitespace and
 * connector punctuation (e.g. `"2:14"` or `"2:14 - 2:30"`), while keeping short
 * reactions such as `"2:14 🔥"`.
 */
export const isTimestampOnlyComment = (runs: readonly TimedCommentRun[]): boolean => {
  if (!Array.isArray(runs) || runs.length === 0) return true
  const nonTimestampText = runs
    .filter((run) => !hasStructuredTimestamp(run))
    .map((run) => run.text ?? '')
    .join('')
  const meaningful = nonTimestampText.replace(CONNECTOR_PUNCTUATION_RE, '')
  return meaningful.length === 0
}

const collapseRunWhitespace = (runs: readonly TimedCommentRun[]): TimedCommentRun[] => {
  const collapsed = runs
    .map((run) => ({
      ...run,
      text: (run.text ?? '').replace(/\s+/g, ' '),
    }))
    .filter((run) => run.text.length > 0)
  if (collapsed.length === 0) return []
  collapsed[0] = { ...collapsed[0]!, text: collapsed[0]!.text.trimStart() }
  const lastIdx = collapsed.length - 1
  collapsed[lastIdx] = { ...collapsed[lastIdx]!, text: collapsed[lastIdx]!.text.trimEnd() }
  return collapsed.filter((run) => run.text.length > 0)
}

/**
 * Extracts at most one timed cue per top-level comment using its first valid structured
 * timestamp targeting `videoId` within `[0, durationSeconds)`, skipping timestamp-only
 * comments and keeping the highest-liked entry per shared timestamp.
 */
export const extractTimedCommentCues = (
  comments: readonly TimedCommentInput[] | null | undefined,
  videoId: string,
  durationSeconds: number,
): TimedCommentCue[] => {
  if (!videoId || !Array.isArray(comments) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return []
  }

  const byTimestamp = new Map<number, TimedCommentCue>()
  for (const comment of comments) {
    if (!comment || typeof comment !== 'object' || !comment.id) continue
    const runs: readonly TimedCommentRun[] = Array.isArray(comment.runs) ? comment.runs : []
    const match = runs.find(
      (run) =>
        run.videoId === videoId
        && typeof run.startSeconds === 'number'
        && Number.isFinite(run.startSeconds)
        && run.startSeconds >= 0
        && run.startSeconds < durationSeconds,
    )
    if (!match) continue
    if (isTimestampOnlyComment(runs)) continue

    const cleanRuns = collapseRunWhitespace(runs)
    const collapsedText = (cleanRuns.length > 0 ? cleanRuns.map((r) => r.text).join('') : comment.text)
      .replace(/\s+/g, ' ')
      .trim()
    if (!collapsedText) continue

    const timestampSeconds = match.startSeconds!
    const likeCount = parseLikeCountText(comment.likeCountText)
    const existing = byTimestamp.get(timestampSeconds)
    if (existing && likeCount <= existing.likeCount) continue

    byTimestamp.set(timestampSeconds, {
      id: comment.id,
      videoId,
      timestampSeconds,
      likeCount,
      text: collapsedText,
      runs: cleanRuns.length > 0 ? cleanRuns : [{ text: collapsedText }],
      author: comment.author ?? undefined,
    })
  }

  return [...byTimestamp.values()].sort((a, b) => a.timestampSeconds - b.timestampSeconds)
}

/** Creates an initial media-clock tracking state for timed comments. */
export const createTimedCommentClockState = (initialTime?: number): TimedCommentClockState => ({
  lastTime: initialTime !== undefined && Number.isFinite(initialTime) && initialTime >= 0 ? initialTime : undefined,
  seeking: false,
  lastEmittedTimestamp: undefined,
})

/** Marks an active seek so active messages clear and intermediate timestamps are skipped. */
export const beginTimedCommentSeek = (
  state: TimedCommentClockState,
  currentTime?: number,
): TimedCommentClockState => ({
  lastTime: currentTime !== undefined && Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : state.lastTime,
  seeking: true,
  lastEmittedTimestamp: undefined,
})

/** Anchors playback at the seek destination so future playback steps forward from there. */
export const finishTimedCommentSeek = (
  state: TimedCommentClockState,
  currentTime: number,
): TimedCommentClockState => ({
  lastTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : state.lastTime,
  seeking: false,
  lastEmittedTimestamp: undefined,
})

/**
 * Advances timed-comment scheduling on `timeupdate`. Emits the latest cue crossed during
 * `(lastTime, nextTime]` (including a `0:00` cue when advancing from `0`), clears active
 * messages on seek or backward jumps, and re-allows cues after rewinding past them.
 */
export const stepTimedCommentClock = (
  state: TimedCommentClockState,
  nextTime: number,
  cues: readonly TimedCommentCue[],
): { state: TimedCommentClockState, cue: TimedCommentCue | undefined, clear: boolean } => {
  if (!Number.isFinite(nextTime) || nextTime < 0) {
    return { state, cue: undefined, clear: false }
  }
  if (state.seeking) {
    return {
      state: { lastTime: nextTime, seeking: true, lastEmittedTimestamp: undefined },
      cue: undefined,
      clear: true,
    }
  }
  if (state.lastTime === undefined) {
    return {
      state: { lastTime: nextTime, seeking: false, lastEmittedTimestamp: undefined },
      cue: undefined,
      clear: false,
    }
  }
  if (nextTime < state.lastTime) {
    return {
      state: { lastTime: nextTime, seeking: false, lastEmittedTimestamp: undefined },
      cue: undefined,
      clear: true,
    }
  }
  if (nextTime === state.lastTime) {
    return { state, cue: undefined, clear: false }
  }

  let matched: TimedCommentCue | undefined
  for (const cue of cues) {
    const startMatch = state.lastTime === 0 ? cue.timestampSeconds >= 0 : cue.timestampSeconds > state.lastTime
    if (startMatch && cue.timestampSeconds <= nextTime && cue.timestampSeconds !== state.lastEmittedTimestamp) {
      matched = cue
    }
  }

  return {
    state: {
      lastTime: nextTime,
      seeking: false,
      lastEmittedTimestamp: matched ? matched.timestampSeconds : state.lastEmittedTimestamp,
    },
    cue: matched,
    clear: false,
  }
}

/** Converts a timed comment cue into a `ChatRow` for `OverScreenOverlay`. */
export const timedCommentCueToChatRow = (cue: TimedCommentCue): ChatRow => ({
  __typename: 'LiveChatMessage',
  id: `timed-comment:${cue.id}:${cue.timestampSeconds}`,
  kind: 'TEXT',
  text: cue.text,
  runs: cue.runs.map((run) => ({
    __typename: 'LiveChatRun',
    text: run.text,
    url: run.url ?? null,
    videoId: run.videoId ?? null,
    startSeconds: run.startSeconds ?? null,
    browseId: run.browseId ?? null,
    emojiUrl: null,
    emojiLabel: null,
  })),
  timestampText: null,
  isOwner: false,
  isModerator: false,
  isMember: false,
  badges: null,
  purchaseAmountText: null,
  headerBackgroundColor: null,
  bodyBackgroundColor: null,
  headerPrimaryText: null,
  headerSubtext: null,
  stickerUrl: null,
  stickerLabel: null,
  iconType: null,
  author: cue.author
    ? {
        __typename: 'Author',
        id: cue.author.id,
        name: cue.author.name,
        avatar: cue.author.avatar ?? null,
        handle: cue.author.handle ?? null,
      }
    : null,
})
