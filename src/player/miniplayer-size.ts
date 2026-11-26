export type MiniplayerResizeEdge = 'left' | 'top' | 'top-left'

export type MiniplayerBounds = { min: number, max: number }

export const DEFAULT_MINIPLAYER_WIDTH = 400
export const MIN_MINIPLAYER_WIDTH = 280
export const MAX_MINIPLAYER_WIDTH = 1200

const MINIPLAYER_MARGIN_X = 32
const MINIPLAYER_META_HEIGHT = 76
// 56px top bar plus 16px gaps above and below the dock keeps the full box below the header
const MINIPLAYER_VERTICAL_RESERVE = 88
const MINIPLAYER_KEYBOARD_STEP = 40
const MINIPLAYER_KEYBOARD_LARGE_STEP = 80
const FALLBACK_VIEWPORT_WIDTH = 1280
const FALLBACK_VIEWPORT_HEIGHT = 800

/** Normalizes a persisted miniplayer width, dropping non-finite values and clamping to supported bounds. */
export const coerceMiniplayerWidth = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.min(MAX_MINIPLAYER_WIDTH, Math.max(MIN_MINIPLAYER_WIDTH, value)))
}

/** Returns the inclusive [min, max] CSS pixel width allowed for the miniplayer in the current viewport. */
export const miniplayerWidthBounds = (viewportWidth: number, viewportHeight: number): MiniplayerBounds => {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT_WIDTH
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT_HEIGHT
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
  return Math.round(Math.min(max, Math.max(min, target)))
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
    : edge === 'top'
      ? dy * (16 / 9)
      : (16 * dx + 9 * dy) * (16 / (16 * 16 + 9 * 9))
  return clampMiniplayerWidth(startWidth + deltaWidth, viewportWidth, viewportHeight)
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
