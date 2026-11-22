import type { TargetedEvent, TargetedMouseEvent, TargetedPointerEvent } from 'preact'

// must stay type-only: a value import puts the on-demand shaka chunk back in the entry
import type { startShakaPlayback } from './shaka'

import { css } from '@emotion/react'
import { Maximize, Minimize, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { LIVE_UNSUPPORTED, playbackRefusal } from '../frame/protocol'
import { startEngine } from '../engine/client'
import { isTypingTarget } from './controls'
import { warmShaka } from './prefetch'
import { getSettings, updateSettings } from '../settings'

const playerStyle = css`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;

  &:fullscreen {
    border-radius: 0;
  }

  video,
  .poster {
    display: block;
    width: 100%;
    height: 100%;
    /* The box is 9:16 and so is a well-formed short, so this is a no-op for the
       common case. It matters for the shorts that are not: plenty are uploaded
       1:1 or 16:9, and covering would crop their edges away rather than
       letting them letterbox. */
    object-fit: contain;
  }

  .poster {
    position: absolute;
    inset: 0;
  }

  .spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 3.6rem;
    height: 3.6rem;
    margin: -1.8rem 0 0 -1.8rem;
    border: 0.3rem solid rgba(255, 255, 255, 0.25);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: shorts-spin 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes shorts-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* In the middle like the spinner, since the title overlay owns the bottom edge. */
  .status {
    position: absolute;
    inset: 50% 1.2rem auto;
    transform: translateY(-50%);
    color: var(--text-on-media);
    font: 500 1.3rem/1.4 system-ui, sans-serif;
    text-shadow: 0 1px 4px #000;
    text-align: center;
  }

  .paused-glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .paused-glyph .badge {
    display: grid;
    place-items: center;
    width: 6.4rem;
    height: 6.4rem;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }

  /* Top overlay bar matching youtube.com Shorts: Play/Pause and expanding volume
     pill on the left, Full screen on the right. */
  .top-bar {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.2rem;
    background: linear-gradient(rgba(0, 0, 0, 0.48), transparent);
    pointer-events: none;
    z-index: 2;
  }

  .top-group {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    pointer-events: auto;
  }

  .control-btn {
    display: grid;
    place-items: center;
    width: 4.8rem;
    height: 4.8rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: var(--text-on-media, #fff);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .control-btn:hover {
    background: rgba(0, 0, 0, 0.78);
  }

  .volume-pill {
    display: flex;
    align-items: center;
    height: 4.8rem;
    border-radius: 2.4rem;
    background: rgba(0, 0, 0, 0.55);
    transition: background 0.15s ease;
  }

  .volume-pill:hover,
  .volume-pill:focus-within {
    background: rgba(0, 0, 0, 0.78);
  }

  .volume-pill .control-btn {
    background: transparent;
  }

  .volume-pill .control-btn:hover {
    background: transparent;
  }

  .volume-slider {
    width: 0;
    height: 0.4rem;
    margin: 0;
    padding: 0;
    opacity: 0;
    appearance: none;
    border-radius: 0.2rem;
    background: linear-gradient(
      to right,
      #fff calc(var(--vol, 1) * 100%),
      rgba(255, 255, 255, 0.35) calc(var(--vol, 1) * 100%)
    );
    cursor: pointer;
    transition: width 0.18s ease, opacity 0.15s ease, margin-right 0.18s ease;
  }

  .volume-pill:hover .volume-slider,
  .volume-pill:focus-within .volume-slider {
    width: 7.2rem;
    opacity: 1;
    margin-right: 1.4rem;
  }

  .volume-slider::-webkit-slider-thumb {
    appearance: none;
    width: 1.2rem;
    height: 1.2rem;
    border: none;
    border-radius: 50%;
    background: #fff;
  }

  .volume-slider::-moz-range-thumb {
    width: 1.2rem;
    height: 1.2rem;
    border: none;
    border-radius: 50%;
    background: #fff;
  }

  /* Full-bleed progress line pinned to the bottom edge, the way the Shorts
     player shows position. It is a scrubber, so it takes pointer events while
     the surrounding surface stays a play/pause target. */
  .scrubber {
    position: absolute;
    inset: auto 0 0 0;
    height: 1.6rem;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    touch-action: none;
    z-index: 2;
  }

  .scrubber .track {
    position: relative;
    width: 100%;
    height: 0.3rem;
    background: rgba(255, 255, 255, 0.3);
    transition: height 0.1s ease;
  }

  .scrubber:hover .track,
  .scrubber.scrubbing .track {
    height: 0.5rem;
  }

  .scrubber .fill {
    position: relative;
    height: 100%;
    background: var(--brand, #f00);
  }

  .scrubber .fill::after {
    content: '';
    position: absolute;
    right: -0.6rem;
    top: 50%;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--brand, #f00);
    transform: translateY(-50%) scale(0);
    transition: transform 0.12s ease;
  }

  .scrubber:hover .fill::after,
  .scrubber.scrubbing .fill::after {
    transform: translateY(-50%) scale(1);
  }

  @media (max-width: 600px) {
    .control-btn {
      width: 4rem;
      height: 4rem;
    }

    .volume-pill {
      height: 4rem;
      border-radius: 2rem;
    }
  }
`

const VolumeIcon = ({ muted, volume }: { muted: boolean, volume: number }) => {
  if (muted || volume === 0) return <VolumeX size={22} strokeWidth={1.75} />
  if (volume < 0.5) return <Volume1 size={22} strokeWidth={1.75} />
  return <Volume2 size={22} strokeWidth={1.75} />
}

const ACTIVE_BUFFER_GOAL = 30
const PRELOAD_BUFFER_GOAL = 4

/**
 * The Shorts player.
 *
 * A separate component from `VideoPlayer` rather than a mode of it: the two
 * share only the Shaka startup call. This one loops, uses Shorts' top-bar
 * play/volume/fullscreen controls and full-bleed scrubber, and is mounted and
 * torn down as slides scroll rather than living for a route.
 *
 * `active` and `preload` bound the open SABR sessions (at most the active slide
 * plus the immediate next slide), because each session pins a per-session media
 * cache in the frame. Transitioning a slide from `preload` to `active` keeps
 * the same `<video>`, Shaka instance, and SABR session alive so playback starts
 * without reopening or re-fetching.
 *
 * `onReady` reports when the player has a decoded frame ready (and clears on
 * teardown). `onRefused`, when given, takes a terminal refusal once the slide
 * is active in place of showing it.
 */
const ShortsPlayer = (
  { videoId, poster, active, preload = false, shortcutsDisabled, onReady, onRefused }: {
    videoId: string
    poster?: string
    active: boolean
    preload?: boolean
    shortcutsDisabled?: boolean
    onReady?: (ready: boolean) => void
    onRefused?: () => void
  },
) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controllerRef = useRef<Awaited<ReturnType<typeof startShakaPlayback>> | undefined>(undefined)
  const activeRef = useRef(active)
  activeRef.current = active
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onRefusedRef = useRef(onRefused)
  onRefusedRef.current = onRefused

  const shouldLoad = active || preload
  const [ready, setReady] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingRefusal, setPendingRefusal] = useState<string | undefined>(undefined)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(() => getSettings().muted)
  const [volume, setVolume] = useState(() => getSettings().volume)
  const [fullscreen, setFullscreen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!shouldLoad) setAttempt(0)
  }, [shouldLoad])

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldLoad) return
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    setVolume(settings.volume)
    setMuted(settings.muted)
    // the loop MUST be on the element: restarting through currentTime re-enters the SABR chain as a seek
    video.loop = true
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setReady(false)
    setHasFrame(false)
    setStatus('')
    setPendingRefusal(undefined)
    const onFrame = () => {
      if (!abort.signal.aborted && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setHasFrame(true)
      }
    }
    video.addEventListener('loadeddata', onFrame)
    video.addEventListener('canplay', onFrame)
    video.addEventListener('playing', onFrame)
    const fail = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      const message = error instanceof Error ? error.message : String(error)
      const refused = playbackRefusal(error)
      if (refused?.final === true) {
        if (activeRef.current) {
          if (onRefusedRef.current) onRefusedRef.current()
          else setStatus(refused.title)
        } else {
          setPendingRefusal(refused.title)
        }
        return
      }
      if (attempt >= 2 || message === LIVE_UNSUPPORTED) {
        setStatus(message)
        return
      }
      retryTimer = setTimeout(() => {
        if (!abort.signal.aborted) setAttempt((value) => value + 1)
      }, 400)
    }
    void (async () => {
      const [api, { startShakaPlayback }] = await Promise.all([startEngine(), warmShaka()])
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        startTime: 0,
        autoPlay: false,
        bufferingGoal: activeRef.current ? ACTIVE_BUFFER_GOAL : PRELOAD_BUFFER_GOAL,
        signal: abort.signal,
        onError: fail,
      })
      if (abort.signal.aborted) return
      controllerRef.current = controller
      setReady(true)
      onFrame()
      // through selectQuality, not Shaka restrictions: the frame's SABR session must serve the format before Shaka may select it
      const displayHeight = Math.ceil(video.getBoundingClientRect().height * devicePixelRatio)
      const covering = displayHeight > 0
        ? [...controller.heights].sort((a, b) => a - b).find((height) => height >= displayHeight)
        : undefined
      if (covering) await controller.selectQuality(covering).catch(() => {})
    })().catch(fail)
    return () => {
      abort.abort()
      clearTimeout(retryTimer)
      video.removeEventListener('loadeddata', onFrame)
      video.removeEventListener('canplay', onFrame)
      video.removeEventListener('playing', onFrame)
      controllerRef.current = undefined
      setReady(false)
      setHasFrame(false)
      setPendingRefusal(undefined)
      onReadyRef.current?.(false)
      void controller?.destroy()
    }
  }, [videoId, shouldLoad, attempt])

  useEffect(() => {
    const video = videoRef.current
    const controller = controllerRef.current
    if (!video || !controller || !ready) return
    if (!active) {
      video.pause()
      if (video.currentTime > 0) video.currentTime = 0
      setProgress(0)
      controller.player.configure({ streaming: { bufferingGoal: PRELOAD_BUFFER_GOAL } })
      return
    }
    let cancelled = false
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    setVolume(settings.volume)
    setMuted(settings.muted)
    setPaused(false)
    controller.player.configure({ streaming: { bufferingGoal: ACTIVE_BUFFER_GOAL } })
    if (video.currentTime > 0) {
      video.currentTime = 0
      setProgress(0)
    }
    void controller.play().finally(() => {
      if (cancelled) video.pause()
      else setPaused(video.paused)
    })
    return () => {
      cancelled = true
    }
  }, [active, ready])

  useEffect(() => {
    if (ready && hasFrame) onReadyRef.current?.(true)
  }, [ready, hasFrame])

  useEffect(() => {
    if (!active || pendingRefusal === undefined) return
    if (onRefusedRef.current) onRefusedRef.current()
    else setStatus(pendingRefusal)
  }, [active, pendingRefusal])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      setPaused(video.paused)
      setMuted(video.muted)
      setVolume(video.volume)
    }
    const tick = () => {
      if (scrubbing) return
      const duration = video.duration
      setProgress(Number.isFinite(duration) && duration > 0 ? video.currentTime / duration : 0)
    }
    video.addEventListener('play', sync)
    video.addEventListener('pause', sync)
    video.addEventListener('volumechange', sync)
    video.addEventListener('timeupdate', tick)
    return () => {
      video.removeEventListener('play', sync)
      video.removeEventListener('pause', sync)
      video.removeEventListener('volumechange', sync)
      video.removeEventListener('timeupdate', tick)
    }
  }, [scrubbing, attempt])

  const seekToPointer = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const track = event.currentTarget as HTMLElement | null
    if (!video || !track || !Number.isFinite(video.duration)) return
    const box = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    setProgress(ratio)
    video.currentTime = ratio * video.duration
  }

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !activeRef.current) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    const currentlyMuted = video ? video.muted || video.volume === 0 : muted || volume === 0
    const nextMuted = !currentlyMuted
    const nextVolume = !nextMuted && (video?.volume ?? volume) === 0 ? 1 : (video?.volume ?? volume)
    if (video) {
      video.volume = nextVolume
      video.muted = nextMuted
    }
    setMuted(nextMuted)
    setVolume(nextVolume)
    updateSettings({ muted: nextMuted, volume: nextVolume })
  }, [muted, volume])

  const onVolumeInput = (event: TargetedEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.currentTarget.value)
    if (!Number.isFinite(nextVolume)) return
    const nextMuted = nextVolume === 0
    const video = videoRef.current
    if (video) {
      video.volume = nextVolume
      video.muted = nextMuted
    }
    setVolume(nextVolume)
    setMuted(nextMuted)
    updateSettings({ volume: nextVolume, muted: nextMuted })
  }

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === rootRef.current) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void rootRef.current?.requestFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!active || shortcutsDisabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'k' || (event.key === ' ' && !(event.target instanceof HTMLElement && event.target.closest('button, a, input, select')))) {
        event.preventDefault()
        togglePlay()
      } else if (key === 'm') {
        event.preventDefault()
        toggleMute()
      } else if (key === 'f') {
        event.preventDefault()
        toggleFullscreen()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const video = videoRef.current
        if (!video || !Number.isFinite(video.duration)) return
        event.preventDefault()
        const delta = event.key === 'ArrowRight' ? 5 : -5
        video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, shortcutsDisabled, togglePlay, toggleMute, toggleFullscreen])

  const effectiveVolume = muted ? 0 : volume
  const visibleStatus = active ? status : ''

  return (
    <div ref={rootRef} css={playerStyle} onClick={togglePlay}>
      {poster && !hasFrame ? <img className='poster' src={poster} alt='' /> : undefined}
      <video key={attempt} ref={videoRef} playsInline preload='auto' />
      {active && !hasFrame && !visibleStatus ? <div className='spinner' /> : undefined}
      {visibleStatus ? <p className='status'>{visibleStatus}</p> : undefined}
      {active && ready && paused
        ? (
          <div className='paused-glyph'>
            <span className='badge'>
              <Play size={30} fill='currentColor' strokeWidth={1.5} />
            </span>
          </div>
        )
        : undefined}
      {!visibleStatus
        ? (
          <div className='top-bar'>
            <div className='top-group' onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}>
              <button
                type='button'
                className='control-btn'
                aria-label={paused ? 'Play' : 'Pause'}
                title={paused ? 'Play (k)' : 'Pause (k)'}
                onClick={togglePlay}
              >
                {paused
                  ? <Play size={22} fill='currentColor' strokeWidth={1.5} />
                  : <Pause size={22} fill='currentColor' strokeWidth={1.5} />}
              </button>
              <div className='volume-pill'>
                <button
                  type='button'
                  className='control-btn mute'
                  aria-label={effectiveVolume === 0 ? 'Unmute' : 'Mute'}
                  title={effectiveVolume === 0 ? 'Unmute (m)' : 'Mute (m)'}
                  onClick={toggleMute}
                >
                  <VolumeIcon muted={muted} volume={volume} />
                </button>
                <input
                  type='range'
                  className='volume-slider'
                  min={0}
                  max={1}
                  step={0.01}
                  value={effectiveVolume}
                  aria-label='Volume'
                  style={{ '--vol': effectiveVolume } as Record<string, number>}
                  onInput={onVolumeInput}
                />
              </div>
            </div>
            <div className='top-group' onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}>
              <button
                type='button'
                className='control-btn'
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                title={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'}
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize size={20} strokeWidth={1.75} /> : <Maximize size={20} strokeWidth={1.75} />}
              </button>
            </div>
          </div>
        )
        : undefined}
      {ready
        ? (
          <div
            className={scrubbing ? 'scrubber scrubbing' : 'scrubber'}
            onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}
            onPointerDown={(event: TargetedPointerEvent<HTMLDivElement>) => {
              event.stopPropagation()
              ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
              setScrubbing(true)
              seekToPointer(event)
            }}
            onPointerMove={(event: TargetedPointerEvent<HTMLDivElement>) => {
              if (scrubbing) seekToPointer(event)
            }}
            onPointerUp={(event: TargetedPointerEvent<HTMLDivElement>) => {
              ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
              setScrubbing(false)
            }}
          >
            <div className='track'>
              <div className='fill' style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )
        : undefined}
    </div>
  )
}

export default ShortsPlayer
