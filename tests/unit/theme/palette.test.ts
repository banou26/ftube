import { describe, expect, it } from 'vite-plus/test'

import { APP_ICONS, buildAppIconSvg } from '../../../src/theme/app-icon'
import { blendOver, contrastRatio, generateThemePalette, normalizeHexColor, pickContrastingInk, THEME_PRESETS } from '../../../src/theme/palette'

const EDGE_COLORS = ['#ffff00', '#000000', '#ffffff', '#000044', '#00ff00', '#ff00ff', '#808080', '#ff0033']

describe('theme palette generator', () => {
  it('normalizes 3-digit and 6-digit hex inputs and rejects invalid values', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc')
    expect(normalizeHexColor('  #10B981  ')).toBe('#10b981')
    expect(normalizeHexColor('#zzzzzz')).toBeUndefined()
    expect(normalizeHexColor('red')).toBeUndefined()
    expect(normalizeHexColor(123)).toBeUndefined()
  })

  it('guarantees WCAG contrast and distinct elevations for all presets and adversarial colors', () => {
    const allInputs = [...THEME_PRESETS.map(preset => preset.color), ...EDGE_COLORS]

    for (const hex of allInputs) {
      for (const mode of ['dark', 'light'] as const) {
        const p = generateThemePalette(hex, mode)

        // Primary text meets AAA (>= 7.0) on base, subtle, elevated, menu, chip, input
        for (const bg of [p['--bg-base'], p['--bg-subtle'], p['--bg-elevated'], p['--bg-menu'], p['--bg-chip'], p['--bg-input']]) {
          expect(contrastRatio(p['--text-primary'], bg), `${hex} ${mode} text-primary vs ${bg}`).toBeGreaterThanOrEqual(7.0)
          expect(contrastRatio(p['--accent'], bg), `${hex} ${mode} accent vs ${bg}`).toBeGreaterThanOrEqual(4.5)
        }

        // Secondary text meets AA (>= 4.5) on main surfaces
        for (const bg of [p['--bg-base'], p['--bg-subtle'], p['--bg-elevated'], p['--bg-menu'], p['--bg-chip']]) {
          expect(contrastRatio(p['--text-secondary'], bg), `${hex} ${mode} text-secondary vs ${bg}`).toBeGreaterThanOrEqual(4.5)
        }

        // Inverse surface pair meets AAA for primary text and AA for accent-inverse
        expect(contrastRatio(p['--text-inverse'], p['--bg-inverse']), `${hex} ${mode} inverse`).toBeGreaterThanOrEqual(7.0)
        expect(contrastRatio(p['--text-inverse'], p['--bg-inverse-hover']), `${hex} ${mode} inverse hover`).toBeGreaterThanOrEqual(7.0)
        expect(contrastRatio(p['--accent-inverse'], p['--bg-inverse']), `${hex} ${mode} accent-inverse`).toBeGreaterThanOrEqual(4.5)

        // Focus ring, strong border, and player progress bar meet UI non-text contrast (>= 3.0)
        expect(contrastRatio(p['--accent-focus'], p['--bg-base']), `${hex} ${mode} focus vs base`).toBeGreaterThanOrEqual(3.0)
        expect(contrastRatio(p['--accent-focus'], p['--bg-input']), `${hex} ${mode} focus vs input`).toBeGreaterThanOrEqual(3.0)
        expect(contrastRatio(p['--border-strong'], p['--bg-base']), `${hex} ${mode} border-strong`).toBeGreaterThanOrEqual(3.0)
        expect(contrastRatio(p['--brand-red'], '#181818'), `${hex} ${mode} brand-red on media`).toBeGreaterThanOrEqual(3.0)
        expect(contrastRatio(p['--brand-mark'], p['--bg-base']), `${hex} ${mode} brand-mark vs base`).toBeGreaterThanOrEqual(3.0)
        expect(contrastRatio(p['--brand-mark-ink'], p['--brand-mark']), `${hex} ${mode} brand-mark-ink vs mark`).toBeGreaterThanOrEqual(3.0)

        // Distinct interactive states
        expect(p['--bg-base']).not.toBe(p['--bg-elevated'])
        expect(p['--bg-chip']).not.toBe(p['--bg-chip-hover'])

        // Accent tint holds primary text legibly
        const tintHex = blendOver(p['--accent-tint'], p['--bg-base'])
        expect(contrastRatio(p['--text-primary'], tintHex), `${hex} ${mode} text on tint`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('builds built-in presets with the same generator rules as custom colors', () => {
    for (const preset of THEME_PRESETS) {
      expect(generateThemePalette(preset.color, 'dark')).toEqual(generateThemePalette(normalizeHexColor(preset.color)!, 'dark'))
      expect(generateThemePalette(preset.color, 'light')).toEqual(generateThemePalette(normalizeHexColor(preset.color)!, 'light'))
    }
  })

  it('picks contrasting inner ink for bright and saturated mark fills', () => {
    expect(pickContrastingInk('#ffdd00')).toBe('#0f0f0f')
    expect(pickContrastingInk('#ff0000')).toBe('#0f0f0f')
    expect(pickContrastingInk('#1d4ed8')).toBe('#ffffff')
  })
})

describe('app icons', () => {
  it('builds valid single-silhouette SVG data using the official FTube mark without nested squares', () => {
    const fills = new Set<string>()
    for (const option of APP_ICONS) {
      const svg = buildAppIconSvg(option.id, '#10b981')
      expect(svg).toContain('<svg')
      expect(svg).toContain('viewBox="0 0 32 32"')
      expect(svg).toContain('M11.4 20.35V11.65L18.9 16')
      expect(svg, `${option.id} should not render a square box`).not.toContain('<rect')
      expect(svg.match(/M30\.37 8\.78/g) ?? []).toHaveLength(1)
      const pillMatch = svg.match(/M30\.37 8\.78[^>]*fill="([^"]+)"/)
      const markMatch = svg.match(/M11\.4 20\.35[^>]*fill="([^"]+)"/)
      expect(pillMatch?.[1]).toBeTruthy()
      expect(markMatch?.[1]).toBeTruthy()
      fills.add(`${pillMatch![1]}:${markMatch![1]}`)
      expect(contrastRatio(markMatch![1]!, pillMatch![1]!), `${option.id} icon contrast`).toBeGreaterThanOrEqual(3.0)
    }
    expect(fills.size).toBe(APP_ICONS.length)
  })
})
