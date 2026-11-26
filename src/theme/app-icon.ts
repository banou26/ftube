import type { ThemeMode } from './palette'

import { contrastRatio, generateThemePalette, normalizeHexColor, pickContrastingInk } from './palette'

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

export const buildAppIconSvg = (id: AppIconId, accentColor?: string): string => {
  const accent = normalizeHexColor(accentColor) ?? '#ff0000'

  if (id === 'theme') {
    const markColor = pickContrastingInk(accent)
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
    const markColor = pickContrastingInk(pillFill)
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
    const markColor = pickContrastingInk(pillFill)
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
let activeIconVersion = 0

const revokeManifestBlob = () => {
  if (!activeManifestBlobUrl || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(activeManifestBlobUrl)
  activeManifestBlobUrl = undefined
}

const renderIconPng = (image: HTMLImageElement, size: number): string | undefined => {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(image, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

type ManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose: string
}

const updateManifestLink = (manifestLink: HTMLLinkElement | null, bgColor: string, icons: ManifestIcon[]) => {
  if (!manifestLink || typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') return
  const origin = typeof location === 'object' && location.origin && location.origin !== 'null'
    ? location.origin
    : ''
  const base = origin ? `${origin}/` : '/'
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
    icons,
  }
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
  const nextUrl = URL.createObjectURL(blob)
  revokeManifestBlob()
  activeManifestBlobUrl = nextUrl
  manifestLink.href = nextUrl
}

const setAppleTouchIconHref = (pngUri: string | undefined) => {
  if (typeof document === 'undefined') return
  const existing = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (!pngUri) {
    existing?.remove()
    return
  }
  const link = existing ?? document.createElement('link')
  link.rel = 'apple-touch-icon'
  link.href = pngUri
  if (!existing) document.head.append(link)
}

const replaceHeadLink = (selector: string, attrs: Record<string, string>) => {
  if (typeof document === 'undefined' || !document.head) return
  for (const node of document.querySelectorAll(selector)) node.remove()
  const link = document.createElement('link')
  for (const [key, value] of Object.entries(attrs)) link.setAttribute(key, value)
  document.head.append(link)
}

export const applyAppIcon = (
  iconId: AppIconId,
  customThemeColor: string | undefined,
  mode: ThemeMode,
) => {
  if (typeof document === 'undefined') return
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const version = ++activeIconVersion

  if (iconId === 'default') {
    replaceHeadLink('link[rel="icon"][type="image/svg+xml"]', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' })
    replaceHeadLink('link[rel="icon"]:not([type="image/svg+xml"])', { rel: 'icon', sizes: 'any', href: '/favicon.ico' })
    revokeManifestBlob()
    if (manifestLink) manifestLink.href = '/app.webmanifest'
    setAppleTouchIconHref(undefined)
    return
  }

  const normalizedCustom = normalizeHexColor(customThemeColor)
  const palette = normalizedCustom ? generateThemePalette(normalizedCustom, mode) : undefined
  const accentForIcon = normalizedCustom ?? '#ff0000'
  const dataUri = buildAppIconDataUri(iconId, accentForIcon)
  const bgColor = palette?.['--bg-base'] ?? (mode === 'light' ? '#f9f9f9' : '#0f0f0f')
  const svgIcon: ManifestIcon = { src: dataUri, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }

  replaceHeadLink('link[rel="icon"][type="image/svg+xml"]', { rel: 'icon', type: 'image/svg+xml', href: dataUri })
  replaceHeadLink('link[rel="icon"]:not([type="image/svg+xml"])', { rel: 'icon', sizes: 'any', href: dataUri })
  updateManifestLink(manifestLink, bgColor, [svgIcon])

  if (typeof Image !== 'function') return
  const image = new Image()
  image.onload = () => {
    if (version !== activeIconVersion) return
    const png32 = renderIconPng(image, 32)
    if (png32) {
      replaceHeadLink('link[rel="icon"]:not([type="image/svg+xml"])', { rel: 'icon', sizes: '32x32', type: 'image/png', href: png32 })
    }
    const applePng = renderIconPng(image, 180)
    if (applePng) setAppleTouchIconHref(applePng)
    const png192 = renderIconPng(image, 192)
    const png512 = renderIconPng(image, 512)
    const icons: ManifestIcon[] = []
    if (png192) icons.push({ src: png192, sizes: '192x192', type: 'image/png', purpose: 'any' })
    if (png512) icons.push({ src: png512, sizes: '512x512', type: 'image/png', purpose: 'any' })
    icons.push(svgIcon)
    updateManifestLink(manifestLink, bgColor, icons)
  }
  image.src = dataUri
}
