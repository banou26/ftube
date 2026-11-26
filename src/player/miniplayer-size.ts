export type MiniplayerResizeEdge = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'bottom-right'

export type MiniplayerBounds = { min: number, max: number }

export type MiniplayerPosition = { x: number, y: number }

export type MiniplayerRect = { left: number, top: number, width: number, height: number }

export type MiniplayerPositionBounds = {
  minLeft: number
  maxLeft: number
  minTop: number
  maxTop: number
}

export const DEFAULT_MINIPLAYER_WIDTH = 400
export const MIN_MINIPLAYER_WIDTH = 280
export const MAX_MINIPLAYER_WIDTH = 1200

export const MINIPLAYER_MARGIN = 16
export const MINIPLAYER_TOP_CLEARANCE = 72
export const MINIPLAYER_META_HEIGHT = 76
export const MINIPLAYER_MOVE_STEP = 24
export const MINIPLAYER_MOVE_LARGE_STEP = 64

const MINIPLAYER_MARGIN_X = 32
// 56px top bar plus 16px gaps above and below the dock keeps the full box below the header
const MINIPLAYER_VERTICAL_RESERVE = 88
const MINIPLAYER_KEYBOARD_STEP = 40
const MINIPLAYER_KEYBOARD_LARGE_STEP = 80
const FALLBACK_VIEWPORT_WIDTH = 1280
const FALLBACK_VIEWPORT_HEIGHT = 800

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const safeViewport = (viewportWidth: number, viewportHeight: number) => ({
  width: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT_WIDTH,
  height: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT_HEIGHT,
})

/** Normalizes a persisted miniplayer width, dropping non-finite values and clamping to supported bounds. */
export const coerceMiniplayerWidth = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(clamp(value, MIN_MINIPLAYER_WIDTH, MAX_MINIPLAYER_WIDTH))
}

/** Normalizes a persisted miniplayer position (`[0, 1]` travel fractions), dropping invalid values. */
export const coerceMiniplayerPosition = (value: unknown): MiniplayerPosition | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as { x?: unknown, y?: unknown }
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x)) return undefined
  if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) return undefined
  return { x: clamp(raw.x, 0, 1), y: clamp(raw.y, 0, 1) }
}

/** Returns the total CSS pixel height of the miniplayer card for a given width and metadata bar height. */
export const miniplayerBoxHeight = (width: number, metaHeight = MINIPLAYER_META_HEIGHT): number =>
  Math.round(width * 9 / 16) + metaHeight

/** Returns the inclusive [min, max] CSS pixel width allowed for the miniplayer in the current viewport. */
export const miniplayerWidthBounds = (viewportWidth: number, viewportHeight: number): MiniplayerBounds => {
  const { width, height } = safeViewport(viewportWidth, viewportHeight)
  const maxByWidth = Math.max(160, Math.floor(width - MINIPLAYER_MARGIN_X))
  const maxByHeight = Math.max(160, Math.floor((height - MINIPLAYER_META_HEIGHT - MINIPLAYER_VERTICAL_RESERVE) * 16 / 9))
  const max = Math.min(MAX_MINIPLAYER_WIDTH, maxByWidth, maxByHeight)
  const min = Math.min(MIN_MINIPLAYER_WIDTH, max)
  return { min, max }
}

/** Clamps a desired or default miniplayer width to fit the current viewport cleanly. */
export const clampMiniplayerWidth = (
  desiredWidth: number | undefined,
  viewportWidth: number,
  viewportHeight: number,
): number => {
  const { min, max } = miniplayerWidthBounds(viewportWidth, viewportHeight)
  const target = typeof desiredWidth === 'number' && Number.isFinite(desiredWidth)
    ? desiredWidth
    : DEFAULT_MINIPLAYER_WIDTH
  return Math.round(clamp(target, min, max))
}

/**
 * Returns valid top-left CSS pixel bounds keeping the miniplayer clear of viewport margins
 * and the fixed 56px top header (`MINIPLAYER_TOP_CLEARANCE = 72px`).
 */
export const miniplayerPositionBounds = (
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): MiniplayerPositionBounds => {
  const safe = safeViewport(viewportWidth, viewportHeight)
  const maxLeft = Math.max(0, Math.floor(safe.width - width - MINIPLAYER_MARGIN))
  const minLeft = Math.min(MINIPLAYER_MARGIN, maxLeft)
  const maxTop = Math.max(0, Math.floor(safe.height - height - MINIPLAYER_MARGIN))
  const minTop = Math.min(MINIPLAYER_TOP_CLEARANCE, maxTop)
  return { minLeft, maxLeft, minTop, maxTop }
}

/** Resolves a normalized miniplayer position (or default bottom-right when absent) to CSS pixel coordinates. */
export const resolveMiniplayerRect = (
  position: MiniplayerPosition | undefined,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): MiniplayerRect => {
  const bounds = miniplayerPositionBounds(viewportWidth, viewportHeight, width, height)
  const resolved = position ?? { x: 1, y: 1 }
  const left = Math.round(bounds.minLeft + clamp(resolved.x, 0, 1) * (bounds.maxLeft - bounds.minLeft))
  const top = Math.round(bounds.minTop + clamp(resolved.y, 0, 1) * (bounds.maxTop - bounds.minTop))
  return { left, top, width, height }
}

/** Converts clamped CSS pixel coordinates back into normalized `[0, 1]` travel fractions. */
export const positionFromCoords = (
  left: number,
  top: number,
  bounds: MiniplayerPositionBounds,
): MiniplayerPosition => {
  const spanX = bounds.maxLeft - bounds.minLeft
  const spanY = bounds.maxTop - bounds.minTop
  return {
    x: spanX > 0 ? clamp((left - bounds.minLeft) / spanX, 0, 1) : 1,
    y: spanY > 0 ? clamp((top - bounds.minTop) / spanY, 0, 1) : 1,
  }
}

/** Nudges the miniplayer position by `(dx, dy)` CSS pixels and clamps within viewport bounds. */
export const nudgeMiniplayerPosition = (
  position: MiniplayerPosition | undefined,
  dx: number,
  dy: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): MiniplayerPosition => {
  const rect = resolveMiniplayerRect(position, width, height, viewportWidth, viewportHeight)
  const bounds = miniplayerPositionBounds(viewportWidth, viewportHeight, width, height)
  return positionFromCoords(
    clamp(rect.left + dx, bounds.minLeft, bounds.maxLeft),
    clamp(rect.top + dy, bounds.minTop, bounds.maxTop),
    bounds,
  )
}

/**
 * Computes the next miniplayer width while dragging an anchor-free edge (`left`, `top`, or `top-left`).
 * `dx` and `dy` grow positively as the pointer moves left (`startX - clientX`) and up (`startY - clientY`).
 * Corner drags project orthogonally onto the 16:9 diagonal so 1:1 diagonal motion tracks the pointer without seams.
 */
export const draggedMiniplayerWidth = (
  { edge, startWidth, dx, dy, viewportWidth, viewportHeight }: {
    edge: MiniplayerResizeEdge
    startWidth: number
    dx: number
    dy: number
    viewportWidth: number
    viewportHeight: number
  },
): number => {
  const deltaWidth = edge === 'left'
    ? dx
    : edge === 'right'
      ? -dx
      : edge === 'top'
        ? dy * (16 / 9)
        : edge === 'bottom'
          ? -dy * (16 / 9)
          : edge === 'bottom-right'
            ? (-16 * dx - 9 * dy) * (16 / (16 * 16 + 9 * 9))
            : (16 * dx + 9 * dy) * (16 / (16 * 16 + 9 * 9))
  return clampMiniplayerWidth(startWidth + deltaWidth, viewportWidth, viewportHeight)
}

/**
 * Computes the resized miniplayer rectangle keeping the opposite edges anchored when room permits.
 * Uses standard screen deltas (`dx = clientX - startX`, `dy = clientY - startY`).
 */
export const resizedMiniplayerRect = (
  { startRect, edge, dx, dy, viewportWidth, viewportHeight, metaHeight = MINIPLAYER_META_HEIGHT }: {
    startRect: MiniplayerRect
    edge: MiniplayerResizeEdge
    dx: number
    dy: number
    viewportWidth: number
    viewportHeight: number
    metaHeight?: number
  },
): MiniplayerRect => {
  const { width: safeVW, height: safeVH } = safeViewport(viewportWidth, viewportHeight)
  const { min, max } = miniplayerWidthBounds(safeVW, safeVH)
  const startRight = startRect.left + startRect.width
  const startBottom = startRect.top + startRect.height

  const anchorsBottomRight = edge === 'left' || edge === 'top' || edge === 'top-left'
  const deltaWidth = edge === 'left'
    ? -dx
    : edge === 'right'
      ? dx
      : edge === 'top'
        ? -dy * (16 / 9)
        : edge === 'bottom'
          ? dy * (16 / 9)
          : edge === 'top-left'
            ? (16 * -dx + 9 * -dy) * (16 / (16 * 16 + 9 * 9))
            : (16 * dx + 9 * dy) * (16 / (16 * 16 + 9 * 9))

  const minLeftEdge = Math.min(MINIPLAYER_MARGIN, Math.max(0, safeVW - min - MINIPLAYER_MARGIN))
  const edgeMaxWidth = anchorsBottomRight
    ? Math.max(min, Math.floor(startRight - minLeftEdge))
    : Math.max(min, Math.floor(safeVW - MINIPLAYER_MARGIN - startRect.left))

  const verticalCap = edge === 'top' || edge === 'top-left'
    ? Math.max(min, Math.floor((startBottom - MINIPLAYER_TOP_CLEARANCE - metaHeight) * 16 / 9))
    : max

  const effectiveMax = Math.min(max, edgeMaxWidth, verticalCap)
  const nextWidth = Math.round(clamp(startRect.width + deltaWidth, Math.min(min, effectiveMax), effectiveMax))
  const nextHeight = miniplayerBoxHeight(nextWidth, metaHeight)
  const bounds = miniplayerPositionBounds(safeVW, safeVH, nextWidth, nextHeight)

  const rawLeft = anchorsBottomRight ? startRight - nextWidth : startRect.left
  const rawTop = anchorsBottomRight ? startBottom - nextHeight : startRect.top
  return {
    left: Math.round(clamp(rawLeft, bounds.minLeft, bounds.maxLeft)),
    top: Math.round(clamp(rawTop, bounds.minTop, bounds.maxTop)),
    width: nextWidth,
    height: nextHeight,
  }
}

/** Steps the miniplayer width via keyboard controls and clamps the result to viewport bounds. */
export const stepMiniplayerWidth = (
  currentWidth: number,
  direction: 1 | -1,
  large: boolean,
  viewportWidth: number,
  viewportHeight: number,
): number => {
  const delta = direction * (large ? MINIPLAYER_KEYBOARD_LARGE_STEP : MINIPLAYER_KEYBOARD_STEP)
  return clampMiniplayerWidth(currentWidth + delta, viewportWidth, viewportHeight)
}
