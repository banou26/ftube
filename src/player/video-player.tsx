import type { TargetedEvent } from 'preact'
import type shaka from 'shaka-player'

import type { AudioTrack, CaptionPick, CaptionTrack, EndScreenElement, PlaybackRefusal, Storyboard, TranslationLanguage } from '../frame/protocol'
import type { Point } from '../components/ui/popup'
import type { WatchMetaQuery } from '../generated/graphql'
import type { BezelCue } from './bezel'
import type { PlayerChapter } from './chapters'
import type { SkipSegment } from './sponsorblock'
import type { TheaterMode } from './theater'
import type { UpNext } from './up-next'

// must stay type-only: a value import puts the on-demand shaka chunk back in the entry
import type { startShakaPlayback } from './shaka'

import { LIVE_UNSUPPORTED, playbackRefusal } from '../frame/protocol'
import { defaultTrack, startingCaption } from '../frame/captions'

import { css } from '@emotion/react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { resetEngine, startEngine } from '../engine/client'
import { warmShaka } from './prefetch'
import { createRestartBudget, isStreamRefusal, resetsEngine } from './restart'
import { revealCards } from './cards'
import { registerSeek, clearSeek } from './seek'
import { clampToWindow, liveResumeTime, seekWindow, timeAtShare } from './seek-window'
import { closePlayer, setPanel, setPlayingChapter } from './session'
import { getSettings, subscribeSettings, updateSettings, useSetting } from '../settings'
import { Dialog } from '../components/ui/dialog'
import { showToast } from '../components/ui/toast'
import { PartyPlayback } from '../components/party-playback'
import { AudioPermissionPrompt } from './audio-prompt'
import { AmbientBars } from './ambient-glow'
import { Bezel } from './bezel'
import { CaptionOverlay } from './caption-overlay'
import { captionDeclarations, stepCaptionSize } from './caption-style'
import { chapterIndexAt, chapterStep } from './chapters'
import { isTypingTarget, PlayerControls } from './controls'
import { EndScreen, UpNextCountdown } from './end-screen'
import { EndScreenElements } from './end-screen-elements'
import { InfoCards } from './info-cards'
import { pictureOf } from './end-screen-layout'
import type { NativeTransitionController } from './ios-playback'

import { getFullscreenElement, subscribeFullscreen, togglePlayerFullscreen } from './fullscreen'
import { bindNativeTransitionResume } from './ios-playback'
import { bindMediaSession, setMediaSessionTrackHandlers, syncMediaSessionState, updateMediaSessionMetadata } from './media-session'
import { MiniplayerControls } from './miniplayer'
import { isVideoInPip, subscribeVideoPip } from './pip'
import { useFrame } from './player-frame'
import { RefusalScreen } from './refusal-screen'
import { stepRate } from './rates'
import { PlayerMenu } from './player-menu'
import { planPlayerSettingsSync } from './settings-sync'
import { ShortcutsDialog } from './shortcuts'
import { endSleepTimer, getSleepTimer, useSleepTimer } from './sleep-timer'
import { CLOCK_SLACK, skipTarget } from './sponsorblock'
import { decideSurfaceClick, isTouchPointer, shouldAutoHideControlsOnLoad, shouldIgnoreHoverPointer } from './surface-interaction'
import { endAction } from './up-next'
import { usePlayerState } from './use-player-state'
import { stepVideoVolume, toggleVideoMute } from './volume'

// the player's box is its frame's, which stays as the video changes; this fills it, less the panel beside it in full screen
const playerStyle = css`
  position: absolute;
  inset: 0;
  /* the controls and the end screen lay out for the player's own width, which is the miniplayer's 400 px wherever the page is */
  container: player / inline-size;

  video {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .poster {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  &.idle {
    cursor: none;
  }

  .playback-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1.2rem;
    pointer-events: none;
    color: var(--text-on-media);
    font: 600 14px/1.4 system-ui, sans-serif;
    text-shadow: 0 1px 4px #000;
  }

  .playback-retry {
    pointer-events: auto;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: #ffffff;
    color: #0f0f0f;
    font: 500 14px/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4.8rem;
    height: 4.8rem;
    margin: -2.4rem 0 0 -2.4rem;
    border: 0.4rem solid rgba(255, 255, 255, 0.25);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: player-spin 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes player-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* above the 72 px of seek rail and control groups, so it never covers a control */
  .sponsor-skip {
    position: absolute;
    right: 1.2rem;
    bottom: 8rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: rgba(0, 0, 0, 0.6);
    color: #ffffff;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .sponsor-skip:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  &.custom-captions video::cue {
    visibility: hidden;
    opacity: 0;
    color: transparent;
    background-color: transparent;
    text-shadow: none;
  }

  @container player (max-width: 600px) {
    .sponsor-skip {
      right: 0.8rem;
      bottom: 7.6rem;
      height: 3.2rem;
      padding: 0 1.2rem;
      font-size: 1.3rem;
    }
  }
`

const IDLE_MS = 2_500
// how long youtube.com shows its caption sample after + or - (measured 2026-11-10)
const CAPTION_SAMPLE_MS = 1_000
// how long before a sponsor part Skip sponsor shows, and after a skip Undo does, in seconds of the video
const SPONSOR_NOTICE = 5
const SEEK_STEP = 5
const JUMP_STEP = 10

const requestPlayerFullscreen = (video: HTMLVideoElement | null) => {
  void togglePlayerFullscreen(video?.closest('[data-player-root]') ?? null, video).catch(() => {})
}

/**
 * What the player moves on to, decided by the persistent player that owns it.
 *
 * `queued` says whether a playlist entry follows, so the end of the video calls
 * `onNext` at once; otherwise `pick` is the autoplay countdown's target and
 * `suggestions` fill the end screen. `onPrevious` is Shift+P, set only in a
 * playlist. `onOpen` plays a picked video, which on the watch page navigates
 * and in the miniplayer plays in place.
 */
export type PlayerUpNext = {
  autoplay: boolean
  onAutoplay: (value: boolean) => void
  queued: () => boolean
  pick?: UpNext
  suggestions: readonly UpNext[]
  onNext?: () => void
  onPrevious?: () => void
  onOpen: (target: UpNext) => void
}

const FALLBACK_FPS = 30

type CardTeaser = NonNullable<WatchMetaQuery['watch']>['cardTeasers'][number]

const captionStyle = (declarations: string) => css`
  video::cue {
    ${declarations};
  }
`

const timesUpStyle = css`
  display: flex;
  gap: 0.8rem;

  button {
    flex: 1;
    height: 3.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .add-time {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .add-time:hover {
    background: var(--bg-chip-hover);
  }

  .done {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .done:hover {
    background: var(--bg-inverse-hover);
  }
`

// Chrome sizes cues to 5% of the smaller side of the picture drawn, not of the element
const captionBase = (video: HTMLVideoElement) => {
  const picture = pictureOf(video)
  return 0.05 * Math.min(picture.width, picture.height)
}

const VideoPlayer = (
  {
    videoId, playerParams, list, title, channelName, startAt, docked = false, theater = 'default', onTheater, onMiniplayer, upNext,
    chapters, segments = [], teasers = [], cardsAvatar, ambientMode, onAmbientMode, annotations = true, onAnnotations, onVideoElement,
  }: {
    videoId: string
    playerParams?: string
    list?: string
    title?: string
    channelName?: string
    startAt?: number
    docked?: boolean
    theater?: TheaterMode
    onTheater?: () => void
    onMiniplayer?: () => void
    upNext?: PlayerUpNext
    chapters?: readonly PlayerChapter[]
    segments?: readonly SkipSegment[]
    teasers?: readonly CardTeaser[]
    cardsAvatar?: string | null
    ambientMode?: boolean
    onAmbientMode?: () => void
    annotations?: boolean
    onAnnotations?: () => void
    onVideoElement?: (video: HTMLVideoElement | null) => void
  },
) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const bindVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node
    setVideoElement(node)
    onVideoElement?.(node)
  }, [onVideoElement])
  const resumeAt = useRef(startAt ?? 0)
  const [attempt, setAttempt] = useState(0)
  const restarts = useMemo(() => createRestartBudget(), [videoId])
  const [loading, setLoading] = useState(true)
  const [hasFrame, setHasFrame] = useState(false)
  const [posterTier, setPosterTier] = useState<'maxres' | 'hq' | 'none'>('maxres')
  const [status, setStatus] = useState('')
  const [refusal, setRefusal] = useState<PlaybackRefusal | undefined>(undefined)
  const [streamRefused, setStreamRefused] = useState(false)
  const [autoMuted, setAutoMuted] = useState(false)
  const dismissAutoMuted = useCallback(() => setAutoMuted(false), [])
  const [player, setPlayer] = useState<shaka.Player | undefined>(undefined)
  const [heights, setHeights] = useState<number[]>([])
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [endScreen, setEndScreen] = useState<EndScreenElement[]>([])
  const [isLive, setIsLive] = useState(false)
  const [quality, setQuality] = useState<'auto' | number>(() => getSettings().quality)
  const qualityRef = useRef(quality)
  const selectQualityRef = useRef<((height: number | 'auto') => Promise<void>) | undefined>(undefined)
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [audioTrackId, setAudioTrackId] = useState<string | undefined>(undefined)
  const audioTrackIdRef = useRef<string | undefined>(undefined)
  const [hasDrc, setHasDrc] = useState(false)
  const hasDrcRef = useRef<((trackId?: string) => boolean) | undefined>(undefined)
  const [stableVolume, setStableVolume] = useState(() => getSettings().stableVolume)
  const stableVolumeRef = useRef(stableVolume)
  const selectAudioRef = useRef<((trackId: string | undefined, drc: boolean) => Promise<void>) | undefined>(undefined)
  const lastSettingsRef = useRef(getSettings())
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([])
  const captionTracksRef = useRef<CaptionTrack[]>([])
  captionTracksRef.current = captionTracks
  const [translationLanguages, setTranslationLanguages] = useState<TranslationLanguage[]>([])
  const translationLanguagesRef = useRef<TranslationLanguage[]>([])
  translationLanguagesRef.current = translationLanguages
  const [caption, setCaption] = useState<CaptionPick | undefined>(undefined)
  const captionRef = useRef<CaptionPick | undefined>(undefined)
  captionRef.current = caption
  const selectCaptionRef = useRef<((trackId: string | undefined, translateTo?: string) => Promise<void>) | undefined>(undefined)
  const [active, setActive] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [cancelled, setCancelled] = useState(false)
  const [bezel, setBezel] = useState<BezelCue | undefined>(undefined)
  const [shortcuts, setShortcuts] = useState(false)
  const closeShortcuts = useCallback(() => setShortcuts(false), [])
  const [loop, setLoop] = useState(false)
  const [cueStyle, setCueStyle] = useState('')
  const [captionBaseSize, setCaptionBaseSize] = useState(0)
  const [inPip, setInPip] = useState(false)
  const [sample, setSample] = useState<number | undefined>(undefined)
  const sampleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [timesUp, setTimesUp] = useState(false)
  const sleepTimerEnabled = useSetting('sleepTimerEnabled')
  const [sleepMenu, setSleepMenu] = useState(0)
  const closeTimesUp = useCallback(() => setTimesUp(false), [])
  // as on youtube.com, Escape on Time's up over a finished video also cancels the countdown to the next one
  const escapeTimesUp = useCallback(() => {
    setTimesUp(false)
    if (videoRef.current?.ended) setCancelled(true)
  }, [])
  const addTime = useCallback(() => {
    setTimesUp(false)
    setSleepMenu(value => value + 1)
  }, [])
  const nativeTransitionRef = useRef<NativeTransitionController | null>(null)
  const markExplicitPause = useCallback(() => {
    nativeTransitionRef.current?.markExplicitPause()
  }, [])
  // youtube.com's miniplayer has no Time's up: a timer that runs out there says so in a toast
  const sleepTimer = useSleepTimer(() => {
    if (!getSettings().sleepTimerEnabled) return
    markExplicitPause()
    videoRef.current?.pause()
    if (docked) showToast('Sleep timer has been turned off')
    else setTimesUp(true)
  })
  // and docking, as Back from the watch page does, closes it
  useEffect(() => {
    if (docked || !sleepTimerEnabled) setTimesUp(false)
  }, [docked, sleepTimerEnabled])
  // from the player's corner, so the menu follows the player as the page scrolls
  const [menu, setMenu] = useState<Point | undefined>(undefined)
  const closeMenu = useCallback(() => setMenu(undefined), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuAtPress = useRef(false)
  const lastPointerTypeRef = useRef('')
  const activeAtPressRef = useRef(true)
  const lastTouchAtRef = useRef(0)
  const flash = useCallback((icon: BezelCue['icon'], text?: string) => {
    setBezel(previous => ({ id: (previous?.id ?? 0) + 1, icon, text }))
  }, [])

  const state = usePlayerState(videoElement, player)
  const chapterList = chapters ?? []
  const chapterIndex = chapterIndexAt(chapterList, state.currentTime)
  useEffect(() => setPlayingChapter(chapterIndex), [chapterIndex])
  const frame = useFrame()
  const grid = frame?.grid ?? false
  const annotationsEnabled = annotations !== false
  // in full screen youtube.com opens the description beside the video, and on the page it expands the one under it
  const openCards = () => {
    if (frame?.fullscreen) frame.setAside('description')
    else revealCards()
  }
  // youtube.com moves on from a finished video only once Time's up is closed
  const held = sleepTimerEnabled && (timesUp || sleepTimer === 'end')
  const ending = state.ended && upNext
    ? endAction({ queued: !held && upNext.queued(), autoplay: upNext.autoplay, pick: upNext.pick, cancelled: cancelled || held })
    : undefined
  const onNext = upNext?.onNext
  const onPrevious = upNext?.onPrevious

  useEffect(() => {
    if (ending === 'advance') onNext?.()
  }, [ending])

  useEffect(() => {
    if (state.ended && getSettings().sleepTimerEnabled && getSleepTimer() === 'end') endSleepTimer()
  }, [state.ended])

  useEffect(() => () => clearTimeout(sampleTimer.current), [])

  // the edges follow the player's base caption size, so the look is drawn again when the picture changes size
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => {
      const base = captionBase(video)
      setCaptionBaseSize(base)
      setCueStyle(captionDeclarations(getSettings(), base))
    }
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
  }, [attempt, videoElement])

  useEffect(() => {
    if (!videoElement) {
      setInPip(false)
      return
    }
    const sync = () => setInPip(isVideoInPip(videoElement))
    sync()
    return subscribeVideoPip(videoElement, sync)
  }, [videoElement])

  const sponsors = useRef(segments)
  sponsors.current = segments
  // the parts the viewer's last seek landed in, kept across restarts, which seek too
  const excused = useRef(new Set<SkipSegment>())
  const undone = useRef<readonly SkipSegment[]>([])
  const landing = useRef(Number.NaN)
  const [skipped, setSkipped] = useState<{ from: number, to: number, parts: readonly SkipSegment[] } | undefined>(undefined)

  const skip = (video: HTMLVideoElement, to: number) => {
    const from = video.currentTime
    const at = Math.min(to, video.duration || to)
    landing.current = at
    setSkipped({ from, to: at, parts: sponsors.current.filter(part => part.start < at && part.end > from) })
    video.currentTime = at
  }

  // Undo excuses every part the skip jumped, so a chain of parts plays through rather than skipping from its second part
  const undo = () => {
    const video = videoRef.current
    if (!video || !skipped) return
    undone.current = skipped.parts
    setSkipped(undefined)
    video.currentTime = skipped.from
    void video.play().catch(() => {})
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // the start position, Shaka's jump over a gap at the start and a restart's resume all seek before the first `playing`, and only a viewer's seek plays a part
    let started = false
    const onPlaying = () => {
      started = true
    }
    const onSeeking = () => {
      const time = video.currentTime
      const own = Math.abs(time - landing.current) < CLOCK_SLACK
      landing.current = Number.NaN
      if (!started) return
      // the skip's own seek keeps its Undo and excuses nothing, and any other seek leaves the Undo behind
      excused.current = new Set([...(own ? [] : sponsors.current.filter(part => part.start <= time && time < part.end)), ...undone.current])
      undone.current = []
      if (!own) setSkipped(undefined)
    }
    const onTimeUpdate = () => {
      const to = video.seeking ? undefined : skipTarget(sponsors.current, video.currentTime, excused.current)
      if (to !== undefined) skip(video, to)
    }
    video.addEventListener('playing', onPlaying)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [attempt])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // applied BEFORE playback starts, or autoplay is attempted at volume 1 and the browser's block-then-mute fallback loses the stored volume
    const audio = getSettings()
    video.volume = audio.volume
    video.muted = audio.muted
    // loading a source puts the rate back to defaultPlaybackRate, and so does Shaka as it starts
    video.defaultPlaybackRate = audio.playbackRate
    video.playbackRate = audio.playbackRate
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let ownedSession: { api: Awaited<ReturnType<typeof startEngine>>, promise: ReturnType<Awaited<ReturnType<typeof startEngine>>['openPlayback']> } | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const restart = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      // the position a live stream had at its edge is behind the edge once it reopens
      resumeAt.current = controller?.player.isLive()
        ? liveResumeTime(controller.player.seekRange(), video.currentTime)
        : video.currentTime || resumeAt.current
      if (isStreamRefusal(error)) {
        // this try ends now, loaded or not, and nothing it still reports starts another
        abort.abort()
        const wait = restarts.refused()
        if (wait === undefined) {
          setLoading(false)
          setStatus('This video can\'t be played right now')
          setStreamRefused(true)
          console.error(error)
          return
        }
        setLoading(true)
        setStatus('')
        retryTimer = setTimeout(() => setAttempt((value) => value + 1), wait)
        return
      }
      const refused = playbackRefusal(error)
      const terminal = (error instanceof Error && error.message === LIVE_UNSUPPORTED) || refused?.final === true
      if (terminal || !restarts.spend()) {
        void controller?.destroy()
        setLoading(false)
        if (refused?.final !== true) console.error(error)
        if (refused) {
          setStatus('')
          setRefusal(refused)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setStatus(`Playback failed: ${message}`)
        return
      }
      const engineFailure = resetsEngine(error)
      retryTimer = setTimeout(() => {
        if (!abort.signal.aborted) {
          if (engineFailure) resetEngine()
          setAttempt((value) => value + 1)
        }
      }, restarts.used === 1 && !engineFailure ? 100 : 1_000)
    }
    const played = () => restarts.progress(video.currentTime)
    video.addEventListener('timeupdate', played)
    setLoading(true)
    setStatus('')
    setStreamRefused(false)
    setAutoMuted(false)
    const shakaModule = warmShaka()
    void shakaModule.catch(() => {})
    void (async () => {
      const api = await startEngine()
      if (abort.signal.aborted) return
      const settings = getSettings()
      const startTime = resumeAt.current
      const storedQuality = settings.quality
      qualityRef.current = storedQuality
      setQuality(storedQuality)
      const elementHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
      // In auto mode at t = 0, cap segment 0 at 720p so the prewarmed opening segment paints fast over WebVPN;
      // Shaka unlocks full ABR on loadeddata and steps up to 1080p/1440p cleanly on segment 1.
      const maxHeight = storedQuality !== 'auto'
        ? storedQuality
        : startTime === 0
        ? Math.min(720, elementHeight)
        : elementHeight
      const openOptions = storedQuality !== 'auto'
        ? { pinnedHeight: storedQuality, ...(startTime > 0 ? { prewarm: false } : {}) }
        : startTime > 0
        ? { prewarm: false }
        : undefined
      const sessionPromise = openOptions
        ? api.openPlayback(videoId, maxHeight, playerParams, settings.stableVolume, openOptions)
        : api.openPlayback(videoId, maxHeight, playerParams, settings.stableVolume)
      void sessionPromise.catch(() => {})
      ownedSession = { api, promise: sessionPromise }
      const { startShakaPlayback } = await shakaModule
      if (abort.signal.aborted) return
      ownedSession = undefined
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        playerParams,
        stableVolume: settings.stableVolume,
        startTime,
        maxHeight,
        pinVideoFormat: storedQuality !== 'auto',
        openOptions,
        sessionPromise,
        signal: abort.signal,
        onError: restart,
        onEndScreen: setEndScreen,
        onAutoplayMuted: () => {
          if (!abort.signal.aborted) setAutoMuted(true)
        },
      })
      if (abort.signal.aborted) return
      setLoading(false)
      setStatus('')
      registerSeek(
        videoId,
        (seconds, play) => {
          video.currentTime = seconds
          if (play) void video.play().catch(() => {})
        },
        () => video.currentTime,
      )
      setPlayer(controller.player)
      setHeights(controller.heights)
      setStoryboards(controller.storyboards)
      setIsLive(controller.isLive)
      selectQualityRef.current = controller.selectQuality
      setAudioTracks(controller.audioTracks)
      setAudioTrackId(controller.audioTrackId)
      audioTrackIdRef.current = controller.audioTrackId
      hasDrcRef.current = controller.hasDrc
      setHasDrc(controller.hasDrc(controller.audioTrackId))
      selectAudioRef.current = controller.selectAudio
      setCaptionTracks(controller.captionTracks)
      setTranslationLanguages(controller.translationLanguages)
      selectCaptionRef.current = controller.selectCaption
      const wanted = startingCaption(controller.captionTracks, controller.translationLanguages, getSettings(), navigator.language)
      setCaption(wanted)
      if (wanted) {
        const selectCaption = controller.selectCaption
        void selectCaption(wanted.trackId, wanted.translateTo).catch(() => {
          if (!wanted.translateTo) {
            setCaption((current) => (current?.trackId === wanted.trackId && !current.translateTo ? undefined : current))
            return
          }
          // if a remembered Auto-translate is refused, open on its source track instead of leaving captions off
          const fallback: CaptionPick = { trackId: wanted.trackId }
          setCaption((current) => (
            current?.trackId === wanted.trackId && current.translateTo === wanted.translateTo ? fallback : current
          ))
          void selectCaption(fallback.trackId).catch(() => {
            setCaption((current) => (current?.trackId === fallback.trackId && !current.translateTo ? undefined : current))
          })
        })
      }
    })().catch((error) => {
      if (!abort.signal.aborted) restart(error)
    })
    return () => {
      abort.abort()
      video.removeEventListener('timeupdate', played)
      clearTimeout(retryTimer)
      clearSeek(videoId)
      setPlayer(undefined)
      setHeights([])
      setStoryboards([])
      setEndScreen([])
      setIsLive(false)
      setAudioTracks([])
      setAudioTrackId(undefined)
      audioTrackIdRef.current = undefined
      hasDrcRef.current = undefined
      setHasDrc(false)
      selectAudioRef.current = undefined
      setCaption(undefined)
      setCaptionTracks([])
      setTranslationLanguages([])
      selectCaptionRef.current = undefined
      setAutoMuted(false)
      if (ownedSession) {
        const { api, promise } = ownedSession
        void promise.then((session) => api.closePlayback(session.id)).catch(() => {})
      }
      void controller?.destroy()
    }
  }, [attempt, videoId, playerParams])

  const applyQuality = useCallback((value: 'auto' | number) => {
    qualityRef.current = value
    setQuality(value)
    updateSettings({ quality: value })
    void selectQualityRef.current?.(value).catch(() => {})
  }, [])

  useEffect(() => subscribeSettings((next) => {
    const prev = lastSettingsRef.current
    lastSettingsRef.current = next
    if (next.quality !== qualityRef.current) {
      qualityRef.current = next.quality
      setQuality(next.quality)
      void selectQualityRef.current?.(next.quality).catch(() => {})
    }
    if (next.stableVolume !== stableVolumeRef.current) {
      stableVolumeRef.current = next.stableVolume
      setStableVolume(next.stableVolume)
      void selectAudioRef.current?.(audioTrackIdRef.current, next.stableVolume).catch(() => {})
    }
    const sync = planPlayerSettingsSync(prev, next, { hasCaption: Boolean(captionRef.current) })
    const el = videoRef.current
    if (el) {
      if (sync.playbackRate !== undefined && (el.playbackRate !== sync.playbackRate || el.defaultPlaybackRate !== sync.playbackRate)) {
        el.defaultPlaybackRate = sync.playbackRate
        el.playbackRate = sync.playbackRate
      }
      if (sync.volume !== undefined && Math.abs(el.volume - sync.volume) > 0.001) el.volume = sync.volume
      if (sync.muted !== undefined && el.muted !== sync.muted) el.muted = sync.muted
      if (sync.clearAutoMuted) setAutoMuted(false)
    }
    if (sync.captionAction === 'disable') {
      captionRef.current = undefined
      setCaption(undefined)
      void selectCaptionRef.current?.(undefined).catch(() => {})
    } else if (sync.captionAction === 'enable-default') {
      const wanted = startingCaption(captionTracksRef.current, translationLanguagesRef.current, next, navigator.language)
      if (wanted) {
        captionRef.current = wanted
        setCaption(wanted)
        void selectCaptionRef.current?.(wanted.trackId, wanted.translateTo).catch(() => {})
      }
    }
  }), [])

  const applyAudioTrack = useCallback((trackId: string) => {
    setAudioTrackId(trackId)
    audioTrackIdRef.current = trackId
    setHasDrc(hasDrcRef.current?.(trackId) ?? false)
    void selectAudioRef.current?.(trackId, stableVolumeRef.current).catch(() => {})
  }, [])

  const applyStableVolume = useCallback((value: boolean) => {
    updateSettings({ stableVolume: value })
  }, [])

  // stores the LANGUAGE rather than the track id, since ids are per video and the next video would not recognize one
  const applyCaption = useCallback((next: CaptionPick | undefined) => {
    if (!next) {
      captionRef.current = undefined
      setCaption(undefined)
      updateSettings({ captionsEnabled: false })
      void selectCaptionRef.current?.(undefined).catch(() => {})
      return
    }
    if (next.translateTo) {
      void selectCaptionRef.current?.(next.trackId, next.translateTo).then(
        () => {
          captionRef.current = next
          setCaption(next)
          updateSettings({ captionsEnabled: true, captionsLanguage: next.translateTo })
        },
        () => {
          showToast('Auto-translate is not available right now')
        },
      )
      return
    }
    captionRef.current = next
    setCaption(next)
    const picked = captionTracks.find((track) => track.id === next.trackId)
    if (picked) updateSettings({ captionsEnabled: true, captionsLanguage: picked.languageCode })
    void selectCaptionRef.current?.(next.trackId).catch(() => {
      setCaption((current) => (current?.trackId === next.trackId && !current.translateTo ? undefined : current))
      showToast('Subtitles are not available for this video right now')
    })
  }, [captionTracks])

  // remembering the last pick is what makes c and the CC button a toggle rather than a reset
  const lastCaption = useRef<CaptionPick | undefined>(undefined)
  if (caption) lastCaption.current = caption
  const toggleCaption = () => {
    if (caption) return applyCaption(undefined)
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
  }

  const wake = useCallback(() => {
    setActive(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS)
  }, [])

  const hideControls = useCallback(() => {
    clearTimeout(idleTimer.current)
    setActive(false)
  }, [])

  useEffect(() => {
    if (shouldAutoHideControlsOnLoad(typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window))) wake()
    return () => clearTimeout(idleTimer.current)
  }, [videoId, wake])

  // the menu is drawn on the fullscreen element or the body, so a switch between the two would strand it
  useEffect(() => subscribeFullscreen(closeMenu, videoElement), [closeMenu, videoElement])

  const onContextMenu = (event: MouseEvent) => {
    // a second right-click gets the browser's own menu, as on youtube.com
    const second = menuAtPress.current
    menuAtPress.current = false
    if (second) return
    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: event.clientX - box.left, y: event.clientY - box.top })
  }

  // at a limit youtube.com changes nothing and shows no sample; otherwise the size changes, captions on or off, and a
  // sample of it shows unless a cue on screen already does
  const resizeCaptions = (direction: 1 | -1) => {
    const video = videoRef.current
    const current = getSettings().captionSize
    const size = stepCaptionSize(current, direction)
    if (!video || size === current) return
    updateSettings({ captionSize: size })
    const cueShown = [...video.textTracks].some(track => track.mode === 'showing' && (track.activeCues?.length ?? 0) > 0)
    setSample(cueShown ? undefined : captionBase(video) * size / 100)
    clearTimeout(sampleTimer.current)
    sampleTimer.current = setTimeout(() => setSample(undefined), CAPTION_SAMPLE_MS)
  }

  // read at key time, so the listener is bound once rather than on every rendered frame
  const latest = useRef({ docked, grid, isLive, onTheater, onNext, onPrevious, onMiniplayer, toggleCaption, resizeCaptions, player, shortcuts, timesUp, chapterList })
  latest.current = { docked, grid, isLive, onTheater, onNext, onPrevious, onMiniplayer, toggleCaption, resizeCaptions, player, shortcuts, timesUp, chapterList }

  const handleWheelVolume = useCallback((next: { volume: number, muted: boolean }) => {
    wake()
    flash(next.muted ? 'mute' : 'volume', `${Math.round(next.volume * 100)}%`)
  }, [wake, flash])

  // Re-run on videoElement change so metadata is restored if <video> remounts after bindMediaSession's cleanup clears it.
  useEffect(() => {
    updateMediaSessionMetadata({ videoId, title, artist: channelName })
  }, [videoElement, videoId, title, channelName])

  useEffect(() => {
    if (!videoElement) return
    const controller = bindNativeTransitionResume({ video: videoElement, doc: document })
    nativeTransitionRef.current = controller
    return () => {
      if (nativeTransitionRef.current === controller) nativeTransitionRef.current = null
      controller.destroy()
    }
  }, [videoElement])

  const hasNext = Boolean(onNext)
  const hasPrevious = Boolean(onPrevious)
  useEffect(() => {
    if (!videoElement) return
    const target = {
      get paused () {
        return videoElement.paused
      },
      get currentTime () {
        return videoElement.currentTime
      },
      set currentTime (value: number) {
        videoElement.currentTime = value
      },
      get duration () {
        return videoElement.duration
      },
      get playbackRate () {
        return videoElement.playbackRate
      },
      get isLive () {
        return latest.current.isLive
      },
      play: () => videoElement.play(),
      pause: () => videoElement.pause(),
      fastSeek: typeof videoElement.fastSeek === 'function' ? (time: number) => videoElement.fastSeek(time) : undefined,
      seekRange: () => seekWindow(videoElement, latest.current.player),
    }
    const unbind = bindMediaSession(target, {
      onUserPause: markExplicitPause,
    })
    const sync = () => syncMediaSessionState(target)
    const events = ['play', 'playing', 'pause', 'ratechange', 'seeked', 'durationchange', 'loadedmetadata'] as const
    for (const event of events) videoElement.addEventListener(event, sync)
    return () => {
      for (const event of events) videoElement.removeEventListener(event, sync)
      unbind()
    }
  }, [videoElement, markExplicitPause])

  // Must remain declared after bindMediaSession: Preact runs cleanups before effects in declaration order,
  // so track handlers update cleanly without tearing down metadata or playbackState when hasNext/hasPrevious flip.
  useEffect(() => {
    if (!videoElement) return
    setMediaSessionTrackHandlers({
      onPrevious: hasPrevious ? () => latest.current.onPrevious?.() : undefined,
      onNext: hasNext ? () => latest.current.onNext?.() : undefined,
    })
  }, [videoElement, hasNext, hasPrevious])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current
      if (!video || event.defaultPrevented || isTypingTarget(event.target)) return
      const actions = latest.current
      if (actions.shortcuts || actions.timesUp) return
      const key = event.key
      const handled = () => {
        event.preventDefault()
        wake()
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        const to = chapterStep(actions.chapterList, video.currentTime, key === 'ArrowRight' ? 1 : -1)
        if (to === undefined) return
        handled()
        video.currentTime = to
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // a live stream's keys seek through its DVR window, as youtube.com's do
      const range = seekWindow(video, actions.player)
      const seekBy = (delta: number) => {
        video.currentTime = clampToWindow(range, video.currentTime + delta)
        flash(delta < 0 ? 'back' : 'forward', String(Math.abs(delta)))
      }
      const stepVolume = (steps: number) => {
        const next = stepVideoVolume(video, steps)
        updateSettings(next)
        flash(next.muted ? 'mute' : 'volume', `${Math.round(next.volume * 100)}%`)
      }
      const stepFrame = (direction: 1 | -1) => {
        const fps = actions.player?.getVariantTracks().find(track => track.active)?.frameRate || FALLBACK_FPS
        video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + direction / fps))
      }
      switch (key) {
        case ' ':
        case 'k':
          handled()
          if (video.paused) {
            void video.play().catch(() => {})
            flash('play')
          } else {
            markExplicitPause()
            video.pause()
            flash('pause')
          }
          return
        case 'ArrowLeft': handled(); seekBy(-SEEK_STEP); return
        case 'ArrowRight': handled(); seekBy(SEEK_STEP); return
        case 'j': handled(); seekBy(-JUMP_STEP); return
        case 'l': handled(); seekBy(JUMP_STEP); return
        case 'ArrowUp': handled(); stepVolume(1); return
        case 'ArrowDown': handled(); stepVolume(-1); return
        case 'm': {
          handled()
          const next = toggleVideoMute(video)
          updateSettings(next)
          flash(next.muted ? 'mute' : 'volume')
          return
        }
        case 'c':
          handled()
          actions.toggleCaption()
          return
        case '+':
        case '=':
        case '-':
        case '_':
          // the numpad's + and - zoom a 360 video on youtube.com rather than size the captions
          if (event.code.startsWith('Numpad')) return
          handled()
          actions.resizeCaptions(key === '+' || key === '=' ? 1 : -1)
          return
        case '<':
        case '>': {
          handled()
          const rate = stepRate(video.playbackRate, key === '>' ? 1 : -1)
          video.playbackRate = rate
          updateSettings({ playbackRate: rate })
          flash('speed', `${rate}x`)
          return
        }
        case ',':
        case '.':
          if (!video.paused) return
          handled()
          stepFrame(key === '.' ? 1 : -1)
          return
        // youtube.com's miniplayer has no full screen or theater, and Escape closes it
        case 'f':
          if (actions.docked) return
          handled()
          requestPlayerFullscreen(video)
          return
        case 't':
          if (actions.docked) return
          handled()
          actions.onTheater?.()
          return
        case 'Escape':
          if (!actions.docked) return
          handled()
          closePlayer()
          return
        case 'i':
          if (!actions.onMiniplayer) return
          handled()
          actions.onMiniplayer()
          return
        case '?':
          handled()
          setShortcuts(true)
          return
        case 'N':
          if (!event.shiftKey || !actions.onNext) return
          handled()
          actions.onNext()
          return
        case 'P':
          if (!event.shiftKey || !actions.onPrevious) return
          handled()
          actions.onPrevious()
          return
        case 'Home': handled(); video.currentTime = range.start; return
        case 'End': handled(); video.currentTime = range.end; return
        default:
          if (/^[0-9]$/.test(key) && range.end > range.start) {
            handled()
            video.currentTime = timeAtShare(range, Number(key) / 10)
          }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [wake, flash])

  const video = videoElement
  const showSpinner = !status && !refusal && (loading || (Boolean(player) && (state.buffering || state.seeking)))
  const posterUrl = !hasFrame && !status && !refusal && posterTier !== 'none'
    ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${posterTier === 'maxres' ? 'maxresdefault' : 'hqdefault'}.jpg`
    : undefined
  const time = state.currentTime
  const undoable = skipped !== undefined && time > skipped.to - CLOCK_SLACK && time < skipped.to + SPONSOR_NOTICE
  const upcoming = undoable
    ? undefined
    : segments.find(part => !excused.current.has(part) && part.start > time && part.start - time <= SPONSOR_NOTICE)

  const playerClasses = [
    !active && !state.paused && !menu && !grid ? 'idle' : undefined,
    !inPip ? 'custom-captions' : undefined,
  ].filter(Boolean).join(' ') || undefined

  const togglePlay = () => {
    const current = videoRef.current
    // a click that closes the menu only closes it, as on youtube.com
    if (!current || menuAtPress.current) return
    if (current.paused) {
      void current.play().catch(() => {})
      flash('play')
    } else {
      markExplicitPause()
      current.pause()
      flash('pause')
    }
  }
  const onSurfaceClick = (event: MouseEvent) => {
    const pointerType = ('pointerType' in event && typeof event.pointerType === 'string' && event.pointerType)
      || lastPointerTypeRef.current
    lastPointerTypeRef.current = ''
    const action = decideSurfaceClick({
      pointerType,
      activeAtPress: activeAtPressRef.current,
      paused: Boolean(videoRef.current?.paused),
      settingsOpen,
      menuAtPress: menuAtPress.current,
    })
    if (action === 'ignore') return
    if (action === 'show-controls') {
      wake()
      return
    }
    if (action === 'hide-controls') {
      hideControls()
      return
    }
    togglePlay()
  }
  const onSurfaceDoubleClick = docked ? undefined : () => {
    if (Date.now() - lastTouchAtRef.current < 500) return
    requestPlayerFullscreen(videoRef.current)
  }

  return (
    <div
      css={[playerStyle, captionStyle(cueStyle)]}
      data-player-surface
      className={playerClasses}
      onPointerMove={(event: PointerEvent) => {
        if (!shouldIgnoreHoverPointer(event.pointerType)) wake()
      }}
      onPointerLeave={(event: PointerEvent) => {
        if (!shouldIgnoreHoverPointer(event.pointerType)) setActive(false)
      }}
      onPointerCancel={() => {
        lastPointerTypeRef.current = ''
      }}
      onPointerDown={(event: PointerEvent) => {
        menuAtPress.current = menu !== undefined
        lastPointerTypeRef.current = event.pointerType
        activeAtPressRef.current = active
        if (isTouchPointer(event.pointerType)) {
          lastTouchAtRef.current = Date.now()
          if (
            active
            && !(event.target instanceof HTMLVideoElement)
            && !(event.target instanceof Element && event.target.closest('[data-caption-window]'))
          ) {
            wake()
          }
        }
      }}
      onContextMenu={onContextMenu}
    >
      <AmbientBars
        video={video}
        enabled={ambientMode !== false}
        fullscreen={frame?.fullscreen ?? false}
        docked={docked}
        hasFrame={hasFrame}
        blocked={Boolean(status || refusal)}
      />
      {posterUrl
        ? (
          <img
            className='poster'
            src={posterUrl}
            alt=''
            aria-hidden='true'
            referrerpolicy='no-referrer'
            onLoad={(event: TargetedEvent<HTMLImageElement>) => {
              // youtube serves a 120x90 gray placeholder when maxresdefault does not exist
              if (posterTier === 'maxres' && event.currentTarget.naturalWidth <= 120) setPosterTier('hq')
            }}
            onError={() => setPosterTier(tier => tier === 'maxres' ? 'hq' : 'none')}
          />
        )
        : undefined}
      <video
        key={attempt}
        ref={bindVideo}
        playsInline
        preload='auto'
        loop={loop}
        onLoadedData={() => setHasFrame(true)}
        onPlaying={() => setHasFrame(true)}
        onClick={onSurfaceClick}
        onDblClick={onSurfaceDoubleClick}
      />
      {showSpinner ? <div className='spinner' /> : undefined}
      {video && !inPip && !status && !refusal
        ? (
          <CaptionOverlay
            video={video}
            cueStyle={cueStyle}
            baseSize={captionBaseSize}
            controlsVisible={(active || state.paused || settingsOpen) && !grid}
            docked={docked}
            sample={sample}
            onDragStart={wake}
            onClick={onSurfaceClick}
            onDblClick={onSurfaceDoubleClick}
          />
        )
        : undefined}
      {bezel ? <Bezel key={bezel.id} cue={bezel} /> : undefined}
      {status
        ? (
          <div className='playback-status'>
            {status}
            {streamRefused
              ? (
                <button
                  type='button'
                  className='playback-retry'
                  onClick={() => {
                    restarts.reset()
                    setAttempt((value) => value + 1)
                  }}
                >
                  Retry
                </button>
              )
              : undefined}
          </div>
        )
        : undefined}
      {refusal ? <RefusalScreen refusal={refusal} /> : undefined}
      {video && autoMuted && !docked && !status && !refusal
        ? <AudioPermissionPrompt video={video} onDismiss={dismissAutoMuted} />
        : undefined}
      {video && player && !status && !refusal && annotationsEnabled && endScreen.length > 0
        ? (
          <EndScreenElements
            elements={endScreen}
            video={video}
            time={time}
            ended={state.ended}
            docked={docked}
            underCards={teasers.length > 0}
            onOpen={upNext?.onOpen}
          />
        )
        : undefined}
      {video && player && !status && !refusal && !docked && annotationsEnabled && teasers.length > 0
        ? (
          <InfoCards
            teasers={teasers}
            avatar={cardsAvatar}
            time={time}
            shown={(active || state.paused) && !grid}
            ended={state.ended}
            onOpen={openCards}
          />
        )
        : undefined}
      {upNext && ending === 'countdown' && upNext.pick
        ? <UpNextCountdown target={upNext.pick} onOpen={upNext.onOpen} onCancel={() => setCancelled(true)} />
        : upNext && ending === 'suggestions' && upNext.suggestions.length > 0
          ? <EndScreen videos={upNext.suggestions} onOpen={upNext.onOpen} />
          : undefined}
      {docked
        ? (
          <MiniplayerControls
            video={video && !status && !refusal ? video : undefined}
            state={state}
            isLive={isLive}
            onExpand={onMiniplayer}
            onUserPause={markExplicitPause}
            onVolumeChange={handleWheelVolume}
          />
        )
        : undefined}
      {video && !status && !refusal
        ? (
          <>
            <PartyPlayback video={video} videoId={videoId} isLive={isLive} docked={docked} onUserPause={markExplicitPause} />
            <PlayerControls
            video={video}
            player={player}
            state={state}
            heights={heights}
            storyboards={storyboards}
            quality={quality}
            onQuality={applyQuality}
            audioTracks={audioTracks}
            audioTrackId={audioTrackId}
            onAudioTrack={applyAudioTrack}
            hasDrc={hasDrc}
            stableVolume={stableVolume}
            onStableVolume={applyStableVolume}
            ambientMode={ambientMode}
            onAmbientMode={onAmbientMode}
            annotations={annotationsEnabled}
            onAnnotations={onAnnotations}
            captionTracks={captionTracks}
            translationLanguages={translationLanguages}
            caption={caption}
            onCaption={applyCaption}
            onToggleCaption={toggleCaption}
            theater={theater}
            onTheater={() => onTheater?.()}
            onNext={onNext}
            autoplay={upNext?.autoplay}
            onAutoplay={upNext?.onAutoplay}
            isLive={isLive}
            chapters={chapters}
            onChapters={() => setPanel('chapters')}
            segments={segments}
            sleepTimer={sleepTimerEnabled ? sleepTimer : undefined}
            sleepMenu={sleepMenu}
            docked={docked}
            visible={(active || state.paused) && !grid}
            onMenu={setSettingsOpen}
            onUserPause={markExplicitPause}
            onWheelVolumeChange={handleWheelVolume}
            />
          </>
        )
        : undefined}
      {video && player && !status && !refusal && undoable
        ? <button type='button' className='sponsor-skip' onClick={undo}>Undo</button>
        : video && player && !status && !refusal && upcoming
          ? (
            <button
              type='button'
              className='sponsor-skip'
              onClick={() => skip(video, skipTarget(segments, upcoming.start, excused.current) ?? upcoming.end)}
            >
              Skip sponsor
            </button>
          )
          : undefined}
      {frame?.fullscreen && frame.view
        ? <frame.view.FullscreenView shown={active || state.paused || settingsOpen} settings={settingsOpen} />
        : undefined}
      {video && menu
        ? (
          <PlayerMenu
            at={() => {
              const box = video.closest('[data-player-root]')!.getBoundingClientRect()
              return { x: box.left + menu.x, y: box.top + menu.y }
            }}
            onClose={closeMenu}
            video={video}
            videoId={videoId}
            list={list}
            title={title}
            loop={loop}
            onLoop={() => setLoop(value => !value)}
            onMiniplayer={docked || getFullscreenElement() ? undefined : onMiniplayer}
            onCopied={flash}
          />
        )
        : undefined}
      {shortcuts ? createPortal(<ShortcutsDialog onClose={closeShortcuts} />, document.body) : undefined}
      {sleepTimerEnabled && timesUp
        ? createPortal(
          <Dialog title={'Time\'s up'} onClose={closeTimesUp} onEscape={escapeTimesUp} closeButton={false}>
            <div css={timesUpStyle}>
              <button type='button' className='add-time' onClick={addTime}>Add time</button>
              <button type='button' className='done' onClick={closeTimesUp}>Close</button>
            </div>
          </Dialog>,
          getFullscreenElement() ?? document.body,
        )
        : undefined}
    </div>
  )
}

export default VideoPlayer
