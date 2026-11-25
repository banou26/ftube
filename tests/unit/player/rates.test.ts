import { describe, expect, it } from 'vite-plus/test'

import { MAX_RATE, RATE_CHIPS, rateDetail, stepRate, toRate } from '../../../src/player/rates'

describe('the < and > speed keys', () => {
  it('step 0.25 from the speed, as youtube.com does from one the chips do not offer', () => {
    expect(stepRate(1, 1)).toBe(1.25)
    expect(stepRate(1.25, -1)).toBe(1)
    expect(stepRate(1.1, 1)).toBe(1.35)
    expect(stepRate(1.1, -1)).toBe(0.85)
    expect(stepRate(2, 1)).toBe(2.25)
  })

  it('hold at 0.25 and 3', () => {
    expect(MAX_RATE).toBe(3)
    expect(RATE_CHIPS).toContain(3)
    expect(stepRate(3, 1)).toBe(3)
    expect(stepRate(2.9, 1)).toBe(3)
    expect(stepRate(0.25, -1)).toBe(0.25)
    expect(stepRate(0.4, -1)).toBe(0.25)
  })
})

describe('a speed', () => {
  it('is held to the slider\'s steps of 0.05, so a sum of steps reads as typed', () => {
    expect(toRate(1.1 + 0.05)).toBe(1.15)
    expect(toRate(1.12)).toBe(1.1)
    expect(toRate(3.2)).toBe(3)
  })

  it('reads as youtube.com\'s Settings row does', () => {
    expect(rateDetail(1)).toBe('Normal')
    expect(rateDetail(toRate(1.1 + 0.05))).toBe('1.15')
    expect(rateDetail(2)).toBe('2')
    expect(rateDetail(3)).toBe('3')
  })
})
