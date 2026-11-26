import type { ThemeMode } from './palette'

import { contrastRatio, generateThemePalette, normalizeHexColor } from './palette'

export type AppIconId = 'default' | 'theme' | 'dark' | 'light'

export type AppIconOption = {
  id: AppIconId
  label: string
  title: string
}

export const APP_ICONS: readonly AppIconOption[] = [
  { id: 'default', label: 'Classic icon', title: 'Classic' },
  { id: 'theme', label: 'Theme icon', title: 'Theme' },
  { id: 'dark', label: 'Dark icon', title: 'Dark' },
  { id: 'light', label: 'Light icon', title: 'Light' },
]

const APP_ICON_IDS = new Set<string>(APP_ICONS.map(option => option.id))

export const isAppIconId = (value: unknown): value is AppIconId =>
  typeof value === 'string' && APP_ICON_IDS.has(value)

export const coerceAppIcon = (value: unknown): AppIconId =>
  isAppIconId(value) ? value : 'default'

const pickMarkColor = (bg: string): string =>
  contrastRatio('#ffffff', bg) >= contrastRatio('#0f0f0f', bg) ? '#ffffff' : '#0f0f0f'

export const buildAppIconSvg = (id: AppIconId, accentColor?: string): string => {
  const accent = normalizeHexColor(accentColor) ?? '#ff0000'

  if (id === 'theme') {
    const markColor = pickMarkColor(accent)
    const pillOverlay = markColor === '#ffffff' ? '#0f0f0f' : '#ffffff'
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      `  <rect x="0" y="0" width="32" height="32" rx="7" fill="${accent}" />`,
      `  <path d="M30.37 8.78A3.77 3.77 0 0 0 27.72 6.12C25.38 5.5 16 5.5 16 5.5S6.62 5.5 4.28 6.12A3.77 3.77 0 0 0 1.63 8.78C1 11.13 1 16 1 16s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C6.62 26.5 16 26.5 16 26.5s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C31 20.87 31 16 31 16s0-4.87-.63-7.22Z" fill="${pillOverlay}" opacity="0.24" />`,
      `  <path d="M11.4 20.35V11.65L18.9 16l-7.5 4.35Z" fill="${markColor}" />`,
      `  <path d="M19.6 12.25l3.2 3.75-3.2 3.75" fill="none" stroke="${markColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
      '</svg>',
    ].join('\n')
  }

  if (id === 'dark') {
    const tileBg = '#0f0f0f'
    const pillFill = contrastRatio(accent, tileBg) >= 2.0 ? accent : generateThemePalette(accent, 'dark')['--brand-red']
    const markColor = pickMarkColor(pillFill)
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      `  <rect x="0" y="0" width="32" height="32" rx="7" fill="${tileBg}" />`,
      `  <path d="M30.37 8.78A3.77 3.77 0 0 0 27.72 6.12C25.38 5.5 16 5.5 16 5.5S6.62 5.5 4.28 6.12A3.77 3.77 0 0 0 1.63 8.78C1 11.13 1 16 1 16s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C6.62 26.5 16 26.5 16 26.5s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C31 20.87 31 16 31 16s0-4.87-.63-7.22Z" fill="${pillFill}" />`,
      `  <path d="M11.4 20.35V11.65L18.9 16l-7.5 4.35Z" fill="${markColor}" />`,
      `  <path d="M19.6 12.25l3.2 3.75-3.2 3.75" fill="none" stroke="${markColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
      '</svg>',
    ].join('\n')
  }

  if (id === 'light') {
    const tileBg = '#f9f9f9'
    const pillFill = contrastRatio(accent, tileBg) >= 2.0 ? accent : generateThemePalette(accent, 'light')['--accent']
    const markColor = pickMarkColor(pillFill)
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      `  <rect x="0" y="0" width="32" height="32" rx="7" fill="${tileBg}" />`,
      `  <path d="M30.37 8.78A3.77 3.77 0 0 0 27.72 6.12C25.38 5.5 16 5.5 16 5.5S6.62 5.5 4.28 6.12A3.77 3.77 0 0 0 1.63 8.78C1 11.13 1 16 1 16s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C6.62 26.5 16 26.5 16 26.5s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C31 20.87 31 16 31 16s0-4.87-.63-7.22Z" fill="${pillFill}" />`,
      `  <path d="M11.4 20.35V11.65L18.9 16l-7.5 4.35Z" fill="${markColor}" />`,
      `  <path d="M19.6 12.25l3.2 3.75-3.2 3.75" fill="none" stroke="${markColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
      '</svg>',
    ].join('\n')
  }

  // Official FTube mark (matches public/favicon.svg)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '  <path d="M30.37 8.78A3.77 3.77 0 0 0 27.72 6.12C25.38 5.5 16 5.5 16 5.5S6.62 5.5 4.28 6.12A3.77 3.77 0 0 0 1.63 8.78C1 11.13 1 16 1 16s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C6.62 26.5 16 26.5 16 26.5s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C31 20.87 31 16 31 16s0-4.87-.63-7.22Z" fill="#ff0000" />',
    '  <path d="M11.4 20.35V11.65L18.9 16l-7.5 4.35Z" fill="#ffffff" />',
    '  <path d="M19.6 12.25l3.2 3.75-3.2 3.75" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />',
    '</svg>',
  ].join('\n')
}

export const buildAppIconDataUri = (id: AppIconId, accentColor?: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAppIconSvg(id, accentColor))}`

let activeManifestBlobUrl: string | undefined
let appleTouchVersion = 0

const revokeManifestBlob = () => {
  if (!activeManifestBlobUrl || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(activeManifestBlobUrl)
  activeManifestBlobUrl = undefined
}

const syncAppleTouchIcon = (dataUri: string | undefined) => {
  if (typeof document === 'undefined') return
  const existing = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (!dataUri) {
    appleTouchVersion += 1
    existing?.remove()
    return
  }
  if (typeof Image !== 'function') return
  const version = ++appleTouchVersion
  const image = new Image()
  image.onload = () => {
    if (version !== appleTouchVersion) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 180
      canvas.height = 180
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(image, 0, 0, 180, 180)
      const pngUri = canvas.toDataURL('image/png')
      let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'apple-touch-icon'
        document.head.append(link)
      }
      link.href = pngUri
    } catch {
      // Ignore offscreen canvas restrictions
    }
  }
  image.src = dataUri
}

export const applyAppIcon = (
  iconId: AppIconId,
  customThemeColor: string | undefined,
  mode: ThemeMode,
) => {
  if (typeof document === 'undefined') return
  const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')

  if (iconId === 'default') {
    if (iconLink) iconLink.href = '/favicon.svg'
    revokeManifestBlob()
    if (manifestLink) manifestLink.href = '/app.webmanifest'
    syncAppleTouchIcon(undefined)
    return
  }

  const normalizedCustom = normalizeHexColor(customThemeColor)
  const palette = normalizedCustom ? generateThemePalette(normalizedCustom, mode) : undefined
  const accentForIcon = normalizedCustom ?? '#ff0033'
  const dataUri = buildAppIconDataUri(iconId, accentForIcon)

  if (iconLink) iconLink.href = dataUri
  syncAppleTouchIcon(dataUri)

  if (manifestLink && typeof Blob === 'function' && typeof URL.createObjectURL === 'function') {
    const origin = typeof location === 'object' && location.origin && location.origin !== 'null'
      ? location.origin
      : ''
    const base = origin ? `${origin}/` : '/'
    const bgColor = palette?.['--bg-base'] ?? (mode === 'light' ? '#f9f9f9' : '#0f0f0f')
    const manifest = {
      name: 'FTube',
      short_name: 'FTube',
      description: 'Fast, private YouTube client running in your browser over FKN.',
      id: base,
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: bgColor,
      theme_color: bgColor,
      icons: [
        {
          src: dataUri,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    }
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    const nextUrl = URL.createObjectURL(blob)
    revokeManifestBlob()
    activeManifestBlobUrl = nextUrl
    manifestLink.href = nextUrl
  }
}
