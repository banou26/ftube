import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

const AMBIENT_WIDTH = 32
const AMBIENT_HEIGHT = 18
const AMBIENT_INTERVAL_MS = 100
const AMBIENT_OPACITY = 0.48

export type AmbientState = {
  enabled: boolean
  fullscreen: boolean
  docked: boolean
  reducedMotion: boolean
}

/**
 * Computes the halo opacity so ambient lighting shows only on the watch page
 * when enabled and motion is allowed.
 */
export const ambientOpacity = ({ enabled, fullscreen, docked, reducedMotion }: AmbientState) =>
  enabled && !fullscreen && !docked && !reducedMotion ? AMBIENT_OPACITY : 0

const style = css`
  position: absolute;
  inset: -3.6rem -4.8rem -7.2rem;
  z-index: -1;
  pointer-events: none;
  transition: opacity 0.4s ease;
  mask-image: radial-gradient(ellipse 78% 76% at 50% 48%, rgba(0, 0, 0, 0.9) 25%, rgba(0, 0, 0, 0.45) 58%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 78% 76% at 50% 48%, rgba(0, 0, 0, 0.9) 25%, rgba(0, 0, 0, 0.45) 58%, transparent 100%);

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    filter: blur(6.4rem) saturate(1.45);
    transform: translateZ(0);
  }
`

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

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
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const opacity = ambientOpacity({ enabled, fullscreen, docked, reducedMotion })
  const active = opacity > 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !video || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frameId = 0
    let lastDrawn = 0

    const drawFrame = () => {
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return
      try {
        context.drawImage(video, 0, 0, AMBIENT_WIDTH, AMBIENT_HEIGHT)
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
        drawFrame()
        lastDrawn = now
      }
      frameId = requestAnimationFrame(tick)
    }

    const syncPlayback = () => {
      drawFrame()
      cancelLoop()
      if (!video.paused && !video.ended && document.visibilityState === 'visible') {
        lastDrawn = performance.now()
        frameId = requestAnimationFrame(tick)
      }
    }

    syncPlayback()
    video.addEventListener('loadeddata', syncPlayback)
    video.addEventListener('seeked', drawFrame)
    video.addEventListener('play', syncPlayback)
    video.addEventListener('pause', syncPlayback)
    document.addEventListener('visibilitychange', syncPlayback)
    return () => {
      cancelLoop()
      video.removeEventListener('loadeddata', syncPlayback)
      video.removeEventListener('seeked', drawFrame)
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      document.removeEventListener('visibilitychange', syncPlayback)
    }
  }, [active, video])

  if (docked || fullscreen) return null

  return (
    <div
      css={style}
      data-ambient-glow=''
      data-active={active ? 'true' : 'false'}
      style={{ opacity }}
      aria-hidden='true'
    >
      <canvas ref={canvasRef} width={AMBIENT_WIDTH} height={AMBIENT_HEIGHT} />
    </div>
  )
}
