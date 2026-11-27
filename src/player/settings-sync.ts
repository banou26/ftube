import type { Settings } from '../settings'

import { languageMatches } from '../frame/captions'

export type PlayerSettingsSyncPlan = {
  playbackRate?: number
  volume?: number
  muted?: boolean
  clearAutoMuted: boolean
  captionAction: 'none' | 'disable' | 'enable-default' | 'refresh'
}

const sameLanguageList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const isLanguageSkipped = (videoLanguage: string | undefined, skipList: readonly string[]) =>
  Boolean(videoLanguage && skipList.some((entry) => languageMatches(videoLanguage, entry)))

/**
 * Computes which live player updates must run when `Settings` transitions from `prev` to `next`.
 * `autoMuted` is cleared only when `volume` or `muted` changes, never by unrelated setting writes.
 */
export const planPlayerSettingsSync = (
  prev: Settings,
  next: Settings,
  current: { hasCaption: boolean, selfWrite?: boolean, manualOverride?: boolean, videoLanguage?: string },
): PlayerSettingsSyncPlan => {
  const volumeChanged = next.volume !== prev.volume
  const mutedChanged = next.muted !== prev.muted
  let captionAction: PlayerSettingsSyncPlan['captionAction'] = 'none'
  if (next.captionsEnabled !== prev.captionsEnabled) {
    if (!next.captionsEnabled) {
      if (current.hasCaption) captionAction = 'disable'
    } else if (!current.hasCaption) {
      captionAction = 'enable-default'
    }
  } else if (next.captionsEnabled && !current.selfWrite && !current.manualOverride) {
    if (next.captionsLanguage !== prev.captionsLanguage) {
      captionAction = 'refresh'
    } else if (!sameLanguageList(next.captionsSkipLanguages, prev.captionsSkipLanguages)) {
      const skippedBefore = isLanguageSkipped(current.videoLanguage, prev.captionsSkipLanguages)
      const skippedAfter = isLanguageSkipped(current.videoLanguage, next.captionsSkipLanguages)
      if (current.videoLanguage && skippedBefore !== skippedAfter) {
        captionAction = 'refresh'
      }
    }
  }
  return {
    playbackRate: next.playbackRate !== prev.playbackRate ? next.playbackRate : undefined,
    volume: volumeChanged ? next.volume : undefined,
    muted: mutedChanged ? next.muted : undefined,
    clearAutoMuted: (volumeChanged || mutedChanged) && !next.muted && next.volume > 0,
    captionAction,
  }
}
