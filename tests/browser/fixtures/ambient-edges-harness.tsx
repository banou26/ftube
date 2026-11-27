import type { AmbientPlacement } from '../../../src/player/ambient-options'

import { css } from '@emotion/react'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { AmbientBars, AmbientGlow } from '../../../src/player/ambient-glow'
import { useSetting } from '../../../src/settings'

type Band = {
  color: string
  from: number
  to: number
}

export type AmbientEdgeScenario = {
  mode: 'pillarbox' | 'letterbox'
  containerWidth: number
  containerHeight: number
  videoWidth: number
  videoHeight: number
  orientation: 'vertical' | 'horizontal'
  bands: Band[]
}

const stageWrapStyle = css`
  position: relative;
  margin: 7.2rem auto 0;
  background: #0f0f0f;
`

const playerBoxStyle = css`
  position: relative;
  overflow: hidden;
  background: #000000;
  z-index: 1;

  [data-player-surface] {
    position: absolute;
    inset: 0;
  }

  video {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`

const paintSourceCanvas = (canvas: HTMLCanvasElement, scenario: AmbientEdgeScenario) => {
  const ctx = canvas.getContext('2d')!
  for (const band of scenario.bands) {
    ctx.fillStyle = band.color
    if (scenario.orientation === 'vertical') {
      const x = Math.round(band.from * canvas.width)
      const w = Math.round((band.to - band.from) * canvas.width)
      ctx.fillRect(x, 0, w, canvas.height)
    } else {
      const y = Math.round(band.from * canvas.height)
      const h = Math.round((band.to - band.from) * canvas.height)
      ctx.fillRect(0, y, canvas.width, h)
    }
  }
}

const AmbientEdgesHarness = ({ scenario }: { scenario: AmbientEdgeScenario }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [hasFrame, setHasFrame] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setVideoEl(video)

    const source = document.createElement('canvas')
    source.width = scenario.videoWidth
    source.height = scenario.videoHeight
    paintSourceCanvas(source, scenario)

    const stream = source.captureStream(15)
    video.srcObject = stream
    video.muted = true
    video.playsInline = true

    const timer = window.setInterval(() => paintSourceCanvas(source, scenario), 120)
    const onFrame = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) setHasFrame(true)
    }
    video.addEventListener('loadeddata', onFrame)
    video.addEventListener('playing', onFrame)
    void video.play().catch(() => {})

    return () => {
      window.clearInterval(timer)
      video.removeEventListener('loadeddata', onFrame)
      video.removeEventListener('playing', onFrame)
      for (const track of stream.getTracks()) track.stop()
    }
  }, [scenario])

  return (
    <div
      css={stageWrapStyle}
      data-ambient-edges-stage={scenario.mode}
      style={{ width: `${scenario.containerWidth}px`, height: `${scenario.containerHeight}px` }}
    >
      <AmbientGlow video={videoEl} enabled fullscreen={false} docked={false} />
      <div
        css={playerBoxStyle}
        data-player-root=''
        style={{ width: `${scenario.containerWidth}px`, height: `${scenario.containerHeight}px` }}
      >
        <div data-player-surface=''>
          <AmbientBars
            video={videoEl}
            enabled
            fullscreen={false}
            docked={false}
            hasFrame={hasFrame}
            blocked={false}
          />
          <video ref={videoRef} muted playsInline />
        </div>
      </div>
    </div>
  )
}

export const mountAmbientEdges = (scenario: AmbientEdgeScenario) => {
  const existing = document.querySelector('[data-ambient-edges-harness]')
  existing?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-ambient-edges-harness', scenario.mode)
  host.style.cssText = 'position: fixed; inset: 0; z-index: 10000; background: #0f0f0f; overflow: hidden'
  document.body.append(host)
  render(<AmbientEdgesHarness scenario={scenario} />, host)
}

const shortsHarnessSlideStyle = css`
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;

  .reel {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 1.6rem;
    height: 540px;
  }

  .stage {
    position: relative;
    width: 304px;
    height: 540px;
    flex: none;
  }

  .player-box {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .rail {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 1rem;
  }

  .rail-action {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
`

const AmbientOptionsHarness = ({ placement }: { placement: AmbientPlacement }) => {
  const ambientMode = useSetting('ambientMode')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setVideoEl(video)
    const source = document.createElement('canvas')
    source.width = 180
    source.height = 320
    paintSourceCanvas(source, {
      mode: 'pillarbox',
      containerWidth: 304,
      containerHeight: 540,
      videoWidth: 180,
      videoHeight: 320,
      orientation: 'vertical',
      bands: [
        { color: '#e11d48', from: 0, to: 0.35 },
        { color: '#2563eb', from: 0.35, to: 1 },
      ],
    })
    const stream = source.captureStream(10)
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => {})
    return () => {
      for (const track of stream.getTracks()) track.stop()
    }
  }, [])

  if (placement === 'shorts') {
    return (
      <div css={shortsHarnessSlideStyle} data-ambient-slide='true'>
        <div className='reel'>
          <div className='stage' data-ambient-stage='shorts'>
            <AmbientGlow video={videoEl} enabled={ambientMode} fullscreen={false} docked={false} placement='shorts' />
            <div className='player-box'>
              <video ref={videoRef} muted playsInline />
            </div>
          </div>
          <div className='rail'>
            <button type='button' className='rail-action' aria-label='Shorts like action'>Like</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', isolation: 'isolate', width: '640px', height: '360px', margin: '80px auto 0' }} data-ambient-stage='watch'>
      <AmbientGlow video={videoEl} enabled={ambientMode} fullscreen={false} docked={false} placement='watch' />
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  )
}

export const mountAmbientOptionsHarness = (placement: AmbientPlacement) => {
  document.querySelector('[data-ambient-options-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-ambient-options-harness', placement)
  host.style.cssText = 'position: fixed; inset: 0; z-index: 10000; background: #0f0f0f; overflow-x: hidden; overflow-y: auto;'
  document.body.append(host)
  render(<AmbientOptionsHarness placement={placement} />, host)
}
