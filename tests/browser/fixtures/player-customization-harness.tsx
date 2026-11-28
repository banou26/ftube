import type { CaptionTrack } from '../../../src/frame/protocol'
import type { PlayerChapter } from '../../../src/player/chapters'
import type { PlayerState } from '../../../src/player/use-player-state'

import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { PlayerControls } from '../../../src/player/controls'
import { isPipSupported } from '../../../src/player/pip'
import { updateSettings, useSetting } from '../../../src/settings'

const CHAPTERS: PlayerChapter[] = [
  { title: 'Opening', startSeconds: 0 },
  { title: 'Middle', startSeconds: 60 },
]

const CAPTIONS: CaptionTrack[] = [
  { id: 'en', label: 'English', languageCode: 'en', auto: false, translatable: true },
]

const AUDIO_TRACKS = [
  { id: 'en', label: 'English (Original)', isDefault: true, autoDubbed: false },
  { id: 'ja', label: 'Japanese', isDefault: false, autoDubbed: true },
]

const Harness = ({ width = 900 }: { width?: number }) => {
  const autoplay = useSetting('autoplay')
  const ambientMode = useSetting('ambientMode')
  const annotations = useSetting('annotations')
  const stableVolume = useSetting('stableVolume')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [audioTrackId, setAudioTrackId] = useState('en')
  const height = Math.round((width * 9) / 16)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (!isPipSupported(el)) {
      const webkitVideo = el as HTMLVideoElement & {
        webkitSupportsPresentationMode?: (mode: string) => boolean
        webkitSetPresentationMode?: (mode: string) => void
      }
      webkitVideo.webkitSupportsPresentationMode = (mode: string) => mode === 'picture-in-picture'
      webkitVideo.webkitSetPresentationMode = () => {}
    }
    setVideo(el)
  }, [])

  const state: PlayerState = {
    paused: true,
    ended: false,
    currentTime: 24,
    duration: 120,
    buffered: 80,
    volume: 1,
    muted: false,
    playbackRate: 1,
    buffering: false,
    seeking: false,
  }

  return (
    <div
      data-player-customization-harness=''
      data-player-root=''
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${height}px`,
        background: '#000',
        containerType: 'inline-size',
        containerName: 'player',
      }}
    >
      <video ref={videoRef} width={width} height={height} muted style={{ width: '100%', height: '100%', display: 'block' }} />
      {video
        ? (
          <PlayerControls
            video={video}
            player={undefined}
            state={state}
            heights={[2160, 1080, 720]}
            storyboards={[]}
            quality='auto'
            onQuality={() => {}}
            audioTracks={AUDIO_TRACKS}
            audioTrackId={audioTrackId}
            onAudioTrack={setAudioTrackId}
            hasDrc
            stableVolume={stableVolume}
            onStableVolume={(value: boolean) => updateSettings({ stableVolume: value })}
            ambientMode={ambientMode}
            onAmbientMode={() => updateSettings({ ambientMode: !ambientMode })}
            annotations={annotations}
            onAnnotations={() => updateSettings({ annotations: !annotations })}
            captionTracks={CAPTIONS}
            caption={undefined}
            onCaption={() => {}}
            onToggleCaption={() => {}}
            theater='default'
            onTheater={() => {}}
            onNext={() => {}}
            autoplay={autoplay}
            onAutoplay={(value: boolean) => updateSettings({ autoplay: value })}
            chapters={CHAPTERS}
            onChapters={() => {}}
            visible
          />
        )
        : undefined}
    </div>
  )
}

export const mountPlayerCustomizationHarness = (options: { width?: number } = {}) => {
  document.querySelector('[data-player-customization-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-player-customization-host', '')
  document.body.prepend(host)
  render(<Harness width={options.width} />, host)
}
