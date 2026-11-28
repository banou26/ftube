import type shaka from 'shaka-player'
import type { PlayerChapter } from '../../../src/player/chapters'

import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { PlayerControls } from '../../../src/player/controls'
import { usePlayerState } from '../../../src/player/use-player-state'

export type LiveProgressHarnessOptions = {
  start: number
  end: number
  currentTime: number
  buffered: [number, number][]
  paused?: boolean
  chapters?: PlayerChapter[]
}

const makeTimeRanges = (ranges: [number, number][]): TimeRanges => ({
  length: ranges.length,
  start: (index: number) => ranges[index]?.[0] ?? 0,
  end: (index: number) => ranges[index]?.[1] ?? 0,
})

class FakeLiveShakaPlayer extends EventTarget {
  private range: { start: number, end: number }

  constructor(start: number, end: number) {
    super()
    this.range = { start, end }
  }

  isLive() {
    return true
  }

  setRange(start: number, end: number) {
    this.range = { start, end }
  }

  seekRange() {
    return this.range
  }

  getVariantTracks() {
    return [{ active: true, width: 1920, height: 1080 }]
  }
}

const LiveProgressHarness = ({ start, end, currentTime, buffered, paused = false, chapters = [] }: LiveProgressHarnessOptions) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const player = useMemo(() => new FakeLiveShakaPlayer(start, end), [start, end])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    let time = currentTime
    let isPaused = paused
    let playCount = 0
    let ranges = buffered

    Object.defineProperty(element, 'duration', { configurable: true, get: () => Number.POSITIVE_INFINITY })
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (next: number) => {
        time = next
        element.dispatchEvent(new Event('timeupdate'))
      },
    })
    Object.defineProperty(element, 'paused', { configurable: true, get: () => isPaused })
    Object.defineProperty(element, 'buffered', { configurable: true, get: () => makeTimeRanges(ranges) })
    Object.defineProperty(element, 'play', {
      configurable: true,
      value: async () => {
        playCount += 1
        isPaused = false
        element.dispatchEvent(new Event('play'))
      },
    })
    Object.defineProperty(element, 'pause', {
      configurable: true,
      value: () => {
        isPaused = true
        element.dispatchEvent(new Event('pause'))
      },
    })

    setVideo(element)

    const win = window as unknown as {
      __liveHarness?: {
        setLiveWindow: (nextStart: number, nextEnd: number) => void
        setBuffered: (nextRanges: [number, number][]) => void
        setTime: (nextTime: number) => void
        setPaused: (nextPaused: boolean) => void
        playCount: () => number
      }
    }
    win.__liveHarness = {
      setLiveWindow: (nextStart, nextEnd) => {
        player.setRange(nextStart, nextEnd)
        element.dispatchEvent(new Event('timeupdate'))
      },
      setBuffered: (nextRanges) => {
        ranges = nextRanges
        element.dispatchEvent(new Event('progress'))
      },
      setTime: (nextTime) => {
        time = nextTime
        element.dispatchEvent(new Event('timeupdate'))
      },
      setPaused: (nextPaused) => {
        isPaused = nextPaused
        element.dispatchEvent(new Event(nextPaused ? 'pause' : 'play'))
      },
      playCount: () => playCount,
    }
    return () => {
      delete win.__liveHarness
    }
  }, [buffered, currentTime, paused, player])

  const state = usePlayerState(video, player as unknown as shaka.Player)

  return (
    <div
      data-live-harness=''
      data-player-root=''
      data-player-surface=''
      style={{ position: 'relative', width: '640px', height: '360px', background: '#000', containerType: 'inline-size', containerName: 'player' }}
    >
      <video ref={videoRef} width={640} height={360} style={{ width: '100%', height: '100%', display: 'block' }} />
      {video
        ? (
          <PlayerControls
            video={video}
            player={player as unknown as shaka.Player}
            state={state}
            heights={[1080, 720]}
            storyboards={[]}
            chapters={chapters}
            quality='auto'
            onQuality={() => {}}
            captionTracks={[]}
            caption={undefined}
            onCaption={() => {}}
            onToggleCaption={() => {}}
            theater='default'
            onTheater={() => {}}
            isLive
            visible
          />
        )
        : undefined}
    </div>
  )
}

export const mountLiveProgressHarness = (options: LiveProgressHarnessOptions) => {
  document.getElementById('app')!.hidden = true
  document.querySelector('[data-live-harness]')?.remove()
  const host = document.createElement('div')
  document.body.append(host)
  render(<LiveProgressHarness {...options} />, host)
}
