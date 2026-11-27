import type { TargetedEvent, TargetedMouseEvent, TargetedPointerEvent } from 'preact'

import type { AudioTrack, CaptionPick, CaptionTrack, TranslationLanguage } from '../frame/protocol'
import type { ShortsMediaState, ShortsMenuActions } from './shorts-menu'
// must stay type-only: a value import puts the on-demand shaka chunk back in the entry
import type { startShakaPlayback } from './shaka'

import { css } from '@emotion/react'
import { Captions, CaptionsOff, Maximize, Minimize, MoreVertical, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { showToast } from '../components/ui/toast'
import { startEngine } from '../engine/client'
import { defaultTrack, startingCaption } from '../frame/captions'
import { LIVE_UNSUPPORTED, playbackRefusal } from '../frame/protocol'
import { getSettings, subscribeSettings, updateSettings, useSetting } from '../settings'
import { AmbientBars } from './ambient-glow'
import { AudioPermissionPrompt } from './audio-prompt'
import { captionDeclarations } from './caption-style'
import { isTypingTarget } from './controls'
import { pictureOf } from './end-screen-layout'
import { getFullscreenElement, isVideoFullscreen, subscribeFullscreen, togglePlayerFullscreen } from './fullscreen'
import { warmShaka } from './prefetch'
import { SeekKnob } from './seek-knob'
import { ShortsOptionsMenu } from './shorts-menu'
import { bindSmoothPlaybackLoop } from './smooth-progress'

const playerStyle = css`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;

  &:fullscreen {
    border-radius: 0;

    video::-webkit-media-text-track-container {
      transform: translateY(-2.4rem);
    }
  }

  video,
  .poster {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    /* The box is 9:16 and so is a well-formed short, so this is a no-op for the
       common case. It matters for the shorts that are not: plenty are uploaded
       1:1 or 16:9, and covering would crop their edges away rather than
       letting them letterbox. */
    object-fit: contain;
  }

  /* Lifts native WebVTT cues above the bottom metadata overlay and scrubber. */
  video::-webkit-media-text-track-container {
    transform: translateY(-13.6rem);
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
    transition: background 0.15s ease, color 0.15s ease;
  }

  .control-btn:hover {
    background: rgba(0, 0, 0, 0.78);
  }

  .control-btn.captions-on {
    background: rgba(255, 255, 255, 0.92);
    color: #0f0f0f;
  }

  .control-btn.captions-on:hover {
    background: #fff;
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
    height: 4.8rem;
    margin: 0;
    padding: 0;
    opacity: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
    transition: width 0.18s cubic-bezier(0, 0, 0.2, 1), opacity 0.15s ease, margin-right 0.18s cubic-bezier(0, 0, 0.2, 1);
  }

  .volume-pill:hover .volume-slider,
  .volume-pill:focus-within .volume-slider {
    width: 7.2rem;
    opacity: 1;
    margin-right: 1.4rem;
  }

  .volume-slider::-webkit-slider-runnable-track {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: linear-gradient(to right, #ffffff var(--fill), rgba(255, 255, 255, 0.25) var(--fill));
  }

  .volume-slider::-webkit-slider-thumb {
    appearance: none;
    width: 1.2rem;
    height: 1.2rem;
    margin-top: -0.5rem;
    border: none;
    border-radius: 50%;
    background: #fff;
  }

  .volume-slider::-moz-range-track {
    height: 0.2rem;
    border: none;
    border-radius: 0.1rem;
    background: rgba(255, 255, 255, 0.25);
  }

  .volume-slider::-moz-range-progress {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: #fff;
  }

  .volume-slider::-moz-range-thumb {
    width: 1.2rem;
    height: 1.2rem;
    border: none;
    border-radius: 50%;
    background: #fff;
  }

  .volume-slider:focus-visible {
    outline: none;
  }

  .volume-slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
  }

  .volume-slider:focus-visible::-moz-range-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
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
    background: var(--brand-red);
    transition: width 80ms linear;
  }

  .scrubber.scrubbing .fill {
    transition: none;
  }

  .scrubber .knob {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) scale(0);
    pointer-events: none;
    transition: left 80ms linear, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .scrubber:hover .knob,
  .scrubber.scrubbing .knob {
    transform: translate(-50%, -50%) scale(1);
  }

  .scrubber.scrubbing .knob {
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Custom emoji/icon handles stay visible above the bottom-flush track (rather than hover-only) inside overflow: hidden. */
  .scrubber .knob[data-seek-handle='emoji'],
  .scrubber .knob[data-seek-handle='icon'] {
    top: auto;
    bottom: 0.35rem;
    transform: translateX(-50%) scale(1);
    transform-origin: center bottom;
    transition: left 80ms linear, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .scrubber:hover .knob[data-seek-handle='emoji'],
  .scrubber.scrubbing .knob[data-seek-handle='emoji'],
  .scrubber:hover .knob[data-seek-handle='icon'],
  .scrubber.scrubbing .knob[data-seek-handle='icon'] {
    transform: translateX(-50%) scale(1.15);
  }

  .scrubber.scrubbing .knob[data-seek-handle='emoji'],
  .scrubber.scrubbing .knob[data-seek-handle='icon'] {
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .scrubber .track,
    .scrubber .fill,
    .scrubber .knob {
      transition: none;
    }
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

// Chrome sizes cues to 5% of the smaller side of the picture drawn, not of the element
const captionBase = (video: HTMLVideoElement) => {
  const picture = pictureOf(video)
  return 0.05 * Math.min(picture.width, picture.height)
}

const captionStyle = (declarations: string) => css`
  video::cue {
    ${declarations};
  }
`

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
  { videoId, poster, active, preload = false, shortcutsDisabled, menuActions, onMediaState, onVideoElement, onMenuOpenChange, onReady, onRefused }: {
    videoId: string
    poster?: string
    active: boolean
    preload?: boolean
    shortcutsDisabled?: boolean
    menuActions?: ShortsMenuActions
    onMediaState?: (state: ShortsMediaState) => void
    onVideoElement?: (video: HTMLVideoElement | null) => void
    onMenuOpenChange?: (open: boolean) => void
    onReady?: (ready: boolean) => void
    onRefused?: () => void
  },
) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const controllerRef = useRef<Awaited<ReturnType<typeof startShakaPlayback>> | undefined>(undefined)
  const activeRef = useRef(active)
  activeRef.current = active
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onRefusedRef = useRef(onRefused)
  onRefusedRef.current = onRefused
  const onVideoElementRef = useRef(onVideoElement)
  onVideoElementRef.current = onVideoElement
  const onMediaStateRef = useRef(onMediaState)
  onMediaStateRef.current = onMediaState

  const bindVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
    onVideoElementRef.current?.(el)
  }, [])

  const shouldLoad = active || preload
  const [ready, setReady] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingRefusal, setPendingRefusal] = useState<string | undefined>(undefined)
  const [autoMuted, setAutoMuted] = useState(false)
  const dismissAutoMuted = useCallback(() => setAutoMuted(false), [])
  const [paused, setPaused] = useState(false)
  const seekHandle = useSetting('seekHandle')
  const ambientMode = useSetting('ambientMode')
  const [playbackRate, setPlaybackRate] = useState(() => getSettings().playbackRate)
  const playbackRateRef = useRef(playbackRate)
  playbackRateRef.current = playbackRate
  const [muted, setMuted] = useState(() => getSettings().muted)
  const [volume, setVolume] = useState(() => getSettings().volume)
  const [fullscreen, setFullscreen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([])
  const [translationLanguages, setTranslationLanguages] = useState<TranslationLanguage[]>([])
  const [caption, setCaption] = useState<CaptionPick | undefined>(undefined)
  const lastCaption = useRef<CaptionPick | undefined>(undefined)
  if (caption) lastCaption.current = caption
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [audioTrackId, setAudioTrackId] = useState<string | undefined>(undefined)
  const selectAudioRef = useRef<((trackId: string | undefined, drc: boolean) => Promise<void>) | undefined>(undefined)
  const [cueStyle, setCueStyle] = useState('')

  useEffect(() => {
    if (!shouldLoad) setAttempt(0)
  }, [shouldLoad])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !active) return
    const update = () => setCueStyle(captionDeclarations(getSettings(), captionBase(video)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(video)
    video.addEventListener('resize', update)
    const unsubscribe = subscribeSettings(update)
    return () => {
      observer.disconnect()
      video.removeEventListener('resize', update)
      unsubscribe()
    }
  }, [active, attempt])

  useEffect(() => {
    const onFullscreen = () => {
      const element = getFullscreenElement()
      setFullscreen(element !== null ? element === rootRef.current : isVideoFullscreen(videoRef.current))
    }
    onFullscreen()
    return subscribeFullscreen(onFullscreen, videoRef.current)
  }, [attempt])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldLoad) {
      setAutoMuted(false)
      return
    }
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    video.playbackRate = settings.playbackRate
    setVolume(settings.volume)
    setMuted(settings.muted)
    setPlaybackRate(settings.playbackRate)
    // the loop MUST be on the element: restarting through currentTime re-enters the SABR chain as a seek
    video.loop = true
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let ownedSession: { api: Awaited<ReturnType<typeof startEngine>>, promise: ReturnType<Awaited<ReturnType<typeof startEngine>>['openPlayback']> } | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setReady(false)
    setHasFrame(false)
    setStatus('')
    setPendingRefusal(undefined)
    setAutoMuted(false)
    setCaptionTracks([])
    setTranslationLanguages([])
    setCaption(undefined)
    setAudioTracks([])
    setAudioTrackId(undefined)
    selectAudioRef.current = undefined
    lastCaption.current = undefined
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
    const shakaModule = warmShaka()
    void shakaModule.catch(() => {})
    void (async () => {
      const api = await startEngine()
      if (abort.signal.aborted) return
      // Pick the smallest format covering the rendered box BEFORE load so prewarmStart() and Shaka open directly on
      // the final Short tier without downloading a low-res segment only to clear buffers and re-fetch.
      const rect = video.getBoundingClientRect()
      const cover = rect.width > 0 && rect.height > 0
        ? { width: Math.ceil(rect.width * devicePixelRatio), height: Math.ceil(rect.height * devicePixelRatio) }
        : undefined
      const maxHeight = cover ? Math.max(360, cover.height) : 1_080
      const openOptions = cover ? { cover } : undefined
      const sessionPromise = openOptions
        ? api.openPlayback(videoId, maxHeight, undefined, settings.stableVolume, openOptions)
        : api.openPlayback(videoId, maxHeight, undefined, settings.stableVolume)
      void sessionPromise.catch(() => {})
      ownedSession = { api, promise: sessionPromise }
      const { startShakaPlayback } = await shakaModule
      if (abort.signal.aborted) return
      ownedSession = undefined
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        stableVolume: settings.stableVolume,
        startTime: 0,
        autoPlay: false,
        bufferingGoal: activeRef.current ? ACTIVE_BUFFER_GOAL : PRELOAD_BUFFER_GOAL,
        maxHeight,
        pinVideoFormat: true,
        openOptions,
        sessionPromise,
        signal: abort.signal,
        onError: fail,
        onAutoplayMuted: () => {
          if (!abort.signal.aborted && activeRef.current) setAutoMuted(true)
        },
      })
      if (abort.signal.aborted) return
      controllerRef.current = controller
      setCaptionTracks(controller.captionTracks)
      setTranslationLanguages(controller.translationLanguages)
      setAudioTracks(controller.audioTracks)
      setAudioTrackId(controller.audioTrackId)
      selectAudioRef.current = controller.selectAudio
      setReady(true)
      onFrame()
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
      setAutoMuted(false)
      setCaptionTracks([])
      setTranslationLanguages([])
      setCaption(undefined)
      setAudioTracks([])
      setAudioTrackId(undefined)
      selectAudioRef.current = undefined
      lastCaption.current = undefined
      onReadyRef.current?.(false)
      if (ownedSession) {
        const { api, promise } = ownedSession
        void promise.then((session) => api.closePlayback(session.id)).catch(() => {})
      }
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
      setAutoMuted(false)
      setCaption(undefined)
      void controller.selectCaption(undefined).catch(() => {})
      controller.player.configure({ streaming: { bufferingGoal: PRELOAD_BUFFER_GOAL } })
      return
    }
    let cancelled = false
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    video.playbackRate = settings.playbackRate
    setVolume(settings.volume)
    setMuted(settings.muted)
    setPlaybackRate(settings.playbackRate)
    setAutoMuted(false)
    setPaused(false)
    controller.player.configure({ streaming: { bufferingGoal: ACTIVE_BUFFER_GOAL } })
    const wanted = startingCaption(controller.captionTracks, controller.translationLanguages, settings, navigator.language)
    setCaption(wanted)
    if (wanted) {
      const selectCaption = controller.selectCaption
      void selectCaption(wanted.trackId, wanted.translateTo).catch(() => {
        if (cancelled) return
        if (!wanted.translateTo) {
          setCaption((current) => (current?.trackId === wanted.trackId && !current.translateTo ? undefined : current))
          return
        }
        const fallback: CaptionPick = { trackId: wanted.trackId }
        setCaption((current) => (
          current?.trackId === wanted.trackId && current.translateTo === wanted.translateTo ? fallback : current
        ))
        void selectCaption(fallback.trackId).catch(() => {
          if (cancelled) return
          setCaption((current) => (current?.trackId === fallback.trackId && !current.translateTo ? undefined : current))
        })
      })
    } else {
      void controller.selectCaption(undefined).catch(() => {})
    }
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
    const unbindProgress = bindSmoothPlaybackLoop(video, tick, () => active && !scrubbing)
    const unsubscribe = subscribeSettings((next) => {
      if (next.playbackRate === playbackRateRef.current) return
      const el = videoRef.current
      if (el) el.playbackRate = next.playbackRate
      setPlaybackRate(next.playbackRate)
    })
    return () => {
      video.removeEventListener('play', sync)
      video.removeEventListener('pause', sync)
      video.removeEventListener('volumechange', sync)
      unbindProgress()
      unsubscribe()
    }
  }, [active, scrubbing, attempt])

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
    void togglePlayerFullscreen(rootRef.current, videoRef.current).catch(() => {})
  }, [])

  const applyCaption = useCallback((next: CaptionPick | undefined) => {
    const controller = controllerRef.current
    if (!next) {
      setCaption(undefined)
      updateSettings({ captionsEnabled: false })
      void controller?.selectCaption(undefined).catch(() => {})
      return
    }
    if (next.translateTo) {
      void controller?.selectCaption(next.trackId, next.translateTo).then(
        () => {
          setCaption(next)
          updateSettings({ captionsEnabled: true, captionsLanguage: next.translateTo })
        },
        () => {
          showToast('Auto-translate is not available right now')
        },
      )
      return
    }
    setCaption(next)
    const picked = captionTracks.find((track) => track.id === next.trackId)
    if (picked) updateSettings({ captionsEnabled: true, captionsLanguage: picked.languageCode })
    void controller?.selectCaption(next.trackId).catch(() => {
      setCaption((current) => (current?.trackId === next.trackId && !current.translateTo ? undefined : current))
      showToast('Subtitles are not available for this video right now')
    })
  }, [captionTracks])

  const toggleCaption = useCallback(() => {
    if (captionTracks.length === 0) return
    if (caption) {
      applyCaption(undefined)
      return
    }
    const previous = lastCaption.current
    const restored = previous
      && captionTracks.some((track) => track.id === previous.trackId)
      && (!previous.translateTo || translationLanguages.some((language) => language.languageCode === previous.translateTo))
      ? previous
      : (() => {
          const track = defaultTrack(captionTracks, navigator.language)
          return track ? { trackId: track.id } : undefined
        })()
    if (restored) applyCaption(restored)
  }, [applyCaption, caption, captionTracks, translationLanguages])

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
      } else if (key === 'c' && captionTracks.length > 0) {
        event.preventDefault()
        toggleCaption()
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
  }, [active, shortcutsDisabled, captionTracks.length, togglePlay, toggleMute, toggleCaption, toggleFullscreen])

  const applyAudioTrack = useCallback((trackId: string) => {
    setAudioTrackId(trackId)
    void selectAudioRef.current?.(trackId, getSettings().stableVolume).catch(() => {})
  }, [])

  const applyPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current
    if (video) video.playbackRate = rate
    setPlaybackRate(rate)
    updateSettings({ playbackRate: rate })
  }, [])

  const toggleAmbientMode = useCallback(() => {
    updateSettings({ ambientMode: !getSettings().ambientMode })
  }, [])

  const effectiveVolume = muted ? 0 : volume
  const visibleStatus = active ? status : ''

  const mediaState = useMemo<ShortsMediaState>(() => ({
    captionTracks,
    translationLanguages,
    caption,
    onCaption: applyCaption,
    audioTracks,
    audioTrackId,
    onAudioTrack: applyAudioTrack,
    playbackRate,
    onPlaybackRate: applyPlaybackRate,
    ambientMode,
    onAmbientMode: toggleAmbientMode,
    fullscreen,
    onFullscreen: toggleFullscreen,
  }), [
    captionTracks,
    translationLanguages,
    caption,
    applyCaption,
    audioTracks,
    audioTrackId,
    applyAudioTrack,
    playbackRate,
    applyPlaybackRate,
    ambientMode,
    toggleAmbientMode,
    fullscreen,
    toggleFullscreen,
  ])

  useEffect(() => {
    onMediaStateRef.current?.(mediaState)
  }, [mediaState])

  return (
    <div ref={rootRef} css={cueStyle ? [playerStyle, captionStyle(cueStyle)] : playerStyle} onClick={togglePlay}>
      <AmbientBars
        video={videoEl}
        enabled={ambientMode && active}
        fullscreen={fullscreen}
        docked={false}
        hasFrame={hasFrame}
        blocked={Boolean(visibleStatus)}
      />
      {poster && !hasFrame ? <img className='poster' src={poster} alt='' /> : undefined}
      <video key={attempt} ref={bindVideo} playsInline preload='auto' />
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
                  aria-valuetext={`${Math.round(effectiveVolume * 100)}%`}
                  style={{ '--fill': `calc(0.6rem + ${effectiveVolume} * (100% - 1.2rem))` }}
                  onInput={onVolumeInput}
                />
              </div>
            </div>
            <div className='top-group' onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}>
              {captionTracks.length > 0
                ? (
                  <button
                    type='button'
                    className={caption ? 'control-btn captions-on' : 'control-btn'}
                    aria-label={caption ? 'Subtitles/closed captions off' : 'Subtitles/closed captions'}
                    aria-pressed={Boolean(caption)}
                    title='Subtitles/closed captions (c)'
                    onClick={toggleCaption}
                  >
                    {caption ? <Captions size={22} strokeWidth={1.75} /> : <CaptionsOff size={22} strokeWidth={1.75} />}
                  </button>
                )
                : undefined}
              <ShortsOptionsMenu
                label='More options'
                align='end'
                side='below'
                media={mediaState}
                actions={menuActions}
                onOpenChange={onMenuOpenChange}
                trigger={(
                  <button
                    type='button'
                    className='control-btn'
                    aria-label='More options'
                    title='More options'
                  >
                    <MoreVertical size={20} strokeWidth={1.75} />
                  </button>
                )}
              />
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
      {active && autoMuted && !visibleStatus && videoRef.current
        ? <AudioPermissionPrompt video={videoRef.current} placement='shorts' onDismiss={dismissAutoMuted} />
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
              <SeekKnob
                handle={seekHandle}
                style={{
                  left: seekHandle.kind === 'default'
                    ? `${progress * 100}%`
                    : `clamp(1.4rem, ${progress * 100}%, calc(100% - 1.4rem))`,
                }}
              />
            </div>
          </div>
        )
        : undefined}
    </div>
  )
}

export default ShortsPlayer
