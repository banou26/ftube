import type { TargetedKeyboardEvent } from 'preact'

import { css } from '@emotion/react'
import { Captions, CaptionsOff, Radio, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link, useLocation } from 'wouter'

import type { AudioTrack, CaptionTrack, Storyboard } from '../frame/protocol'
import type { StoryboardFrame } from '../frame/storyboard'
import type { SeekHandle } from '../theme/seek-handle'

import { detectVideoLanguage, languageMatches, preferredTrack } from '../frame/captions'
import { bestStoryboard, storyboardFrame } from '../frame/storyboard'

import { startEngine } from '../engine/client'
import { getSettings, useSetting } from '../settings'
import { claimPreviewAudio, releasePreviewAudio, reservePreviewAudio } from './audio-coordinator'
import { cardState } from './card-params'
import { clock } from './controls'
import { computeHoverDwellMs } from './hover-dwell'
import { warmShaka } from './prefetch'
import { previewSeekStep } from './preview-seek'
import { SeekKnob } from './seek-knob'
import { bindSmoothPlaybackLoop } from './smooth-progress'

import type { startShakaPlayback } from './shaka'

// only ONE preview can be live at a time: module scope because no single card can know about the others
let activeToken = 0

// previews render inside small cards, so capping height avoids 720p segments on HiDPI displays
const PREVIEW_MAX_HEIGHT = 360
const PREVIEW_BUFFER_GOAL = 10

// carried between previews and deliberately NOT persisted: a feed may never start talking on its own
let preferMuted = true

/** Resets in-session preview mute preference (intended for tests). */
export const resetHoverPreviewState = () => {
  preferMuted = true
}

// Manual CC toggle chooses the preferred track (without video-language skip suppression).
const previewCaption = (tracks: CaptionTrack[]) =>
  preferredTrack(tracks, getSettings().captionsLanguage ?? navigator.language)

// Preview autoplay respects video-language subtitle skip preferences alongside preferred language.
const startingPreviewCaption = (tracks: CaptionTrack[], audioTracks: readonly AudioTrack[]) => {
  const currentSettings = getSettings()
  const videoLanguage = detectVideoLanguage(audioTracks, tracks)
  if (videoLanguage && currentSettings.captionsSkipLanguages.some((entry) => languageMatches(videoLanguage, entry))) {
    return undefined
  }
  return previewCaption(tracks)
}

// Keep corner buttons and the scrubber isolated from the painted surface link underneath.
const guard = (event: Event) => {
  event.preventDefault()
  event.stopPropagation()
}

// a preview that has played or been moved this far opens the video where it is, not at 0:00
const CARRY_SECONDS = 10

// a card wants the largest sheet that FITS, not the sharpest one `bestStoryboard` picks
const previewStoryboard = (boards: Storyboard[], stripWidth: number) => {
  const fitting = boards.filter((board) => board.thumbnailWidth <= stripWidth * 0.6)
  if (fitting.length) return bestStoryboard(fitting)
  return boards.reduce<Storyboard | undefined>(
    (best, board) => (!best || board.thumbnailWidth < best.thumbnailWidth ? board : best),
    undefined,
  )
}

/** Styling shared by inline card video previews and their scrubber overlay. */
export const hoverPreviewStyle = css`
  position: absolute;
  inset: 0;
  background: #000;
  /* Above the card's own thumbnail overlays.

     The duration badge and the resume bar are siblings drawn AFTER this one, and
     the resume bar is deliberately last so it wins wherever the two overlap. It
     therefore also won over the scrubber: both sit flush to the bottom edge, the
     resume bar is 4px and the scrubber's visible track is the bottom 3px of its
     strip, so the track was painted UNDER a bar of the same brand red. What the
     reader saw was a scrubber; what the pointer hit was a span with no handler,
     so dragging it did nothing. The preview covers the whole thumbnail anyway,
     so it owns this box while it is up. */
  z-index: 1;

  /* Held invisible until the video actually has a frame to show.

     This box is opaque black and it covers the thumbnail from the moment it
     mounts, so every millisecond of session setup was painted as a black
     rectangle where a picture used to be, which reads as the card breaking
     rather than as the card loading. Fading the preview IN is the same thing as
     fading the thumbnail OUT, and it needs no second element and no
     coordination with the card: the still is simply still there, underneath.

     It also fixes the failure case. A preview that never produces a frame now
     leaves the thumbnail up forever instead of leaving a black hole, which is
     the behaviour the silent-failure design already asked for everywhere else
     in this file. */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;

  &[data-painted] {
    opacity: 1;
  }

  &[data-painted] .preview-surface-link,
  &[data-painted] .corner,
  &[data-painted] .scrubber:not(.live) {
    pointer-events: auto;
  }

  .preview-surface-link {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: block;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* the browser sizes cues to 5% of the element's height, which is 14 px on a 500 px card */
  video::cue {
    font-size: 1.8rem;
    background: rgba(8, 8, 8, 0.75);
  }

  /* The grab area is deliberately several times the height of the bar it draws.
     A 3px track on the last pixels of a thumbnail is not a pointer target at
     any card size, so the strip reaches well above the line and the line itself
     sits at the bottom of it. */
  .scrubber {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    height: 2.4rem;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    touch-action: none;
  }

  .scrubber:focus-visible {
    outline: 2px solid var(--accent-focus, var(--accent));
    outline-offset: -2px;
  }

  .scrubber .track {
    position: relative;
    width: 100%;
    height: 0.4rem;
    overflow: visible;
    background: rgba(255, 255, 255, 0.3);
    transition: height 0.12s ease;
  }

  /* Thickens under the pointer, so the thing being aimed at confirms the aim
     before the press rather than after it. */
  .scrubber:hover .track {
    height: 0.6rem;
  }

  .scrubber:focus-visible .track {
    height: 0.5rem;
  }

  /* Buffered sits UNDER played and over the track, the same three-layer stack
     the watch controls use, so the bar reads as "have it / played it / neither"
     rather than as one bar that only knows about the playhead. */
  .buffered {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(255, 255, 255, 0.5);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--brand-red);
    transition: width 80ms linear;
  }

  .scrubber.scrubbing .fill {
    transition: none;
  }

  /* hidden at rest, as youtube.com's playhead dot is */
  .knob {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0;
    transition: left 80ms linear, opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .scrubber:hover .knob,
  .scrubber:focus-visible .knob,
  .scrubber.scrubbing .knob {
    opacity: 1;
  }

  .scrubber.scrubbing .knob {
    transition: opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .scrubber.scrubbing .track {
    height: 0.6rem;
  }

  .scrubber .knob[data-seek-handle='default'] {
    top: auto;
    bottom: 0;
    transform: translateX(-50%);
  }

  /* Custom emoji/icon handles stay visible above the bottom-flush track inside the card's overflow: hidden. */
  .scrubber .knob[data-seek-handle='emoji'],
  .scrubber .knob[data-seek-handle='icon'] {
    top: auto;
    bottom: calc(100% - 0.05rem);
    opacity: 1;
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
    .track,
    .fill,
    .knob {
      transition: none;
    }
  }

  /* a storyboard tile scaled up to the whole preview while a drag is held, the video seeking only on release */
  .scrub-frame {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    background-color: #000;
    background-repeat: no-repeat;
    pointer-events: none;
  }

  .scrub-time {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    transform: translate(-50%, -50%);
    padding: 0 1.2rem;
    border-radius: 1.6rem;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 3.2rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  /* Storyboard scrub preview: the sheet frame plus its timestamp, centred on
     the pointer and clamped inside the card. Identical treatment to the watch
     scrubber (white border, time underneath) because it is the same gesture. */
  .preview {
    position: absolute;
    bottom: 100%;
    margin-bottom: 0.6rem;
    transform: translateX(-50%);
    pointer-events: none;
    text-align: center;
  }

  .preview-frame {
    border: 2px solid #ffffff;
    border-radius: 0.4rem;
    background-color: #000;
    background-repeat: no-repeat;
  }

  .preview-time {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px #000;
  }

  .time {
    position: absolute;
    right: 0.8rem;
    bottom: 0.8rem;
    z-index: 2;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .time.live {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    background: var(--brand-red);
  }

  .scrubber.live {
    pointer-events: none;
  }

  .corner {
    position: absolute;
    top: 0.8rem;
    right: 0.8rem;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .corner button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
  }

  .corner button:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  .corner button:focus-visible {
    outline: 2px solid var(--accent-focus, var(--accent));
    outline-offset: 2px;
  }
`

export type HoverPreviewScrubberProps = {
  seekHandle: SeekHandle
  position: number
  buffered: number
  scrubbing: boolean
  duration?: number
  currentTime?: number
  hover?: { time: number }
  frame?: StoryboardFrame
  previewLeft?: number
  onPointerLeave?: () => void
  onPointerDown?: (event: PointerEvent) => void
  onPointerMove?: (event: PointerEvent) => void
  onPointerUp?: (event: PointerEvent) => void
  onPointerCancel?: () => void
  onClick?: (event: Event) => void
  onSeekTime?: (time: number) => void
}

/** Interactive progress bar and seek knob rendered along the bottom edge of a card preview. */
export const HoverPreviewScrubber = (
  {
    seekHandle,
    position,
    buffered,
    scrubbing,
    duration,
    currentTime,
    hover,
    frame,
    previewLeft = 0,
    onPointerLeave,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    onSeekTime,
  }: HoverPreviewScrubberProps,
) => {
  const effectiveDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : 100
  const effectiveTime = currentTime !== undefined && Number.isFinite(currentTime)
    ? Math.max(0, Math.min(effectiveDuration, currentTime))
    : Math.max(0, Math.min(effectiveDuration, position * effectiveDuration))
  return (
    <div
      className={scrubbing ? 'scrubber scrubbing' : 'scrubber'}
      role='slider'
      tabIndex={0}
      aria-label='Seek preview'
      aria-orientation='horizontal'
      aria-valuemin={0}
      aria-valuemax={Math.round(effectiveDuration)}
      aria-valuenow={Math.round(effectiveTime)}
      aria-valuetext={duration && duration > 0 ? `${clock(effectiveTime)} of ${clock(effectiveDuration)}` : undefined}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onKeyDown={(event: TargetedKeyboardEvent<HTMLDivElement>) => {
        if (event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const next = previewSeekStep(effectiveTime, effectiveDuration, event.key, event.shiftKey)
        if (next === undefined) return
        event.preventDefault()
        event.stopPropagation()
        onSeekTime?.(next)
      }}
    >
      <div className='track'>
        <div className='buffered' style={{ width: `${Math.round(buffered * 100)}%` }} />
        <div className='fill' style={{ width: `${position * 100}%` }} />
        <SeekKnob
          handle={seekHandle}
          size={14}
          style={{
            // Clamping non-default handles prevents edge clipping on preview cards while trading exact end alignment with .fill.
            left: seekHandle.kind === 'default'
              ? `${position * 100}%`
              : `clamp(1.4rem, ${position * 100}%, calc(100% - 1.4rem))`,
          }}
        />
      </div>
      {hover && !scrubbing
        ? (
          <div className='preview' style={{ left: `${previewLeft}px` }}>
            {frame
              ? (
                <div
                  className='preview-frame'
                  style={{
                    width: `${frame.width}px`,
                    height: `${frame.height}px`,
                    backgroundImage: `url("${frame.url}")`,
                    backgroundPosition: `-${frame.x}px -${frame.y}px`,
                  }}
                />
              )
              : undefined}
            <div className='preview-time'>{clock(hover.time)}</div>
          </div>
        )
        : undefined}
    </div>
  )
}

/**
 * A muted inline preview drawn over a card thumbnail.
 *
 * Mounted only while the pointer is dwelling on the card. Failure is silent by
 * design: this is a hover affordance over a thumbnail that is already correct,
 * so an error card in its place would be worse than no preview.
 *
 * `href` is the card's own watch link. When `carryTime` is true (default), a plain
 * click on the playing preview opens it at the preview's position once that is
 * past CARRY_SECONDS; a live preview opens at the stream's edge. Pass `carryTime={false}`
 * for `/shorts/` links so the tile's route link keeps navigation state intact.
 * `playerParams`, when present, are the card's inline playback params, which the preview's
 * watch page is read with, as youtube.com reads its own.
 */
export const HoverPreview = (
  { videoId, href, playerParams, carryTime = true, linkState, immediate = false, onFail }: {
    videoId: string
    href: string
    playerParams?: string
    carryTime?: boolean
    linkState?: unknown
    immediate?: boolean
    onFail?: () => void
  },
) => {
  const [, navigate] = useLocation()
  const seekHandle = useSetting('seekHandle')
  const videoRef = useRef<HTMLVideoElement>(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const [time, setTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [ready, setReady] = useState(false)
  const [live, setLive] = useState(false)
  const [painted, setPainted] = useState(false)
  const [muted, setMuted] = useState(preferMuted)
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([])
  const [caption, setCaption] = useState<string | undefined>()
  const selectCaption = useRef<(trackId: string | undefined) => Promise<void>>(undefined)
  const [hover, setHover] = useState<{ x: number, width: number, time: number } | undefined>()
  const [scrub, setScrub] = useState<{ ratio: number, width: number, height: number } | undefined>()
  const tokenRef = useRef(0)
  const forceMuteRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const token = ++activeToken
    tokenRef.current = token
    const abort = new AbortController()
    let isPainted = false
    let failed = false
    const forceMute = () => {
      video.muted = true
      preferMuted = true
      setMuted(true)
    }
    forceMuteRef.current = forceMute
    const syncPreviewAudio = () => {
      if (abort.signal.aborted || token !== activeToken) return
      setMuted(video.muted)
      if (!video.paused && !video.ended && !video.muted && video.volume > 0) {
        claimPreviewAudio(token, forceMute)
      } else {
        releasePreviewAudio(token)
      }
    }
    const notifyFailed = () => {
      if (failed || isPainted || abort.signal.aborted || token !== activeToken) return
      failed = true
      releasePreviewAudio(token)
      onFailRef.current?.()
    }
    const dwellMs = immediate ? 0 : computeHoverDwellMs()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let ownedSession: { api: Awaited<ReturnType<typeof startEngine>>, promise: ReturnType<Awaited<ReturnType<typeof startEngine>>['openPlayback']> } | undefined
    video.muted = preferMuted
    setMuted(preferMuted)
    if (!preferMuted) reservePreviewAudio(token)

    const audioEvents = ['play', 'playing', 'volumechange', 'pause', 'ended'] as const
    for (const eventName of audioEvents) video.addEventListener(eventName, syncPreviewAudio)

    const timer = setTimeout(() => {
      void (async () => {
        // Start importing the local Shaka chunk only once the pointer settles past the dwell window.
        const shakaModule = warmShaka()
        void shakaModule.catch(() => {})
        const api = await startEngine()
        if (abort.signal.aborted || token !== activeToken) return
        const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, Math.max(240, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio)))
        const sessionPromise = api.openPlayback(videoId, maxHeight, playerParams, undefined, true)
        void sessionPromise.catch(() => {})
        ownedSession = { api, promise: sessionPromise }
        const { startShakaPlayback } = await shakaModule
        if (abort.signal.aborted || token !== activeToken) return
        ownedSession = undefined
        controller = await startShakaPlayback({
          api,
          video,
          videoId,
          playerParams,
          maxHeight,
          preview: true,
          bufferingGoal: PREVIEW_BUFFER_GOAL,
          sessionPromise,
          startTime: 0,
          signal: abort.signal,
          onError: notifyFailed,
        })
        if (abort.signal.aborted || token !== activeToken) return
        setStoryboards(controller.storyboards)
        setCaptionTracks(controller.captionTracks)
        selectCaption.current = controller.selectCaption
        setLive(controller.isLive)
        setReady(true)
        syncPreviewAudio()
        const wanted = startingPreviewCaption(controller.captionTracks, controller.audioTracks)
        if (wanted) {
          setCaption(wanted.id)
          void controller.selectCaption(wanted.id).catch(() => setCaption(undefined))
        }
      })().catch(() => {
        // silent: the thumbnail underneath is still the right thing to show, or animatedThumbnail when provided
        notifyFailed()
      })
    }, dwellMs)

    const onTime = () => {
      setTime(video.currentTime)
      // the range that CONTAINS the playhead, not the last one: a seek leaves earlier ranges behind
      const ranges = video.buffered
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= video.currentTime && video.currentTime <= ranges.end(index)) {
          if (video.duration > 0) setBuffered(ranges.end(index) / video.duration)
          break
        }
      }
    }
    const unbindProgress = bindSmoothPlaybackLoop(video, onTime, () => !abort.signal.aborted && token === activeToken)
    video.addEventListener('progress', onTime)

    const onPainted = () => {
      isPainted = true
      setPainted(true)
    }
    if (video.readyState >= 2) onPainted()
    video.addEventListener('loadeddata', onPainted)

    return () => {
      clearTimeout(timer)
      abort.abort()
      unbindProgress()
      for (const eventName of audioEvents) video.removeEventListener(eventName, syncPreviewAudio)
      video.removeEventListener('progress', onTime)
      video.removeEventListener('loadeddata', onPainted)
      releasePreviewAudio(token)
      if (forceMuteRef.current === forceMute) forceMuteRef.current = undefined
      if (ownedSession) {
        const { api, promise } = ownedSession
        void promise.then((session) => api.closePlayback(session.id)).catch(() => {})
      }
      void controller?.destroy()
    }
  }, [videoId, playerParams])

  const ratioFromPointer = (event: PointerEvent) => {
    const bar = event.currentTarget as HTMLElement
    const box = bar.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  }

  const scrubFromPointer = (event: PointerEvent) => {
    const root = (event.currentTarget as HTMLElement).parentElement
    if (!root || !videoRef.current?.duration) return
    setScrub({ ratio: ratioFromPointer(event), width: root.clientWidth, height: root.clientHeight })
  }

  // one seek per gesture: every seek cancels the segment in flight, so seeking on each move left the frame stalled
  const seekFromPointer = (event: PointerEvent) => {
    const video = videoRef.current
    setScrub(undefined)
    if (!video || !video.duration) return
    const ratio = ratioFromPointer(event)
    video.currentTime = ratio * video.duration
    setTime(video.currentTime)
  }

  const openAtTime = (event: MouseEvent) => {
    const at = Math.floor(videoRef.current?.currentTime ?? 0)
    // youtube.com opens a live preview at the stream's edge, wherever the preview is (measured 2026-11-11)
    if (!carryTime || live || at < CARRY_SECONDS || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const url = new URL(href, location.origin)
    url.searchParams.set('t', `${at}s`)
    navigate(url.pathname + url.search, { state: linkState ?? cardState(playerParams) })
  }

  const toggleCaption = () => {
    const next = caption ? undefined : (previewCaption(captionTracks) ?? preferredTrack(captionTracks, undefined))?.id
    setCaption(next)
    void selectCaption.current?.(next).catch(() => setCaption(undefined))
  }

  const trackHover = (event: PointerEvent) => {
    const video = videoRef.current
    if (!video?.duration) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = ratioFromPointer(event)
    setHover({ x: event.clientX - box.left, width: box.width, time: ratio * video.duration })
  }

  const duration = videoRef.current?.duration ?? 0
  const scrubBoard = scrub ? bestStoryboard(storyboards) : undefined
  const scrubFrame = scrub && scrubBoard ? storyboardFrame(scrubBoard, scrub.ratio * duration) : undefined
  const scrubScale = scrub && scrubFrame
    ? Math.max(scrub.width / scrubFrame.width, scrub.height / scrubFrame.height)
    : 1
  const position = scrub?.ratio ?? (duration > 0 ? time / duration : 0)

  const board = hover && !scrub ? previewStoryboard(storyboards, hover.width) : undefined
  const frame = board && hover ? storyboardFrame(board, hover.time) : undefined
  // half the tile plus its 2px border
  const half = frame ? frame.width / 2 + 2 : 0
  const previewLeft = hover
    ? Math.min(Math.max(hover.x, half), Math.max(half, hover.width - half))
    : 0

  return (
    <div css={hoverPreviewStyle} data-painted={painted ? '' : undefined}>
      {/* No preload='none': an element told not to preload never runs its resource selection, so the MediaSource sits at networkState 0 forever */}
      <video ref={videoRef} muted playsInline disablePictureInPicture disableRemotePlayback tabIndex={-1} aria-hidden='true' />
      {painted
        ? (
          <Link
            href={href}
            state={linkState ?? (carryTime ? cardState(playerParams) : undefined)}
            className='preview-surface-link'
            tabIndex={-1}
            aria-hidden='true'
            onClick={openAtTime}
          />
        )
        : undefined}
      {scrubFrame
        ? (
          <div
            className='scrub-frame'
            style={{
              width: `${scrubFrame.width}px`,
              height: `${scrubFrame.height}px`,
              backgroundImage: `url("${scrubFrame.url}")`,
              backgroundPosition: `-${scrubFrame.x}px -${scrubFrame.y}px`,
              transform: `translate(-50%, -50%) scale(${scrubScale})`,
            }}
          />
        )
        : undefined}
      {scrub ? <div className='scrub-time'>{clock(scrub.ratio * duration)}</div> : undefined}
      {painted && ready && !scrub
        ? (
          <div className='corner' onPointerDown={guard} onClick={guard}>
            <button
              type='button'
              aria-label={muted ? 'Unmute preview' : 'Mute preview'}
              onKeyDown={(event: TargetedKeyboardEvent<HTMLButtonElement>) => {
                if (event.key === ' ') event.stopPropagation()
              }}
              onClick={() => {
                const video = videoRef.current
                if (!video) return
                const nextMuted = !video.muted
                if (!nextMuted && forceMuteRef.current) {
                  claimPreviewAudio(tokenRef.current, forceMuteRef.current)
                }
                video.muted = nextMuted
                preferMuted = nextMuted
                setMuted(nextMuted)
                if (nextMuted) releasePreviewAudio(tokenRef.current)
              }}
            >
              {muted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
            </button>
            {captionTracks.length > 0
              ? (
                <button
                  type='button'
                  aria-label='Subtitles/CC'
                  aria-pressed={caption !== undefined}
                  onKeyDown={(event: TargetedKeyboardEvent<HTMLButtonElement>) => {
                    if (event.key === ' ') event.stopPropagation()
                  }}
                  onClick={toggleCaption}
                >
                  {caption ? <Captions size={16} strokeWidth={2} /> : <CaptionsOff size={16} strokeWidth={2} />}
                </button>
              )
              : undefined}
          </div>
        )
        : undefined}
      {/* time LEFT, as youtube.com's preview counts, and out of the way while the pointer is on the bar */}
      {painted && ready && live
        ? <span className='time live'><Radio size={12} strokeWidth={2.5} />LIVE</span>
        : painted && ready && !scrub && !hover
        ? <span className='time'>{clock(duration - time)}</span>
        : undefined}
      {/* youtube.com's preview bar seeks back through a live stream's window, as the watch page's does; this one stays full at the edge */}
      {painted && ready && live
        ? (
          <div className='scrubber live'>
            <div className='track'>
              <div className='fill' style={{ width: '100%' }} />
            </div>
          </div>
        )
        : undefined}
      {painted && ready && !live
        ? (
          <HoverPreviewScrubber
            seekHandle={seekHandle}
            position={position}
            buffered={buffered}
            scrubbing={Boolean(scrub)}
            duration={duration}
            currentTime={scrub ? scrub.ratio * duration : time}
            hover={hover}
            frame={frame}
            previewLeft={previewLeft}
            onPointerLeave={() => setHover(undefined)}
            onPointerDown={(event: PointerEvent) => {
              guard(event)
              ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
              scrubFromPointer(event)
            }}
            onPointerMove={(event: PointerEvent) => {
              trackHover(event)
              if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) scrubFromPointer(event)
            }}
            onPointerUp={(event: PointerEvent) => {
              if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) seekFromPointer(event)
            }}
            onPointerCancel={() => setScrub(undefined)}
            onClick={guard}
            onSeekTime={(next: number) => {
              const video = videoRef.current
              if (!video || !video.duration) return
              video.currentTime = next
              setTime(next)
            }}
          />
        )
        : undefined}
    </div>
  )
}

export default HoverPreview
