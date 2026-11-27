import type { Settings } from '../settings'

export type PlayerSettingsSyncPlan = {
  playbackRate?: number
  volume?: number
  muted?: boolean
  clearAutoMuted: boolean
  captionAction: 'none' | 'disable' | 'enable-default'
}

/**
 * Computes which live player updates must run when `Settings` transitions from `prev` to `next`.
 * `autoMuted` is cleared only when `volume` or `muted` changes, never by unrelated setting writes.
 */
export const planPlayerSettingsSync = (
  prev: Settings,
  next: Settings,
  current: { hasCaption: boolean },
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
  }
  return {
    playbackRate: next.playbackRate !== prev.playbackRate ? next.playbackRate : undefined,
    volume: volumeChanged ? next.volume : undefined,
    muted: mutedChanged ? next.muted : undefined,
    clearAutoMuted: (volumeChanged || mutedChanged) && !next.muted && next.volume > 0,
    captionAction,
  }
}
