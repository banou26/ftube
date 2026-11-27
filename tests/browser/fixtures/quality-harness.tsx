import type shaka from 'shaka-player'
import type { QualityPreference } from '../../../src/settings'

import { render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { PlayerControls } from '../../../src/player/controls'
import { usePlayerState } from '../../../src/player/use-player-state'
import { getSettings, subscribeSettings, updateSettings } from '../../../src/settings'

export type QualityHarnessOptions = {
  heights: number[]
  initialVideoHeight: number
  variantHeight?: number
  syncVideoHeightOnPick?: boolean
}

class FakeShakaPlayer extends EventTarget {
  private variantHeight: number

  constructor(variantHeight = 0) {
    super()
    this.variantHeight = variantHeight
  }

  isLive() {
    return false
  }

  setVariantHeight(height: number) {
    this.variantHeight = height
  }

  getVariantTracks() {
    return this.variantHeight > 0 ? [{ active: true, height: this.variantHeight }] : []
  }
}

const QualityHarness = ({ heights, initialVideoHeight, variantHeight = 0, syncVideoHeightOnPick = true }: QualityHarnessOptions) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [quality, setQuality] = useState<QualityPreference>(() => getSettings().quality)
  const videoHeightRef = useRef(initialVideoHeight)
  const fakePlayer = useMemo(() => new FakeShakaPlayer(variantHeight), [variantHeight])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    videoHeightRef.current = initialVideoHeight
    Object.defineProperty(element, 'videoHeight', {
      configurable: true,
      get: () => videoHeightRef.current,
    })
    Object.defineProperty(element, 'duration', {
      configurable: true,
      get: () => 120,
    })
    setVideo(element)

    const win = window as unknown as {
      __qualityHarness?: {
        setVideoHeight: (height: number) => void
        setVariantHeight: (height: number) => void
        setQualitySetting: (next: QualityPreference) => void
      }
    }
    win.__qualityHarness = {
      setVideoHeight: (height: number) => {
        videoHeightRef.current = height
        element.dispatchEvent(new Event('resize'))
      },
      setVariantHeight: (height: number) => {
        fakePlayer.setVariantHeight(height)
        fakePlayer.dispatchEvent(new Event('variantchanged'))
      },
      setQualitySetting: (next: QualityPreference) => {
        updateSettings({ quality: next })
      },
    }
    return () => {
      delete win.__qualityHarness
    }
  }, [fakePlayer, initialVideoHeight])

  useEffect(() => subscribeSettings((next) => {
    setQuality(next.quality)
  }), [])

  const state = usePlayerState(video, fakePlayer as unknown as shaka.Player)

  const applyQuality = useCallback((value: QualityPreference) => {
    setQuality(value)
    updateSettings({ quality: value })
    const element = videoRef.current
    if (!element) return
    if (value === 'auto') {
      if (syncVideoHeightOnPick) {
        videoHeightRef.current = initialVideoHeight
        element.dispatchEvent(new Event('resize'))
      }
    } else if (syncVideoHeightOnPick && heights.includes(value)) {
      videoHeightRef.current = value
      element.dispatchEvent(new Event('resize'))
    }
  }, [heights, initialVideoHeight, syncVideoHeightOnPick])

  return (
    <div
      data-quality-harness=''
      data-player-root=''
      data-player-surface=''
      style={{ position: 'relative', width: '640px', height: '360px', background: '#000', containerType: 'inline-size', containerName: 'player' }}
    >
      <video ref={videoRef} width={640} height={360} style={{ width: '100%', height: '100%', display: 'block' }} />
      {video
        ? (
          <PlayerControls
            video={video}
            player={fakePlayer as unknown as shaka.Player}
            state={state}
            heights={heights}
            storyboards={[]}
            quality={quality}
            onQuality={applyQuality}
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

/**
 * Mounts PlayerControls with configurable video heights and Shaka variant state
 * so Settings quality labels and checkmarks can be verified without live media streams.
 */
export const mountQualityHarness = (options: QualityHarnessOptions) => {
  document.getElementById('app')!.hidden = true
  document.querySelector('[data-quality-harness]')?.remove()
  const host = document.createElement('div')
  document.body.append(host)
  render(<QualityHarness {...options} />, host)
}
