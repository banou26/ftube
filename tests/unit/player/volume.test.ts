import { describe, expect, it } from 'vite-plus/test'

import {
  applyVideoVolume,
  createWheelVolumeAccumulator,
  effectiveVolumeOf,
  stepVideoVolume,
  toggleVideoMute,
  VOLUME_STEP,
  WHEEL_RESET_MS,
  WHEEL_STEP_PX,
  wheelVolumeDelta,
} from '../../../src/player/volume'

describe('player volume helpers', () => {
  it('computes effective volume and clamps out-of-range inputs', () => {
    expect(effectiveVolumeOf({ volume: 0.75, muted: false })).toBe(0.75)
    expect(effectiveVolumeOf({ volume: 0.75, muted: true })).toBe(0)
    expect(effectiveVolumeOf({ volume: -0.4, muted: false })).toBe(0)
    expect(effectiveVolumeOf({ volume: 1.5, muted: false })).toBe(1)
  })

  it('applies slider volume updates and mutes only at zero', () => {
    const video = { volume: 1, muted: true }
    expect(applyVideoVolume(video, 0.35)).toStrictEqual({ volume: 0.35, muted: false })
    expect(video).toStrictEqual({ volume: 0.35, muted: false })

    expect(applyVideoVolume(video, 0)).toStrictEqual({ volume: 0, muted: true })
    expect(video).toStrictEqual({ volume: 0, muted: true })

    expect(applyVideoVolume(video, 2)).toStrictEqual({ volume: 1, muted: false })
    expect(video).toStrictEqual({ volume: 1, muted: false })
  })

  it('toggles mute cleanly and restores 0.5 when unmuting from zero volume', () => {
    const video = { volume: 0.4, muted: false }
    expect(toggleVideoMute(video)).toStrictEqual({ volume: 0.4, muted: true })
    expect(video).toStrictEqual({ volume: 0.4, muted: true })

    expect(toggleVideoMute(video)).toStrictEqual({ volume: 0.4, muted: false })
    expect(video).toStrictEqual({ volume: 0.4, muted: false })

    const zeroMuted = { volume: 0, muted: true }
    expect(toggleVideoMute(zeroMuted)).toStrictEqual({ volume: 0.5, muted: false })
    expect(zeroMuted).toStrictEqual({ volume: 0.5, muted: false })

    const zeroUnmuted = { volume: 0, muted: false }
    expect(toggleVideoMute(zeroUnmuted)).toStrictEqual({ volume: 0.5, muted: false })
    expect(zeroUnmuted).toStrictEqual({ volume: 0.5, muted: false })
  })

  it('maps wheel deltaY to volume step directions', () => {
    expect(VOLUME_STEP).toBe(0.05)
    expect(wheelVolumeDelta(-120)).toBe(1)
    expect(wheelVolumeDelta(-1)).toBe(1)
    expect(wheelVolumeDelta(120)).toBe(-1)
    expect(wheelVolumeDelta(1)).toBe(-1)
    expect(wheelVolumeDelta(0)).toBe(0)
    expect(wheelVolumeDelta(-0)).toBe(0)
    expect(wheelVolumeDelta(Number.NaN)).toBe(0)
  })

  it('steps video volume cleanly with clamping and mute-aware transitions', () => {
    const video = { volume: 0.5, muted: false }
    expect(stepVideoVolume(video, 1)).toStrictEqual({ volume: 0.55, muted: false })
    expect(stepVideoVolume(video, -2)).toStrictEqual({ volume: 0.45, muted: false })

    const precision = { volume: 0.1, muted: false }
    expect(stepVideoVolume(precision, 4)).toStrictEqual({ volume: 0.3, muted: false })

    const ceiling = { volume: 0.98, muted: false }
    expect(stepVideoVolume(ceiling, 1)).toStrictEqual({ volume: 1, muted: false })

    const floor = { volume: 0.03, muted: false }
    expect(stepVideoVolume(floor, -1)).toStrictEqual({ volume: 0, muted: true })

    const mutedUp = { volume: 0.6, muted: true }
    expect(stepVideoVolume(mutedUp, 1)).toStrictEqual({ volume: 0.05, muted: false })

    const mutedDown = { volume: 0.6, muted: true }
    expect(stepVideoVolume(mutedDown, -1)).toStrictEqual({ volume: 0, muted: true })
  })

  it('accumulates trackpad pixel wheel deltas and handles discrete notches, reversals, and resets', () => {
    let clockMs = 1_000
    const acc = createWheelVolumeAccumulator({ now: () => clockMs })

    // Smooth trackpad micro-deltas integrate across events until crossing 100px
    expect(acc.consume(-40)).toBe(0)
    expect(acc.consume(-40)).toBe(0)
    expect(acc.consume(-40)).toBe(1) // -120 -> +1 step, -20 remainder kept
    expect(acc.consume(-80)).toBe(1) // -20 + -80 = -100 -> +1 step

    // Multi-step burst works cleanly too
    expect(acc.consume(250)).toBe(-1) // discrete notch resets buffer

    // Reversing direction clears stale opposite remainder
    expect(acc.consume(-60)).toBe(0)
    expect(acc.consume(50)).toBe(0)
    expect(acc.consume(50)).toBe(-1)

    // Idle gap > WHEEL_RESET_MS clears partial accumulation
    expect(acc.consume(-(WHEEL_STEP_PX - 10))).toBe(0)
    clockMs += WHEEL_RESET_MS + 1
    expect(acc.consume(-20)).toBe(0)

    // Line/page deltaMode bypasses pixel accumulation cleanly
    expect(acc.consume(-3, 1)).toBe(1)
    expect(acc.consume(3, 2)).toBe(-1)

    // Mouse notches >= 100px produce single step immediately
    expect(acc.consume(-120)).toBe(1)
    expect(acc.consume(120)).toBe(-1)
    acc.reset()
    expect(acc.consume(0)).toBe(0)
    expect(acc.consume(Number.NaN)).toBe(0)
  })
})
