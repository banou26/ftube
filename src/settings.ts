import type { CaptionLook } from './player/caption-style'
import type { MiniplayerPosition } from './player/miniplayer-size'
import type { AppIconId } from './theme/app-icon'
import type { SeekHandle } from './theme/seek-handle'

import { useEffect, useState } from 'preact/hooks'

import { CAPTION_OPTIONS } from './player/caption-style'
import { coerceMiniplayerPosition, coerceMiniplayerWidth } from './player/miniplayer-size'
import { toRate } from './player/rates'
import { applyAppIcon, coerceAppIcon } from './theme/app-icon'
import { applyCustomPalette, normalizeHexColor } from './theme/palette'
import { coerceSeekHandle } from './theme/seek-handle'

export type ThemePreference = 'device' | 'light' | 'dark'

export type QualityPreference = 'auto' | number

export type CaptionPosition = { x: number, y: number }

export type Settings = {
  theme: ThemePreference
  autoplay: boolean
  volume: number
  muted: boolean
  playbackRate: number
  // a ceiling on the video height, not an exact pick: ABR still moves below it
  quality: QualityPreference
  stableVolume: boolean
  captionsEnabled: boolean
  // a track's language, or the language of the last Auto-translate, which youtube.com remembers the same way
  captionsLanguage?: string
  // set once a person turns captions on or off; until then each video shows the track YouTube recommends for it, if any
  captionsChosen?: boolean
  // the Subtitles Options panel's rows: fonts, colors and edges by name, opacities as fractions, the size in percent
  captionFont: string
  captionColor: string
  captionSize: number
  captionBackground: string
  captionBackgroundOpacity: number
  captionEdge: string
  captionOpacity: number
  captionPosition?: CaptionPosition
  theater: boolean
  ambientMode: boolean
  annotations: boolean
  miniplayerWidth?: number
  miniplayerPosition?: MiniplayerPosition
  showDislikes: boolean
  skipSponsors: boolean
  guideCollapsed: boolean
  hideShorts: boolean
  // off for good once dismissed: an offer that keeps coming back after being declined is an ad
  suggestExtension: boolean
  // a CACHE rather than a preference, and the live DOM signal always wins over it
  extensionSeen?: boolean
  // set when a person picks a theme; before 2026-11-05 the first visit saved the old Dark default as if chosen
  themeChosen?: boolean
  customThemeColor?: string
  seekHandle: SeekHandle
  appIcon: AppIconId
  appIconChosen?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'device',
  autoplay: true,
  volume: 1,
  muted: false,
  playbackRate: 1,
  quality: 'auto',
  stableVolume: false,
  captionsEnabled: false,
  captionFont: 'Proportional Sans-Serif',
  captionColor: 'White',
  captionSize: 100,
  captionBackground: 'Black',
  captionBackgroundOpacity: 0.75,
  captionEdge: 'None',
  captionOpacity: 1,
  theater: false,
  ambientMode: true,
  annotations: true,
  miniplayerWidth: undefined,
  miniplayerPosition: undefined,
  showDislikes: true,
  skipSponsors: true,
  guideCollapsed: false,
  hideShorts: false,
  suggestExtension: true,
  customThemeColor: undefined,
  seekHandle: { kind: 'default' },
  appIcon: 'default',
}

const STORAGE_KEY = 'yt-client:settings'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// storage is user-editable and survives across versions of this code, so one bad entry must not take out the whole store
const coerce = (stored: Partial<Record<keyof Settings, unknown>>): Settings => {
  const theme = stored.theme
  const quality = stored.quality
  const volume = stored.volume
  const playbackRate = stored.playbackRate
  const captionsLanguage = stored.captionsLanguage
  const rawPosition = stored.captionPosition as { x?: unknown, y?: unknown } | null | undefined
  const captionPosition = rawPosition && typeof rawPosition === 'object'
    && typeof rawPosition.x === 'number' && Number.isFinite(rawPosition.x)
    && typeof rawPosition.y === 'number' && Number.isFinite(rawPosition.y)
    ? { x: clamp(rawPosition.x, 0, 1), y: clamp(rawPosition.y, 0, 1) }
    : undefined
  return {
    theme: theme === 'light' || (theme === 'dark' && stored.themeChosen === true) ? theme : DEFAULT_SETTINGS.theme,
    autoplay: typeof stored.autoplay === 'boolean' ? stored.autoplay : DEFAULT_SETTINGS.autoplay,
    volume: typeof volume === 'number' && Number.isFinite(volume) ? clamp(volume, 0, 1) : DEFAULT_SETTINGS.volume,
    muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_SETTINGS.muted,
    playbackRate: typeof playbackRate === 'number' && Number.isFinite(playbackRate) ? toRate(playbackRate) : DEFAULT_SETTINGS.playbackRate,
    quality: quality === 'auto' || (typeof quality === 'number' && Number.isFinite(quality))
      ? quality
      : DEFAULT_SETTINGS.quality,
    stableVolume: typeof stored.stableVolume === 'boolean' ? stored.stableVolume : DEFAULT_SETTINGS.stableVolume,
    captionsEnabled: typeof stored.captionsEnabled === 'boolean' ? stored.captionsEnabled : DEFAULT_SETTINGS.captionsEnabled,
    captionsLanguage: typeof captionsLanguage === 'string' ? captionsLanguage : undefined,
    // an off stored without the mark is the default every write saves, not a choice; an on could only have been chosen
    captionsChosen: stored.captionsChosen === true || stored.captionsEnabled === true ? true : undefined,
    ...Object.fromEntries(CAPTION_OPTIONS.map(({ key, choices }) => [
      key,
      choices.some(choice => choice.value === stored[key]) ? stored[key] : DEFAULT_SETTINGS[key],
    ])) as CaptionLook,
    captionPosition,
    theater: typeof stored.theater === 'boolean' ? stored.theater : DEFAULT_SETTINGS.theater,
    ambientMode: typeof stored.ambientMode === 'boolean' ? stored.ambientMode : DEFAULT_SETTINGS.ambientMode,
    annotations: typeof stored.annotations === 'boolean' ? stored.annotations : DEFAULT_SETTINGS.annotations,
    miniplayerWidth: coerceMiniplayerWidth(stored.miniplayerWidth),
    miniplayerPosition: coerceMiniplayerPosition(stored.miniplayerPosition),
    showDislikes: typeof stored.showDislikes === 'boolean' ? stored.showDislikes : DEFAULT_SETTINGS.showDislikes,
    skipSponsors: typeof stored.skipSponsors === 'boolean' ? stored.skipSponsors : DEFAULT_SETTINGS.skipSponsors,
    guideCollapsed: typeof stored.guideCollapsed === 'boolean' ? stored.guideCollapsed : DEFAULT_SETTINGS.guideCollapsed,
    hideShorts: typeof stored.hideShorts === 'boolean' ? stored.hideShorts : DEFAULT_SETTINGS.hideShorts,
    suggestExtension: typeof stored.suggestExtension === 'boolean' ? stored.suggestExtension : DEFAULT_SETTINGS.suggestExtension,
    extensionSeen: typeof stored.extensionSeen === 'boolean' ? stored.extensionSeen : undefined,
    themeChosen: stored.themeChosen === true ? true : undefined,
    customThemeColor: normalizeHexColor(stored.customThemeColor),
    seekHandle: coerceSeekHandle(stored.seekHandle),
    appIcon: coerceAppIcon(stored.appIcon),
    appIconChosen: stored.appIconChosen === true ? true : undefined,
  }
}

const read = (): Settings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
    return coerce(parsed as Partial<Record<keyof Settings, unknown>>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current = read()

const listeners = new Set<(settings: Settings) => void>()

export const getSettings = () => current

export const subscribeSettings = (listener: (settings: Settings) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current value of one setting key, kept synchronized with updates. */
export const useSetting = <Key extends keyof Settings>(key: Key): Settings[Key] => {
  const [value, setValue] = useState<Settings[Key]>(() => current[key])
  useEffect(() => {
    setValue(current[key])
    return subscribeSettings(settings => setValue(settings[key]))
  }, [key])
  return value
}

export const updateSettings = (patch: Partial<Settings>) => {
  const normalizedPatch: Partial<Settings> = {
    ...patch,
    ...('customThemeColor' in patch ? { customThemeColor: normalizeHexColor(patch.customThemeColor) } : {}),
    ...('miniplayerWidth' in patch ? { miniplayerWidth: coerceMiniplayerWidth(patch.miniplayerWidth) } : {}),
    ...('miniplayerPosition' in patch ? { miniplayerPosition: coerceMiniplayerPosition(patch.miniplayerPosition) } : {}),
    ...('seekHandle' in patch ? { seekHandle: coerceSeekHandle(patch.seekHandle) } : {}),
    ...('appIcon' in patch ? { appIcon: coerceAppIcon(patch.appIcon) } : {}),
  }
  const hasCustomColor = 'customThemeColor' in patch
  const autoAppIcon = hasCustomColor && !('appIcon' in patch)
    ? normalizedPatch.customThemeColor && !current.customThemeColor && current.appIcon === 'default' && !current.appIconChosen
      ? { appIcon: 'theme' as AppIconId }
      : !normalizedPatch.customThemeColor && current.customThemeColor && current.appIcon === 'theme' && !current.appIconChosen
        ? { appIcon: 'default' as AppIconId }
        : {}
    : {}
  const next: Settings = {
    ...current,
    ...normalizedPatch,
    ...autoAppIcon,
    ...('theme' in patch ? { themeChosen: 'themeChosen' in patch ? patch.themeChosen : true } : {}),
    ...('captionsEnabled' in patch ? { captionsChosen: true } : {}),
    ...('appIcon' in patch ? { appIconChosen: 'appIconChosen' in patch ? patch.appIconChosen : true } : {}),
  }
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode, quota): the in-memory value still stands
  }
  for (const listener of listeners) listener(next)
  return next
}

export const resetCustomAppearance = () =>
  updateSettings({
    theme: DEFAULT_SETTINGS.theme,
    themeChosen: undefined,
    customThemeColor: undefined,
    seekHandle: { ...DEFAULT_SETTINGS.seekHandle },
    appIcon: DEFAULT_SETTINGS.appIcon,
    appIconChosen: undefined,
  })

const prefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

export const resolveTheme = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'device' ? (prefersLight() ? 'light' : 'dark') : preference

const THEME_COLOR = { dark: '#0f0f0f', light: '#f9f9f9' }

export const applyTheme = (preference: ThemePreference = current.theme) => {
  const resolved = resolveTheme(preference)
  if (typeof document === 'undefined') return resolved
  document.documentElement.dataset.theme = resolved
  const palette = applyCustomPalette(current.customThemeColor, resolved)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette?.['--bg-base'] ?? THEME_COLOR[resolved])
  applyAppIcon(current.appIcon, current.customThemeColor, resolved)
  return resolved
}

export const watchDeviceTheme = () => {
  let media: MediaQueryList
  try {
    media = window.matchMedia('(prefers-color-scheme: light)')
  } catch {
    return () => {}
  }
  const onChange = () => {
    if (current.theme === 'device') applyTheme('device')
  }
  media.addEventListener('change', onChange)
  const unsubscribe = subscribeSettings((settings) => applyTheme(settings.theme))
  return () => {
    media.removeEventListener('change', onChange)
    unsubscribe()
  }
}
