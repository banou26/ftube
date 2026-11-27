export type AmbientArea = 'around' | 'sides' | 'top-bottom' | 'full-page'

export type AmbientFillMode = 'edge' | 'stretch' | 'average' | 'vivid'

export type AmbientPlacement = 'watch' | 'shorts'

export const AMBIENT_AREA_DEFAULT: AmbientArea = 'around'
export const AMBIENT_FILL_MODE_DEFAULT: AmbientFillMode = 'edge'
export const AMBIENT_SPREAD_MIN = 25
export const AMBIENT_SPREAD_MAX = 200
export const AMBIENT_SPREAD_DEFAULT = 100

export const AMBIENT_AREA_OPTIONS: { value: AmbientArea, label: string }[] = [
  { value: 'around', label: 'Around player' },
  { value: 'sides', label: 'Sides only' },
  { value: 'top-bottom', label: 'Top & bottom' },
  { value: 'full-page', label: 'Full page' },
]

export const AMBIENT_FILL_MODE_OPTIONS: { value: AmbientFillMode, label: string }[] = [
  { value: 'edge', label: 'Edge match' },
  { value: 'stretch', label: 'Full frame' },
  { value: 'average', label: 'Average color' },
  { value: 'vivid', label: 'Vivid' },
]

export const AMBIENT_SPREAD_PRESETS = [50, 100, 150, 200] as const

const AREA_SET = new Set<string>(['around', 'sides', 'top-bottom', 'full-page'])
const FILL_SET = new Set<string>(['edge', 'stretch', 'average', 'vivid'])

export const coerceAmbientArea = (value: unknown): AmbientArea =>
  typeof value === 'string' && AREA_SET.has(value) ? value as AmbientArea : AMBIENT_AREA_DEFAULT

export const coerceAmbientSpread = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AMBIENT_SPREAD_DEFAULT
  return Math.round(Math.min(AMBIENT_SPREAD_MAX, Math.max(AMBIENT_SPREAD_MIN, value)))
}

export const coerceAmbientFillMode = (value: unknown): AmbientFillMode =>
  typeof value === 'string' && FILL_SET.has(value) ? value as AmbientFillMode : AMBIENT_FILL_MODE_DEFAULT

export type AmbientGlowVars = {
  position: 'absolute' | 'fixed'
  top: string
  right: string
  bottom: string
  left: string
  mask: string
  filter: string
  opacityScale: number
}

const MASK_AROUND = 'radial-gradient(ellipse 50% 50% at 50% 45%, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0.75) 87%, transparent 100%)'
const MASK_SIDES = 'linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 1) 18%, rgba(0, 0, 0, 1) 82%, transparent 100%)'
const MASK_TOP_BOTTOM = 'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 1) 18%, rgba(0, 0, 0, 1) 82%, transparent 100%)'

const remOffset = (baseRem: number, scale: number) =>
  baseRem === 0 ? '0px' : `${(-baseRem * scale).toFixed(2)}rem`

/** Computes CSS positioning, edge-fade mask, filter, and opacity scaling for AmbientGlow. */
export const computeAmbientGlowVars = (
  area: AmbientArea,
  spread: number,
  fillMode: AmbientFillMode,
  placement: AmbientPlacement = 'watch',
): AmbientGlowVars => {
  const safeArea = coerceAmbientArea(area)
  const safeSpread = coerceAmbientSpread(spread)
  const safeFill = coerceAmbientFillMode(fillMode)
  const scale = safeSpread / 100
  const isShorts = placement === 'shorts'

  const baseBlur = 5.2 * (0.65 + 0.35 * scale)
  const blurRem = Math.min(9.6, Math.max(2.6, safeArea === 'full-page' ? baseBlur * 1.15 : baseBlur))
  const filter = safeFill === 'vivid'
    ? `blur(${blurRem.toFixed(2)}rem) saturate(2.2) brightness(1.16)`
    : safeFill === 'average'
      ? `blur(${blurRem.toFixed(2)}rem) saturate(1.45) brightness(1.05)`
      : safeFill === 'stretch'
        ? `blur(${blurRem.toFixed(2)}rem) saturate(1.55) brightness(1.06)`
        : `blur(${blurRem.toFixed(2)}rem) saturate(1.65) brightness(1.08)`

  const opacityScale = safeFill === 'vivid'
    ? 1.15
    : safeFill === 'average'
      ? 0.95
      : safeArea === 'full-page'
        ? 0.85
        : 1

  if (safeArea === 'full-page') {
    return {
      position: 'fixed',
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px',
      mask: 'none',
      filter,
      opacityScale,
    }
  }

  if (safeArea === 'sides') {
    const sideBase = isShorts ? 16 : 9.6
    return {
      position: 'absolute',
      top: '0px',
      right: remOffset(sideBase, scale),
      bottom: '0px',
      left: remOffset(sideBase, scale),
      mask: MASK_SIDES,
      filter,
      opacityScale,
    }
  }

  if (safeArea === 'top-bottom') {
    const topBase = isShorts ? 8 : 6.4
    const bottomBase = isShorts ? 10 : 12.8
    return {
      position: 'absolute',
      top: remOffset(topBase, scale),
      right: '0px',
      bottom: remOffset(bottomBase, scale),
      left: '0px',
      mask: MASK_TOP_BOTTOM,
      filter,
      opacityScale,
    }
  }

  // 'around': Watch preserves youtube.com halo proportions; Shorts spreads wide beyond the 9:16 stage so it is clearly visible beside vertical frames.
  const topBase = isShorts ? 7.2 : 4.8
  const sideBase = isShorts ? 14 : 6.4
  const bottomBase = isShorts ? 10.8 : 11.2
  return {
    position: 'absolute',
    top: remOffset(topBase, scale),
    right: remOffset(sideBase, scale),
    bottom: remOffset(bottomBase, scale),
    left: remOffset(sideBase, scale),
    mask: MASK_AROUND,
    filter,
    opacityScale,
  }
}
