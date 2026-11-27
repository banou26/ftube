import type shaka from 'shaka-player'

import type { SeekWindow } from './seek-window'

import { useEffect, useState } from 'preact/hooks'

export type PlayerState = {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  playbackRate: number
  buffering: boolean
  seeking: boolean
  videoHeight?: number
  // a live stream's DVR window, in the same presentation time as currentTime
  liveWindow?: SeekWindow
}

const EMPTY: PlayerState = {
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  buffering: false,
  seeking: false,
  videoHeight: 0,
}

const read = (
  video: HTMLVideoElement,
  player: shaka.Player | undefined,
  buffering: boolean,
  variantHeight: number,
  preferVariant: boolean,
): PlayerState => ({
  paused: video.paused,
  ended: video.ended,
  currentTime: video.currentTime,
  duration: Number.isFinite(video.duration) ? video.duration : 0,
  buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
  volume: video.volume,
  muted: video.muted,
  playbackRate: video.playbackRate,
  buffering,
  seeking: video.seeking,
  videoHeight: preferVariant && variantHeight > 0
    ? variantHeight
    : (video.videoHeight > 0 ? video.videoHeight : variantHeight),
  liveWindow: player?.isLive() ? player.seekRange() : undefined,
})

// timeupdate fires about four times a second, too coarse to track the playhead smoothly
export const usePlayerState = (video: HTMLVideoElement | null, player: shaka.Player | undefined) => {
  const [state, setState] = useState<PlayerState>(EMPTY)

  useEffect(() => {
    if (!video) return
    let buffering = false
    let variantHeight = 0
    let preferVariant = false
    let frame = 0
    let running = true

    const readVariantHeight = () => player?.getVariantTracks?.().find((track) => track.active)?.height ?? 0
    variantHeight = readVariantHeight()

    const sync = () => setState(read(video, player, buffering, variantHeight, preferVariant))

    let liveRead = 0
    const tick = () => {
      if (!running) return
      if (!video.paused || video.seeking) sync()
      // a paused live stream's edge moves on at a second per second, so its window is read once a second
      else if (player?.isLive() && performance.now() - liveRead >= 1_000) {
        liveRead = performance.now()
        sync()
      }
      frame = requestAnimationFrame(tick)
    }

    const onBuffering = (event: Event) => {
      buffering = Boolean((event as Event & { buffering?: boolean }).buffering)
      sync()
    }
    const onAdaptation = () => {
      variantHeight = readVariantHeight()
      sync()
    }
    const onVariantChanged = () => {
      variantHeight = readVariantHeight()
      preferVariant = variantHeight > 0
      sync()
    }
    const onResize = () => {
      if (video.videoHeight > 0) preferVariant = false
      sync()
    }
    const onEmptied = () => {
      preferVariant = false
      variantHeight = readVariantHeight()
      sync()
    }

    const events = ['play', 'pause', 'ended', 'seeking', 'seeked', 'volumechange', 'ratechange', 'durationchange', 'loadedmetadata', 'progress', 'timeupdate']
    for (const event of events) video.addEventListener(event, sync)
    video.addEventListener('resize', onResize)
    video.addEventListener('emptied', onEmptied)
    player?.addEventListener('buffering', onBuffering)
    player?.addEventListener('adaptation', onAdaptation)
    player?.addEventListener('variantchanged', onVariantChanged)
    sync()
    frame = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      for (const event of events) video.removeEventListener(event, sync)
      video.removeEventListener('resize', onResize)
      video.removeEventListener('emptied', onEmptied)
      player?.removeEventListener('buffering', onBuffering)
      player?.removeEventListener('adaptation', onAdaptation)
      player?.removeEventListener('variantchanged', onVariantChanged)
    }
  }, [video, player])

  return state
}
