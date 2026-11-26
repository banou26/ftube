/** Inclusive-start, exclusive-end playback interval in milliseconds for a cropped download. */
export type TrimRange = {
  startMs: number
  endMs: number
}

/** Minimum allowed cropped clip length (1 second). */
export const MIN_CLIP_MS = 1_000

/** Formats non-negative whole seconds into `m:ss` or `h:mm:ss`. */
export const formatClockSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Formats milliseconds into `m:ss` or `h:mm:ss` for clip controls and labels. */
export const formatTimestamp = (ms: number): string =>
  formatClockSeconds(Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000)))

/** Parses `ss`, `mm:ss`, or `hh:mm:ss` (with optional decimals on seconds) into milliseconds. */
export const parseTimestamp = (input: string, maxDurationMs?: number): number | undefined => {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const parts = trimmed.split(':')
  if (parts.length > 3) return undefined
  if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return undefined

  let secondsTotal = 0
  if (parts.length === 1) {
    secondsTotal = Number.parseFloat(parts[0]!)
  } else if (parts.length === 2) {
    const mins = Number.parseFloat(parts[0]!)
    const secs = Number.parseFloat(parts[1]!)
    if (!Number.isInteger(mins) || secs >= 60) return undefined
    secondsTotal = mins * 60 + secs
  } else {
    const hrs = Number.parseFloat(parts[0]!)
    const mins = Number.parseFloat(parts[1]!)
    const secs = Number.parseFloat(parts[2]!)
    if (!Number.isInteger(hrs) || !Number.isInteger(mins) || mins >= 60 || secs >= 60) return undefined
    secondsTotal = hrs * 3600 + mins * 60 + secs
  }

  if (!Number.isFinite(secondsTotal) || secondsTotal < 0) return undefined
  const ms = Math.round(secondsTotal * 1000)
  return maxDurationMs !== undefined ? Math.min(Math.max(0, maxDurationMs), ms) : ms
}

/** Clamps `(startMs, endMs)` within `[0, durationMs]` while enforcing `minSpanMs`. */
export const clampTrimRange = (
  startMs: number,
  endMs: number,
  durationMs: number,
  minSpanMs = MIN_CLIP_MS,
): TrimRange => {
  const duration = Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0))
  const span = Math.min(duration, Math.max(0, Math.round(minSpanMs)))
  let start = Math.max(0, Math.min(duration - span, Math.round(Number.isFinite(startMs) ? startMs : 0)))
  let end = Math.max(start + span, Math.min(duration, Math.round(Number.isFinite(endMs) ? endMs : duration)))
  if (end - start < span) {
    start = Math.max(0, end - span)
    end = Math.min(duration, start + span)
  }
  return { startMs: start, endMs: end }
}

/** Returns whether `trim` covers essentially the whole video duration. */
export const isFullRange = (
  trim: TrimRange | undefined,
  durationMs: number,
  toleranceMs = 500,
): boolean => {
  if (!trim) return true
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false
  return trim.startMs <= toleranceMs && trim.endMs >= Math.max(0, durationMs - toleranceMs)
}

/** Clamps `trim` to `durationMs` and returns `undefined` when it covers the full duration or `durationMs` is unset. */
export const normalizeTrimRange = (
  trim: TrimRange | undefined,
  durationMs: number | undefined,
): TrimRange | undefined => {
  if (!trim || !durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return undefined
  const clamped = clampTrimRange(trim.startMs, trim.endMs, durationMs, MIN_CLIP_MS)
  return isFullRange(clamped, durationMs) ? undefined : clamped
}

/** Proportionally scales full-stream byte estimate to the cropped `[startMs, endMs]` clip span. */
export const estimateTrimmedBytes = (
  fullBytes: number | undefined,
  durationMs: number,
  trim: TrimRange | undefined,
): number | undefined => {
  if (fullBytes === undefined || !Number.isFinite(fullBytes) || fullBytes <= 0) return fullBytes
  if (!trim || !Number.isFinite(durationMs) || durationMs <= 0 || isFullRange(trim, durationMs)) return fullBytes
  const clipMs = Math.max(1, trim.endMs - trim.startMs)
  const scaled = Math.round((fullBytes * clipMs) / durationMs)
  return Math.min(fullBytes, Math.max(1024, scaled))
}

/** Formats a display badge like `0:04 - 0:12` using plain ASCII hyphens. */
export const formatClipLabel = (trim: TrimRange): string =>
  `${formatTimestamp(trim.startMs)} - ${formatTimestamp(trim.endMs)}`

const formatFilenameToken = (ms: number): string => {
  const safeSec = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000))
  const hours = Math.floor(safeSec / 3600)
  const minutes = Math.floor((safeSec % 3600) / 60)
  const seconds = safeSec % 60
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`
  }
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** Formats a filesystem-safe suffix like `0m04s-0m12s` with no colons or path separators. */
export const formatClipFilenameSuffix = (trim: TrimRange): string =>
  `${formatFilenameToken(trim.startMs)}-${formatFilenameToken(trim.endMs)}`
