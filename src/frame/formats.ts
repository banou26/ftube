import { BinaryReader, WireType } from '@bufbuild/protobuf/wire'

export type AdaptiveFormat = {
  has_audio?: boolean
  has_video?: boolean
  xtags?: string
  is_drc?: boolean
  is_vb?: boolean
  is_dubbed?: boolean
  is_auto_dubbed?: boolean
  is_descriptive?: boolean
  is_secondary?: boolean
  is_original?: boolean
  audio_track?: { id?: string, display_name?: string }
}

/** One logical audio language track of a video, collapsed across bitrates, codecs and DRC variants. */
export type AudioTrack = {
  id: string
  label: string
  language?: string
  original: boolean
  autoDubbed: boolean
  hasDrc: boolean
}

export type AudioFormatLike = {
  itag: number
  mimeType: string
  bitrate: number
  audioTrackId?: string
  audioTrackName?: string
  isOriginal?: boolean
  isAutoDubbed?: boolean
  isDrc?: boolean
  language?: string
}

export type VideoFormatLike = {
  mimeType: string
  bitrate: number
  width?: number
  height?: number
}

export type VideoSelection = {
  maxHeight?: number
  cover?: { width: number, height: number }
  pinnedHeight?: number
}

/**
 * Picks the opening video format for a SABR session.
 *
 * - `pinnedHeight`: exact manual height when available.
 * - `cover`: smallest format covering an `object-fit: contain` box (`width >= boxW || height >= boxH`) at >= 1:1
 *   physical pixels (used by Shorts so vertical, 4:5 and landscape Shorts never over-fetch 1440p/4K or upscale 360p).
 * - default: largest format whose short side is at most `maxHeight`, preferring the lowest bitrate at that tier.
 */
export const pickInitialVideoFormat = <Format extends VideoFormatLike>(
  videoFormats: readonly Format[],
  { maxHeight = 1_080, cover, pinnedHeight }: VideoSelection = {},
  isSupported: (mimeType: string) => boolean = (mimeType) =>
    typeof MediaSource === 'undefined' || MediaSource.isTypeSupported(mimeType),
): Format | undefined => {
  const supported = videoFormats.filter((format) => format.width && format.height && isSupported(format.mimeType))
  if (supported.length === 0) return undefined
  const shortSide = (format: Format) => Math.min(format.width!, format.height!)
  if (pinnedHeight !== undefined) {
    const exact = supported
      .filter((format) => format.height === pinnedHeight)
      .sort((a, b) => b.bitrate - a.bitrate)[0]
    if (exact) return exact
  }
  if (cover && cover.width > 0 && cover.height > 0) {
    const covering = supported
      .filter((format) => format.width! >= cover.width || format.height! >= cover.height)
      .sort((a, b) => shortSide(a) - shortSide(b) || a.bitrate - b.bitrate)[0]
    return covering ?? [...supported].sort((a, b) => shortSide(b) - shortSide(a) || a.bitrate - b.bitrate)[0]
  }
  return supported
    .filter((format) => shortSide(format) <= maxHeight)
    .sort((a, b) => shortSide(b) - shortSide(a) || a.bitrate - b.bitrate)[0]
    ?? supported[0]
}

type XTag = { key: string, value: string }

const KNOWN_AUDIO_XTAGS = new Set(['acont', 'lang', 'drc'])

const decodeBase64 = (input: string) => {
  const normalized = decodeURIComponent(input).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, '=')
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
  return out
}

// YouTube encodes FormatXTags as repeated field 1 messages carrying field 1 (key) and field 2 (value) strings
const decodeXtags = (xtags: string): XTag[] | undefined => {
  try {
    const reader = new BinaryReader(decodeBase64(xtags))
    const tags: XTag[] = []
    while (reader.pos < reader.len) {
      const [field, wireType] = reader.tag()
      if (field !== 1 || wireType !== WireType.LengthDelimited) return undefined
      const inner = new BinaryReader(reader.bytes())
      let key = ''
      let value = ''
      while (inner.pos < inner.len) {
        const [innerField, innerType] = inner.tag()
        if (innerField === 1 && innerType === WireType.LengthDelimited) key = inner.string()
        else if (innerField === 2 && innerType === WireType.LengthDelimited) value = inner.string()
        else return undefined
      }
      if (!key) return undefined
      tags.push({ key, value })
    }
    return tags.length > 0 ? tags : undefined
  } catch {
    return undefined
  }
}

const isAudioOnly = (format: AdaptiveFormat) => Boolean(format.has_audio) && !format.has_video

const isDisallowedTag = (tag: XTag) =>
  tag.key === 'vb' || (tag.key === 'acont' && (tag.value === 'descriptive' || tag.value === 'secondary'))

const isUnwantedAudio = (format: AdaptiveFormat) => {
  if (format.is_vb || format.is_descriptive || format.is_secondary) return true
  if (!format.xtags) return false
  const tags = decodeXtags(format.xtags)
  return Boolean(tags?.some(isDisallowedTag))
}

const hasUnknownXtags = (format: AdaptiveFormat) => {
  if (!format.xtags) return false
  const tags = decodeXtags(format.xtags)
  if (tags) return tags.some((tag) => !KNOWN_AUDIO_XTAGS.has(tag.key))
  return !(format.is_drc || format.is_dubbed || format.is_auto_dubbed || format.is_original || format.audio_track?.id)
}

/**
 * Keeps video formats and playable audio formats: original, dubbed, auto-dubbed, and DRC variants, while dropping
 * `vb=1` (Voice Boost, which answers 403 on every segment), descriptive/secondary tracks, and unrecognized xtag
 * siblings. Pass `singleTrack: true` for live streams, whose manifest generator serves one audio track.
 */
export const playableFormats = <Format extends AdaptiveFormat>(
  formats: Format[],
  { singleTrack = false }: { singleTrack?: boolean } = {},
): Format[] => {
  const allAudio = formats.filter(isAudioOnly)
  const allowed = allAudio.filter((format) => !isUnwantedAudio(format))
  const known = allowed.filter((format) => !hasUnknownXtags(format))
  let kept = known.length > 0 ? known : allowed.length > 0 ? allowed : allAudio
  // youtubei.js's toDash drops trackless audio formats when any audio format carries audio_track, so match it here
  if (kept.some((format) => Boolean(format.audio_track?.id))) {
    kept = kept.filter((format) => Boolean(format.audio_track?.id))
  }
  if (singleTrack) {
    const plain = kept.filter((format) => !format.is_drc && !format.is_dubbed && !format.is_auto_dubbed)
    const originals = plain.filter((format) => format.is_original)
    kept = originals.length > 0 ? originals : plain.length > 0 ? plain : kept
  }
  // identity set, so the caller's ordering survives
  const keep = new Set<Format>(kept)
  return formats.filter((format) => !isAudioOnly(format) || keep.has(format))
}

/** Distinct audio language tracks present in `audioFormats`, original first then alphabetical by label. */
export const audioTracksOf = (audioFormats: readonly AudioFormatLike[]): AudioTrack[] => {
  const groups = new Map<string, AudioFormatLike[]>()
  for (const format of audioFormats) {
    if (!format.audioTrackId) continue
    const list = groups.get(format.audioTrackId)
    if (list) list.push(format)
    else groups.set(format.audioTrackId, [format])
  }
  return [...groups.entries()]
    .map(([id, group]): AudioTrack => {
      const original = group.some((format) => format.isOriginal)
      const hasDrc = group.some((format) => format.isDrc) && group.some((format) => !format.isDrc)
      return {
        id,
        label: group.find((format) => format.audioTrackName)?.audioTrackName
          ?? group.find((format) => format.language)?.language
          ?? id,
        language: group.find((format) => format.language)?.language,
        original,
        autoDubbed: !original && group.some((format) => format.isAutoDubbed),
        hasDrc,
      }
    })
    .sort((a, b) => Number(b.original) - Number(a.original) || a.label.localeCompare(b.label))
}

/** Whether the active track (or the sole track of a single-track video) has both plain and DRC variants to toggle between. */
export const trackHasDrc = (audioFormats: readonly AudioFormatLike[], trackId?: string) => {
  const matching = trackId === undefined
    ? audioFormats
    : audioFormats.filter((format) => format.audioTrackId === trackId)
  return matching.some((format) => format.isDrc) && matching.some((format) => !format.isDrc)
}

/**
 * Picks the best audio format for a logical track and Stable Volume (DRC) preference.
 * When `trackId` is omitted, always prefers the original track rather than a dub or auto-dub.
 */
export const pickAudioFormat = <Format extends AudioFormatLike>(
  audioFormats: readonly Format[],
  { trackId, drc = false }: { trackId?: string, drc?: boolean } = {},
): Format | undefined => {
  if (audioFormats.length === 0) return undefined
  let trackGroup: Format[]
  if (trackId !== undefined) {
    trackGroup = audioFormats.filter((format) => format.audioTrackId === trackId)
  } else {
    trackGroup = []
  }
  if (trackGroup.length === 0) {
    if (audioFormats.some((format) => format.audioTrackId)) {
      const preferred = audioFormats.find((format) => format.audioTrackId && format.isOriginal && !format.isAutoDubbed)
        ?? audioFormats.find((format) => format.audioTrackId && !format.isAutoDubbed)
        ?? audioFormats.find((format) => format.audioTrackId)
      trackGroup = preferred
        ? audioFormats.filter((format) => format.audioTrackId === preferred.audioTrackId)
        : [...audioFormats]
    } else {
      trackGroup = [...audioFormats]
    }
  }
  const drcMatched = trackGroup.filter((format) => Boolean(format.isDrc) === drc)
  const pool = drcMatched.length > 0 ? drcMatched : trackGroup
  return [...pool].sort((a, b) =>
    Number(b.mimeType.includes('opus')) - Number(a.mimeType.includes('opus')) || b.bitrate - a.bitrate,
  )[0]
}

/** DASH `<Representation id>` emitted by youtubei.js `toDash` for a VOD audio format (Shaka's `originalAudioId`). */
export const audioRepresentationId = (format: Pick<AudioFormatLike, 'itag' | 'audioTrackId' | 'isDrc'>) => {
  const parts = [String(format.itag)]
  if (format.audioTrackId) parts.push(format.audioTrackId)
  if (format.isDrc) parts.push('drc')
  return parts.join('-')
}

/** DASH `<Label>` emitted by youtubei.js `toDash` for a VOD audio AdaptationSet. */
export const audioManifestLabel = (format: Pick<AudioFormatLike, 'audioTrackName' | 'isDrc'>, hasAnyDrc: boolean) => {
  if (format.audioTrackName) {
    return hasAnyDrc && format.isDrc ? `${format.audioTrackName} (Stable Volume)` : format.audioTrackName
  }
  if (hasAnyDrc) return format.isDrc ? 'Stable Volume' : 'Original'
  return ''
}

/** First DASH `<Role>` emitted by youtubei.js `toDash` for a VOD audio AdaptationSet. */
export const audioManifestRole = (format: Pick<AudioFormatLike, 'audioTrackId' | 'isOriginal'>, hasAnyDrc: boolean) => {
  if (!format.audioTrackId && !hasAnyDrc) return ''
  return format.isOriginal ? 'main' : 'alternate'
}
