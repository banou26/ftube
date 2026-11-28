import type { HeatMarker } from '../../../src/player/heatmap'
import type { PlayerState } from '../../../src/player/use-player-state'

import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { PlayerControls } from '../../../src/player/controls'
import { decideSurfaceClick, isTouchPointer } from '../../../src/player/surface-interaction'

export type HeatmapMode = 'valid' | 'empty' | 'invalid'

const makeValidHeatmap = (): HeatMarker[] =>
  Array.from({ length: 50 }, (_, index) => {
    const startMs = index * 2_000
    const distFromPeak = Math.abs(index - 35)
    const intensity = distFromPeak <= 4
      ? Number(Math.max(0.2, 1 - distFromPeak * 0.16).toFixed(2))
      : 0.12
    return { startMs, durationMs: 2_000, intensity }
  })

const INVALID_HEATMAP = [
  { startMs: Number.NaN, durationMs: 1_000, intensity: 0.8 },
  { startMs: -100, durationMs: 1_000, intensity: 0.7 },
  { startMs: 1_000, durationMs: 0, intensity: 0.9 },
  { startMs: 2_000, durationMs: 1_000, intensity: 1.8 },
  { startMs: 3_000, durationMs: 1_000, intensity: 0 },
] as HeatMarker[]

export type MostReplayedHarnessOptions = {
  videoId?: string
  mode?: HeatmapMode
  duration?: number
  paused?: boolean
  initialVisible?: boolean
  isLive?: boolean
  width?: number
}

const Harness = ({
  videoId = 'heat-video-1',
  mode = 'valid',
  duration = 100,
  paused: initialPaused = false,
  initialVisible = true,
  isLive = false,
  width = 800,
  onCurrentTime,
}: MostReplayedHarnessOptions & { onCurrentTime: (next: number) => void }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(12)
  const [paused, setPaused] = useState(initialPaused)
  const [visible, setVisible] = useState(initialVisible)
  const touchPressRef = useRef<{ activeAtPress: boolean } | null>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    let time = 12
    Object.defineProperty(el, 'duration', { configurable: true, get: () => duration })
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = Math.max(0, Math.min(duration, value))
        setCurrentTime(time)
        onCurrentTime(time)
      },
    })
    onCurrentTime(12)
    setVideo(el)
  }, [duration, videoId, onCurrentTime])

  const onSurfaceClick = (event: MouseEvent) => {
    const pointerEvent = event as PointerEvent
    const touchPress = touchPressRef.current
    touchPressRef.current = null
    const action = decideSurfaceClick({
      pointerType: touchPress ? 'touch' : (pointerEvent.pointerType || 'mouse'),
      activeAtPress: touchPress?.activeAtPress ?? visible,
      paused,
      settingsOpen: false,
      menuAtPress: false,
    })
    if (action === 'show-controls') setVisible(true)
    else if (action === 'hide-controls') setVisible(false)
    else if (action === 'toggle-play') setPaused(prev => !prev)
  }

  const heatmap: readonly HeatMarker[] = mode === 'valid'
    ? makeValidHeatmap()
    : mode === 'invalid'
      ? INVALID_HEATMAP
      : []

  const state: PlayerState = {
    paused,
    ended: false,
    currentTime,
    duration,
    buffered: Math.min(duration, 60),
    volume: 1,
    muted: true,
    playbackRate: 1,
    buffering: false,
    seeking: false,
  }

  return (
    <div
      data-most-replayed-harness={videoId}
      data-player-root=''
      style={{
        position: 'relative',
        width: `${width}px`,
        height: width <= 420 ? '220px' : '450px',
        background: '#000',
        overflow: 'hidden',
        containerType: 'inline-size',
        containerName: 'player',
      }}
    >
      <div
        className='video-surface'
        data-testid='video-surface'
        style={{ position: 'absolute', inset: 0 }}
        onPointerDown={(event: PointerEvent) => {
          touchPressRef.current = isTouchPointer(event.pointerType)
            ? { activeAtPress: visible }
            : null
        }}
        onPointerCancel={() => {
          touchPressRef.current = null
        }}
      >
        <video
          ref={videoRef}
          width={width}
          height={width <= 420 ? 220 : 450}
          muted
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer' }}
          onClick={onSurfaceClick}
        />
      </div>
      {video
        ? (
          <PlayerControls
            video={video}
            player={undefined}
            state={state}
            heights={[1080, 720]}
            storyboards={[]}
            quality='auto'
            onQuality={() => {}}
            captionTracks={[]}
            caption={undefined}
            onCaption={() => {}}
            onToggleCaption={() => {}}
            theater='default'
            onTheater={() => {}}
            visible={visible}
            isLive={isLive}
            heatmap={heatmap}
          />
        )
        : undefined}
    </div>
  )
}

export const mountMostReplayedHarness = (options: MostReplayedHarnessOptions = {}) => {
  document.querySelector('[data-most-replayed-harness]')?.remove()
  const container = document.createElement('div')
  container.setAttribute('data-most-replayed-host', '')
  ;(document.querySelector('main') ?? document.body).prepend(container)

  let latestTime = 12
  render(
    <Harness {...options} onCurrentTime={(next: number) => { latestTime = next }} />,
    container,
  )

  return {
    currentTime: () => latestTime,
  }
}
