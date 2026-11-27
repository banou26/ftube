import type { AmbientArea, AmbientFillMode, AmbientPlacement } from './ambient-options'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { useSetting } from '../settings'
import {
  coerceAmbientArea,
  coerceAmbientFillMode,
  coerceAmbientSpread,
  computeAmbientGlowVars,
} from './ambient-options'

const AMBIENT_WIDTH = 64
const AMBIENT_HEIGHT = 36
const AMBIENT_INTERVAL_MS = 100
const AMBIENT_OPACITY = 0.72
const AMBIENT_BAR_OPACITY = 0.88
const BLEND_ALPHA = 0.28
const BLACK_THRESHOLD = 28
const SIGNAL_THRESHOLD = 36
const MAX_CROP_FRACTION = 0.2
const EDGE_MARGIN_EPSILON = 0.05

export type AmbientState = {
  enabled: boolean
  fullscreen: boolean
  docked: boolean
  reducedMotion: boolean
}

export type AmbientBarState = AmbientState & {
  hasFrame: boolean
  blocked: boolean
}

export type AmbientCrop = {
  x: number
  y: number
  w: number
  h: number
}

export type AmbientVideoRect = {
  x: number
  y: number
  width: number
  height: number
}

export type AmbientDrawContext = {
  clearRect: (x: number, y: number, width: number, height: number) => void
  drawImage: (
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void
  save: () => void
  restore: () => void
  translate: (x: number, y: number) => void
  scale: (x: number, y: number) => void
  fillStyle?: string | CanvasGradient | CanvasPattern
  fillRect?: (x: number, y: number, width: number, height: number) => void
}

/**
 * Computes the halo opacity so ambient lighting shows only on the watch page
 * when enabled and motion is allowed.
 */
export const ambientOpacity = ({ enabled, fullscreen, docked, reducedMotion }: AmbientState) =>
  enabled && !fullscreen && !docked && !reducedMotion ? AMBIENT_OPACITY : 0

/**
 * Computes the inner bar-backdrop opacity so colored pillarbox/letterbox fills
 * appear inside the watch player once a decoded video frame is ready.
 */
export const ambientBarOpacity = ({ enabled, fullscreen, docked, reducedMotion, hasFrame, blocked }: AmbientBarState) =>
  enabled && !fullscreen && !docked && !reducedMotion && hasFrame && !blocked ? AMBIENT_BAR_OPACITY : 0

/**
 * Crops symmetric encoded black bars (for example 4:3 inside 16:9 or 21:9 letterbox)
 * while leaving asymmetric dark scenes and all-black frames untouched.
 */
export const detectSymmetricBarCrop = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): AmbientCrop => {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  if (safeWidth === 0 || safeHeight === 0 || pixels.length < safeWidth * safeHeight * 4) {
    return { x: 0, y: 0, w: safeWidth, h: safeHeight }
  }

  const colDark = (x: number) => {
    for (let y = 0; y < safeHeight; y += 1) {
      const i = (y * safeWidth + x) * 4
      if (Math.max(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0) > BLACK_THRESHOLD) return false
    }
    return true
  }

  const rowDark = (y: number) => {
    const rowOffset = y * safeWidth
    for (let x = 0; x < safeWidth; x += 1) {
      const i = (rowOffset + x) * 4
      if (Math.max(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0) > BLACK_THRESHOLD) return false
    }
    return true
  }

  let left = 0
  while (left < safeWidth && colDark(left)) left += 1
  let right = 0
  while (right < safeWidth && colDark(safeWidth - 1 - right)) right += 1

  let top = 0
  while (top < safeHeight && rowDark(top)) top += 1
  let bottom = 0
  while (bottom < safeHeight && rowDark(safeHeight - 1 - bottom)) bottom += 1

  const colCrop = Math.min(left, right, Math.floor(safeWidth * MAX_CROP_FRACTION))
  const rowCrop = Math.min(top, bottom, Math.floor(safeHeight * MAX_CROP_FRACTION))
  const x = colCrop
  const y = rowCrop
  const w = safeWidth - colCrop * 2
  const h = safeHeight - rowCrop * 2
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: safeWidth, h: safeHeight }

  let hasSignal = false
  for (let py = y; py < y + h && !hasSignal; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const i = (py * safeWidth + px) * 4
      if (Math.max(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0) > SIGNAL_THRESHOLD) {
        hasSignal = true
        break
      }
    }
  }
  return hasSignal ? { x, y, w, h } : { x: 0, y: 0, w: safeWidth, h: safeHeight }
}

/** Computes the `object-fit: contain` sub-rectangle of a video inside a container box. */
export const computeContainedVideoRect = (
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
): AmbientVideoRect => {
  const safeCW = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0
  const safeCH = Number.isFinite(containerHeight) && containerHeight > 0 ? containerHeight : 0
  if (
    safeCW === 0
    || safeCH === 0
    || !Number.isFinite(videoWidth)
    || !Number.isFinite(videoHeight)
    || videoWidth <= 0
    || videoHeight <= 0
  ) {
    return { x: 0, y: 0, width: safeCW, height: safeCH }
  }
  const containerAspect = safeCW / safeCH
  const videoAspect = videoWidth / videoHeight
  if (videoAspect > containerAspect) {
    const height = safeCW / videoAspect
    return { x: 0, y: (safeCH - height) / 2, width: safeCW, height }
  }
  const width = safeCH * videoAspect
  return { x: (safeCW - width) / 2, y: 0, width, height: safeCH }
}

/**
 * Draws the sampled frame at `videoRect` and mirror-extends outer ~8% strips and corner
 * patches out to every canvas border so edge colors sit flush against `<video>` without
 * dark blur borders or interior colors bleeding across letterbox/pillarbox margins.
 */
export const drawEdgeMatchedFrame = (
  ctx: AmbientDrawContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  videoRect: AmbientVideoRect,
  crop?: AmbientCrop,
  clear = true,
) => {
  if (clear) ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  if (
    canvasWidth <= 0
    || canvasHeight <= 0
    || sourceWidth <= 0
    || sourceHeight <= 0
    || videoRect.width <= 0
    || videoRect.height <= 0
  ) {
    return
  }

  const sx = crop ? Math.max(0, Math.min(sourceWidth, crop.x)) : 0
  const sy = crop ? Math.max(0, Math.min(sourceHeight, crop.y)) : 0
  const sw = crop ? Math.max(1, Math.min(sourceWidth - sx, crop.w)) : sourceWidth
  const sh = crop ? Math.max(1, Math.min(sourceHeight - sy, crop.h)) : sourceHeight
  const stripW = Math.max(2, Math.min(sw, Math.round(sw * 0.08)))
  const stripH = Math.max(2, Math.min(sh, Math.round(sh * 0.08)))

  const left = Math.max(0, Math.min(canvasWidth, videoRect.x))
  const top = Math.max(0, Math.min(canvasHeight, videoRect.y))
  const right = Math.max(left, Math.min(canvasWidth, videoRect.x + videoRect.width))
  const bottom = Math.max(top, Math.min(canvasHeight, videoRect.y + videoRect.height))
  const dw = right - left
  const dh = bottom - top
  const rw = Math.max(0, canvasWidth - right)
  const bh = Math.max(0, canvasHeight - bottom)

  if (dw > 0 && dh > 0) ctx.drawImage(source, sx, sy, sw, sh, left, top, dw, dh)

  if (left > EDGE_MARGIN_EPSILON && dh > 0) {
    ctx.save()
    ctx.translate(left, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(source, sx, sy, stripW, sh, 0, top, left, dh)
    ctx.restore()
  }

  if (rw > EDGE_MARGIN_EPSILON && dh > 0) {
    ctx.save()
    ctx.translate(canvasWidth, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(source, sx + sw - stripW, sy, stripW, sh, 0, top, rw, dh)
    ctx.restore()
  }

  if (top > EDGE_MARGIN_EPSILON && dw > 0) {
    ctx.save()
    ctx.translate(0, top)
    ctx.scale(1, -1)
    ctx.drawImage(source, sx, sy, sw, stripH, left, 0, dw, top)
    ctx.restore()
  }

  if (bh > EDGE_MARGIN_EPSILON && dw > 0) {
    ctx.save()
    ctx.translate(0, canvasHeight)
    ctx.scale(1, -1)
    ctx.drawImage(source, sx, sy + sh - stripH, sw, stripH, left, 0, dw, bh)
    ctx.restore()
  }

  if (left > EDGE_MARGIN_EPSILON && top > EDGE_MARGIN_EPSILON) {
    ctx.save()
    ctx.translate(left, top)
    ctx.scale(-1, -1)
    ctx.drawImage(source, sx, sy, stripW, stripH, 0, 0, left, top)
    ctx.restore()
  }

  if (rw > EDGE_MARGIN_EPSILON && top > EDGE_MARGIN_EPSILON) {
    ctx.save()
    ctx.translate(canvasWidth, top)
    ctx.scale(-1, -1)
    ctx.drawImage(source, sx + sw - stripW, sy, stripW, stripH, 0, 0, rw, top)
    ctx.restore()
  }

  if (left > EDGE_MARGIN_EPSILON && bh > EDGE_MARGIN_EPSILON) {
    ctx.save()
    ctx.translate(left, canvasHeight)
    ctx.scale(-1, -1)
    ctx.drawImage(source, sx, sy + sh - stripH, stripW, stripH, 0, 0, left, bh)
    ctx.restore()
  }

  if (rw > EDGE_MARGIN_EPSILON && bh > EDGE_MARGIN_EPSILON) {
    ctx.save()
    ctx.translate(canvasWidth, canvasHeight)
    ctx.scale(-1, -1)
    ctx.drawImage(source, sx + sw - stripW, sy + sh - stripH, stripW, stripH, 0, 0, rw, bh)
    ctx.restore()
  }
}

/** Computes the average RGB color across the cropped video frame for solid-fill ambient mode. */
export const computeAverageFrameColor = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  crop?: AmbientCrop,
): string | undefined => {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  if (safeWidth === 0 || safeHeight === 0 || pixels.length < safeWidth * safeHeight * 4) return undefined
  const sx = crop ? Math.max(0, Math.min(safeWidth, Math.floor(crop.x))) : 0
  const sy = crop ? Math.max(0, Math.min(safeHeight, Math.floor(crop.y))) : 0
  const sw = crop ? Math.max(1, Math.min(safeWidth - sx, Math.floor(crop.w))) : safeWidth
  const sh = crop ? Math.max(1, Math.min(safeHeight - sy, Math.floor(crop.h))) : safeHeight
  let rSum = 0
  let gSum = 0
  let bSum = 0
  let count = 0
  for (let py = sy; py < sy + sh; py += 1) {
    const rowOffset = py * safeWidth
    for (let px = sx; px < sx + sw; px += 1) {
      const i = (rowOffset + px) * 4
      rSum += pixels[i] ?? 0
      gSum += pixels[i + 1] ?? 0
      bSum += pixels[i + 2] ?? 0
      count += 1
    }
  }
  if (count === 0) return undefined
  return `rgb(${Math.round(rSum / count)}, ${Math.round(gSum / count)}, ${Math.round(bSum / count)})`
}

/** Draws an ambient frame using edge matching, full-frame stretch, or averaged solid color. */
export const drawAmbientFrame = (
  ctx: AmbientDrawContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  videoRect: AmbientVideoRect,
  crop: AmbientCrop | undefined,
  fillMode: AmbientFillMode,
  averageColor: string | undefined,
  clear = true,
) => {
  if (fillMode === 'average' && averageColor && ctx.fillRect) {
    if (clear) ctx.clearRect(0, 0, canvasWidth, canvasHeight)
    if (canvasWidth <= 0 || canvasHeight <= 0) return
    ctx.fillStyle = averageColor
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    return
  }
  if (fillMode === 'stretch') {
    if (clear) ctx.clearRect(0, 0, canvasWidth, canvasHeight)
    if (canvasWidth <= 0 || canvasHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return
    const sx = crop ? Math.max(0, Math.min(sourceWidth, crop.x)) : 0
    const sy = crop ? Math.max(0, Math.min(sourceHeight, crop.y)) : 0
    const sw = crop ? Math.max(1, Math.min(sourceWidth - sx, crop.w)) : sourceWidth
    const sh = crop ? Math.max(1, Math.min(sourceHeight - sy, crop.h)) : sourceHeight
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight)
    return
  }
  drawEdgeMatchedFrame(ctx, source, sourceWidth, sourceHeight, canvasWidth, canvasHeight, videoRect, crop, clear)
}

type CanvasTarget = {
  canvas: HTMLCanvasElement
  fillMode: AmbientFillMode
  seeded: boolean
  lastRectKey: string
  lastFillMode?: AmbientFillMode
}

type VideoSampler = {
  targets: Set<CanvasTarget>
  sample: (instant: boolean) => void
  drawTarget: (target: CanvasTarget, instant: boolean) => void
  destroy: () => void
}

const samplers = new WeakMap<HTMLVideoElement, VideoSampler>()

const rectForTarget = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): { rect: AmbientVideoRect, key: string } => {
  const cw = canvas.width
  const ch = canvas.height
  const cRect = canvas.getBoundingClientRect()
  const vRect = video.getBoundingClientRect()
  const rect = cRect.width > 0 && cRect.height > 0 && vRect.width > 0 && vRect.height > 0
    ? (() => {
        const contained = computeContainedVideoRect(vRect.width, vRect.height, video.videoWidth, video.videoHeight)
        const sx = cw / cRect.width
        const sy = ch / cRect.height
        return {
          x: (vRect.left + contained.x - cRect.left) * sx,
          y: (vRect.top + contained.y - cRect.top) * sy,
          width: contained.width * sx,
          height: contained.height * sy,
        }
      })()
    : computeContainedVideoRect(cw, ch, video.videoWidth, video.videoHeight)
  const key = `${rect.x.toFixed(2)},${rect.y.toFixed(2)},${rect.width.toFixed(2)},${rect.height.toFixed(2)}`
  return { rect, key }
}

const createVideoSampler = (video: HTMLVideoElement): VideoSampler => {
  const scratch = document.createElement('canvas')
  scratch.width = AMBIENT_WIDTH
  scratch.height = AMBIENT_HEIGHT
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
  const targets = new Set<CanvasTarget>()
  let lastCrop: AmbientCrop = { x: 0, y: 0, w: AMBIENT_WIDTH, h: AMBIENT_HEIGHT }
  let lastAverageColor: string | undefined
  let hasSample = false
  let frameId = 0
  let lastDrawn = 0

  const drawTarget = (target: CanvasTarget, instant: boolean) => {
    if (!hasSample) return
    const ctx = target.canvas.getContext('2d')
    if (!ctx) return
    const { rect, key } = rectForTarget(video, target.canvas)
    const snap = instant || !target.seeded || target.lastRectKey !== key || target.lastFillMode !== target.fillMode
    const previousAlpha = ctx.globalAlpha
    ctx.globalAlpha = snap ? 1 : BLEND_ALPHA
    drawAmbientFrame(ctx, scratch, AMBIENT_WIDTH, AMBIENT_HEIGHT, target.canvas.width, target.canvas.height, rect, lastCrop, target.fillMode, lastAverageColor, snap)
    ctx.globalAlpha = previousAlpha
    target.seeded = true
    target.lastRectKey = key
    target.lastFillMode = target.fillMode
  }

  const sample = (instant: boolean) => {
    if (!scratchCtx || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return
    try {
      scratchCtx.drawImage(video, 0, 0, AMBIENT_WIDTH, AMBIENT_HEIGHT)
      let crop: AmbientCrop = { x: 0, y: 0, w: AMBIENT_WIDTH, h: AMBIENT_HEIGHT }
      let averageColor: string | undefined
      try {
        const data = scratchCtx.getImageData(0, 0, AMBIENT_WIDTH, AMBIENT_HEIGHT).data
        crop = detectSymmetricBarCrop(data, AMBIENT_WIDTH, AMBIENT_HEIGHT)
        averageColor = computeAverageFrameColor(data, AMBIENT_WIDTH, AMBIENT_HEIGHT, crop)
      } catch {
        // Fallback to full frame if pixel readback is blocked.
      }
      lastCrop = crop
      lastAverageColor = averageColor
      hasSample = true
      for (const target of targets) drawTarget(target, instant)
    } catch {
      // Ignore transient frame-read errors before the first decoded frame.
    }
  }

  const cancelLoop = () => {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId)
      frameId = 0
    }
  }

  const tick = (now: number) => {
    frameId = 0
    if (video.paused || video.ended || document.visibilityState !== 'visible') return
    if (now - lastDrawn >= AMBIENT_INTERVAL_MS) {
      sample(false)
      lastDrawn = now
    }
    frameId = requestAnimationFrame(tick)
  }

  const syncPlayback = () => {
    sample(true)
    cancelLoop()
    if (!video.paused && !video.ended && document.visibilityState === 'visible') {
      lastDrawn = performance.now()
      frameId = requestAnimationFrame(tick)
    }
  }

  const onSeeked = () => sample(true)

  video.addEventListener('loadedmetadata', syncPlayback)
  video.addEventListener('loadeddata', syncPlayback)
  video.addEventListener('resize', syncPlayback)
  video.addEventListener('playing', syncPlayback)
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('play', syncPlayback)
  video.addEventListener('pause', syncPlayback)
  document.addEventListener('visibilitychange', syncPlayback)
  syncPlayback()

  return {
    targets,
    sample,
    drawTarget,
    destroy: () => {
      cancelLoop()
      video.removeEventListener('loadedmetadata', syncPlayback)
      video.removeEventListener('loadeddata', syncPlayback)
      video.removeEventListener('resize', syncPlayback)
      video.removeEventListener('playing', syncPlayback)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      document.removeEventListener('visibilitychange', syncPlayback)
    },
  }
}

const subscribeAmbientVideo = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  fillMode: AmbientFillMode,
) => {
  let sampler = samplers.get(video)
  if (!sampler) {
    sampler = createVideoSampler(video)
    samplers.set(video, sampler)
  }
  const target: CanvasTarget = { canvas, fillMode, seeded: false, lastRectKey: '' }
  sampler.targets.add(target)
  sampler.sample(true)
  sampler.drawTarget(target, true)
  const observer = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        sampler?.drawTarget(target, true)
      })
    : undefined
  observer?.observe(video)
  if (canvas.parentElement) observer?.observe(canvas.parentElement)
  return () => {
    observer?.disconnect()
    sampler.targets.delete(target)
    if (sampler.targets.size === 0) {
      sampler.destroy()
      if (samplers.get(video) === sampler) samplers.delete(video)
    }
  }
}

const clearCanvas = (canvas: HTMLCanvasElement | null) => {
  const ctx = canvas?.getContext('2d')
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height)
}

const glowStyle = css`
  position: var(--ambient-position, absolute);
  top: var(--ambient-top, -4.8rem);
  right: var(--ambient-right, -6.4rem);
  bottom: var(--ambient-bottom, -11.2rem);
  left: var(--ambient-left, -6.4rem);
  z-index: -1;
  pointer-events: none;
  opacity: var(--ambient-opacity, 0);
  transition: opacity 0.4s ease;
  mask-image: var(--ambient-mask, radial-gradient(ellipse 50% 50% at 50% 45%, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0.75) 87%, transparent 100%));
  -webkit-mask-image: var(--ambient-mask, radial-gradient(ellipse 50% 50% at 50% 45%, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0.75) 87%, transparent 100%));

  :root[data-theme='light'] & {
    opacity: calc(var(--ambient-opacity, 0) * 0.35);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    filter: var(--ambient-filter, blur(5.2rem) saturate(1.65) brightness(1.08));
    transform: translateZ(0);
  }
`

// Drawn behind <video> without z-index so transparent object-fit: contain pillarbox/letterbox areas show the video's colors while player controls keep stacking above <video>.
const barsStyle = css`
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.4s ease;
  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 1) 10%, rgba(0, 0, 0, 1) 90%, rgba(0, 0, 0, 0.88) 100%);
  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 1) 10%, rgba(0, 0, 0, 1) 90%, rgba(0, 0, 0, 0.88) 100%);

  canvas {
    position: absolute;
    top: -4rem;
    left: -4rem;
    display: block;
    width: calc(100% + 8rem);
    height: calc(100% + 8rem);
    filter: var(--ambient-bars-filter, blur(3.6rem) saturate(1.55) brightness(0.92));
    transform: translateZ(0);
  }
`

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return reducedMotion
}

/** Soft blurred color glow behind the watch or shorts player, sampled from the video element. */
export const AmbientGlow = (
  { video, enabled, fullscreen, docked, placement = 'watch', area, spread, fillMode }: {
    video: HTMLVideoElement | null
    enabled: boolean
    fullscreen: boolean
    docked: boolean
    placement?: AmbientPlacement
    area?: AmbientArea
    spread?: number
    fillMode?: AmbientFillMode
  },
) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const settingArea = useSetting('ambientArea')
  const settingSpread = useSetting('ambientSpread')
  const settingFillMode = useSetting('ambientFillMode')
  const resolvedArea = area !== undefined ? coerceAmbientArea(area) : settingArea
  const resolvedSpread = spread !== undefined ? coerceAmbientSpread(spread) : settingSpread
  const resolvedFillMode = fillMode !== undefined ? coerceAmbientFillMode(fillMode) : settingFillMode
  const vars = computeAmbientGlowVars(resolvedArea, resolvedSpread, resolvedFillMode, placement)
  const baseOpacity = ambientOpacity({ enabled, fullscreen, docked, reducedMotion })
  const opacity = baseOpacity > 0 ? Math.min(0.95, baseOpacity * vars.opacityScale) : 0
  const active = opacity > 0

  useEffect(() => {
    clearCanvas(canvasRef.current)
  }, [video])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!video) {
      clearCanvas(canvas)
      return
    }
    if (!active || !canvas) return
    const unsubscribe = subscribeAmbientVideo(video, canvas, resolvedFillMode)
    return () => {
      unsubscribe()
    }
  }, [active, video, resolvedFillMode])

  if (docked || fullscreen) return null

  return (
    <div
      css={glowStyle}
      data-ambient-glow=''
      data-active={active ? 'true' : 'false'}
      data-ambient-area={resolvedArea}
      data-ambient-spread={String(resolvedSpread)}
      data-ambient-fill-mode={resolvedFillMode}
      data-ambient-placement={placement}
      style={{
        '--ambient-opacity': String(opacity),
        '--ambient-position': vars.position,
        '--ambient-top': vars.top,
        '--ambient-right': vars.right,
        '--ambient-bottom': vars.bottom,
        '--ambient-left': vars.left,
        '--ambient-mask': vars.mask,
        '--ambient-filter': vars.filter,
      }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} width={AMBIENT_WIDTH} height={AMBIENT_HEIGHT} />
    </div>
  )
}

/**
 * Blurred video-colored backdrop painted inside the watch player surface behind `<video>`,
 * coloring any left/right or top/bottom matte bars with a smooth gradient of the video.
 */
export const AmbientBars = (
  { video, enabled, fullscreen, docked, hasFrame, blocked, fillMode }: {
    video: HTMLVideoElement | null
    enabled: boolean
    fullscreen: boolean
    docked: boolean
    hasFrame: boolean
    blocked: boolean
    fillMode?: AmbientFillMode
  },
) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const settingFillMode = useSetting('ambientFillMode')
  const resolvedFillMode = fillMode !== undefined ? coerceAmbientFillMode(fillMode) : settingFillMode
  const opacity = ambientBarOpacity({ enabled, fullscreen, docked, reducedMotion, hasFrame, blocked })
  const active = opacity > 0

  useEffect(() => {
    clearCanvas(canvasRef.current)
  }, [video])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!video) {
      clearCanvas(canvas)
      return
    }
    if (!active || !canvas) return
    return subscribeAmbientVideo(video, canvas, resolvedFillMode)
  }, [active, video, resolvedFillMode])

  if (docked || fullscreen) return null

  return (
    <div
      css={barsStyle}
      data-ambient-bars=''
      data-active={active ? 'true' : 'false'}
      data-ambient-fill-mode={resolvedFillMode}
      style={{
        opacity,
        '--ambient-bars-filter': resolvedFillMode === 'vivid'
          ? 'blur(3.6rem) saturate(2.1) brightness(1.02)'
          : 'blur(3.6rem) saturate(1.55) brightness(0.92)',
      }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} width={AMBIENT_WIDTH} height={AMBIENT_HEIGHT} />
    </div>
  )
}
