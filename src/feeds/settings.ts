import { useEffect, useState } from 'preact/hooks'

import { normalizeHexColor } from '../theme/palette'

export type FeedLayoutMode = 'grid' | 'list'
export type FeedSurface = 'subscriptions' | 'channel' | 'home' | 'other'
export type ThumbnailPosition = 'start' | 'end'
export type FeedFontFamily = 'default' | 'sans' | 'serif' | 'mono'
export type DurationPreset = 'any' | 'under4' | '4to20' | 'over20' | 'custom'
export type UploadDatePreset = 'any' | 'today' | 'week' | 'month' | 'year'

export type FeedCardStyle = {
  /** Grid: thumbnail width % (60-100). List: thumbnail width px (140-420). */
  thumbSize: number
  /** Start = top (grid) / left (list). End = bottom (grid) / right (list). */
  thumbPosition: ThumbnailPosition
  /** Grid: minimum column width px (220-520). List: max card width px (0 = full width, or 560-1600). */
  cardWidth: number
  titleSize: number
  titleColor: string
  boldTitle: boolean
  font: FeedFontFamily
  metaColor: string
  /** 0 hides descriptions unless channel Videos override enables them. */
  descriptionLines: number
  rowGap: number
  cornerRadius: number
}

export type FeedHideOptions = {
  live: boolean
  premieres: boolean
  upcoming: boolean
  pastStreams: boolean
  watched: boolean
  mostRelevant: boolean
}

export type DurationFilter = {
  preset: DurationPreset
  minMinutes?: number
  maxMinutes?: number
}

export type CustomFeedFilter = {
  id: string
  name: string
  keyword: string
  durationPreset: DurationPreset
  minMinutes?: number
  maxMinutes?: number
  uploadDate: UploadDatePreset
  hideLive?: boolean
  hideWatched?: boolean
  hideShorts?: boolean
  hidePremieres?: boolean
  hideUpcoming?: boolean
  hidePastStreams?: boolean
}

export type FeedViewSettings = {
  layouts: Record<FeedSurface, FeedLayoutMode>
  showDuration: boolean
  showChannelDescriptions: boolean
  hide: FeedHideOptions
  durationFilter: DurationFilter
  uploadDate: UploadDatePreset
  blockedKeywords: string[]
  blockedChannels: string[]
  customFilters: CustomFeedFilter[]
  activeCustomFilterIds: string[]
  cardStyles: Record<FeedLayoutMode, FeedCardStyle>
}

export const DEFAULT_GRID_CARD_STYLE: FeedCardStyle = {
  thumbSize: 100,
  thumbPosition: 'start',
  cardWidth: 320,
  titleSize: 16,
  titleColor: '',
  boldTitle: false,
  font: 'default',
  metaColor: '',
  descriptionLines: 0,
  rowGap: 32,
  cornerRadius: 12,
}

export const DEFAULT_LIST_CARD_STYLE: FeedCardStyle = {
  thumbSize: 240,
  thumbPosition: 'start',
  cardWidth: 0,
  titleSize: 16,
  titleColor: '',
  boldTitle: false,
  font: 'default',
  metaColor: '',
  descriptionLines: 2,
  rowGap: 16,
  cornerRadius: 12,
}

export const DEFAULT_FEED_VIEW_SETTINGS: FeedViewSettings = {
  layouts: {
    subscriptions: 'grid',
    channel: 'grid',
    home: 'grid',
    other: 'grid',
  },
  showDuration: true,
  showChannelDescriptions: false,
  hide: {
    live: false,
    premieres: false,
    upcoming: false,
    pastStreams: false,
    watched: false,
    mostRelevant: false,
  },
  durationFilter: { preset: 'any' },
  uploadDate: 'any',
  blockedKeywords: [],
  blockedChannels: [],
  customFilters: [],
  activeCustomFilterIds: [],
  cardStyles: {
    grid: { ...DEFAULT_GRID_CARD_STYLE },
    list: { ...DEFAULT_LIST_CARD_STYLE },
  },
}

const STORAGE_KEY = 'yt-client:feed-view'

const FONT_STACKS: Record<Exclude<FeedFontFamily, 'default'>, string> = {
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
}

const SURFACES: readonly FeedSurface[] = ['subscriptions', 'channel', 'home', 'other']
const DURATION_PRESETS: readonly DurationPreset[] = ['any', 'under4', '4to20', 'over20', 'custom']
const UPLOAD_DATE_PRESETS: readonly UploadDatePreset[] = ['any', 'today', 'week', 'month', 'year']
const FONTS: readonly FeedFontFamily[] = ['default', 'sans', 'serif', 'mono']

const clampInt = (value: unknown, fallback: number, low: number, high: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(high, Math.max(low, value)))
    : fallback

const coerceLayout = (value: unknown, fallback: FeedLayoutMode = 'grid'): FeedLayoutMode =>
  value === 'grid' || value === 'list' ? value : fallback

const coerceDurationPreset = (value: unknown): DurationPreset =>
  DURATION_PRESETS.includes(value as DurationPreset) ? value as DurationPreset : 'any'

const coerceUploadDate = (value: unknown): UploadDatePreset =>
  UPLOAD_DATE_PRESETS.includes(value as UploadDatePreset) ? value as UploadDatePreset : 'any'

const coerceOptionalMinutes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(Math.min(10000, value))
    : undefined

const coerceCardStyle = (mode: FeedLayoutMode, raw: unknown): FeedCardStyle => {
  const defaults = mode === 'list' ? DEFAULT_LIST_CARD_STYLE : DEFAULT_GRID_CARD_STYLE
  if (!raw || typeof raw !== 'object') return { ...defaults }
  const input = raw as Partial<Record<keyof FeedCardStyle, unknown>>
  const rawWidth = input.cardWidth
  const cardWidth = mode === 'list'
    ? (rawWidth === 0 ? 0 : clampInt(rawWidth, defaults.cardWidth, 560, 1600))
    : clampInt(rawWidth, defaults.cardWidth, 220, 520)
  return {
    thumbSize: mode === 'list'
      ? clampInt(input.thumbSize, defaults.thumbSize, 140, 420)
      : clampInt(input.thumbSize, defaults.thumbSize, 60, 100),
    thumbPosition: input.thumbPosition === 'end' ? 'end' : 'start',
    cardWidth,
    titleSize: clampInt(input.titleSize, defaults.titleSize, 12, 26),
    titleColor: normalizeHexColor(input.titleColor) ?? '',
    boldTitle: typeof input.boldTitle === 'boolean' ? input.boldTitle : defaults.boldTitle,
    font: FONTS.includes(input.font as FeedFontFamily) ? input.font as FeedFontFamily : defaults.font,
    metaColor: normalizeHexColor(input.metaColor) ?? '',
    descriptionLines: clampInt(input.descriptionLines, defaults.descriptionLines, 0, 4),
    rowGap: clampInt(input.rowGap, defaults.rowGap, 4, 48),
    cornerRadius: clampInt(input.cornerRadius, defaults.cornerRadius, 0, 28),
  }
}

const coerceStringList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

const coerceCustomFilters = (raw: unknown): CustomFeedFilter[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CustomFeedFilter[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Partial<CustomFeedFilter>
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : undefined
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name,
      keyword: typeof item.keyword === 'string' ? item.keyword.trim() : '',
      durationPreset: coerceDurationPreset(item.durationPreset),
      minMinutes: coerceOptionalMinutes(item.minMinutes),
      maxMinutes: coerceOptionalMinutes(item.maxMinutes),
      uploadDate: coerceUploadDate(item.uploadDate),
      ...(item.hideLive ? { hideLive: true } : {}),
      ...(item.hideWatched ? { hideWatched: true } : {}),
      ...(item.hideShorts ? { hideShorts: true } : {}),
      ...(item.hidePremieres ? { hidePremieres: true } : {}),
      ...(item.hideUpcoming ? { hideUpcoming: true } : {}),
      ...(item.hidePastStreams ? { hidePastStreams: true } : {}),
    })
  }
  return out
}

const coerce = (raw: Partial<Record<keyof FeedViewSettings, unknown>>): FeedViewSettings => {
  const rawLayouts = (raw.layouts && typeof raw.layouts === 'object' ? raw.layouts : {}) as Partial<Record<FeedSurface, unknown>>
  const rawHide = (raw.hide && typeof raw.hide === 'object' ? raw.hide : {}) as Partial<Record<keyof FeedHideOptions, unknown>>
  const rawDuration = (raw.durationFilter && typeof raw.durationFilter === 'object' ? raw.durationFilter : {}) as Partial<DurationFilter>
  const rawCardStyles = (raw.cardStyles && typeof raw.cardStyles === 'object' ? raw.cardStyles : {}) as Partial<Record<FeedLayoutMode, unknown>>
  const customFilters = coerceCustomFilters(raw.customFilters)
  const validFilterIds = new Set(customFilters.map(filter => filter.id))
  const activeCustomFilterIds = Array.isArray(raw.activeCustomFilterIds)
    ? raw.activeCustomFilterIds.filter((id): id is string => typeof id === 'string' && validFilterIds.has(id))
    : []

  return {
    layouts: Object.fromEntries(
      SURFACES.map(surface => [surface, coerceLayout(rawLayouts[surface], DEFAULT_FEED_VIEW_SETTINGS.layouts[surface])]),
    ) as Record<FeedSurface, FeedLayoutMode>,
    showDuration: typeof raw.showDuration === 'boolean' ? raw.showDuration : DEFAULT_FEED_VIEW_SETTINGS.showDuration,
    showChannelDescriptions: typeof raw.showChannelDescriptions === 'boolean'
      ? raw.showChannelDescriptions
      : DEFAULT_FEED_VIEW_SETTINGS.showChannelDescriptions,
    hide: {
      live: typeof rawHide.live === 'boolean' ? rawHide.live : false,
      premieres: typeof rawHide.premieres === 'boolean' ? rawHide.premieres : false,
      upcoming: typeof rawHide.upcoming === 'boolean' ? rawHide.upcoming : false,
      pastStreams: typeof rawHide.pastStreams === 'boolean' ? rawHide.pastStreams : false,
      watched: typeof rawHide.watched === 'boolean' ? rawHide.watched : false,
      mostRelevant: typeof rawHide.mostRelevant === 'boolean' ? rawHide.mostRelevant : false,
    },
    durationFilter: {
      preset: coerceDurationPreset(rawDuration.preset),
      minMinutes: coerceOptionalMinutes(rawDuration.minMinutes),
      maxMinutes: coerceOptionalMinutes(rawDuration.maxMinutes),
    },
    uploadDate: coerceUploadDate(raw.uploadDate),
    blockedKeywords: coerceStringList(raw.blockedKeywords),
    blockedChannels: coerceStringList(raw.blockedChannels),
    customFilters,
    activeCustomFilterIds: [...new Set(activeCustomFilterIds)],
    cardStyles: {
      grid: coerceCardStyle('grid', rawCardStyles.grid),
      list: coerceCardStyle('list', rawCardStyles.list),
    },
  }
}

const cloneDefaults = (): FeedViewSettings => coerce({})

const read = (): FeedViewSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return cloneDefaults()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return cloneDefaults()
    return coerce(parsed as Partial<Record<keyof FeedViewSettings, unknown>>)
  } catch {
    return cloneDefaults()
  }
}

let current = read()
const listeners = new Set<(settings: FeedViewSettings) => void>()

const commit = (next: FeedViewSettings): FeedViewSettings => {
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode or quota): in-memory state stays authoritative
  }
  for (const listener of listeners) listener(next)
  return next
}

export const getFeedViewSettings = (): FeedViewSettings => current

export const subscribeFeedViewSettings = (listener: (settings: FeedViewSettings) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reloads store state from storage; used by unit tests after seeding localStorage directly. */
export const reloadFeedViewSettings = (): FeedViewSettings => commit(read())

export const useFeedViewSettings = (): FeedViewSettings => {
  const [value, setValue] = useState<FeedViewSettings>(() => current)
  useEffect(() => {
    setValue(current)
    return subscribeFeedViewSettings(setValue)
  }, [])
  return value
}

export const updateFeedViewSettings = (patch: Partial<FeedViewSettings>): FeedViewSettings =>
  commit(coerce({ ...current, ...patch }))

export const setFeedLayout = (surface: FeedSurface, layout: FeedLayoutMode): FeedViewSettings =>
  commit(coerce({
    ...current,
    layouts: { ...current.layouts, [surface]: layout },
  }))

export const updateFeedHide = (patch: Partial<FeedHideOptions>): FeedViewSettings =>
  commit(coerce({
    ...current,
    hide: { ...current.hide, ...patch },
  }))

export const updateFeedCardStyle = (mode: FeedLayoutMode, patch: Partial<FeedCardStyle>): FeedViewSettings =>
  commit(coerce({
    ...current,
    cardStyles: {
      ...current.cardStyles,
      [mode]: { ...current.cardStyles[mode], ...patch },
    },
  }))

export const resetFeedCardStyle = (mode: FeedLayoutMode): FeedViewSettings =>
  commit(coerce({
    ...current,
    cardStyles: {
      ...current.cardStyles,
      [mode]: mode === 'list' ? { ...DEFAULT_LIST_CARD_STYLE } : { ...DEFAULT_GRID_CARD_STYLE },
    },
  }))

export const addBlockedKeyword = (keyword: string): FeedViewSettings => {
  const trimmed = keyword.trim()
  if (!trimmed) return current
  return commit(coerce({
    ...current,
    blockedKeywords: [...current.blockedKeywords, trimmed],
  }))
}

export const removeBlockedKeyword = (keyword: string): FeedViewSettings => {
  const target = keyword.trim().toLowerCase()
  return commit(coerce({
    ...current,
    blockedKeywords: current.blockedKeywords.filter(entry => entry.toLowerCase() !== target),
  }))
}

export const addBlockedChannel = (channel: string): FeedViewSettings => {
  const trimmed = channel.trim()
  if (!trimmed) return current
  return commit(coerce({
    ...current,
    blockedChannels: [...current.blockedChannels, trimmed],
  }))
}

export const removeBlockedChannel = (channel: string): FeedViewSettings => {
  const target = channel.trim().toLowerCase()
  return commit(coerce({
    ...current,
    blockedChannels: current.blockedChannels.filter(entry => entry.toLowerCase() !== target),
  }))
}

export const addCustomFeedFilter = (input: Omit<CustomFeedFilter, 'id'>): FeedViewSettings => {
  const name = input.name.trim()
  if (!name) return current
  const id = `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const created: CustomFeedFilter = { ...input, id, name }
  return commit(coerce({
    ...current,
    customFilters: [...current.customFilters, created],
  }))
}

export const removeCustomFeedFilter = (id: string): FeedViewSettings =>
  commit(coerce({
    ...current,
    customFilters: current.customFilters.filter(entry => entry.id !== id),
    activeCustomFilterIds: current.activeCustomFilterIds.filter(activeId => activeId !== id),
  }))

export const toggleCustomFeedFilter = (id: string): FeedViewSettings => {
  const active = current.activeCustomFilterIds.includes(id)
  return commit(coerce({
    ...current,
    activeCustomFilterIds: active
      ? current.activeCustomFilterIds.filter(activeId => activeId !== id)
      : [...current.activeCustomFilterIds, id],
  }))
}

export const resetFeedViewSettings = (): FeedViewSettings => commit(cloneDefaults())

/** Maps feed card style choices into CSS custom properties without disturbing unmodified Grid geometry. */
export const feedCardCssVars = (layout: FeedLayoutMode, style: FeedCardStyle): Record<string, string> => {
  const vars: Record<string, string> = {}
  if (layout === 'list') {
    vars['--feed-list-thumb-width'] = `${style.thumbSize}px`
    if (style.cardWidth > 0) vars['--feed-list-max-width'] = `${style.cardWidth}px`
    vars['--feed-row-gap'] = `${style.rowGap}px`
  } else {
    if (style.thumbSize < 100) vars['--feed-grid-thumb-width'] = `${style.thumbSize}%`
    if (style.cardWidth !== DEFAULT_GRID_CARD_STYLE.cardWidth) vars['--feed-grid-card-width'] = `${style.cardWidth}px`
    if (style.rowGap !== DEFAULT_GRID_CARD_STYLE.rowGap) vars['--feed-row-gap'] = `${style.rowGap}px`
  }
  if (style.titleSize !== 16) vars['--feed-title-size'] = `${style.titleSize}px`
  if (style.boldTitle) vars['--feed-title-weight'] = '700'
  if (style.titleColor) vars['--feed-title-color'] = style.titleColor
  if (style.metaColor) vars['--feed-meta-color'] = style.metaColor
  if (style.font !== 'default') vars['--feed-font-family'] = FONT_STACKS[style.font]
  if (style.cornerRadius !== 12) vars['--feed-thumb-radius'] = `${style.cornerRadius}px`
  return vars
}
