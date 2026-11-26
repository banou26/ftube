import { describe, expect, it } from 'vite-plus/test'

import {
  CARD_HOVER_ALPHA_DARK,
  CARD_HOVER_ALPHA_LIGHT,
  cardHoverStyle,
  cardHoverTintRgb,
  extractDominantColor,
} from '../../../src/components/card-hover-tint'
import { blendOver, contrastRatio, generateThemePalette, hslToRgb, THEME_PRESETS } from '../../../src/theme/palette'

const fillPixels = (count: number, colorAt: (index: number) => [number, number, number, number]) => {
  const pixels = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i += 1) {
    const [r, g, b, a] = colorAt(i)
    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
    pixels[i * 4 + 3] = a
  }
  return pixels
}

describe('card hover thumbnail tinting', () => {
  it('extracts distinct dominant colors from chromatic pixel buffers', () => {
    const blue = extractDominantColor(fillPixels(64, () => [29, 78, 216, 255]))
    const orange = extractDominantColor(fillPixels(64, () => [216, 108, 29, 255]))
    const emerald = extractDominantColor(fillPixels(64, () => [5, 150, 105, 255]))

    expect(blue).toBeDefined()
    expect(orange).toBeDefined()
    expect(emerald).toBeDefined()
    expect(blue!.b).toBeGreaterThan(blue!.r)
    expect(orange!.r).toBeGreaterThan(orange!.b)
    expect(emerald!.g).toBeGreaterThan(emerald!.r)
    expect(emerald!.g).toBeGreaterThan(emerald!.b)
  })

  it('picks the dominant hue bin rather than averaging complementary colors to gray', () => {
    const mostlyBlue = extractDominantColor(fillPixels(100, (i) => i < 75 ? [29, 78, 216, 255] : [217, 119, 6, 255]))
    expect(mostlyBlue).toBeDefined()
    expect(mostlyBlue!.b).toBeGreaterThan(mostlyBlue!.r)
    expect(cardHoverTintRgb(mostlyBlue!)).toBeDefined()
  })

  it('ignores black letterbox bars and extracts the colored center', () => {
    const letterboxedRed = extractDominantColor(
      fillPixels(100, (i) => i < 30 || i >= 70 ? [0, 0, 0, 255] : [210, 35, 45, 255]),
    )
    expect(letterboxedRed).toBeDefined()
    expect(letterboxedRed!.r).toBeGreaterThan(letterboxedRed!.b)
  })

  it('returns undefined for monochrome, pure black, pure white, or transparent inputs', () => {
    expect(extractDominantColor(fillPixels(64, () => [0, 0, 0, 255]))).toBeUndefined()
    expect(extractDominantColor(fillPixels(64, () => [255, 255, 255, 255]))).toBeUndefined()
    expect(extractDominantColor(fillPixels(64, () => [128, 128, 128, 255]))).toBeUndefined()
    expect(extractDominantColor(fillPixels(64, () => [29, 78, 216, 0]))).toBeUndefined()
    expect(extractDominantColor(new Uint8ClampedArray(0))).toBeUndefined()
    expect(cardHoverTintRgb({ r: 128, g: 128, b: 128 })).toBeUndefined()
    expect(cardHoverStyle(undefined)).toBeUndefined()
  })

  it('formats distinct card hover styles for distinct colors', () => {
    const blueRgb = cardHoverTintRgb({ r: 29, g: 78, b: 216 })
    const orangeRgb = cardHoverTintRgb({ r: 216, g: 108, b: 29 })
    expect(blueRgb).toBeDefined()
    expect(orangeRgb).toBeDefined()
    expect(blueRgb).not.toBe(orangeRgb)
    expect(cardHoverStyle(blueRgb)).toEqual({
      '--card-hover-bg': `rgba(${blueRgb}, var(--card-hover-alpha, ${CARD_HOVER_ALPHA_DARK}))`,
    })
  })

  it('keeps WCAG AA contrast for primary and secondary text across all hues and theme presets', () => {
    const hues = Array.from({ length: 72 }, (_, index) => index * 5)
    for (const hue of hues) {
      const sample = hslToRgb(hue, 0.9, 0.5)
      const rgb = cardHoverTintRgb(sample)
      expect(rgb).toBeDefined()

      const darkOverlay = blendOver(`rgba(${rgb}, ${CARD_HOVER_ALPHA_DARK})`, '#0f0f0f')
      expect(contrastRatio('#f1f1f1', darkOverlay)).toBeGreaterThanOrEqual(7.0)
      expect(contrastRatio('#aaaaaa', darkOverlay)).toBeGreaterThanOrEqual(4.5)

      const lightOverlay = blendOver(`rgba(${rgb}, ${CARD_HOVER_ALPHA_LIGHT})`, '#f9f9f9')
      expect(contrastRatio('#0f0f0f', lightOverlay)).toBeGreaterThanOrEqual(7.0)
      expect(contrastRatio('#606060', lightOverlay)).toBeGreaterThanOrEqual(4.5)

      for (const preset of THEME_PRESETS) {
        const darkPalette = generateThemePalette(preset.color, 'dark')
        const darkCustom = blendOver(`rgba(${rgb}, ${CARD_HOVER_ALPHA_DARK})`, darkPalette['--bg-base'])
        expect(contrastRatio(darkPalette['--text-primary'], darkCustom)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(darkPalette['--text-secondary'], darkCustom)).toBeGreaterThanOrEqual(4.5)

        const lightPalette = generateThemePalette(preset.color, 'light')
        const lightCustom = blendOver(`rgba(${rgb}, ${CARD_HOVER_ALPHA_LIGHT})`, lightPalette['--bg-base'])
        expect(contrastRatio(lightPalette['--text-primary'], lightCustom)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(lightPalette['--text-secondary'], lightCustom)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
