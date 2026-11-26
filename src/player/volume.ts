const clampVolume = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1)

/** Default keyboard and mouse-wheel volume step in `[0, 1]`. */
export const VOLUME_STEP = 0.05
export const WHEEL_STEP_PX = 100
export const WHEEL_RESET_MS = 300
export const WHEEL_PERSIST_DEBOUNCE_MS = 200

/** Maps a wheel event's vertical delta to `+1` (up), `-1` (down), or `0` (none). */
export const wheelVolumeDelta = (deltaY: number): -1 | 0 | 1 => {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  return deltaY < 0 ? 1 : -1
}

/**
 * Accumulates high-resolution trackpad pixel wheel deltas into discrete 5% volume steps while
 * keeping discrete mouse-wheel notches (`>= stepPx` or line/page mode) single-step responsive.
 */
export const createWheelVolumeAccumulator = (options?: {
  stepPx?: number
  resetMs?: number
  now?: () => number
}) => {
  const stepPx = options?.stepPx !== undefined && Number.isFinite(options.stepPx) && options.stepPx > 0
    ? options.stepPx
    : WHEEL_STEP_PX
  const resetMs = options?.resetMs !== undefined && Number.isFinite(options.resetMs) && options.resetMs >= 0
    ? options.resetMs
    : WHEEL_RESET_MS
  const now = options?.now ?? (() => Date.now())

  let buffer = 0
  let lastTime = Number.NEGATIVE_INFINITY

  return {
    consume: (deltaY: number, deltaMode = 0): number => {
      if (!Number.isFinite(deltaY) || deltaY === 0) return 0
      const currentTime = now()
      if (deltaMode !== 0 || Math.abs(deltaY) >= stepPx) {
        buffer = 0
        lastTime = currentTime
        return wheelVolumeDelta(deltaY)
      }
      if (currentTime - lastTime > resetMs || (buffer !== 0 && Math.sign(buffer) !== Math.sign(deltaY))) {
        buffer = 0
      }
      lastTime = currentTime
      buffer += deltaY
      if (Math.abs(buffer) < stepPx) return 0
      const steps = -Math.trunc(buffer / stepPx)
      buffer = buffer % stepPx
      if (buffer === 0) buffer = 0
      return steps === 0 ? 0 : steps
    },
    reset: () => {
      buffer = 0
      lastTime = Number.NEGATIVE_INFINITY
    },
  }
}

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

/** Steps effective video volume by `steps * step`, rounded cleanly to two decimal places. */
export const stepVideoVolume = (
  video: { volume: number, muted: boolean },
  steps: number,
  step = VOLUME_STEP,
): { volume: number, muted: boolean } => {
  const current = effectiveVolumeOf(video)
  const next = Math.round((current + steps * step) * 100) / 100
  return applyVideoVolume(video, next)
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
