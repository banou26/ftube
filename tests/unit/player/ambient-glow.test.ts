import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => '' }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))

import { ambientBarOpacity, ambientOpacity, detectSymmetricBarCrop } from '../../../src/player/ambient-glow'

const makePixels = (width: number, height: number, colorAt: (x: number, y: number) => [number, number, number]) => {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const [r, g, b] = colorAt(x, y)
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = 255
    }
  }
  return out
}

describe('ambientOpacity', () => {
  it('returns zero when ambient mode is disabled, fullscreen, docked, or reduced motion is preferred', () => {
    expect(ambientOpacity({ enabled: false, fullscreen: false, docked: false, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: true, docked: false, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: true, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: false, reducedMotion: true })).toBe(0)
  })

  it('returns positive opacity when active on the watch stage', () => {
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: false, reducedMotion: false })).toBeGreaterThan(0)
  })
})

describe('ambientBarOpacity', () => {
  it('returns zero until a frame is ready or when disabled, blocked, fullscreen, docked, or reduced motion', () => {
    const active = { enabled: true, fullscreen: false, docked: false, reducedMotion: false, hasFrame: true, blocked: false }
    expect(ambientBarOpacity(active)).toBeGreaterThan(0)
    expect(ambientBarOpacity({ ...active, hasFrame: false })).toBe(0)
    expect(ambientBarOpacity({ ...active, blocked: true })).toBe(0)
    expect(ambientBarOpacity({ ...active, enabled: false })).toBe(0)
    expect(ambientBarOpacity({ ...active, fullscreen: true })).toBe(0)
    expect(ambientBarOpacity({ ...active, docked: true })).toBe(0)
    expect(ambientBarOpacity({ ...active, reducedMotion: true })).toBe(0)
  })
})

describe('detectSymmetricBarCrop', () => {
  it('crops symmetric encoded pillarbox bars without losing inner picture colors', () => {
    const pixels = makePixels(32, 18, (x) => (x < 4 || x >= 28 ? [2, 2, 2] : [140, 120, 180]))
    expect(detectSymmetricBarCrop(pixels, 32, 18)).toEqual({ x: 4, y: 0, w: 24, h: 18 })
  })

  it('crops symmetric encoded letterbox bars up to 20 percent', () => {
    const pixels = makePixels(32, 18, (_x, y) => (y < 2 || y >= 16 ? [0, 0, 0] : [200, 90, 40]))
    expect(detectSymmetricBarCrop(pixels, 32, 18)).toEqual({ x: 0, y: 2, w: 32, h: 14 })
  })

  it('preserves asymmetric dark scenes and all-black fade frames', () => {
    const leftOnly = makePixels(32, 18, (x) => (x < 5 ? [0, 0, 0] : [110, 150, 210]))
    expect(detectSymmetricBarCrop(leftOnly, 32, 18)).toEqual({ x: 0, y: 0, w: 32, h: 18 })

    const allBlack = makePixels(32, 18, () => [0, 0, 0])
    expect(detectSymmetricBarCrop(allBlack, 32, 18)).toEqual({ x: 0, y: 0, w: 32, h: 18 })
  })
})
