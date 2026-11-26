import { beforeEach, describe, expect, it } from 'vite-plus/test'

import {
  BASE_HOVER_DWELL_MS,
  computeHoverDwellMs,
  MAX_HOVER_DWELL_MS,
  resetHoverDwellForTests,
  SWEEP_HOVER_DWELL_MS,
  SWEEP_WINDOW_MS,
} from '../../../src/player/hover-dwell'

describe('hover preview rapid-sweep dwell', () => {
  beforeEach(() => {
    resetHoverDwellForTests()
  })

  it('keeps base dwell on isolated hovers and ramps during rapid sweeps', () => {
    expect(computeHoverDwellMs(1_000)).toBe(BASE_HOVER_DWELL_MS)
    expect(computeHoverDwellMs(1_100)).toBe(BASE_HOVER_DWELL_MS)
    expect(computeHoverDwellMs(1_200)).toBe(SWEEP_HOVER_DWELL_MS)
    expect(computeHoverDwellMs(1_250)).toBe(Math.min(MAX_HOVER_DWELL_MS, SWEEP_HOVER_DWELL_MS + 50))
    expect(computeHoverDwellMs(1_300)).toBe(MAX_HOVER_DWELL_MS)
    expect(computeHoverDwellMs(1_350)).toBe(MAX_HOVER_DWELL_MS)
  })

  it('resets back to base dwell once the sweep window expires', () => {
    computeHoverDwellMs(1_000)
    computeHoverDwellMs(1_100)
    expect(computeHoverDwellMs(1_200)).toBe(SWEEP_HOVER_DWELL_MS)

    expect(computeHoverDwellMs(1_200 + SWEEP_WINDOW_MS + 1)).toBe(BASE_HOVER_DWELL_MS)
  })
})
