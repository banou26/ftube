import type { EndScreenElement } from '../../../src/frame/protocol'
import type { PlayerState } from '../../../src/player/use-player-state'

import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { EndScreenElements } from '../../../src/player/end-screen-elements'
import { InfoCards } from '../../../src/player/info-cards'
import { PlayerControls } from '../../../src/player/controls'
import { updateSettings, useSetting } from '../../../src/settings'

const TEASER = { text: 'Featured video card', startMs: 15_000, durationMs: 6_000 }
const END_SCREEN: EndScreenElement[] = [
  {
    kind: 'video',
    videoId: 'dQw4w9WgXcQ',
    title: 'Recommended end screen video',
    left: 0.55,
    top: 0.25,
    width: 0.35,
    aspectRatio: 16 / 9,
    startMs: 10_000,
    endMs: 30_000,
  },
]

const Harness = () => {
  const annotations = useSetting('annotations')
  const ambientMode = useSetting('ambientMode')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)

  useEffect(() => {
    setVideo(videoRef.current)
  }, [])

  const state: PlayerState = {
    paused: true,
    ended: false,
    currentTime: 16,
    duration: 40,
    buffered: 40,
    volume: 1,
    muted: false,
    playbackRate: 1,
    buffering: false,
    seeking: false,
  }

  return (
    <div
      data-annotations-harness=''
      data-player-root=''
      data-player-surface=''
      style={{ position: 'relative', width: '640px', height: '360px', background: '#000' }}
    >
      <video ref={videoRef} width={640} height={360} style={{ width: '100%', height: '100%', display: 'block' }} />
      {video && annotations
        ? (
          <EndScreenElements
            elements={END_SCREEN}
            video={video}
            time={16}
            ended={false}
            docked={false}
            underCards
          />
        )
        : undefined}
      {video && annotations
        ? (
          <InfoCards
            teasers={[TEASER]}
            time={16}
            shown
            ended={false}
            onOpen={() => {}}
          />
        )
        : undefined}
      {video
        ? (
          <PlayerControls
            video={video}
            player={undefined}
            state={state}
            heights={[720, 360]}
            storyboards={[]}
            quality='auto'
            onQuality={() => {}}
            ambientMode={ambientMode}
            onAmbientMode={() => updateSettings({ ambientMode: !ambientMode })}
            annotations={annotations}
            onAnnotations={() => updateSettings({ annotations: !annotations })}
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

export const mountAnnotationsHarness = () => {
  document.querySelector('[data-annotations-harness]')?.remove()
  const host = document.createElement('div')
  document.body.append(host)
  render(<Harness />, host)
}
