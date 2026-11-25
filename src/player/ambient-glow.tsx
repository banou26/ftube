import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

const AMBIENT_WIDTH = 32
const AMBIENT_HEIGHT = 18
const AMBIENT_INTERVAL_MS = 100
const AMBIENT_OPACITY = 0.72
const AMBIENT_BAR_OPACITY = 0.88
const BLEND_ALPHA = 0.28
const BLACK_THRESHOLD = 28
const SIGNAL_THRESHOLD = 36
const MAX_CROP_FRACTION = 0.2

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

type CanvasTarget = {
  canvas: HTMLCanvasElement
  seeded: boolean
}

type VideoSampler = {
  targets: Set<CanvasTarget>
  sample: (instant: boolean) => void
  drawTarget: (target: CanvasTarget, instant: boolean) => void
  destroy: () => void
}

const samplers = new WeakMap<HTMLVideoElement, VideoSampler>()

const createVideoSampler = (video: HTMLVideoElement): VideoSampler => {
  const scratch = document.createElement('canvas')
  scratch.width = AMBIENT_WIDTH
  scratch.height = AMBIENT_HEIGHT
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
  const targets = new Set<CanvasTarget>()
  let lastCrop: AmbientCrop = { x: 0, y: 0, w: AMBIENT_WIDTH, h: AMBIENT_HEIGHT }
  let hasSample = false
  let frameId = 0
  let lastDrawn = 0

  const drawTarget = (target: CanvasTarget, instant: boolean) => {
    if (!hasSample) return
    const ctx = target.canvas.getContext('2d')
    if (!ctx) return
    const previousAlpha = ctx.globalAlpha
    ctx.globalAlpha = instant || !target.seeded ? 1 : BLEND_ALPHA
    ctx.drawImage(
      scratch,
      lastCrop.x,
      lastCrop.y,
      lastCrop.w,
      lastCrop.h,
      0,
      0,
      AMBIENT_WIDTH,
      AMBIENT_HEIGHT,
    )
    ctx.globalAlpha = previousAlpha
    target.seeded = true
  }

  const sample = (instant: boolean) => {
    if (!scratchCtx || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return
    try {
      scratchCtx.drawImage(video, 0, 0, AMBIENT_WIDTH, AMBIENT_HEIGHT)
      let crop: AmbientCrop = { x: 0, y: 0, w: AMBIENT_WIDTH, h: AMBIENT_HEIGHT }
      try {
        const data = scratchCtx.getImageData(0, 0, AMBIENT_WIDTH, AMBIENT_HEIGHT).data
        crop = detectSymmetricBarCrop(data, AMBIENT_WIDTH, AMBIENT_HEIGHT)
      } catch {
        // Fallback to full frame if pixel readback is blocked.
      }
      lastCrop = crop
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

  video.addEventListener('loadeddata', syncPlayback)
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
      video.removeEventListener('loadeddata', syncPlayback)
      video.removeEventListener('playing', syncPlayback)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      document.removeEventListener('visibilitychange', syncPlayback)
    },
  }
}

const subscribeAmbientVideo = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
  let sampler = samplers.get(video)
  if (!sampler) {
    sampler = createVideoSampler(video)
    samplers.set(video, sampler)
  }
  const target: CanvasTarget = { canvas, seeded: false }
  sampler.targets.add(target)
  sampler.sample(true)
  sampler.drawTarget(target, true)
  return () => {
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
  position: absolute;
  inset: -4.8rem -6.4rem -11.2rem;
  z-index: -1;
  pointer-events: none;
  opacity: var(--ambient-opacity, 0);
  transition: opacity 0.4s ease;
  mask-image: radial-gradient(ellipse 50% 50% at 50% 45%, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0.75) 87%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 45%, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0.75) 87%, transparent 100%);

  :root[data-theme='light'] & {
    opacity: calc(var(--ambient-opacity, 0) * 0.35);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    filter: blur(5.2rem) saturate(1.65) brightness(1.08);
    transform: scale(1.12) translateZ(0);
  }
`

// Drawn behind <video> without z-index so transparent object-fit: contain pillarbox/letterbox areas show the video's colors while player controls keep stacking above <video>.
const barsStyle = css`
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.4s ease;
  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 1) 14%, rgba(0, 0, 0, 1) 86%, rgba(0, 0, 0, 0.72) 100%);
  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 1) 14%, rgba(0, 0, 0, 1) 86%, rgba(0, 0, 0, 0.72) 100%);

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    filter: blur(3.6rem) saturate(1.55) brightness(0.92);
    transform: scale(1.18) translateZ(0);
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

/** Soft blurred color glow behind the watch player, sampled from the video element. */
export const AmbientGlow = (
  { video, enabled, fullscreen, docked }: {
    video: HTMLVideoElement | null
    enabled: boolean
    fullscreen: boolean
    docked: boolean
  },
) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const opacity = ambientOpacity({ enabled, fullscreen, docked, reducedMotion })
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
    const unsubscribe = subscribeAmbientVideo(video, canvas)
    return () => {
      unsubscribe()
    }
  }, [active, video])

  if (docked || fullscreen) return null

  return (
    <div
      css={glowStyle}
      data-ambient-glow=''
      data-active={active ? 'true' : 'false'}
      style={{ '--ambient-opacity': String(opacity) }}
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
  { video, enabled, fullscreen, docked, hasFrame, blocked }: {
    video: HTMLVideoElement | null
    enabled: boolean
    fullscreen: boolean
    docked: boolean
    hasFrame: boolean
    blocked: boolean
  },
) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const opacity = ambientBarOpacity({ enabled, fullscreen, docked, reducedMotion, hasFrame, blocked })
  const active = opacity > 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !video || !canvas) return
    return subscribeAmbientVideo(video, canvas)
  }, [active, video])

  if (docked || fullscreen) return null

  return (
    <div
      css={barsStyle}
      data-ambient-bars=''
      data-active={active ? 'true' : 'false'}
      style={{ opacity }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} width={AMBIENT_WIDTH} height={AMBIENT_HEIGHT} />
    </div>
  )
}
