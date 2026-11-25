import { describe, expect, it } from 'vite-plus/test'

import { advance, expectedTime, MAX_EXTRAPOLATION_MS, partyPlaybackMode, playbackCorrection, sameRate, SEEK_TOLERANCE_S } from '../../../src/party/playback'

describe('party playback sync arithmetic', () => {
  it('extrapolates playing timestamps and holds paused ones steady', () => {
    expect(expectedTime({ paused: true, time: 40, rate: 1, at: 1_000 }, 6_000, true)).toBe(40)
    expect(expectedTime({ paused: false, time: 40, rate: 1.5, at: 1_000 }, 5_000, true)).toBe(46)
    // Unmeasured clock caps extrapolation so clock skew cannot jump arbitrarily far ahead.
    expect(expectedTime({ paused: false, time: 10, rate: 1, at: 0 }, MAX_EXTRAPOLATION_MS + 60_000, false))
      .toBe(10 + MAX_EXTRAPOLATION_MS / 1_000)
    expect(expectedTime({ paused: false, time: 10, rate: 1, at: 0 }, MAX_EXTRAPOLATION_MS + 60_000, true))
      .toBe(10 + (MAX_EXTRAPOLATION_MS + 60_000) / 1_000)
  })

  it('advances playback snapshots across elapsed time', () => {
    expect(advance({ paused: false, time: 12, rate: 2, at: 1_000 }, 1_000, 4_000)).toStrictEqual({
      paused: false,
      time: 18,
      rate: 2,
      at: 4_000,
    })
    expect(advance({ paused: true, time: 12, rate: 2, at: 1_000 }, 1_000, 4_000)).toStrictEqual({
      paused: true,
      time: 12,
      rate: 2,
      at: 4_000,
    })
  })

  it('skips micro-drift within tolerance and reports only changed fields', () => {
    expect(sameRate(1, 1.005)).toBe(true)
    expect(sameRate(1, 1.25)).toBe(false)
    expect(playbackCorrection(
      { paused: false, time: 20, rate: 1 },
      { paused: false, time: 20 + SEEK_TOLERANCE_S - 0.1, rate: 1, at: 1_000 },
      1_000,
      true,
    )).toBeUndefined()
    expect(playbackCorrection(
      { paused: true, time: 10, rate: 1 },
      { paused: false, time: 20, rate: 1.25, at: 1_000 },
      3_000,
      true,
    )).toStrictEqual({ seekTo: 22.5, paused: false, rate: 1.25 })
  })

  it('keeps follower sync active while docked into the miniplayer and limits host publish to undocked VOD', () => {
    expect(partyPlaybackMode({ role: 'guest', isLive: false, docked: false })).toStrictEqual({ publish: false, follow: true })
    expect(partyPlaybackMode({ role: 'guest', isLive: false, docked: true })).toStrictEqual({ publish: false, follow: true })
    expect(partyPlaybackMode({ role: 'guest', isLive: true, docked: true })).toStrictEqual({ publish: false, follow: false })
    expect(partyPlaybackMode({ role: 'host', isLive: false, docked: false })).toStrictEqual({ publish: true, follow: false })
    expect(partyPlaybackMode({ role: 'host', isLive: false, docked: true })).toStrictEqual({ publish: false, follow: false })
    expect(partyPlaybackMode({ role: 'host', isLive: true, docked: false })).toStrictEqual({ publish: false, follow: false })
    expect(partyPlaybackMode({ role: undefined, isLive: false, docked: true })).toStrictEqual({ publish: false, follow: false })
  })
})
