import { describe, expect, it } from 'vite-plus/test'

import {
  buildHeatmapGeometry,
  HEATMAP_VIEWBOX_HEIGHT,
  HEATMAP_VIEWBOX_WIDTH,
  sanitizeHeatMarkers,
} from '../../../src/player/heatmap'

describe('heatmap geometry', () => {
  it('sanitizes unordered markers and drops corrupt entries', () => {
    const cleaned = sanitizeHeatMarkers([
      { startMs: 2_000, durationMs: 1_000, intensity: 0.9 },
      { startMs: -10, durationMs: 1_000, intensity: 0.5 },
      { startMs: 1_000, durationMs: 0, intensity: 0.5 },
      { startMs: 1_000, durationMs: 1_000, intensity: Number.NaN },
      { startMs: 3_000, durationMs: 1_000, intensity: 1.5 },
      { startMs: 0, durationMs: 1_000, intensity: 0.2 },
    ])
    expect(cleaned).toEqual([
      { startMs: 0, durationMs: 1_000, intensity: 0.2 },
      { startMs: 2_000, durationMs: 1_000, intensity: 0.9 },
    ])

    expect(sanitizeHeatMarkers([])).toEqual([])
    expect(sanitizeHeatMarkers([{ startMs: 0, durationMs: 1_000, intensity: 0.5 }])).toEqual([])
    expect(sanitizeHeatMarkers([
      { startMs: 0, durationMs: 1_000, intensity: 0 },
      { startMs: 1_000, durationMs: 1_000, intensity: 0 },
    ])).toEqual([])
  })

  it('aligns peaks with timestamps, spans the full viewBox width, and keeps monotonic control points', () => {
    const markers = Array.from({ length: 100 }, (_, i) => {
      const ratio = i / 100
      const intensity = i === 70 ? 1 : i >= 65 && i <= 75 ? 0.65 : 0.1
      return { startMs: ratio * 100_000, durationMs: 1_000, intensity }
    })

    const geometry = buildHeatmapGeometry(markers, 100)
    expect(geometry).toBeDefined()
    expect(geometry!.maxIntensity).toBe(1)
    expect(geometry!.peakRatio).toBeCloseTo(0.705, 3)

    const peak = geometry!.points[70]!
    const valley = geometry!.points[20]!
    expect(peak.x).toBeGreaterThan(700)
    expect(peak.x).toBeLessThan(710)
    expect(peak.y).toBeLessThan(valley.y)

    // Path spans [0, 1000] and stays strictly inside vertical bounds [0, 100]
    expect(geometry!.areaPath.startsWith('M 0 100 L 0 ')).toBe(true)
    expect(geometry!.areaPath.endsWith(`L ${HEATMAP_VIEWBOX_WIDTH} ${HEATMAP_VIEWBOX_HEIGHT} Z`)).toBe(true)
    const yValues = [...geometry!.strokePath.matchAll(/[-.\d]+/g)]
      .map(m => Number(m[0]))
      .filter((_, idx) => idx % 2 === 1)
    expect(Math.min(...yValues)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...yValues)).toBeLessThanOrEqual(HEATMAP_VIEWBOX_HEIGHT - 6)
  })

  it('returns undefined when duration is invalid or markers fall past the duration', () => {
    const valid = [
      { startMs: 0, durationMs: 1_000, intensity: 0.2 },
      { startMs: 1_000, durationMs: 1_000, intensity: 0.8 },
    ]
    expect(buildHeatmapGeometry(valid, 0)).toBeUndefined()
    expect(buildHeatmapGeometry(valid, Number.NaN)).toBeUndefined()
    expect(buildHeatmapGeometry(null, 120)).toBeUndefined()
    expect(buildHeatmapGeometry([
      { startMs: 150_000, durationMs: 1_000, intensity: 0.4 },
      { startMs: 151_000, durationMs: 1_000, intensity: 0.8 },
    ], 100)).toBeUndefined()
  })
})
