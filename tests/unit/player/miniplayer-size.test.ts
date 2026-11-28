import { describe, expect, it } from 'vite-plus/test'

import {
  clampMiniplayerWidth,
  coerceMiniplayerPosition,
  coerceMiniplayerWidth,
  DEFAULT_MINIPLAYER_WIDTH,
  DEFAULT_VERTICAL_MINIPLAYER_WIDTH,
  draggedMiniplayerWidth,
  MAX_MINIPLAYER_WIDTH,
  MAX_VERTICAL_MINIPLAYER_WIDTH,
  MIN_MINIPLAYER_WIDTH,
  MIN_VERTICAL_MINIPLAYER_WIDTH,
  miniplayerBoxHeight,
  miniplayerPositionBounds,
  miniplayerWidthBounds,
  nudgeMiniplayerPosition,
  positionFromCoords,
  resizedMiniplayerRect,
  resolveMiniplayerRect,
  stepMiniplayerWidth,
} from '../../../src/player/miniplayer-size'

describe('miniplayer sizing helpers', () => {
  it('coerces persisted widths and drops non-finite values', () => {
    expect(coerceMiniplayerWidth(undefined)).toBeUndefined()
    expect(coerceMiniplayerWidth(null)).toBeUndefined()
    expect(coerceMiniplayerWidth('500')).toBeUndefined()
    expect(coerceMiniplayerWidth(Number.NaN)).toBeUndefined()
    expect(coerceMiniplayerWidth(Number.POSITIVE_INFINITY)).toBeUndefined()

    expect(coerceMiniplayerWidth(120)).toBe(MIN_MINIPLAYER_WIDTH)
    expect(coerceMiniplayerWidth(512.6)).toBe(513)
    expect(coerceMiniplayerWidth(3400)).toBe(MAX_MINIPLAYER_WIDTH)
  })

  it('bounds miniplayer width cleanly to viewport width and height', () => {
    expect(miniplayerWidthBounds(1280, 800)).toEqual({ min: 280, max: 1130 })
    expect(miniplayerWidthBounds(3400, 2119)).toEqual({ min: 280, max: MAX_MINIPLAYER_WIDTH })
    expect(miniplayerWidthBounds(360, 740)).toEqual({ min: 280, max: 328 })
    expect(miniplayerWidthBounds(500, 700)).toEqual({ min: 280, max: 468 })
    expect(miniplayerWidthBounds(1280, 300)).toEqual({ min: 241, max: 241 })
    expect(miniplayerWidthBounds(0, Number.NaN)).toEqual({ min: 280, max: 1130 })

    expect(clampMiniplayerWidth(undefined, 1280, 800)).toBe(DEFAULT_MINIPLAYER_WIDTH)
    expect(clampMiniplayerWidth(undefined, 360, 740)).toBe(328)
    expect(clampMiniplayerWidth(700, 500, 700)).toBe(468)
    expect(clampMiniplayerWidth(100, 1280, 800)).toBe(280)
  })

  it('tracks 16:9 drag deltas across left, top, and top-left handles without seams', () => {
    expect(draggedMiniplayerWidth({
      edge: 'left',
      startWidth: 400,
      dx: 160,
      dy: 0,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(560)

    expect(draggedMiniplayerWidth({
      edge: 'top',
      startWidth: 560,
      dx: 0,
      dy: 90,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(720)

    expect(draggedMiniplayerWidth({
      edge: 'top-left',
      startWidth: 400,
      dx: 160,
      dy: 90,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(560)

    expect(draggedMiniplayerWidth({
      edge: 'top-left',
      startWidth: 560,
      dx: -160,
      dy: -90,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(400)

    // opposite-sign drag stays monotonic rather than jumping
    const slightShrink = draggedMiniplayerWidth({
      edge: 'top-left',
      startWidth: 500,
      dx: 10,
      dy: -20,
      viewportWidth: 1280,
      viewportHeight: 800,
    })
    const moreShrink = draggedMiniplayerWidth({
      edge: 'top-left',
      startWidth: 500,
      dx: 10,
      dy: -30,
      viewportWidth: 1280,
      viewportHeight: 800,
    })
    expect(moreShrink).toBeLessThanOrEqual(slightShrink)

    // clamps at viewport max and min
    expect(draggedMiniplayerWidth({
      edge: 'left',
      startWidth: 400,
      dx: 2000,
      dy: 0,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(1130)
    expect(draggedMiniplayerWidth({
      edge: 'left',
      startWidth: 400,
      dx: -500,
      dy: 0,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toBe(280)
  })

  it('steps miniplayer width for normal and Shift keyboard steps and clamps to bounds', () => {
    expect(stepMiniplayerWidth(400, 1, false, 1280, 800)).toBe(440)
    expect(stepMiniplayerWidth(400, 1, true, 1280, 800)).toBe(480)
    expect(stepMiniplayerWidth(400, -1, false, 1280, 800)).toBe(360)
    expect(stepMiniplayerWidth(280, -1, true, 1280, 800)).toBe(280)
    expect(stepMiniplayerWidth(1120, 1, true, 1280, 800)).toBe(1130)
  })

  it('coerces normalized miniplayer positions and rejects invalid inputs', () => {
    expect(coerceMiniplayerPosition(undefined)).toBeUndefined()
    expect(coerceMiniplayerPosition(null)).toBeUndefined()
    expect(coerceMiniplayerPosition([0, 0])).toBeUndefined()
    expect(coerceMiniplayerPosition({ x: '0.5', y: 0.5 })).toBeUndefined()
    expect(coerceMiniplayerPosition({ x: Number.NaN, y: 0.5 })).toBeUndefined()
    expect(coerceMiniplayerPosition({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 })
    expect(coerceMiniplayerPosition({ x: -2, y: 3 })).toEqual({ x: 0, y: 1 })
  })

  it('resolves, clamps, nudges, and converts coordinates safely below the 56px header', () => {
    const height = miniplayerBoxHeight(400)
    expect(height).toBe(301)

    const bounds = miniplayerPositionBounds(1280, 800, 400, height)
    expect(bounds).toEqual({ minLeft: 16, maxLeft: 864, minTop: 72, maxTop: 483 })

    expect(resolveMiniplayerRect(undefined, 400, height, 1280, 800)).toEqual({
      left: 864,
      top: 483,
      width: 400,
      height: 301,
    })
    expect(resolveMiniplayerRect({ x: 0, y: 0 }, 400, height, 1280, 800)).toEqual({
      left: 16,
      top: 72,
      width: 400,
      height: 301,
    })

    // Zero-span travel falls back cleanly to 1 without dividing by zero
    expect(positionFromCoords(16, 72, { minLeft: 16, maxLeft: 16, minTop: 72, maxTop: 72 })).toEqual({ x: 1, y: 1 })

    const nudged = nudgeMiniplayerPosition({ x: 0, y: 0 }, 64, 24, 400, height, 1280, 800)
    expect(resolveMiniplayerRect(nudged, 400, height, 1280, 800)).toMatchObject({ left: 80, top: 96 })
  })

  it('resizes anchored at top-left for right, bottom, and bottom-right handles without leaving bounds', () => {
    const startRect = { left: 16, top: 72, width: 400, height: 301 }
    expect(resizedMiniplayerRect({
      startRect,
      edge: 'right',
      dx: 160,
      dy: 0,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toEqual({ left: 16, top: 72, width: 560, height: 391 })

    expect(resizedMiniplayerRect({
      startRect,
      edge: 'bottom',
      dx: 0,
      dy: 90,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toEqual({ left: 16, top: 72, width: 560, height: 391 })

    expect(resizedMiniplayerRect({
      startRect,
      edge: 'bottom-right',
      dx: 160,
      dy: 90,
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toEqual({ left: 16, top: 72, width: 560, height: 391 })
  })

  it('supports vertical 9:16 miniplayer bounds, clamping, drag deltas, resizing, and stepping', () => {
    expect(DEFAULT_VERTICAL_MINIPLAYER_WIDTH).toBe(240)
    expect(MIN_VERTICAL_MINIPLAYER_WIDTH).toBe(200)
    expect(MAX_VERTICAL_MINIPLAYER_WIDTH).toBe(420)
    expect(miniplayerBoxHeight(240, 76, 'vertical')).toBe(503)

    // At 1280x800, max height is bounded by 800 - 76 - 88 = 636 -> width <= Math.floor(636 * 9 / 16) = 357
    expect(miniplayerWidthBounds(1280, 800, 'vertical')).toEqual({ min: 200, max: 357 })
    // Tall screen allows up to MAX_VERTICAL_MINIPLAYER_WIDTH (420)
    expect(miniplayerWidthBounds(1440, 1200, 'vertical')).toEqual({ min: 200, max: 420 })
    // Short viewport clamps vertical miniplayer width cleanly to keep it on screen
    expect(clampMiniplayerWidth(undefined, 1280, 500, 'vertical')).toBe(189)
    expect(clampMiniplayerWidth(100, 1280, 550, 'vertical')).toBe(200)
    expect(clampMiniplayerWidth(undefined, 1280, 800, 'vertical')).toBe(240)

    expect(draggedMiniplayerWidth({
      edge: 'top',
      startWidth: 240,
      dx: 0,
      dy: 160,
      viewportWidth: 1280,
      viewportHeight: 1200,
      aspect: 'vertical',
    })).toBe(330)

    expect(stepMiniplayerWidth(240, 1, false, 1280, 800, 'vertical')).toBe(280)
    expect(stepMiniplayerWidth(340, 1, true, 1280, 800, 'vertical')).toBe(357)

    const verticalRect = { left: 16, top: 72, width: 240, height: miniplayerBoxHeight(240, 76, 'vertical') }
    const resized = resizedMiniplayerRect({
      startRect: verticalRect,
      edge: 'bottom-right',
      dx: 45,
      dy: 80,
      viewportWidth: 1280,
      viewportHeight: 1200,
      aspect: 'vertical',
    })
    expect(resized.width).toBe(285)
    expect(resized.height).toBe(miniplayerBoxHeight(285, 76, 'vertical'))
  })
})
