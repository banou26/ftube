import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => '' }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))

import {
  ambientBarOpacity,
  ambientOpacity,
  computeContainedVideoRect,
  detectSymmetricBarCrop,
  drawEdgeMatchedFrame,
} from '../../../src/player/ambient-glow'

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

describe('computeContainedVideoRect', () => {
  it('computes exact object-fit: contain bounds across pillarbox, letterbox, matching, and portrait aspect ratios', () => {
    expect(computeContainedVideoRect(1200, 450, 1920, 1080)).toEqual({ x: 200, y: 0, width: 800, height: 450 })
    expect(computeContainedVideoRect(640, 450, 640, 240)).toEqual({ x: 0, y: 105, width: 640, height: 240 })
    expect(computeContainedVideoRect(1280, 720, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
    expect(computeContainedVideoRect(960, 540, 1080, 1920)).toEqual({ x: 328.125, y: 0, width: 303.75, height: 540 })
  })

  it('handles zero or non-finite dimensions safely without NaN', () => {
    expect(computeContainedVideoRect(800, 450, 0, 0)).toEqual({ x: 0, y: 0, width: 800, height: 450 })
    expect(computeContainedVideoRect(800, 450, Number.NaN, 1080)).toEqual({ x: 0, y: 0, width: 800, height: 450 })
    expect(computeContainedVideoRect(0, 450, 1920, 1080)).toEqual({ x: 0, y: 0, width: 0, height: 450 })
  })
})

describe('drawEdgeMatchedFrame', () => {
  const createRecorder = () => {
    const drawCalls: { sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, tx: number, ty: number, scaleX: number, scaleY: number }[] = []
    const clearCalls: [number, number, number, number][] = []
    let tx = 0
    let ty = 0
    let scaleX = 1
    let scaleY = 1
    const stack: [number, number, number, number][] = []
    const ctx = {
      clearRect: (x: number, y: number, w: number, h: number) => clearCalls.push([x, y, w, h]),
      save: () => stack.push([tx, ty, scaleX, scaleY]),
      restore: () => {
        const prev = stack.pop()
        if (prev) [tx, ty, scaleX, scaleY] = prev
      },
      translate: (x: number, y: number) => {
        tx += x * scaleX
        ty += y * scaleY
      },
      scale: (x: number, y: number) => {
        scaleX *= x
        scaleY *= y
      },
      drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
        drawCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh, tx, ty, scaleX, scaleY })
      },
    }
    return { ctx, drawCalls, clearCalls }
  }

  it('draws the frame inside videoRect and mirrors outer ~8% strips into surrounding margins and corners', () => {
    const { ctx, drawCalls, clearCalls } = createRecorder()
    drawEdgeMatchedFrame(
      ctx,
      {} as CanvasImageSource,
      64,
      36,
      64,
      36,
      { x: 10, y: 4, width: 44, height: 28 },
    )

    expect(clearCalls).toEqual([[0, 0, 64, 36]])
    expect(drawCalls).toHaveLength(9)
    expect(drawCalls[0]).toMatchObject({ sx: 0, sy: 0, sw: 64, sh: 36, dx: 10, dy: 4, dw: 44, dh: 28, scaleX: 1, scaleY: 1 })

    // Left strip samples sx=0..5 (outer ~8%, never center) and mirrors flush against x=10
    expect(drawCalls[1]).toMatchObject({ sx: 0, sy: 0, sw: 5, sh: 36, dx: 0, dy: 4, dw: 10, dh: 28, tx: 10, scaleX: -1, scaleY: 1 })
    // Right strip samples sx=59..64 and mirrors flush against x=54
    expect(drawCalls[2]).toMatchObject({ sx: 59, sy: 0, sw: 5, sh: 36, dx: 0, dy: 4, dw: 10, dh: 28, tx: 64, scaleX: -1, scaleY: 1 })
    // Top strip samples sy=0..3 and mirrors flush against y=4
    expect(drawCalls[3]).toMatchObject({ sx: 0, sy: 0, sw: 64, sh: 3, dx: 10, dy: 0, dw: 44, dh: 4, ty: 4, scaleX: 1, scaleY: -1 })
    // Bottom strip samples sy=33..36 and mirrors flush against y=32
    expect(drawCalls[4]).toMatchObject({ sx: 0, sy: 33, sw: 64, sh: 3, dx: 10, dy: 0, dw: 44, dh: 4, ty: 36, scaleX: 1, scaleY: -1 })
    // Corners sample outer 5x3 corner strips under dual mirroring
    expect(drawCalls[5]).toMatchObject({ sx: 0, sy: 0, sw: 5, sh: 3, tx: 10, ty: 4, scaleX: -1, scaleY: -1 })
    expect(drawCalls[6]).toMatchObject({ sx: 59, sy: 0, sw: 5, sh: 3, tx: 64, ty: 4, scaleX: -1, scaleY: -1 })
    expect(drawCalls[7]).toMatchObject({ sx: 0, sy: 33, sw: 5, sh: 3, tx: 10, ty: 36, scaleX: -1, scaleY: -1 })
    expect(drawCalls[8]).toMatchObject({ sx: 59, sy: 33, sw: 5, sh: 3, tx: 64, ty: 36, scaleX: -1, scaleY: -1 })
  })
})
