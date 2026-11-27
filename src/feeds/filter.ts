import type { CustomFeedFilter, DurationFilter, DurationPreset, FeedViewSettings, UploadDatePreset } from './settings'

import { WATCHED_PERCENT } from '../groups/filter'
import { isAllowedWithHideShorts } from '../shorts-filter'

export type FilterableChannel = {
  id?: string | null
  name?: string | null
  handle?: string | null
}

export type FilterableVideo = {
  title?: string | null
  description?: string | null
  descriptionSnippet?: string | null
  durationSeconds?: number | null
  publishedText?: string | null
  publishedAt?: string | null
  isLive?: boolean | null
  isUpcoming?: boolean | null
  isShort?: boolean | null
  isMostRelevant?: boolean | null
  progressPercent?: number | null
  badges?: readonly string[] | null
  thumbnailBadge?: string | null
  channel?: FilterableChannel | null
  byline?: readonly { text: string }[] | null
  collaborators?: readonly FilterableChannel[] | null
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 31 * DAY_MS
const YEAR_MS = 366 * DAY_MS

const PREMIERE_RE = /(?:^|[^\p{L}\p{N}])premi[eè]re(?=$|[^\p{L}\p{N}])/iu
const UPCOMING_RE = /(?:^|[^\p{L}\p{N}])(?:upcoming|scheduled|a venir|à venir|premiere scheduled)(?=$|[^\p{L}\p{N}])/iu
const PAST_STREAM_RE = /(?:^|[^\p{L}\p{N}])(?:streamed|diffus[eé]|transmitido|gestreamt|trasmesso)(?=$|[^\p{L}\p{N}])|配信済み/iu
const MOST_RELEVANT_TITLE_RE = /^(most relevant|les plus pertinents?|m[aá]s relevantes?|am relevantesten)$/i
const JUST_NOW_RE = /(?:^|[^\p{L}\p{N}])(?:just now|seconds? ago|à l'instant|il y a quelques secondes)(?=$|[^\p{L}\p{N}])/iu

// Ordered multi-character units first so 'sem' matches before 's' and 'mois'/'monat' before 'm'.
const RELATIVE_UNIT_MS: readonly [RegExp, number][] = [
  [/^(?:months?|mois|mes(?:es)?|monat(?:e|en)?|mo)/, MONTH_MS],
  [/^(?:years?|ans?|a(?:ños?|ño|nnee|nnées)?|jahre?n?|y)/, YEAR_MS],
  [/^(?:weeks?|semaines?|sem\.?|semanas?|wochen?|w)/, WEEK_MS],
  [/^(?:days?|jours?|d[ií]as?|tage?n?|j|d)/, DAY_MS],
  [/^(?:hours?|heures?|horas?|stunden?|h)/, HOUR_MS],
  [/^(?:minutes?|mins?|minuten?|min|m)/, MINUTE_MS],
  [/^(?:seconds?|secondes?|segundos?|sekunden?|sec|s)/, 1_000],
]

export const isPremiereVideo = (video: Pick<FilterableVideo, 'badges' | 'thumbnailBadge'>): boolean =>
  video.badges?.some(badge => PREMIERE_RE.test(badge)) === true
  || (typeof video.thumbnailBadge === 'string' && PREMIERE_RE.test(video.thumbnailBadge))

export const isUpcomingVideo = (video: Pick<FilterableVideo, 'isUpcoming' | 'badges' | 'thumbnailBadge'>): boolean =>
  video.isUpcoming === true
  || video.badges?.some(badge => UPCOMING_RE.test(badge)) === true
  || (typeof video.thumbnailBadge === 'string' && UPCOMING_RE.test(video.thumbnailBadge))

export const isPastStreamVideo = (video: Pick<FilterableVideo, 'isLive' | 'publishedText'>): boolean =>
  video.isLive !== true
  && typeof video.publishedText === 'string'
  && PAST_STREAM_RE.test(video.publishedText)

export const isWatchedVideo = (video: Pick<FilterableVideo, 'progressPercent'>): boolean =>
  (video.progressPercent ?? 0) >= WATCHED_PERCENT

export const isMostRelevantShelfTitle = (title?: string | null): boolean =>
  typeof title === 'string' && MOST_RELEVANT_TITLE_RE.test(title.trim())

/**
 * Estimates age in milliseconds from ISO `publishedAt` or localized relative strings such as
 * `"3 hours ago"`, `"Streamed 2 days ago"`, `"il y a 1 h"`, or `"Diffusé il y a 2 sem."`.
 */
export const parseRelativeAgeMs = (
  publishedText?: string | null,
  publishedAt?: string | null,
  now = Date.now(),
): number | undefined => {
  if (publishedAt) {
    const parsed = Date.parse(publishedAt)
    if (!Number.isNaN(parsed)) return Math.max(0, now - parsed)
  }
  if (!publishedText) return undefined
  const text = publishedText.trim()
  if (!text) return undefined
  if (JUST_NOW_RE.test(text)) return 0

  const match = text.match(/(?:il y a\s+)?(\d+)\s*([^\s\d.,/]+(?:\s+[^\s\d.,/]+)?)/i)
  if (!match) return undefined
  const count = Number(match[1])
  if (!Number.isFinite(count)) return undefined
  const unitToken = match[2]!.toLowerCase()
  const matched = RELATIVE_UNIT_MS.find(([pattern]) => pattern.test(unitToken))
  return matched ? count * matched[1] : undefined
}

export const matchesDurationRule = (
  durationSeconds: number | null | undefined,
  preset: DurationPreset,
  minMinutes?: number,
  maxMinutes?: number,
): boolean => {
  if (preset === 'any') return true
  if (durationSeconds === null || durationSeconds === undefined || durationSeconds <= 0) return false
  if (preset === 'under4') return durationSeconds < 4 * 60
  if (preset === '4to20') return durationSeconds >= 4 * 60 && durationSeconds <= 20 * 60
  if (preset === 'over20') return durationSeconds > 20 * 60
  if (minMinutes !== undefined && durationSeconds < minMinutes * 60) return false
  if (maxMinutes !== undefined && durationSeconds > maxMinutes * 60) return false
  return true
}

const UPLOAD_DATE_LIMIT_MS: Record<Exclude<UploadDatePreset, 'any'>, number> = {
  today: DAY_MS,
  week: WEEK_MS,
  month: MONTH_MS,
  year: YEAR_MS,
}

export const matchesUploadDateRule = (
  video: Pick<FilterableVideo, 'publishedText' | 'publishedAt'>,
  preset: UploadDatePreset,
  now = Date.now(),
): boolean => {
  if (preset === 'any') return true
  const ageMs = parseRelativeAgeMs(video.publishedText, video.publishedAt, now)
  if (ageMs === undefined) return false
  return ageMs <= UPLOAD_DATE_LIMIT_MS[preset]
}

const channelText = (video: Pick<FilterableVideo, 'channel' | 'byline' | 'collaborators'>): string =>
  [
    video.channel?.name,
    video.channel?.handle,
    ...(video.byline?.map(part => part.text) ?? []),
    ...(video.collaborators?.map(channel => `${channel.name ?? ''} ${channel.handle ?? ''}`) ?? []),
  ]
    .filter(Boolean)
    .join(' ')

const videoSearchHaystack = (video: FilterableVideo): string =>
  [video.title, video.descriptionSnippet, video.description, channelText(video)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export const matchesBlockedKeywords = (video: FilterableVideo, blockedKeywords: readonly string[]): boolean => {
  if (blockedKeywords.length === 0) return false
  const haystack = videoSearchHaystack(video)
  return blockedKeywords.some((raw) => {
    const keyword = raw.trim().toLowerCase()
    return keyword.length > 0 && haystack.includes(keyword)
  })
}

const stripAt = (value: string) => (value.startsWith('@') ? value.slice(1) : value)

const matchesChannelEntry = (channel: FilterableChannel | null | undefined, needle: string): boolean => {
  if (!channel) return false
  if (channel.id && channel.id.toLowerCase() === needle) return true
  const normalizedNeedle = stripAt(needle)
  if (channel.handle && stripAt(channel.handle.trim().toLowerCase()) === normalizedNeedle) return true
  if (channel.name && channel.name.trim().toLowerCase().includes(normalizedNeedle)) return true
  return false
}

export const matchesBlockedChannels = (
  video: Pick<FilterableVideo, 'channel' | 'byline' | 'collaborators'>,
  blockedChannels: readonly string[],
): boolean => {
  if (blockedChannels.length === 0) return false
  return blockedChannels.some((raw) => {
    const needle = raw.trim().toLowerCase()
    if (!needle) return false
    if (matchesChannelEntry(video.channel, needle)) return true
    if (video.collaborators?.some(collaborator => matchesChannelEntry(collaborator, needle))) return true
    if (video.byline?.some(part => part.text.trim().toLowerCase().includes(stripAt(needle)))) return true
    return false
  })
}

export const matchesGlobalFeedRules = (
  video: FilterableVideo,
  settings: Pick<FeedViewSettings, 'hide' | 'blockedKeywords' | 'blockedChannels'>,
  hideShorts: boolean,
  options: { ignoreWatched?: boolean } = {},
): boolean => {
  if (!isAllowedWithHideShorts(video, hideShorts)) return false
  if (settings.hide.live && video.isLive === true) return false
  if (settings.hide.premieres && isPremiereVideo(video)) return false
  if (settings.hide.upcoming && isUpcomingVideo(video)) return false
  if (settings.hide.pastStreams && isPastStreamVideo(video)) return false
  if (!options.ignoreWatched && settings.hide.watched && isWatchedVideo(video)) return false
  if (settings.hide.mostRelevant && video.isMostRelevant === true) return false
  if (matchesBlockedKeywords(video, settings.blockedKeywords)) return false
  if (matchesBlockedChannels(video, settings.blockedChannels)) return false
  return true
}

export const matchesCustomFilter = (
  video: FilterableVideo,
  filter: CustomFeedFilter,
  now = Date.now(),
): boolean => {
  if (filter.hideShorts && video.isShort === true) return false
  if (filter.hideLive && video.isLive === true) return false
  if (filter.hideWatched && isWatchedVideo(video)) return false
  if (filter.hidePremieres && isPremiereVideo(video)) return false
  if (filter.hideUpcoming && isUpcomingVideo(video)) return false
  if (filter.hidePastStreams && isPastStreamVideo(video)) return false
  if (filter.keyword) {
    const needle = filter.keyword.trim().toLowerCase()
    if (needle && !videoSearchHaystack(video).includes(needle)) return false
  }
  if (!matchesDurationRule(video.durationSeconds, filter.durationPreset, filter.minMinutes, filter.maxMinutes)) {
    return false
  }
  if (!matchesUploadDateRule(video, filter.uploadDate, now)) return false
  return true
}

export const matchesDurationFilter = (
  video: Pick<FilterableVideo, 'durationSeconds'>,
  filter: DurationFilter,
): boolean => matchesDurationRule(video.durationSeconds, filter.preset, filter.minMinutes, filter.maxMinutes)

/** Evaluates global hide/blocklist rules together with feed duration, upload date, and active custom filter buttons. */
export const matchesFeedViewFilter = (
  video: FilterableVideo,
  settings: FeedViewSettings,
  hideShorts: boolean,
  now = Date.now(),
): boolean => {
  if (!matchesGlobalFeedRules(video, settings, hideShorts)) return false
  if (!matchesDurationFilter(video, settings.durationFilter)) return false
  if (!matchesUploadDateRule(video, settings.uploadDate, now)) return false
  for (const activeId of settings.activeCustomFilterIds) {
    const custom = settings.customFilters.find(entry => entry.id === activeId)
    if (custom && !matchesCustomFilter(video, custom, now)) return false
  }
  return true
}
