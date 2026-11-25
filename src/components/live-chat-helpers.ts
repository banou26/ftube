/** Chat author entry offered in live chat `@` mention autocomplete. */
export type MentionCandidate = {
  id: string
  name: string
  handle?: string | null
  avatar?: string | null
}

/** One slice of plain text split around `@` mention tokens. */
export type MentionRunPart = {
  text: string
  mention?: string
}

const MENTION_PATTERN = /(^|[\s([{"',;:!?])(@[^\s@,;:!?()[\]{}"']+)/g

/** Splits `text` into plain segments and `@` mention tokens while ignoring email addresses. */
export const splitMentionRuns = (text: string): MentionRunPart[] => {
  if (!text) return [{ text }]
  const parts: MentionRunPart[] = []
  let last = 0
  MENTION_PATTERN.lastIndex = 0
  for (;;) {
    const match = MENTION_PATTERN.exec(text)
    if (!match) break
    const prefix = match[1] ?? ''
    const mention = match[2]!.replace(/\.+$/, '')
    if (mention.length <= 1) continue
    const mentionStart = match.index + prefix.length
    if (mentionStart > last) parts.push({ text: text.slice(last, mentionStart) })
    parts.push({ text: mention, mention })
    last = mentionStart + mention.length
  }
  if (parts.length === 0) return [{ text }]
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

const ACTIVE_MENTION = /(?:^|[\s([{"',;:!?])@([^\s@,;:!?()[\]{}"']*)$/

/** Returns the active `@query` span right before `caret` for mention autocomplete, or `undefined`. */
export const activeMentionQuery = (
  draft: string,
  caret: number,
): { start: number, query: string } | undefined => {
  const clamped = Math.max(0, Math.min(caret, draft.length))
  const before = draft.slice(0, clamped)
  const match = ACTIVE_MENTION.exec(before)
  if (!match) return undefined
  const query = match[1] ?? ''
  return {
    start: clamped - query.length - 1,
    query,
  }
}

/** Returns the string to insert after `@` for a chat author (`handle` without leading `@`, or `name`). */
export const mentionTagFor = (candidate: Pick<MentionCandidate, 'name' | 'handle'>): string => {
  const handle = candidate.handle?.trim()
  if (handle) return handle.startsWith('@') ? handle.slice(1) : handle
  return candidate.name.trim()
}

/** Replaces `@query` spanning `[start, caret]` in `draft` with `@tag ` and returns the updated text and caret. */
export const applyMention = (
  draft: string,
  start: number,
  caret: number,
  tagOrHandle: string,
): { value: string, cursor: number } => {
  const tag = tagOrHandle.startsWith('@') ? tagOrHandle.slice(1) : tagOrHandle
  const from = Math.max(0, Math.min(start, draft.length))
  const to = Math.max(from, Math.min(caret, draft.length))
  const inserted = `@${tag} `
  return {
    value: `${draft.slice(0, from)}${inserted}${draft.slice(to)}`,
    cursor: from + inserted.length,
  }
}

/** Filters recent deduplicated chat authors against a partial `@` query, newest first. */
export const filterMentionCandidates = (
  authors: readonly MentionCandidate[],
  query: string,
  limit = 6,
): MentionCandidate[] => {
  const needle = query.trim().toLowerCase()
  const out: MentionCandidate[] = []
  const seen = new Set<string>()
  for (let index = authors.length - 1; index >= 0; index -= 1) {
    const candidate = authors[index]!
    const tag = mentionTagFor(candidate)
    if (!tag || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    if (
      needle.length === 0
      || candidate.name.toLowerCase().includes(needle)
      || tag.toLowerCase().includes(needle)
    ) {
      out.push(candidate)
      if (out.length >= limit) break
    }
  }
  return out
}

const stripAt = (value: string | null | undefined) => {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return undefined
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
}

/** Whether `mention` matches the signed-in viewer's handle or channel name. */
export const isSelfMention = (
  mention: string,
  self?: { name?: string | null, handle?: string | null },
): boolean => {
  const token = stripAt(mention)
  if (!token || !self) return false
  const handle = stripAt(self.handle)
  const name = stripAt(self.name)
  return Boolean((handle && token === handle) || (name && token === name))
}
