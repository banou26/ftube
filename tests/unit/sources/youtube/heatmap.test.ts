import { describe, expect, it } from 'vite-plus/test'
import { Parser } from 'youtubei.js'

import { normalizeWatchMeta } from '../../../../src/sources/youtube/normalize'

describe('watch heatmap normalization', () => {
  it('extracts and sanitizes Most Replayed markers parsed by youtubei.js from frameworkUpdates', () => {
    const next = {
      contents: {
        twoColumnWatchNextResults: {
          results: {
            results: {
              contents: [{ videoPrimaryInfoRenderer: { title: { simpleText: 'Heatmap Video' } } }],
            },
          },
        },
      },
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [
            {
              entityKey: 'heat-1',
              payload: {
                macroMarkersListEntity: {
                  key: 'heat-1',
                  markersList: {
                    markerType: 'MARKER_TYPE_HEATMAP',
                    markers: [
                      { startMillis: '0', durationMillis: '2000', intensityScoreNormalized: 0.15 },
                      { startMillis: '2000', durationMillis: '2000', intensityScoreNormalized: 1.0 },
                      { startMillis: '4000', durationMillis: '2000', intensityScoreNormalized: 0.42 },
                      { startMillis: '-5', durationMillis: '2000', intensityScoreNormalized: 0.8 },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }

    const parsed = Parser.parseResponse(next as never)
    const meta = normalizeWatchMeta(parsed, 'heat-1')
    expect(meta?.heatmap).toEqual([
      { startMs: 0, durationMs: 2_000, intensity: 0.15 },
      { startMs: 2_000, durationMs: 2_000, intensity: 1 },
      { startMs: 4_000, durationMs: 2_000, intensity: 0.42 },
    ])
  })

  it('extracts heatmap markers from playerOverlays MultiMarkersPlayerBar when present', () => {
    const playerOverlays = {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          decoratedPlayerBarRenderer: {
            playerBar: {
              multiMarkersPlayerBarRenderer: {
                markersMap: [{
                  key: 'HEATSEEKER',
                  value: {
                    heatmap: {
                      heatmapRenderer: {
                        heatMarkers: [
                          { heatMarkerRenderer: { startMillis: '0', durationMillis: '1500', intensityScoreNormalized: 0.25 } },
                          { heatMarkerRenderer: { startMillis: '1500', durationMillis: '1500', intensityScoreNormalized: 0.9 } },
                        ],
                      },
                    },
                  },
                }],
              },
            },
          },
        },
      },
    }

    const parsed = Parser.parseResponse({ playerOverlays } as never)
    const meta = normalizeWatchMeta({ ...parsed, contents_memo: new Map() }, 'heat-overlay')
    expect(meta?.heatmap).toEqual([
      { startMs: 0, durationMs: 1_500, intensity: 0.25 },
      { startMs: 1_500, durationMs: 1_500, intensity: 0.9 },
    ])
  })

  it('falls back cleanly to empty array on raw overlay or malformed/all-zero markers', () => {
    const rawFallback = normalizeWatchMeta({
      contents_memo: new Map(),
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [{
            payload: {
              macroMarkersListEntity: {
                markersList: {
                  markerType: 'MARKER_TYPE_HEATMAP',
                  markers: [
                    { startMillis: '1000', durationMillis: '1000', intensityScoreNormalized: 0.8 },
                    { startMillis: '0', durationMillis: '1000', intensityScoreNormalized: 0.3 },
                  ],
                },
              },
            },
          }],
        },
      },
    }, 'raw-1')
    expect(rawFallback?.heatmap).toEqual([
      { startMs: 0, durationMs: 1_000, intensity: 0.3 },
      { startMs: 1_000, durationMs: 1_000, intensity: 0.8 },
    ])

    const allZero = normalizeWatchMeta({
      contents_memo: new Map(),
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [{
            payload: {
              macroMarkersListEntity: {
                markersList: {
                  markerType: 'MARKER_TYPE_HEATMAP',
                  markers: [
                    { startMillis: '0', durationMillis: '1000', intensityScoreNormalized: 0 },
                    { startMillis: '1000', durationMillis: '1000', intensityScoreNormalized: 0 },
                  ],
                },
              },
            },
          }],
        },
      },
    }, 'zero-1')
    expect(allZero?.heatmap).toEqual([])
  })
})
