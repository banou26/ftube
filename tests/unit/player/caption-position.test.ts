import { describe, expect, it } from 'vite-plus/test'

import {
  DEFAULT_CAPTION_POSITION,
  extractCueLines,
  positionFromPointer,
} from '../../../src/player/caption-position'

describe('positionFromPointer', () => {
  const layerRect = { left: 100, top: 50, width: 800, height: 400 }
  const windowRect = { width: 200, height: 40 }

  it('places the caption window at corners and center and clamps outside bounds', () => {
    expect(positionFromPointer({
      clientX: 120,
      clientY: 60,
      grabOffsetX: 20,
      grabOffsetY: 10,
      layerRect,
      windowRect,
    })).toEqual({ x: 0, y: 0 })

    expect(positionFromPointer({
      clientX: 720,
      clientY: 420,
      grabOffsetX: 20,
      grabOffsetY: 10,
      layerRect,
      windowRect,
    })).toEqual({ x: 1, y: 1 })

    expect(positionFromPointer({
      clientX: 420,
      clientY: 240,
      grabOffsetX: 20,
      grabOffsetY: 10,
      layerRect,
      windowRect,
    })).toEqual({ x: 0.5, y: 0.5 })

    expect(positionFromPointer({
      clientX: -50,
      clientY: 999,
      grabOffsetX: 20,
      grabOffsetY: 10,
      layerRect,
      windowRect,
    })).toEqual({ x: 0, y: 1 })
  })

  it('falls back to default coordinates when the travel range is zero or negative', () => {
    expect(positionFromPointer({
      clientX: 120,
      clientY: 60,
      grabOffsetX: 10,
      grabOffsetY: 10,
      layerRect: { left: 100, top: 50, width: 180, height: 40 },
      windowRect: { width: 200, height: 40 },
    })).toEqual(DEFAULT_CAPTION_POSITION)
  })
})

describe('extractCueLines', () => {
  it('collects showing track cues, decodes HTML via getCueAsHTML, and handles <br> and .text fallback', () => {
    const fragment = {
      nodeType: 11,
      childNodes: [
        { nodeType: 3, textContent: 'Tom & Jerry', childNodes: [] },
        { nodeType: 1, tagName: 'BR', childNodes: [] },
        { nodeType: 1, tagName: 'SPAN', childNodes: [{ nodeType: 3, textContent: 'Line <2>\r', childNodes: [] }] },
      ],
    }
    const tracks = [
      {
        mode: 'disabled',
        activeCues: [{ text: 'Hidden cue' }],
      },
      {
        mode: 'showing',
        activeCues: [
          {
            text: 'Tom &amp; Jerry\nLine &lt;2&gt;',
            getCueAsHTML: () => fragment,
          },
          {
            text: 'Fallback first\r\n\r\nFallback second',
          },
        ],
      },
    ] as unknown as Iterable<TextTrack>

    expect(extractCueLines(tracks)).toEqual([
      'Tom & Jerry',
      'Line <2>',
      'Fallback first',
      'Fallback second',
    ])
  })
})
