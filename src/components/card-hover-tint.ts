import type { Rgb } from '../theme/palette'

import { useEffect, useState } from 'preact/hooks'

import { hslToRgb, rgbToHsl } from '../theme/palette'

export const CARD_HOVER_ALPHA_DARK = 0.22
export const CARD_HOVER_ALPHA_LIGHT = 0.13

const SAMPLE_SIZE = 16
const HUE_BINS = 24
const CACHE_LIMIT = 256

const tintCache = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()
let sharedCanvas: HTMLCanvasElement | undefined

const sampleCanvasContext = () => {
  if (typeof document === 'undefined') return undefined
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas')
    sharedCanvas.width = SAMPLE_SIZE
    sharedCanvas.height = SAMPLE_SIZE
  }
  return sharedCanvas.getContext('2d', { willReadFrequently: true }) ?? undefined
}

const setCachedTint = (src: string, value: string | null) => {
  if (tintCache.has(src)) tintCache.delete(src)
  tintCache.set(src, value)
  if (tintCache.size > CACHE_LIMIT) {
    const oldest = tintCache.keys().next().value
    if (oldest !== undefined) tintCache.delete(oldest)
  }
}

/** Clears the in-memory thumbnail hover tint cache (intended for unit tests). */
export const clearCardHoverTintCache = () => {
  tintCache.clear()
  inFlight.clear()
}

/**
 * Extracts a single dominant chromatic RGB color from RGBA pixel data using a 24-bin
 * hue histogram weighted by saturation and mid-luminance, rejecting washed-out/dark
 * backgrounds and monochrome inputs.
 */
export const extractDominantColor = (pixels: Uint8ClampedArray): Rgb | undefined => {
  if (pixels.length < 4) return undefined
  const weights = new Float64Array(HUE_BINS)
  const sumR = new Float64Array(HUE_BINS)
  const sumG = new Float64Array(HUE_BINS)
  const sumB = new Float64Array(HUE_BINS)
  let opaquePixels = 0
  let chromaticPixels = 0

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]!
    if (a < 128) continue
    opaquePixels += 1
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    const { h, s, l } = rgbToHsl({ r, g, b })
    if (l < 0.08 || l > 0.94 || s < 0.12) continue
    chromaticPixels += 1
    const bin = Math.floor((h % 360) / (360 / HUE_BINS)) % HUE_BINS
    const weight = s * (1 - Math.abs(2 * l - 1) * 0.6)
    weights[bin]! += weight
    sumR[bin]! += r * weight
    sumG[bin]! += g * weight
    sumB[bin]! += b * weight
  }

  if (opaquePixels === 0 || chromaticPixels / opaquePixels < 0.03) return undefined

  let bestBin = -1
  let bestScore = 0
  for (let bin = 0; bin < HUE_BINS; bin += 1) {
    const prev = (bin + HUE_BINS - 1) % HUE_BINS
    const next = (bin + 1) % HUE_BINS
    const score = weights[prev]! * 0.5 + weights[bin]! + weights[next]! * 0.5
    if (score > bestScore) {
      bestScore = score
      bestBin = bin
    }
  }
  if (bestBin < 0 || bestScore <= 0) return undefined

  const prev = (bestBin + HUE_BINS - 1) % HUE_BINS
  const next = (bestBin + 1) % HUE_BINS
  let totalWeight = 0
  let totalR = 0
  let totalG = 0
  let totalB = 0
  for (const bin of [prev, bestBin, next]) {
    totalWeight += weights[bin]!
    totalR += sumR[bin]!
    totalG += sumG[bin]!
    totalB += sumB[bin]!
  }
  if (totalWeight <= 0) return undefined
  return {
    r: Math.round(totalR / totalWeight),
    g: Math.round(totalG / totalWeight),
    b: Math.round(totalB / totalWeight),
  }
}

/**
 * Normalizes a dominant thumbnail RGB color into `"r, g, b"` base components calibrated
 * for WCAG-safe dark and light theme hover backdrop compositing.
 */
export const cardHoverTintRgb = (color: Rgb): string | undefined => {
  const { h, s } = rgbToHsl(color)
  if (s < 0.08) return undefined
  const targetS = Math.min(0.5, Math.max(0.34, 0.32 + s * 0.18))
  const tinted = hslToRgb(h, targetS, 0.42)
  return `${tinted.r}, ${tinted.g}, ${tinted.b}`
}

/** Returns inline CSS variable overrides for a card's hover backdrop when a tint is known. */
export const cardHoverStyle = (rgb: string | undefined): Record<string, string> | undefined =>
  rgb ? { '--card-hover-bg': `rgba(${rgb}, var(--card-hover-alpha, ${CARD_HOVER_ALPHA_DARK}))` } : undefined

const loadImage = (src: string): Promise<HTMLImageElement | undefined> =>
  new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    if (!/^(?:data|blob):/i.test(src)) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(undefined)
    image.src = src
  })

/**
 * Lazily samples a thumbnail URL onto a 16x16 offscreen canvas and caches the normalized
 * `"r, g, b"` hover tint (or `null` when unavailable/monochrome).
 */
export const sampleThumbnailHoverTint = (src: string): Promise<string | null> => {
  if (!src) return Promise.resolve(null)
  if (tintCache.has(src)) return Promise.resolve(tintCache.get(src) ?? null)
  const pending = inFlight.get(src)
  if (pending) return pending

  const promise = (async (): Promise<string | null> => {
    if (typeof Image === 'undefined') return null
    const ctx = sampleCanvasContext()
    if (!ctx) return null
    const image = await loadImage(src)
    if (!image || image.naturalWidth === 0 || image.naturalHeight === 0) {
      setCachedTint(src, null)
      return null
    }
    try {
      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      // Trim outer letterbox margins (e.g. hqdefault.jpg 4:3 black bars) on natural bitmaps.
      const crop = image.naturalWidth >= 16 && image.naturalHeight >= 16
      const sx = crop ? Math.floor(image.naturalWidth * 0.06) : 0
      const sy = crop ? Math.floor(image.naturalHeight * 0.12) : 0
      const sw = crop ? Math.max(1, image.naturalWidth - sx * 2) : image.naturalWidth
      const sh = crop ? Math.max(1, image.naturalHeight - sy * 2) : image.naturalHeight
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
      const dominant = extractDominantColor(data)
      const rgb = dominant ? cardHoverTintRgb(dominant) ?? null : null
      setCachedTint(src, rgb)
      return rgb
    } catch {
      setCachedTint(src, null)
      return null
    } finally {
      inFlight.delete(src)
    }
  })()

  inFlight.set(src, promise)
  return promise
}

/** Resolves a card's thumbnail hover tint lazily upon interaction, returning cached values immediately. */
export const useCardHoverTint = (src: string | null | undefined, active: boolean): string | undefined => {
  const [tint, setTint] = useState<string | undefined>(() =>
    src ? tintCache.get(src) ?? undefined : undefined,
  )

  useEffect(() => {
    if (!src) {
      setTint(undefined)
      return
    }
    if (tintCache.has(src)) {
      setTint(tintCache.get(src) ?? undefined)
      return
    }
    setTint(undefined)
    if (!active) return
    let cancelled = false
    void sampleThumbnailHoverTint(src).then((rgb) => {
      if (!cancelled) setTint(rgb ?? undefined)
    })
    return () => {
      cancelled = true
    }
  }, [src, active])

  return tint
}
