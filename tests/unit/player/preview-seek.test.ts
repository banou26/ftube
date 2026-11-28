import { describe, expect, test } from 'vite-plus/test'

import { previewSeekStep } from '../../../src/player/preview-seek'

describe('previewSeekStep', () => {
  test('steps forward and backward by 5s or 10s with Shift and clamps to [0, duration]', () => {
    expect(previewSeekStep(20, 180, 'ArrowRight')).toBe(25)
    expect(previewSeekStep(20, 180, 'ArrowUp')).toBe(25)
    expect(previewSeekStep(20, 180, 'ArrowLeft')).toBe(15)
    expect(previewSeekStep(20, 180, 'ArrowDown')).toBe(15)

    expect(previewSeekStep(20, 180, 'ArrowRight', true)).toBe(30)
    expect(previewSeekStep(20, 180, 'ArrowLeft', true)).toBe(10)

    expect(previewSeekStep(177, 180, 'ArrowRight')).toBe(180)
    expect(previewSeekStep(3, 180, 'ArrowLeft')).toBe(0)
  })

  test('supports PageUp, PageDown, Home, and End with 10% (minimum 10s) page jumps', () => {
    expect(previewSeekStep(20, 180, 'PageUp')).toBe(38)
    expect(previewSeekStep(50, 180, 'PageDown')).toBe(32)
    expect(previewSeekStep(10, 40, 'PageUp')).toBe(20)
    expect(previewSeekStep(15, 40, 'PageDown')).toBe(5)
    expect(previewSeekStep(45, 180, 'Home')).toBe(0)
    expect(previewSeekStep(45, 180, 'End')).toBe(180)
  })

  test('returns undefined when duration is invalid or key is not a seek key', () => {
    expect(previewSeekStep(10, 0, 'ArrowRight')).toBeUndefined()
    expect(previewSeekStep(10, Number.NaN, 'ArrowRight')).toBeUndefined()
    expect(previewSeekStep(Number.NaN, 60, 'ArrowRight')).toBe(5)
    expect(previewSeekStep(10, 180, 'Enter')).toBeUndefined()
    expect(previewSeekStep(10, 180, ' ')).toBeUndefined()
  })
})
