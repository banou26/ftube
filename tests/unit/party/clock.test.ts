import { describe, expect, it } from 'vite-plus/test'

import { bestSample, clockSample, MAX_USABLE_RTT_MS, toHostTime, toLocalTime } from '../../../src/party/clock'

describe('clock offset estimation', () => {
  it('computes RTT and midpoint offset via Cristian arithmetic', () => {
    // Host clock is +2000 ms ahead of local clock; symmetric 50 ms one-way transit.
    const sample = clockSample(1_000, 3_050, 1_100)
    expect(sample).toStrictEqual({ rtt: 100, offset: 2_000 })
    expect(toLocalTime(3_050, sample.offset)).toBe(1_050)
    expect(toHostTime(1_050, sample.offset)).toBe(3_050)
  })

  it('picks the usable sample with the smallest RTT and ignores bogus samples', () => {
    expect(bestSample([
      { rtt: -5, offset: 0 },
      { rtt: MAX_USABLE_RTT_MS, offset: 10 },
      { rtt: Number.NaN, offset: 0 },
      { rtt: 240, offset: 150 },
      { rtt: 60, offset: 120 },
      { rtt: 120, offset: 130 },
    ])).toStrictEqual({ rtt: 60, offset: 120 })
    expect(bestSample([{ rtt: -1, offset: 0 }, { rtt: MAX_USABLE_RTT_MS + 1, offset: 0 }])).toBeUndefined()
  })
})
