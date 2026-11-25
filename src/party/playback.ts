// Playback position extrapolation and drift correction for Watch Together followers.

import type { PlaybackState } from './protocol'

/** Drift below this threshold is left alone to avoid micro-seek stutter. */
export const SEEK_TOLERANCE_S = 1.5

/** Upper bound on elapsed extrapolation when clock skew has not been measured yet. */
export const MAX_EXTRAPOLATION_MS = 15_000

export type PlaybackCorrection = {
  seekTo?: number
  paused?: boolean
  rate?: number
}

/** Whether two playback rates are close enough to avoid redundant rate updates. */
export const sameRate = (a: number, b: number): boolean => Math.abs(a - b) < 0.01

/** Extrapolates where the host's playhead is at `now` (ms). */
export const expectedTime = (state: PlaybackState, now: number, measured = false): number => {
  if (state.paused) return state.time
  const elapsedMs = Math.max(0, now - state.at)
  const boundedMs = measured ? elapsedMs : Math.min(elapsedMs, MAX_EXTRAPOLATION_MS)
  return state.time + (boundedMs / 1_000) * state.rate
}

/** Projects a playback snapshot forward on a single clock from `from` to `to`. */
export const advance = (state: PlaybackState, from: number, to: number): PlaybackState => {
  if (state.paused) return { ...state, at: to }
  const elapsedMs = Math.max(0, to - from)
  return { ...state, time: state.time + (elapsedMs / 1_000) * state.rate, at: to }
}

/** Computes the minimal player mutations needed to align a follower's player with the host's state. */
export const playbackCorrection = (
  local: { paused: boolean, time: number, rate: number },
  host: PlaybackState,
  now: number,
  measured = false,
): PlaybackCorrection | undefined => {
  const target = expectedTime(host, now, measured)
  const correction: PlaybackCorrection = {}
  if (Math.abs(target - local.time) > SEEK_TOLERANCE_S) correction.seekTo = target
  if (local.paused !== host.paused) correction.paused = host.paused
  if (!sameRate(local.rate, host.rate)) correction.rate = host.rate
  return Object.keys(correction).length > 0 ? correction : undefined
}

/** Determines whether Watch Together publishes host state or follows host updates in the player. */
export const partyPlaybackMode = ({ role, isLive, docked }: { role?: 'host' | 'guest', isLive: boolean, docked: boolean }) => ({
  publish: role === 'host' && !isLive && !docked,
  follow: role === 'guest' && !isLive,
})
