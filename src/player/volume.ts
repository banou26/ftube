const clampVolume = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1)

/** Effective audible level `[0, 1]`, treating muted elements as `0`. */
export const effectiveVolumeOf = (state: { volume: number, muted: boolean }): number =>
  state.muted ? 0 : clampVolume(state.volume)

/** Applies a slider volume in `[0, 1]` to a video element and derives its muted flag. */
export const applyVideoVolume = (
  video: { volume: number, muted: boolean },
  value: number,
): { volume: number, muted: boolean } => {
  const volume = clampVolume(value)
  const muted = volume === 0
  video.volume = volume
  video.muted = muted
  return { volume, muted }
}

/** Toggles mute on a video element, restoring `0.5` volume when unmuting from zero. */
export const toggleVideoMute = (
  video: { volume: number, muted: boolean },
): { volume: number, muted: boolean } => {
  if (video.muted || video.volume === 0) {
    const volume = video.volume === 0 ? 0.5 : clampVolume(video.volume)
    video.muted = false
    video.volume = volume
    return { volume, muted: false }
  }
  video.muted = true
  return { volume: clampVolume(video.volume), muted: true }
}
