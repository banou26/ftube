import type { QualityPreference, Settings } from '../settings'

import { getSettings } from '../settings'
import { toRate } from './rates'

export type TabPlayback = {
  quality?: QualityPreference
  playbackRate?: number
}

const STORAGE_KEY = 'yt-client:tab-playback'

const coerceQuality = (value: unknown): QualityPreference | undefined => {
  if (value === 'auto') return 'auto'
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

const coercePlaybackRate = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? toRate(value) : undefined

const coerce = (raw: unknown): TabPlayback => {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Partial<Record<keyof TabPlayback, unknown>>
  const quality = coerceQuality(record.quality)
  const playbackRate = coercePlaybackRate(record.playbackRate)
  return {
    ...(quality !== undefined ? { quality } : {}),
    ...(playbackRate !== undefined ? { playbackRate } : {}),
  }
}

const read = (): TabPlayback => {
  try {
    if (typeof sessionStorage === 'undefined') return {}
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return coerce(JSON.parse(raw))
  } catch {
    return {}
  }
}

const write = (next: TabPlayback) => {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (next.quality === undefined && next.playbackRate === undefined) {
      sessionStorage.removeItem(STORAGE_KEY)
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    // storage unavailable (private mode, quota): the in-memory value still stands
  }
}

let current: TabPlayback = read()
const listeners = new Set<(next: TabPlayback, prev: TabPlayback) => void>()

/** Returns the current tab's quality/playback-rate overrides. */
export const getTabPlayback = (): TabPlayback => current

/** Returns effective video quality for this tab: player override if set, else persistent Settings default. */
export const getEffectiveQuality = (settings: Pick<Settings, 'quality'> = getSettings()): QualityPreference =>
  current.quality ?? settings.quality

/** Returns effective playback rate for this tab: player override if set, else persistent Settings default. */
export const getEffectivePlaybackRate = (settings: Pick<Settings, 'playbackRate'> = getSettings()): number =>
  current.playbackRate ?? settings.playbackRate

/** Subscribes to tab-scoped quality/playback-rate override changes. */
export const subscribeTabPlayback = (listener: (next: TabPlayback, prev: TabPlayback) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const commit = (next: TabPlayback) => {
  const prev = current
  if (next.quality === prev.quality && next.playbackRate === prev.playbackRate) return current
  current = next
  write(next)
  for (const listener of listeners) listener(next, prev)
  return next
}

/** Saves player quality and/or playback speed overrides only for the current browser tab. */
export const updateTabPlayback = (patch: TabPlayback): TabPlayback =>
  commit({
    ...current,
    ...('quality' in patch ? { quality: coerceQuality(patch.quality) } : {}),
    ...('playbackRate' in patch ? { playbackRate: coercePlaybackRate(patch.playbackRate) } : {}),
  })

/** Clears specified tab overrides (e.g. when persistent Settings explicitly change quality or speed). */
export const clearTabPlaybackFields = (fields: { quality?: boolean, playbackRate?: boolean }): TabPlayback =>
  commit({
    ...(fields.quality || current.quality === undefined ? {} : { quality: current.quality }),
    ...(fields.playbackRate || current.playbackRate === undefined ? {} : { playbackRate: current.playbackRate }),
  })

/** Clears all tab-scoped playback overrides. */
export const resetTabPlayback = (): TabPlayback => commit({})
