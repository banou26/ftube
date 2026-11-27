import type { Storyboard } from '../../../src/frame/storyboard'
import type { PlayerState } from '../../../src/player/use-player-state'

import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { PlayerControls } from '../../../src/player/controls'

const SPRITE_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">'
  + '<rect width="800" height="450" fill="#202838"/>'
  + '<rect x="0" y="0" width="160" height="90" fill="#2c3e50" stroke="#fff" stroke-width="2"/>'
  + '<rect x="160" y="0" width="160" height="90" fill="#3b5998" stroke="#fff" stroke-width="2"/>'
  + '<rect x="320" y="0" width="160" height="90" fill="#16a085" stroke="#fff" stroke-width="2"/>'
  + '<rect x="480" y="0" width="160" height="90" fill="#8e44ad" stroke="#fff" stroke-width="2"/>'
  + '<rect x="640" y="0" width="160" height="90" fill="#d35400" stroke="#fff" stroke-width="2"/>'
  + '</svg>',
) + '#s=$M'

const STORYBOARDS: Storyboard[] = [{
  templateUrl: SPRITE_SVG,
  thumbnailWidth: 160,
  thumbnailHeight: 90,
  thumbnailCount: 60,
  intervalMs: 2_000,
  columns: 5,
  rows: 5,
  sheetCount: 3,
}]

const FilmstripHarness = ({
  onCurrentTime,
}: {
  onCurrentTime: (next: number) => void
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(30)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let time = 30
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get: () => 120,
    })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = Math.max(0, Math.min(120, value))
        setCurrentTime(time)
        onCurrentTime(time)
      },
    })
    onCurrentTime(30)
    setVideoEl(video)
  }, [onCurrentTime])

  const state: PlayerState = {
    paused: true,
    ended: false,
    currentTime,
    duration: 120,
    buffered: 90,
    volume: 1,
    muted: false,
    playbackRate: 1,
    buffering: false,
    seeking: false,
  }

  return (
    <div
      data-player-root='true'
      style={{
        position: 'relative',
        width: '800px',
        height: '450px',
        background: '#000',
        overflow: 'hidden',
        containerType: 'inline-size',
        containerName: 'player',
      }}
    >
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        muted
      />
      {videoEl
        ? (
          <PlayerControls
            video={videoEl}
            player={undefined}
            state={state}
            heights={[720, 480]}
            storyboards={STORYBOARDS}
            quality='auto'
            onQuality={() => {}}
            captionTracks={[]}
            caption={undefined}
            onCaption={() => {}}
            onToggleCaption={() => {}}
            theater='default'
            onTheater={() => {}}
            visible
          />
        )
        : undefined}
    </div>
  )
}

export const mountFilmstripHarness = () => {
  document.querySelector('[data-filmstrip-harness]')?.remove()
  const container = document.createElement('div')
  container.setAttribute('data-filmstrip-harness', 'true')
  container.style.padding = '32px'
  ;(document.querySelector('main') ?? document.body).prepend(container)

  let latestTime = 30
  render(<FilmstripHarness onCurrentTime={(next: number) => { latestTime = next }} />, container)

  return {
    currentTime: () => latestTime,
  }
}
