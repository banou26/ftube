import type { CaptionSource, TranslationLanguage } from './captions'
import type { OpenPlaybackOptions, SegmentEnvelope, SegmentRequest } from './protocol'
import type { LiveSessionCallbacks } from './sabr'

import { getSabrSource } from './innertube'
import { STREAM_REFUSED } from './protocol'
import { createSabrSession, isSabrSessionRefreshError } from './sabr'

type SabrSession = ReturnType<typeof createSabrSession>

export type PlaybackEntry = {
  videoId: string
  maxHeight?: number
  // the card params its watch page was read with, which every refresh's read of the page carries too
  playerParams?: string
  player: SabrSession
  chain: Promise<unknown>
  serial: Promise<unknown>
  requests: Map<string, AbortController>
  generation: number
  closed: boolean
  refreshing?: Promise<void>
  // the session the last refresh left current, until it delivers media: an init it answers says nothing of its stream
  recovered?: SabrSession
  refused?: Error
  captions: CaptionSource[]
  translations: TranslationLanguage[]
  cueSources?: Promise<CaptionSource[]>
  mint(): Promise<string>

  lastLiveManifest?: string
  liveAnchorMs?: number
  liveWindowStartMs?: number
}

const SEGMENT_CANCELLED = 'youtube: segment request cancelled'
const LIVE_HANDOFF_WAIT_MS = 8_000

const closeWaiters = new WeakMap<PlaybackEntry, Set<() => void>>()

const notifyClose = (entry: PlaybackEntry) => {
  const waiters = closeWaiters.get(entry)
  if (!waiters) return
  closeWaiters.delete(entry)
  for (const notify of waiters) notify()
}

const setSegmentRecovery = (reason: string) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.segmentRecovery = reason
}

const refusalError = (reason: string) =>
  new Error(`${STREAM_REFUSED} (${reason.replace(/^youtube: /, '')})`)

const handleLiveRefresh = (entry: PlaybackEntry, session: SabrSession, reason: string) => {
  if (entry.closed || entry.player !== session || entry.refreshing || entry.refused) return
  if (session === entry.recovered) {
    entry.refused ??= refusalError(reason)
    return
  }
  setSegmentRecovery(reason)
  void startRefresh(entry).catch(() => {})
}

/** Whether a failure is one the app or the frame asked for: a segment request it cancelled, or an abort. */
export const isCancellation = (error: unknown) =>
  (error instanceof Error && error.message === SEGMENT_CANCELLED) || (error instanceof DOMException && error.name === 'AbortError')

const normalizeOpenOptions = (options?: boolean | OpenPlaybackOptions): OpenPlaybackOptions =>
  typeof options === 'boolean' ? { preview: options } : (options ?? {})

/** Reads the video's watch page, with a card's inline playback params when given, and opens a SABR session on it. */
export const openPlaybackEntry = async (
  videoId: string,
  maxHeight?: number,
  playerParams?: string,
  stableVolume?: boolean,
  options?: boolean | OpenPlaybackOptions,
) => {
  const { preview = false, prewarm = true, cover, pinnedHeight } = normalizeOpenOptions(options)
  const source = preview
    ? await getSabrSource(videoId, playerParams, true, maxHeight)
    : await getSabrSource(videoId, playerParams)
  const videoSelection = cover || pinnedHeight !== undefined ? { cover, pinnedHeight } : undefined
  const ref: { entry?: PlaybackEntry, session?: SabrSession } = {}
  const player = source.isLive
    ? createSabrSession(source, maxHeight, undefined, stableVolume, {
        onLiveMedia: () => {
          if (ref.entry && ref.session && ref.entry.player === ref.session) ref.entry.recovered = undefined
        },
        onLiveRefresh: (reason) => {
          if (ref.entry && ref.session) handleLiveRefresh(ref.entry, ref.session, reason)
        },
      })
    : videoSelection
    ? createSabrSession(source, maxHeight, undefined, stableVolume, undefined, videoSelection)
    : createSabrSession(source, maxHeight, undefined, stableVolume)
  const entry: PlaybackEntry = {
    videoId,
    maxHeight,
    playerParams: source.playerParams,
    player,
    chain: Promise.resolve(),
    serial: Promise.resolve(),
    requests: new Map(),
    generation: 0,
    closed: false,
    // Shaka rejects a side-loaded text track against an infinite presentation
    captions: source.isLive ? [] : source.captions,
    translations: source.isLive ? [] : source.translations,
    mint: () => source.mint(),
  }
  ref.entry = entry
  ref.session = player
  if (!source.isLive && prewarm) player.prewarmStart?.()
  return { source, entry }
}

/** Stops everything the entry has in flight, its refresh included, and closes its SABR session. */
export const closePlaybackEntry = (entry: PlaybackEntry) => {
  entry.closed = true
  notifyClose(entry)
  for (const controller of entry.requests.values()) controller.abort()
  entry.requests.clear()
  entry.player.close()
}

// Returns true when a live replacement already delivered at least one media segment during handoff.
const refreshSession = async (entry: PlaybackEntry): Promise<boolean> => {
  if (entry.closed) throw new Error('youtube: playback session closed during refresh')
  const previous = entry.player
  const videoKey = previous.videoFormat.key
  const videoMimeType = previous.videoFormat.mimeType
  const audioKey = previous.audioFormat.key
  const audioMimeType = previous.audioFormat.mimeType
  const source = await getSabrSource(entry.videoId, entry.playerParams)
  if (entry.closed) throw new Error('youtube: playback session closed during refresh')
  const isDrc = Boolean(previous.audioFormat.isDrc)
  const nextRef: { session?: SabrSession } = {}
  let nextDelivered = false
  let nextRefusedReason: string | undefined
  let settleHandoff: (() => void) | undefined
  const liveCallbacks: LiveSessionCallbacks | undefined = source.isLive
    ? {
        onLiveMedia: () => {
          nextDelivered = true
          settleHandoff?.()
          if (nextRef.session && entry.player === nextRef.session) entry.recovered = undefined
        },
        onLiveRefresh: (reason) => {
          if (!nextRef.session || entry.closed) return
          if (entry.player !== nextRef.session) {
            nextRefusedReason = reason
            settleHandoff?.()
            return
          }
          handleLiveRefresh(entry, nextRef.session, reason)
        },
      }
    : undefined
  // a new live session asked at 0 is answered at the oldest end of the DVR window, so it continues where this one got to
  const liveFromMs = source.isLive && previous.liveEndMs > 0 ? previous.liveEndMs : undefined
  const next = liveCallbacks
    ? createSabrSession(source, entry.maxHeight, liveFromMs, isDrc, liveCallbacks)
    : createSabrSession(source, entry.maxHeight, undefined, isDrc)
  nextRef.session = next
  const videoFormat = next.videoFormats.find((format) => format.key === videoKey && format.mimeType === videoMimeType)
  const audioFormat = next.audioFormats.find((format) => format.key === audioKey && format.mimeType === audioMimeType)
  if (!videoFormat || !audioFormat) {
    next.close()
    throw new Error('youtube: playback formats changed during session refresh')
  }
  next.selectVideoFormat(videoFormat.key)
  next.selectAudioFormat(audioFormat.key)
  if (source.isLive) {
    next.startLivePump()
    // Keep `previous` active while `next` fetches its first live segment so Shaka can keep reading cached segments.
    if (next.liveSegments.length === 0 && !nextRefusedReason && !entry.closed) {
      await new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          clearTimeout(timer)
          closeWaiters.get(entry)?.delete(finish)
          settleHandoff = undefined
          resolve()
        }
        const timer = setTimeout(finish, LIVE_HANDOFF_WAIT_MS)
        settleHandoff = finish
        const waiters = closeWaiters.get(entry) ?? new Set<() => void>()
        waiters.add(finish)
        closeWaiters.set(entry, waiters)
        if (entry.closed || next.liveSegments.length > 0 || nextRefusedReason) finish()
      })
    }
    if (entry.closed) {
      next.close()
      throw new Error('youtube: playback session closed during refresh')
    }
    if (nextRefusedReason !== undefined && next.liveSegments.length === 0) {
      next.close()
      entry.refused ??= refusalError(nextRefusedReason)
      throw entry.refused
    }
  }
  previous.close()
  entry.player = next
  if (!source.isLive) {
    entry.captions = source.captions
    entry.translations = source.translations
  }
  entry.mint = () => source.mint()
  return nextDelivered
}

const startRefresh = (entry: PlaybackEntry) =>
  entry.refreshing ??= (async () => {
    let delivered = false
    try {
      delivered = await refreshSession(entry)
    } finally {
      entry.refreshing = undefined
      entry.recovered = delivered ? undefined : entry.player
    }
  })()

/**
 * One segment of the entry's video. A session that fails with a refresh error (status 2 or 3 through its retries, an
 * HTTP error, a reload request) is replaced at once by a new one on a new watch page read. If that one fails the same
 * way before it delivers a media segment, the stream is refused: this request and every later one fail with
 * `STREAM_REFUSED` and read nothing more, and the player decides when to open the video again. Every refresh error
 * counts, not only status 2, since a session answered 403 or 5xx every time would otherwise read the watch page every
 * few seconds as well. A refresh that itself fails counts the same, so a playback reads at most one more watch page
 * per stretch of delivered media.
 */
export const requestPlaybackSegment = (
  entry: PlaybackEntry,
  request: SegmentRequest,
  progress: (phase: string) => void,
): Promise<SegmentEnvelope> => {
  const controller = new AbortController()
  entry.requests.set(request.requestId, controller)
  entry.generation = Math.max(entry.generation, request.generation)
  document.documentElement.dataset.segmentStartMs = String(request.startTimeMs)
  const assertActive = () => {
    if (controller.signal.aborted || request.generation < entry.generation) {
      throw new Error(SEGMENT_CANCELLED)
    }
    if (entry.closed) throw new Error(`youtube: unknown playback session ${request.sessionId}`)
  }
  const attempt = async (): Promise<SegmentEnvelope> => {
    assertActive()
    if (entry.refused) throw entry.refused
    const player = entry.player
    try {
      const segment = await player.requestSegment(request, progress, controller.signal)
      assertActive()
      if (request.kind === 'media') entry.recovered = undefined
      return segment
    } catch (error) {
      assertActive()
      // A background live refresh replaced `player` while this request was waiting on it; retry on the new session.
      if (entry.player !== player) return attempt()
      if (!isSabrSessionRefreshError(error)) throw error
      if (player === entry.recovered) {
        entry.refused ??= refusalError(error.message)
        throw entry.refused
      }
      setSegmentRecovery(error.message)
      progress('session-refresh')
      // refresh only if the player that failed is still current, or a stale failure disposes a fresh session
      if (entry.player === player) {
        await startRefresh(entry).catch((failure: unknown) => {
          assertActive()
          throw failure
        })
      }
      return attempt()
    }
  }
  const base = request.kind === 'init' ? entry.serial : entry.chain
  const run = base.then(attempt).finally(() => entry.requests.delete(request.requestId))
  if (request.kind === 'init') {
    entry.chain = Promise.allSettled([entry.chain, run]).then(() => {})
  } else {
    entry.chain = run.catch(() => {})
    entry.serial = entry.chain
  }
  return run
}
