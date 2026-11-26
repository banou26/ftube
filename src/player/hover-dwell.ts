export const BASE_HOVER_DWELL_MS = 150
export const SWEEP_HOVER_DWELL_MS = 350
export const MAX_HOVER_DWELL_MS = 450
export const SWEEP_WINDOW_MS = 600
export const SWEEP_THRESHOLD = 3

let recentHovers: number[] = []

/**
 * Computes hover preview activation dwell delay.
 * Rapid pointer sweeps across multiple cards delay preview startup (and lazy Shaka warm-up)
 * from 150ms to 350ms..450ms so transient scrolling does not open media pipelines.
 */
export const computeHoverDwellMs = (now = Date.now()): number => {
  recentHovers = recentHovers.filter((timestamp) => now - timestamp <= SWEEP_WINDOW_MS && timestamp <= now)
  recentHovers.push(now)
  if (recentHovers.length < SWEEP_THRESHOLD) return BASE_HOVER_DWELL_MS
  const extra = (recentHovers.length - SWEEP_THRESHOLD) * 50
  return Math.min(MAX_HOVER_DWELL_MS, SWEEP_HOVER_DWELL_MS + extra)
}

/** Resets recorded hover timestamps for deterministic unit tests. */
export const resetHoverDwellForTests = () => {
  recentHovers = []
}
