import type { Settings } from '../settings'

export type PlayerSettingsSyncPlan = {
  playbackRate?: number
  volume?: number
  muted?: boolean
  clearAutoMuted: boolean
  captionAction: 'none' | 'disable' | 'enable-default' | 'refresh'
}

const sameLanguageList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

/**
 * Computes which live player updates must run when `Settings` transitions from `prev` to `next`.
 * `autoMuted` is cleared only when `volume` or `muted` changes, never by unrelated setting writes.
 */
export const planPlayerSettingsSync = (
  prev: Settings,
  next: Settings,
  current: { hasCaption: boolean, selfWrite?: boolean },
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
  } else if (
    next.captionsEnabled
    && !current.selfWrite
    && (next.captionsLanguage !== prev.captionsLanguage || !sameLanguageList(next.captionsSkipLanguages, prev.captionsSkipLanguages))
  ) {
    captionAction = 'refresh'
  }
  return {
    playbackRate: next.playbackRate !== prev.playbackRate ? next.playbackRate : undefined,
    volume: volumeChanged ? next.volume : undefined,
    muted: mutedChanged ? next.muted : undefined,
    clearAutoMuted: (volumeChanged || mutedChanged) && !next.muted && next.volume > 0,
    captionAction,
  }
}
