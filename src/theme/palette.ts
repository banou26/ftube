export type ThemeMode = 'dark' | 'light'

export type ThemePreset = {
  id: string
  name: string
  color: string
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'crimson', name: 'Crimson', color: '#ff0033' },
  { id: 'ocean', name: 'Ocean', color: '#2563eb' },
  { id: 'emerald', name: 'Emerald', color: '#10b981' },
  { id: 'amber', name: 'Amber', color: '#d97706' },
  { id: 'violet', name: 'Violet', color: '#7c3aed' },
  { id: 'rose', name: 'Rose', color: '#e11d48' },
  { id: 'teal', name: 'Teal', color: '#0d9488' },
  { id: 'cobalt', name: 'Cobalt', color: '#4f46e5' },
]

export const THEME_TOKEN_KEYS = [
  '--bg-base',
  '--bg-subtle',
  '--bg-elevated',
  '--bg-menu',
  '--bg-chip',
  '--bg-chip-hover',
  '--bg-selected',
  '--bg-hover',
  '--bg-hover-strong',
  '--bg-input',
  '--bg-input-button',
  '--bg-inverse',
  '--bg-inverse-hover',
  '--border',
  '--border-strong',
  '--border-subtle',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-placeholder',
  '--text-inverse',
  '--accent',
  '--accent-hover',
  '--accent-focus',
  '--accent-inverse',
  '--accent-tint',
  '--transcript-tint',
  '--transcript-tint-text',
  '--brand-red',
  '--brand-mark',
  '--brand-mark-ink',
] as const

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number]
export type ThemePalette = Record<ThemeTokenKey, string>

export type Rgb = { r: number, g: number, b: number }
type Hsl = { h: number, s: number, l: number }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export const normalizeHexColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  const short = trimmed.match(/^#([0-9a-f]{3})$/)
  if (!short?.[1]) return undefined
  const [r, g, b] = short[1]
  return `#${r}${r}${g}${g}${b}${b}`
}

const hexToRgb = (hex: string): Rgb => {
  const clean = normalizeHexColor(hex) ?? '#000000'
  return {
    r: Number.parseInt(clean.slice(1, 3), 16),
    g: Number.parseInt(clean.slice(3, 5), 16),
    b: Number.parseInt(clean.slice(5, 7), 16),
  }
}

const rgbToHex = ({ r, g, b }: Rgb): string => {
  const part = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export const rgbToHsl = ({ r, g, b }: Rgb): Hsl => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

export const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const sn = clamp(s, 0, 1)
  const ln = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m = ln - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

const hslToHex = (h: number, s: number, l: number): string => rgbToHex(hslToRgb(h, s, l))

const srgbLuminance = (channel: number) => {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * srgbLuminance(r) + 0.7152 * srgbLuminance(g) + 0.0722 * srgbLuminance(b)
}

export const contrastRatio = (fgHex: string, bgHex: string): number => {
  const l1 = luminance(fgHex)
  const l2 = luminance(bgHex)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Picks pure white or FTube near-black ink for maximum WCAG contrast against a solid fill. */
export const pickContrastingInk = (bgHex: string): string =>
  contrastRatio('#ffffff', bgHex) >= contrastRatio('#0f0f0f', bgHex) ? '#ffffff' : '#0f0f0f'

export const blendOver = (fg: string, bgHex: string): string => {
  const normalized = normalizeHexColor(fg)
  if (normalized) return normalized
  const match = fg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i)
  if (!match) return normalizeHexColor(bgHex) ?? '#000000'
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const a = clamp(match[4] === undefined ? 1 : Number(match[4]), 0, 1)
  const base = hexToRgb(bgHex)
  return rgbToHex({
    r: r * a + base.r * (1 - a),
    g: g * a + base.g * (1 - a),
    b: b * a + base.b * (1 - a),
  })
}

const rgba = (hex: string, alpha: number): string => {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Number(clamp(alpha, 0, 1).toFixed(3))})`
}

const ensureContrast = (
  h: number,
  s: number,
  initialL: number,
  backgrounds: readonly string[],
  minRatio: number,
  direction: 'lighter' | 'darker',
): string => {
  const passes = (candidate: string) =>
    backgrounds.every(bg => contrastRatio(candidate, bg) >= minRatio)

  const initialHex = hslToHex(h, s, initialL)
  if (passes(initialHex)) return initialHex

  let low = direction === 'lighter' ? clamp(initialL, 0, 1) : 0
  let high = direction === 'lighter' ? 1 : clamp(initialL, 0, 1)

  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2
    const candidate = hslToHex(h, s, mid)
    if (passes(candidate)) {
      if (direction === 'lighter') high = mid
      else low = mid
    } else if (direction === 'lighter') {
      low = mid
    } else {
      high = mid
    }
  }

  const best = hslToHex(h, s, direction === 'lighter' ? high : low)
  if (passes(best)) return best
  return direction === 'lighter' ? '#ffffff' : '#000000'
}

const pickBrandMark = (
  normalized: string,
  h: number,
  s: number,
  l: number,
  neutral: boolean,
  bgBase: string,
  direction: 'lighter' | 'darker',
) => contrastRatio(normalized, bgBase) >= 3.0
  ? normalized
  : ensureContrast(h, neutral ? 0 : Math.max(s, 0.72), l, [bgBase], 3.0, direction)

export const generateThemePalette = (inputHex: string, mode: ThemeMode): ThemePalette => {
  const normalized = normalizeHexColor(inputHex) ?? '#ff0033'
  const { h, s, l } = rgbToHsl(hexToRgb(normalized))
  const neutral = s < 0.06
  const bgSat = neutral ? 0 : mode === 'dark' ? clamp(s * 0.28, 0.06, 0.24) : clamp(s * 0.22, 0.04, 0.16)
  const accentSat = neutral ? 0 : clamp(Math.max(s, 0.55), 0.5, 0.92)

  if (mode === 'dark') {
    const bgBase = hslToHex(h, bgSat, 0.058)
    const bgInput = hslToHex(h, bgSat, 0.078)
    const bgSubtle = hslToHex(h, bgSat, 0.102)
    const bgChip = hslToHex(h, bgSat, 0.13)
    const bgChipHover = hslToHex(h, bgSat, 0.19)
    const bgElevated = hslToHex(h, bgSat, 0.15)
    const bgMenu = hslToHex(h, bgSat, 0.165)
    const bgInputButton = hslToHex(h, bgSat, 0.14)
    const bgInverse = hslToHex(h, bgSat * 0.4, 0.945)
    const bgInverseHover = hslToHex(h, bgSat * 0.4, 0.855)

    const primarySurfaces = [bgBase, bgSubtle, bgElevated, bgMenu, bgChip, bgInput]
    const cardSurfaces = [bgBase, bgSubtle, bgElevated, bgMenu, bgChip]

    const textPrimary = ensureContrast(h, bgSat * 0.25, 0.95, primarySurfaces, 7.0, 'lighter')
    const textSecondary = ensureContrast(h, bgSat * 0.2, 0.72, cardSurfaces, 4.5, 'lighter')
    const textTertiary = ensureContrast(h, bgSat * 0.18, 0.56, [bgBase, bgElevated], 3.2, 'lighter')
    const textInverse = ensureContrast(h, bgSat * 0.3, 0.07, [bgInverse, bgInverseHover], 7.0, 'darker')

    const accent = ensureContrast(h, accentSat, 0.68, primarySurfaces, 4.5, 'lighter')
    const accentHover = ensureContrast(h, accentSat, 0.76, primarySurfaces, 4.8, 'lighter')
    const accentFocus = ensureContrast(h, accentSat, 0.62, [bgBase, bgInput], 3.0, 'lighter')
    const accentInverse = ensureContrast(h, neutral ? 0 : clamp(s, 0.65, 0.95), 0.42, [bgInverse], 4.5, 'darker')
    const borderStrong = ensureContrast(h, bgSat * 0.4, 0.46, [bgBase], 3.0, 'lighter')
    const brandRed = ensureContrast(h, neutral ? 0 : Math.max(s, 0.72), 0.58, ['#181818'], 3.0, 'lighter')
    const brandMark = pickBrandMark(normalized, h, s, l, neutral, bgBase, 'lighter')
    const brandMarkInk = pickContrastingInk(brandMark)

    let tintAlpha = 0.2
    let accentTint = rgba(accent, tintAlpha)
    while (tintAlpha > 0.04 && contrastRatio(textPrimary, blendOver(accentTint, bgBase)) < 4.5) {
      tintAlpha -= 0.02
      accentTint = rgba(accent, tintAlpha)
    }

    return {
      '--bg-base': bgBase,
      '--bg-subtle': bgSubtle,
      '--bg-elevated': bgElevated,
      '--bg-menu': bgMenu,
      '--bg-chip': bgChip,
      '--bg-chip-hover': bgChipHover,
      '--bg-selected': rgba(accent, 0.18),
      '--bg-hover': 'rgba(255, 255, 255, 0.1)',
      '--bg-hover-strong': 'rgba(255, 255, 255, 0.2)',
      '--bg-input': bgInput,
      '--bg-input-button': bgInputButton,
      '--bg-inverse': bgInverse,
      '--bg-inverse-hover': bgInverseHover,
      '--border': rgba(accentFocus, 0.24),
      '--border-strong': borderStrong,
      '--border-subtle': rgba(accentFocus, 0.14),
      '--text-primary': textPrimary,
      '--text-secondary': textSecondary,
      '--text-tertiary': textTertiary,
      '--text-placeholder': textTertiary,
      '--text-inverse': textInverse,
      '--accent': accent,
      '--accent-hover': accentHover,
      '--accent-focus': accentFocus,
      '--accent-inverse': accentInverse,
      '--accent-tint': accentTint,
      '--transcript-tint': rgba(accent, 0.14),
      '--transcript-tint-text': accentHover,
      '--brand-red': brandRed,
      '--brand-mark': brandMark,
      '--brand-mark-ink': brandMarkInk,
    }
  }

  const bgBase = hslToHex(h, bgSat, 0.985)
  const bgInput = hslToHex(h, bgSat, 0.972)
  const bgSubtle = hslToHex(h, bgSat, 0.95)
  const bgChip = hslToHex(h, bgSat, 0.925)
  const bgChipHover = hslToHex(h, bgSat, 0.865)
  const bgElevated = hslToHex(h, bgSat, 0.996)
  const bgMenu = hslToHex(h, bgSat, 1.0)
  const bgInputButton = hslToHex(h, bgSat, 0.94)
  const bgInverse = hslToHex(h, bgSat * 0.5, 0.085)
  const bgInverseHover = hslToHex(h, bgSat * 0.5, 0.16)

  const primarySurfaces = [bgBase, bgSubtle, bgElevated, bgMenu, bgChip, bgInput]
  const cardSurfaces = [bgBase, bgSubtle, bgElevated, bgMenu, bgChip]

  const textPrimary = ensureContrast(h, bgSat * 0.35, 0.08, primarySurfaces, 7.0, 'darker')
  const textSecondary = ensureContrast(h, bgSat * 0.3, 0.34, cardSurfaces, 4.5, 'darker')
  const textTertiary = ensureContrast(h, bgSat * 0.25, 0.45, [bgBase, bgElevated], 3.2, 'darker')
  const textInverse = ensureContrast(h, bgSat * 0.2, 0.96, [bgInverse, bgInverseHover], 7.0, 'lighter')

  const accent = ensureContrast(h, accentSat, 0.44, primarySurfaces, 4.5, 'darker')
  const accentHover = ensureContrast(h, accentSat, 0.36, primarySurfaces, 5.2, 'darker')
  const accentFocus = ensureContrast(h, accentSat, 0.52, [bgBase, bgInput], 3.0, 'darker')
  const accentInverse = ensureContrast(h, neutral ? 0 : clamp(s, 0.65, 0.95), 0.72, [bgInverse], 4.5, 'lighter')
  const borderStrong = ensureContrast(h, bgSat * 0.5, 0.52, [bgBase], 3.0, 'darker')
  const brandRed = ensureContrast(h, neutral ? 0 : Math.max(s, 0.72), 0.58, ['#181818'], 3.0, 'lighter')
  const brandMark = pickBrandMark(normalized, h, s, l, neutral, bgBase, 'darker')
  const brandMarkInk = pickContrastingInk(brandMark)

  let tintAlpha = 0.14
  let accentTint = rgba(accent, tintAlpha)
  while (tintAlpha > 0.04 && contrastRatio(textPrimary, blendOver(accentTint, bgBase)) < 4.5) {
    tintAlpha -= 0.02
    accentTint = rgba(accent, tintAlpha)
  }

  return {
    '--bg-base': bgBase,
    '--bg-subtle': bgSubtle,
    '--bg-elevated': bgElevated,
    '--bg-menu': bgMenu,
    '--bg-chip': bgChip,
    '--bg-chip-hover': bgChipHover,
    '--bg-selected': rgba(accent, 0.12),
    '--bg-hover': 'rgba(0, 0, 0, 0.06)',
    '--bg-hover-strong': 'rgba(0, 0, 0, 0.12)',
    '--bg-input': bgInput,
    '--bg-input-button': bgInputButton,
    '--bg-inverse': bgInverse,
    '--bg-inverse-hover': bgInverseHover,
    '--border': rgba(accentFocus, 0.2),
    '--border-strong': borderStrong,
    '--border-subtle': rgba(accentFocus, 0.12),
    '--text-primary': textPrimary,
    '--text-secondary': textSecondary,
    '--text-tertiary': textTertiary,
    '--text-placeholder': textTertiary,
    '--text-inverse': textInverse,
    '--accent': accent,
    '--accent-hover': accentHover,
    '--accent-focus': accentFocus,
    '--accent-inverse': accentInverse,
    '--accent-tint': accentTint,
    '--transcript-tint': rgba(accent, 0.1),
    '--transcript-tint-text': accentHover,
    '--brand-red': brandRed,
    '--brand-mark': brandMark,
    '--brand-mark-ink': brandMarkInk,
  }
}

export const applyCustomPalette = (customColor: string | undefined, mode: ThemeMode): ThemePalette | undefined => {
  if (typeof document === 'undefined') return undefined
  const root = document.documentElement
  const normalized = normalizeHexColor(customColor)
  if (!normalized) {
    for (const key of THEME_TOKEN_KEYS) root.style.removeProperty(key)
    return undefined
  }
  const palette = generateThemePalette(normalized, mode)
  for (const key of THEME_TOKEN_KEYS) {
    root.style.setProperty(key, palette[key])
  }
  return palette
}
