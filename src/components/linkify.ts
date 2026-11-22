import type { RichTextRun } from './rich-text'

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const VIDEO_ID = /^[\w-]{11}$/
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?'])
const CLOSING_BRACKETS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

const countChar = (value: string, target: string) => {
  let count = 0
  for (const character of value) {
    if (character === target) count += 1
  }
  return count
}

const trimTrailingPunctuation = (raw: string) => {
  let value = raw
  while (value.length > 0) {
    const last = value.at(-1)!
    if (TRAILING_PUNCTUATION.has(last)) {
      value = value.slice(0, -1)
      continue
    }
    const opener = CLOSING_BRACKETS[last]
    if (opener && countChar(value, last) > countChar(value, opener)) {
      value = value.slice(0, -1)
      continue
    }
    break
  }
  return value
}

const youtubeVideoId = (parsed: URL) => {
  if (parsed.searchParams.has('list')) return undefined
  const host = parsed.hostname.toLowerCase()
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const match = parsed.pathname.match(/^\/([\w-]{11})\/?$/)
    return match?.[1]
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname !== '/watch') return undefined
    const id = parsed.searchParams.get('v')
    return id && VIDEO_ID.test(id) ? id : undefined
  }
  return undefined
}

const linkRunFor = (candidate: string): RichTextRun | undefined => {
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return undefined
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return undefined
  const videoId = youtubeVideoId(parsed)
  return videoId ? { text: candidate, videoId } : { text: candidate, url: parsed.href }
}

/**
 * Splits plain text into rich-text runs with http(s) URLs linked.
 *
 * Plain `youtu.be/<id>` and `youtube.com/watch?v=<id>` links become internal
 * `videoId` runs so RichText routes them in-app; all other http(s) URLs become
 * external `url` runs. Trailing sentence punctuation and unmatched closing
 * brackets stay outside the link.
 */
export const linkifyText = (text: string): RichTextRun[] => {
  if (!text) return []
  const runs: RichTextRun[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index
    const candidate = trimTrailingPunctuation(match[0])
    const link = linkRunFor(candidate)
    if (!link) continue
    if (start > cursor) runs.push({ text: text.slice(cursor, start) })
    runs.push(link)
    cursor = start + candidate.length
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) })
  return runs
}

const isLinked = (run: RichTextRun) => Boolean(run.url || run.videoId || run.browseId)

const trimEdgeBlankLines = (runs: RichTextRun[]): RichTextRun[] => {
  const result = [...runs]
  while (result.length > 0 && !isLinked(result[0]!)) {
    const trimmed = result[0]!.text.replace(/^(?:\r?\n)+/, '')
    if (trimmed.length === 0) {
      result.shift()
      continue
    }
    result[0] = { ...result[0]!, text: trimmed }
    break
  }
  while (result.length > 0 && !isLinked(result.at(-1)!)) {
    const last = result.at(-1)!
    const trimmed = last.text.replace(/(?:\r?\n)+$/, '')
    if (trimmed.length === 0) {
      result.pop()
      continue
    }
    result[result.length - 1] = { ...last, text: trimmed }
    break
  }
  return result
}

/**
 * Produces clickable rich-text runs for a description, preserving structured
 * upstream runs when present and linkifying any unlinked http(s) URLs in plain
 * text runs or in the fallback description string.
 */
export const linkifyRuns = (description: string, runs?: readonly RichTextRun[] | null): RichTextRun[] => {
  const source: readonly RichTextRun[] = runs && runs.length > 0 ? runs : [{ text: description }]
  const expanded = source.flatMap((run) => (isLinked(run) ? [run] : linkifyText(run.text)))
  return trimEdgeBlankLines(expanded)
}
