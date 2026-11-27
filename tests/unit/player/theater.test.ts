import { describe, expect, it } from 'vite-plus/test'

import { coerceTheaterMode, isTheaterActive, nextTheaterMode } from '../../../src/player/theater'

describe('theater mode helpers', () => {
  it('coerces string modes and legacy booleans cleanly', () => {
    expect(coerceTheaterMode('default')).toBe('default')
    expect(coerceTheaterMode('theater')).toBe('theater')
    expect(coerceTheaterMode('fullscreen')).toBe('fullscreen')
    expect(coerceTheaterMode(true)).toBe('theater')
    expect(coerceTheaterMode(false)).toBe('default')
    expect(coerceTheaterMode('wide')).toBe('default')
    expect(coerceTheaterMode(undefined)).toBe('default')
  })

  it('cycles Default -> Theater -> Fullscreen theater -> Default', () => {
    expect(nextTheaterMode('default')).toBe('theater')
    expect(nextTheaterMode('theater')).toBe('fullscreen')
    expect(nextTheaterMode('fullscreen')).toBe('default')
  })

  it('reports active theater states', () => {
    expect(isTheaterActive('default')).toBe(false)
    expect(isTheaterActive('theater')).toBe(true)
    expect(isTheaterActive('fullscreen')).toBe(true)
  })
})
