import { describe, expect, it } from 'vite-plus/test'

import {
  clampTrimRange,
  estimateTrimmedBytes,
  formatClipFilenameSuffix,
  formatClipLabel,
  formatTimestamp,
  isFullRange,
  MIN_CLIP_MS,
  parseTimestamp,
} from '../../../src/downloads/trim'

describe('download trim helpers', () => {
  it('formats timestamps cleanly for short, minute, and hour-long clips', () => {
    expect(formatTimestamp(0)).toBe('0:00')
    expect(formatTimestamp(-500)).toBe('0:00')
    expect(formatTimestamp(4_000)).toBe('0:04')
    expect(formatTimestamp(65_000)).toBe('1:05')
    expect(formatTimestamp(3_661_000)).toBe('1:01:01')
  })

  it('parses ss, mm:ss, hh:mm:ss, and fractional seconds safely', () => {
    expect(parseTimestamp('4')).toBe(4_000)
    expect(parseTimestamp('0:04')).toBe(4_000)
    expect(parseTimestamp('1:05')).toBe(65_000)
    expect(parseTimestamp('1:01:01')).toBe(3_661_000)
    expect(parseTimestamp('0:04.5')).toBe(4_500)
    expect(parseTimestamp('0:25', 19_000)).toBe(19_000)
    expect(parseTimestamp('1:99')).toBeUndefined()
    expect(parseTimestamp('-5')).toBeUndefined()
    expect(parseTimestamp('nope')).toBeUndefined()
    expect(parseTimestamp('')).toBeUndefined()
  })

  it('clamps ranges within duration while respecting minimum clip span', () => {
    expect(clampTrimRange(-1000, 12_000, 19_000)).toEqual({ startMs: 0, endMs: 12_000 })
    expect(clampTrimRange(4_000, 4_200, 19_000)).toEqual({ startMs: 4_000, endMs: 4_000 + MIN_CLIP_MS })
    expect(clampTrimRange(18_800, 19_000, 19_000)).toEqual({ startMs: 19_000 - MIN_CLIP_MS, endMs: 19_000 })
    expect(clampTrimRange(10_000, 4_000, 19_000)).toEqual({ startMs: 10_000, endMs: 11_000 })
  })

  it('detects full range with tolerance, estimates cropped bytes, and formats labels without colons or typographic dashes', () => {
    expect(isFullRange(undefined, 19_000)).toBe(true)
    expect(isFullRange({ startMs: 0, endMs: 19_000 }, 19_000)).toBe(true)
    expect(isFullRange({ startMs: 200, endMs: 18_700 }, 19_000)).toBe(true)
    expect(isFullRange({ startMs: 4_000, endMs: 12_000 }, 19_000)).toBe(false)

    expect(estimateTrimmedBytes(undefined, 19_000, { startMs: 4_000, endMs: 12_000 })).toBeUndefined()
    expect(estimateTrimmedBytes(1_900_000, 19_000, { startMs: 0, endMs: 19_000 })).toBe(1_900_000)
    expect(estimateTrimmedBytes(1_900_000, 19_000, { startMs: 4_000, endMs: 12_000 })).toBe(800_000)

    const label = formatClipLabel({ startMs: 4_000, endMs: 12_000 })
    expect(label).toBe('0:04 - 0:12')
    expect(label).not.toMatch(/[\u2013\u2014]/)

    const suffix = formatClipFilenameSuffix({ startMs: 4_000, endMs: 65_000 })
    expect(suffix).not.toContain(':')
    expect(suffix).toBe('0m04s-1m05s')

    expect(formatClipFilenameSuffix({ startMs: 3_661_000, endMs: 3_725_000 })).toBe('1h01m01s-1h02m05s')
  })
})
