export type CaptionTrack = {
  // `id` is YouTube's own `vss_id` and the app hands it straight back to ask for cues, so the frame never accepts a URL from the app realm
  id: string
  languageCode: string
  label: string
  auto: boolean
  // whether YouTube's Auto-translate accepts this track
  translatable: boolean
  // the track YouTube's answer recommends showing to this viewer: set only when the default audio track's caption state starts with `ON_`
  recommended?: true
}

export type CaptionSource = CaptionTrack & { url: string }

/** A language YouTube's Auto-translate turns the video's translatable tracks into. */
export type TranslationLanguage = { languageCode: string, label: string }

/** What the captions show: a track, or YouTube's Auto-translate of it into `translateTo`. */
export type CaptionPick = { trackId: string, translateTo?: string }

type RawTracklist = {
  caption_tracks?: {
    base_url?: string
    name?: string | { text?: string }
    vss_id?: string
    language_code?: string
    kind?: string
    is_translatable?: boolean
  }[]
  translation_languages?: {
    language_code?: string
    language_name?: string | { text?: string }
  }[]
  audio_tracks?: {
    captions_initial_state?: string
    default_caption_track_index?: number
  }[]
  default_audio_track_index?: number
}

const nameOf = (name: string | { text?: string } | undefined) =>
  (typeof name === 'string' ? name : name?.text) ?? ''

export const parseCaptionTracks = (tracklist: RawTracklist | undefined): CaptionSource[] => {
  const tracks = tracklist?.caption_tracks ?? []
  const audio = tracklist?.audio_tracks?.[tracklist.default_audio_track_index ?? 0]
  const recommended = audio?.captions_initial_state?.startsWith('CAPTIONS_INITIAL_STATE_ON_')
    ? audio.default_caption_track_index ?? 0
    : undefined
  const seen = new Set<string>()
  return tracks.flatMap((track, index) => {
    const url = track.base_url
    const languageCode = track.language_code ?? ''
    if (!url || !languageCode) return []
    const auto = track.kind === 'asr'
    const id = track.vss_id || `${auto ? 'a' : ''}.${languageCode}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      languageCode,
      label: nameOf(track.name) || languageCode,
      auto,
      translatable: track.is_translatable === true,
      ...(index === recommended ? { recommended: true as const } : {}),
      url,
    }]
  })
}

export const parseTranslationLanguages = (tracklist: RawTracklist | undefined): TranslationLanguage[] =>
  (tracklist?.translation_languages ?? []).flatMap(({ language_code: languageCode, language_name: name }) =>
    languageCode ? [{ languageCode, label: nameOf(name) || languageCode }] : [])

export const preferredTrack = (tracks: CaptionTrack[], language: string | undefined) => {
  if (tracks.length === 0) return undefined
  const rank = (track: CaptionTrack) => (track.auto ? 1 : 0)
  const byRank = (a: CaptionTrack, b: CaptionTrack) => rank(a) - rank(b)
  if (language) {
    const base = language.split('-')[0]?.toLowerCase()
    const exact = tracks.filter((track) => track.languageCode.toLowerCase() === language.toLowerCase())
    if (exact.length > 0) return exact.sort(byRank)[0]
    const loose = tracks.filter((track) => track.languageCode.split('-')[0]?.toLowerCase() === base)
    if (loose.length > 0) return loose.sort(byRank)[0]
    // a stored language the video does not publish means no captions, rather than a language the viewer never asked for
    return undefined
  }
  return [...tracks].sort(byRank)[0]
}

/** The track captions turn on with when no language was picked: the one YouTube recommends, else one in the browser's language, else the first listed. */
export const defaultTrack = (tracks: CaptionTrack[], browserLanguage: string | undefined) =>
  tracks.find((track) => track.recommended) ?? preferredTrack(tracks, browserLanguage) ?? preferredTrack(tracks, undefined)

type CaptionChoice = { captionsChosen?: boolean, captionsEnabled: boolean, captionsLanguage?: string }

/** The track a video starts with: the person's own choice once they turned captions on or off, else the one YouTube recommends, if any. */
export const startingTrack = (tracks: CaptionTrack[], choice: CaptionChoice, browserLanguage: string | undefined) => {
  if (!choice.captionsChosen) return tracks.find((track) => track.recommended)
  if (!choice.captionsEnabled) return undefined
  return choice.captionsLanguage ? preferredTrack(tracks, choice.captionsLanguage) : defaultTrack(tracks, browserLanguage)
}

/**
 * The captions a remembered language asks for: the video's own track in it, else the Auto-translate of its preferred
 * translatable track into it, as youtube.com does with the language it remembers from an Auto-translate.
 */
export const preferredCaption = (
  tracks: CaptionTrack[],
  translations: TranslationLanguage[],
  language: string | undefined,
): CaptionPick | undefined => {
  const track = preferredTrack(tracks, language)
  if (track) return { trackId: track.id }
  if (!language) return undefined
  const lower = language.toLowerCase()
  const base = lower.split('-')[0]
  const target = translations.find((candidate) => candidate.languageCode.toLowerCase() === lower)
    ?? translations.find((candidate) => candidate.languageCode.split('-')[0]?.toLowerCase() === base)
  const source = preferredTrack(tracks.filter((candidate) => candidate.translatable), undefined)
  return target && source ? { trackId: source.id, translateTo: target.languageCode } : undefined
}

/** The caption choice a video starts with, falling back to Auto-translate when the remembered language has no native track. */
export const startingCaption = (
  tracks: CaptionTrack[],
  translations: TranslationLanguage[],
  choice: CaptionChoice,
  browserLanguage: string | undefined,
): CaptionPick | undefined => {
  if (!choice.captionsChosen) {
    const recommended = tracks.find((track) => track.recommended)
    return recommended ? { trackId: recommended.id } : undefined
  }
  if (!choice.captionsEnabled) return undefined
  if (choice.captionsLanguage) return preferredCaption(tracks, translations, choice.captionsLanguage)
  const fallback = defaultTrack(tracks, browserLanguage)
  return fallback ? { trackId: fallback.id } : undefined
}

/** youtube.com's name for a caption pick: the track's label, or `<track> >> <language>` for Auto-translate. */
export const captionLabel = (
  tracks: CaptionTrack[],
  translations: TranslationLanguage[],
  pick: CaptionPick | undefined,
) => {
  const track = tracks.find((candidate) => candidate.id === pick?.trackId)
  const target = translations.find((candidate) => candidate.languageCode === pick?.translateTo)
  return track && (target ? `${track.label} >> ${target.label}` : track.label)
}

// one `fmt=json3` event: every field is optional, and `aAppend` marks an event that re-states the line before it so a rolling caption can grow a word at a time
type Json3Event = {
  tStartMs?: number
  dDurationMs?: number
  aAppend?: number
  segs?: { utf8?: string, tOffsetMs?: number }[]
}

export type Cue = { startMs: number, endMs: number, text: string }

const ORPHAN_CUE_MS = 4_000

const pad = (value: number, width: number) => String(value).padStart(width, '0')

const timestamp = (totalMs: number) => {
  const ms = Math.max(0, Math.round(totalMs))
  const seconds = Math.floor(ms / 1_000)
  return `${pad(Math.floor(seconds / 3_600), 2)}:${pad(Math.floor(seconds / 60) % 60, 2)}:${pad(seconds % 60, 2)}.${pad(ms % 1_000, 3)}`
}

const escapeCueText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const parseJson3 = (body: string): Cue[] => {
  let events: Json3Event[]
  try {
    const parsed = JSON.parse(body) as { events?: Json3Event[] }
    events = Array.isArray(parsed.events) ? parsed.events : []
  } catch {
    return []
  }

  const cues: Cue[] = []
  for (const event of events) {
    if (event.aAppend) continue
    const startMs = Number(event.tStartMs)
    if (!Number.isFinite(startMs) || startMs < 0) continue
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? '').join('').trim()
    if (!text) continue
    const durationMs = Number(event.dDurationMs)
    cues.push({
      startMs,
      endMs: Number.isFinite(durationMs) && durationMs > 0 ? startMs + durationMs : Number.NaN,
      text,
    })
  }

  cues.sort((a, b) => a.startMs - b.startMs)

  // generated tracks overlap on purpose so the line appears to scroll, so every cue is cut at the next one's start
  return cues
    .map((cue, index) => {
      const next = cues[index + 1]?.startMs
      const endMs = Number.isFinite(cue.endMs)
        ? Math.min(cue.endMs, next ?? cue.endMs)
        : next ?? cue.startMs + ORPHAN_CUE_MS
      return { ...cue, endMs }
    })
    .filter((cue) => cue.endMs > cue.startMs)
}

export const toWebVtt = (cues: Cue[]) =>
  ['WEBVTT', '', ...cues.flatMap((cue) => [
    `${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}`,
    escapeCueText(cue.text),
    '',
  ])].join('\n')

export const json3ToWebVtt = (body: string) => toWebVtt(parseJson3(body))

// every other parameter is preserved: `base_url` arrives signed, and those parameters are what authorize it
export const timedTextUrl = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.searchParams.set('fmt', 'json3')
  return url.toString()
}

/**
 * youtube.com's request for an Auto-translate: the watch page's own signed caption address with `tlang`, the
 * video-bound PO token, and `c=WEB`. Without a valid token that address answers 200 with an empty body.
 */
export const translatedTextUrl = (baseUrl: string, translateTo: string, poToken: string) => {
  const url = new URL(timedTextUrl(baseUrl))
  url.searchParams.set('tlang', translateTo)
  url.searchParams.set('potc', '1')
  url.searchParams.set('pot', poToken)
  url.searchParams.set('c', 'WEB')
  return url.toString()
}
