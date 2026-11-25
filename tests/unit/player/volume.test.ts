import { describe, expect, it } from 'vite-plus/test'

import { applyVideoVolume, effectiveVolumeOf, toggleVideoMute } from '../../../src/player/volume'

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
})
