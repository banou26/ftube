import type shaka from 'shaka-player'

import { css } from '@emotion/react'
import { Captions, CaptionsOff, Check, ChevronLeft, ChevronRight, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Settings, SkipForward } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { AudioTrack, CaptionPick, CaptionTrack, Storyboard, TranslationLanguage } from '../frame/protocol'
import type { CaptionOption } from './caption-style'
import type { PlayerChapter } from './chapters'
import type { SleepTimer } from './sleep-timer'
import type { SkipSegment } from './sponsorblock'
import type { PlayerState } from './use-player-state'

import { formatClockSeconds } from '../downloads/trim'
import { captionLabel } from '../frame/captions'
import { bestStoryboard, storyboardFrame } from '../frame/storyboard'

import { MenuItem, Popup, useDismiss } from '../components/ui/popup'
import { DEFAULT_SETTINGS, getSettings, subscribeSettings, updateSettings } from '../settings'
import { CAPTION_OPTIONS } from './caption-style'
import { barFill, barOffset, barParts, barWidth, chapterIndexAt, timeAtOffset } from './chapters'
import { isPlayerFullscreen, subscribeFullscreen, togglePlayerFullscreen } from './fullscreen'
import { isPipSupported, isVideoInPip, subscribeVideoPip, toggleVideoPip } from './pip'
import { rateDetail } from './rates'
import { atLiveEdge } from './seek-window'
import { SeekKnob } from './seek-knob'
import { setSleepTimer, SLEEP_MINUTES, sleepDetail, sleepDuration } from './sleep-timer'
import { SpeedPicker } from './speed-picker'
import { VolumeControl } from './volume-control'

export const clock = formatClockSeconds

/* youtube.com's 2025 bar, measured headless at 1280 and 1920 (the sizes do not scale with the player):
   40 px tall groups on a 30% black wash, 12 px from the sides and 8 px from the bottom, no gradient behind them, and the
   4 px rail resting 1 px above the 56 px row of groups */
const style = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 1.2rem;
  color: #ffffff;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;

  &.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .scrubber {
    position: relative;
    height: 1.6rem;
    display: flex;
    align-items: flex-end;
    padding-bottom: 0.1rem;
    cursor: pointer;
    touch-action: none;
  }

  .rail {
    position: relative;
    width: 100%;
    height: 0.4rem;
  }

  /* youtube.com's chapters: square ends 4 px apart, 4 px tall, 6 px while the pointer is on the bar and 10 px for the
     chapter under it, growing about their middle */
  .part {
    position: absolute;
    top: 50%;
    height: 100%;
    overflow: hidden;
    background: rgba(40, 40, 40, 0.6);
    transform: translateY(-50%);
    transition: height 0.1s ease;
  }

  .scrubber:hover .part,
  .scrubber.scrubbing .part {
    height: 0.6rem;
  }

  .scrubber .part.hovered {
    height: 1rem;
  }

  .buffered,
  .played {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
  }

  .buffered {
    background: rgba(255, 255, 255, 0.4);
  }

  .played {
    background: var(--brand-red);
  }

  /* SponsorBlock's own colour for sponsors */
  .sponsor {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #00d400;
  }

  .knob {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    transition: transform 0.1s ease;
  }

  .scrubber:hover .knob,
  .scrubber.scrubbing .knob {
    transform: translate(-50%, -50%) scale(1.3);
  }

  .preview {
    position: absolute;
    bottom: 100%;
    margin-bottom: 0.8rem;
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
    display: inline-flex;
    gap: 0.8rem;
    max-width: 30rem;
    margin-top: 0.4rem;
    padding: 0 0.8rem;
    border-radius: 1.2rem;
    background: rgba(0, 0, 0, 0.6);
    font-size: 1.3rem;
    line-height: 2.4rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .preview-chapter {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
  }

  .bar {
    display: flex;
    align-items: center;
    height: 5.6rem;
  }

  /* the groups left of the spacer, which the player's frame can hold short of the middle */
  .left {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .spacer {
    flex: 1;
  }

  .control {
    position: relative;
    flex: none;
    width: 4.8rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 2.8rem;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
  }

  /* after .control, whose transparent background would otherwise win on a control that is its own group */
  .group {
    position: relative;
    flex: none;
    height: 4rem;
    border-radius: 2.8rem;
    background: rgba(0, 0, 0, 0.3);
  }

  /* the hover wash: a 32 px band inside the shared group, and the whole shape of a control that is its own group */
  .control::after,
  .volume::after,
  .chapter::after,
  .live-badge::after {
    content: '';
    position: absolute;
    inset: 0.4rem 0;
    border-radius: 4rem;
    background: rgba(255, 255, 255, 0.1);
    opacity: 0;
    transition: opacity 0.1s ease;
    pointer-events: none;
  }

  .control:hover::after,
  .volume:hover::after,
  .chapter:hover::after,
  .live-badge:enabled:hover::after {
    opacity: 1;
  }

  .play {
    width: 4rem;
    border-radius: 50%;
  }

  .play::after {
    inset: 0.4rem;
    border-radius: 50%;
  }

  .next {
    margin-left: 0.8rem;
  }

  .next::after {
    inset: 0;
    border-radius: inherit;
  }

  .volume::after {
    inset: 0.4rem;
    border-radius: inherit;
  }

  .volume {
    display: flex;
    align-items: center;
    margin-left: 1.2rem;
  }

  .volume .control {
    width: 4rem;
  }

  .volume .control::after {
    display: none;
  }

  .volume-slider {
    display: flex;
    align-items: center;
    width: 0;
    height: 4rem;
    overflow: hidden;
    opacity: 0;
    transition: width 0.2s cubic-bezier(0, 0, 0.2, 1), margin 0.2s cubic-bezier(0, 0, 0.2, 1), opacity 0.15s ease;
  }

  .volume:hover .volume-slider,
  .volume:focus-within .volume-slider {
    width: 5.2rem;
    margin-right: 1.6rem;
    opacity: 1;
  }

  /* the groups that give way, so a long chapter title and then an hour-long clock clip rather than pushing a button out of the player */
  .time,
  .live-badge,
  .chapter {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    margin-left: 0.8rem;
    padding: 0 1.6rem;
    font-size: 1.4rem;
    line-height: 4rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .time .current {
    font-weight: 500;
  }

  /* the title and youtube.com's 20 px chevron after it, which opens the chapter list, in at most a quarter of the
     player's width (measured 2026-11-10 at 704 to 1920 px, in full screen and on the watch page) */
  .chapter {
    flex-shrink: 100;
    display: flex;
    align-items: center;
    max-width: 25cqi;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
  }

  .chapter::after,
  .live-badge::after {
    inset: 0;
    border-radius: inherit;
  }

  .chapter-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapter svg {
    flex: none;
  }

  /* youtube.com's Live, in 14 px regular: a red dot at the edge, and a grey one on a button back to it while behind
     (measured 2026-11-11) */
  .live-badge {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border: none;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
  }

  .live-badge:disabled {
    cursor: default;
  }

  .live-badge::before {
    content: '';
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: #757575;
  }

  .live-badge:disabled::before {
    background: rgba(225, 0, 45, 0.9);
  }

  .right {
    display: flex;
    margin-left: 0.8rem;
    padding: 0 0.4rem;
  }

  .menu-anchor {
    position: relative;
  }

  .autoplay-track {
    position: relative;
    width: 3rem;
    height: 1.8rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.1);
    transition: background 0.15s ease;
  }

  .autoplay-knob {
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: #ffffff;
    color: #000000;
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .autoplay[aria-checked='true'] .autoplay-track {
    background: #ffffff;
  }

  .autoplay[aria-checked='true'] .autoplay-knob {
    background: #000000;
    color: #ffffff;
    transform: translateX(1.2rem);
  }

  /* youtube.com's menu, as wide as its longest row and at most 82% of the player's height less its 70 px of controls,
     and 413 px: 140, 239 and 350 px on 240, 360 and 495 px players (its player code, measured 2026-11-10) */
  .settings-menu {
    bottom: calc(100% + 0.8rem);
    top: auto;
    width: max-content;
    max-width: calc(100cqi - 2.4rem);
    max-height: min(41.3rem, (var(--player-height, 100vh) - 7rem) * 0.82);
  }

  /* youtube.com's Playback speed panel, measured 2026-11-10: a 57 px header of a 48 px back button and the title in
     12 px medium over a rule, then the picker 24 px below it and 16 px from the other sides, 269 px wide in all with
     these four chips */
  .speed-menu {
    padding: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
  }

  .panel-back {
    display: grid;
    place-items: center;
    width: 4.8rem;
    height: 4.8rem;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .speed-picker {
    padding: 2.4rem 1.6rem 1.6rem;
  }

  /* below these player widths the clock would clip, so the chapter goes first, then the volume slider and 8 px of each
     right-hand button (FTube draws Next and PiP, which youtube.com's bar does not) */
  @container player (max-width: 760px) {
    .chapter {
      display: none;
    }
  }

  @container player (max-width: 700px) {
    .volume-slider {
      display: none;
    }

    .right .control {
      width: 4rem;
    }
  }

  /* compact bar for phone widths: uniform 36 px circular left controls and 32 px right icons */
  @container player (max-width: 600px) {
    padding: 0 0.8rem;

    .bar {
      height: 4.8rem;
    }

    .group {
      height: 3.6rem;
      border-radius: 1.8rem;
    }

    .play,
    .next,
    .volume,
    .volume .control {
      width: 3.6rem;
      height: 3.6rem;
      border-radius: 50%;
    }

    .next,
    .volume,
    .time,
    .live-badge,
    .right {
      margin-left: 0.6rem;
    }

    .time,
    .live-badge {
      height: 3.6rem;
      padding: 0 0.8rem;
      font-size: 1.2rem;
      line-height: 3.6rem;
    }

    .right {
      height: 3.6rem;
      padding: 0 0.2rem;
    }

    .right .control {
      width: 3.2rem;
      height: 3.6rem;
    }

    .control > svg {
      width: 2rem;
      height: 2rem;
    }

    .autoplay,
    .theater-toggle {
      display: none;
    }
  }

  /* below 400 px, tighten gaps so an hour-long clock and PiP fit on iPhone widths; below 375 px, hide PiP */
  @container player (max-width: 400px) {
    .next,
    .volume,
    .time,
    .live-badge,
    .right {
      margin-left: 0.4rem;
    }

    .control > svg {
      width: 1.8rem;
      height: 1.8rem;
    }
  }

  @container player (max-width: 374px) {
    .pip {
      display: none;
    }
  }
`

type ControlsProps = {
  video: HTMLVideoElement
  player: shaka.Player | undefined
  state: PlayerState
  heights: number[]
  storyboards: Storyboard[]
  quality: 'auto' | number
  onQuality: (value: 'auto' | number) => void
  audioTracks?: AudioTrack[]
  audioTrackId?: string
  onAudioTrack?: (trackId: string) => void
  hasDrc?: boolean
  stableVolume?: boolean
  onStableVolume?: (value: boolean) => void
  ambientMode?: boolean
  onAmbientMode?: () => void
  annotations?: boolean
  onAnnotations?: () => void
  captionTracks: CaptionTrack[]
  translationLanguages?: TranslationLanguage[]
  caption: CaptionPick | undefined
  onCaption: (choice: CaptionPick | undefined) => void
  onToggleCaption: () => void
  theater: boolean
  onTheater: () => void
  onNext?: () => void
  autoplay?: boolean
  onAutoplay?: (value: boolean) => void
  visible: boolean
  isLive?: boolean
  chapters?: readonly PlayerChapter[]
  onChapters?: () => void
  segments?: readonly SkipSegment[]
  /** Told whether a settings menu is open, which keeps the controls shown while the pointer is still. */
  onMenu?: (open: boolean) => void
  sleepTimer?: SleepTimer
  // counts the requests to open the Sleep timer panel, so each one opens it again
  sleepMenu?: number
  /** Closes the settings menu as the player docks into the miniplayer, as youtube.com does. */
  docked?: boolean
  /** Called right before user controls pause playback explicitly. */
  onUserPause?: () => void
}

export const PlayerControls = (
  {
    video, state, heights, storyboards, quality, onQuality, audioTracks = [], audioTrackId, onAudioTrack, hasDrc = false, stableVolume = false, onStableVolume,
    ambientMode = true, onAmbientMode, annotations = true, onAnnotations,
    captionTracks, translationLanguages = [], caption, onCaption, onToggleCaption,
    theater, onTheater, onNext, autoplay, onAutoplay, visible, isLive = false, chapters = [], onChapters, segments = [], onMenu,
    sleepTimer, sleepMenu = 0, docked = false, onUserPause,
  }: ControlsProps,
) => {
  const [scrubbing, setScrubbing] = useState(false)
  const [preview, setPreview] = useState<number | undefined>(undefined)
  const [hover, setHover] = useState<{ time: number, ratio: number } | undefined>(undefined)
  const [pip, setPip] = useState(false)
  const [pipSupported, setPipSupported] = useState(false)
  const [menu, setMenu] = useState<'root' | 'audio' | 'quality' | 'speed' | 'captions' | 'caption-translate' | 'caption-options' | CaptionOption | 'sleep' | undefined>(undefined)
  const [settings, setSettings] = useState(getSettings)
  useEffect(() => subscribeSettings(setSettings), [])
  const railRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const closeMenu = useCallback(() => setMenu(undefined), [])
  const menuOpen = menu !== undefined
  useDismiss({ open: menuOpen, onClose: closeMenu, rootRef: menuRef, triggerRef: menuTriggerRef })
  useEffect(() => {
    onMenu?.(menuOpen)
    return () => onMenu?.(false)
  }, [menuOpen])

  const sleepMenuSeen = useRef(sleepMenu)
  useEffect(() => {
    if (sleepMenu === sleepMenuSeen.current) return
    sleepMenuSeen.current = sleepMenu
    setMenu('sleep')
  }, [sleepMenu])

  useEffect(() => {
    if (docked) setMenu(undefined)
  }, [docked])

  useEffect(() => {
    const onChange = () => setFullscreen(isPlayerFullscreen(video))
    onChange()
    return subscribeFullscreen(onChange, video)
  }, [video])

  useEffect(() => {
    const sync = () => {
      setPip(isVideoInPip(video))
      setPipSupported(isPipSupported(video))
    }
    sync()
    return subscribeVideoPip(video, sync)
  }, [video])

  // a live stream's bar is its DVR window, so its times are drawn from the window's start
  const live = isLive ? state.liveWindow : undefined
  const base = live?.start ?? 0
  const duration = live ? Math.max(0, live.end - live.start) : state.duration
  const position = preview ?? state.currentTime - base
  const behind = live !== undefined && !atLiveEdge(live, state.currentTime)
  const chapter = chapters[chapterIndexAt(chapters, position)]
  const parts = barParts(chapters, duration)
  const offset = (time: number) => barOffset(parts, duration, time)
  const hoverChapter = hover ? chapters[chapterIndexAt(chapters, hover.time)] : undefined
  const hoverPart = hover && parts.length > 1 ? parts.findLastIndex(part => part.start <= hover.time) : -1

  const timeAt = (clientX: number) => {
    const rail = railRef.current
    if (!rail || duration <= 0) return 0
    const boxes = [...rail.querySelectorAll('.part')].map(part => part.getBoundingClientRect())
    return timeAtOffset(parts, boxes, clientX)
  }

  const onPointerDown = (event: PointerEvent) => {
    // a right-click opens the player menu rather than seeking
    if (duration <= 0 || event.button !== 0) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    setScrubbing(true)
    setPreview(timeAt(event.clientX))
  }

  const onPointerMove = (event: PointerEvent) => {
    const rail = railRef.current
    if (rail && duration > 0) {
      const box = rail.getBoundingClientRect()
      setHover({
        time: timeAt(event.clientX),
        ratio: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      })
    }
    if (!scrubbing) return
    setPreview(timeAt(event.clientX))
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!scrubbing) return
    const target = event.currentTarget as HTMLElement
    target.releasePointerCapture(event.pointerId)
    video.currentTime = base + timeAt(event.clientX)
    setScrubbing(false)
    setPreview(undefined)
  }

  /* Shaka holds the video at rate 0 while it buffers, when the speed chosen is the stored one. Read off the video rather
     than the state, which learns of a new speed only at the next frame or ratechange: saving the speed renders before
     that, and a render with the old speed puts it back in the slider for the next key press to step from. */
  const rate = video.playbackRate || getSettings().playbackRate
  const onRate = (value: number) => {
    video.playbackRate = value
    updateSettings({ playbackRate: value })
  }

  // as on youtube.com, the left arrow goes back to the settings rather than seeking, and the right one does nothing
  const onSpeedKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (event.key === 'ArrowLeft') setMenu('root')
  }

  const toggleFullscreen = () => {
    void togglePlayerFullscreen(video.closest('[data-player-root]') ?? null, video).catch(() => {})
  }

  const togglePip = () => {
    void toggleVideoPip(video)
  }

  const board = bestStoryboard(storyboards)
  const frame = board && hover ? storyboardFrame(board, hover.time) : undefined

  const activeAudioTrack = audioTracks.find((track) => track.id === audioTrackId)
  const activeTrack = caption && captionTracks.find((track) => track.id === caption.trackId)
  const activeCaptionLabel = captionLabel(captionTracks, translationLanguages, caption)
  const canTranslate = Boolean(activeTrack?.translatable && translationLanguages.length > 0)
  const activeLabel = video.videoHeight > 0 ? `${video.videoHeight}p` : undefined
  const videoLeft = Math.max(0, state.duration - state.currentTime)
  // youtube.com names a point of a live bar by how far behind the edge it is
  const barClock = (time: number) => (live ? `-${clock(duration - time)}` : clock(time))

  // youtube.com goes back to the settings rather than closing them
  const pickSleep = (choice: number | 'end' | undefined) => {
    setSleepTimer(choice)
    setMenu('root')
  }

  return (
    <div
      css={style}
      className={visible || scrubbing || menuOpen ? 'visible' : undefined}
      style={{ '--player-height': `${video.clientHeight}px` }}
    >
      <div
        className={scrubbing ? 'scrubber scrubbing' : 'scrubber'}
        role='slider'
        aria-label='Seek'
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={isLive && !behind ? 'Live' : barClock(position)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(undefined)}
      >
        <div className='rail' ref={railRef}>
          {parts.map((part, index) => (
            <div
              key={index}
              className={index === hoverPart ? 'part hovered' : 'part'}
              style={{ left: offset(part.start), width: barWidth(parts, duration, part) }}
            >
              <div className='buffered' style={{ width: barFill(part, state.buffered - base) }} />
              <div className='played' style={{ width: barFill(part, position) }} />
            </div>
          ))}
          {duration > 0
            ? segments.map((part, index) => (
              <div
                key={index}
                className='sponsor'
                style={{ left: offset(part.start), width: `calc(${offset(Math.min(part.end, duration))} - ${offset(part.start)})` }}
              />
            ))
            : undefined}
          <SeekKnob handle={settings.seekHandle} style={{ left: offset(position) }} />
        </div>
        {hover
          ? (
            <div className='preview' style={{ left: `${hover.ratio * 100}%` }}>
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
              <div className='preview-time'>
                <span>{barClock(hover.time)}</span>
                {hoverChapter ? <span className='preview-chapter'>{hoverChapter.title}</span> : undefined}
              </div>
            </div>
          )
          : undefined}
      </div>
      <div className='bar'>
        <div className='left'>
          <button
            type='button'
            className='control group play'
            aria-label={state.ended ? 'Replay' : state.paused ? 'Play' : 'Pause'}
            onClick={() => {
              if (state.paused) {
                void video.play().catch(() => {})
                return
              }
              onUserPause?.()
              video.pause()
            }}
          >
            {state.ended
              ? <RotateCcw size={22} strokeWidth={2} />
              : state.paused ? <Play size={22} fill='currentColor' strokeWidth={0} /> : <Pause size={22} fill='currentColor' strokeWidth={0} />}
          </button>
          {onNext ? <button type='button' className='control group next' aria-label='Next' onClick={onNext}><SkipForward size={22} fill='currentColor' strokeWidth={2} /></button> : undefined}
          <VolumeControl video={video} state={state} variant='bar' />
          {/* a live presentation timeline is the stream's own clock: the position reads like 3348:05:43 and the duration is 0 */}
          {isLive
            ? (
              <button
                type='button'
                className='group live-badge'
                disabled={!behind}
                aria-label={behind ? 'Skip ahead to live broadcast' : undefined}
                onClick={() => {
                  if (live) video.currentTime = live.end
                }}
              >
                Live
              </button>
            )
            : <span className='group time'><span className='current'>{clock(position)}</span> / {clock(duration)}</span>}
          {chapter && !isLive
            ? (
              <button type='button' className='group chapter' aria-label={chapter.title} onClick={onChapters}>
                <span className='chapter-title'>{chapter.title}</span>
                <ChevronRight size={20} strokeWidth={2} />
              </button>
            )
            : undefined}
        </div>
        <span className='spacer' />
        <div className='group right'>
          {onAutoplay && !isLive
            ? (
              <button
                type='button'
                className='control autoplay'
                role='switch'
                aria-label='Autoplay'
                aria-checked={autoplay === true}
                onClick={() => onAutoplay(!autoplay)}
              >
                <span className='autoplay-track'>
                  <span className='autoplay-knob'>
                    {autoplay ? <Play size={9} fill='currentColor' strokeWidth={0} /> : <Pause size={9} fill='currentColor' strokeWidth={0} />}
                  </span>
                </span>
              </button>
            )
            : undefined}
          {captionTracks.length > 0
            ? (
              <button
                type='button'
                className='control'
                aria-label={caption ? 'Turn off captions' : 'Turn on captions'}
                aria-pressed={caption !== undefined}
                onClick={onToggleCaption}
              >
                {caption ? <Captions size={24} strokeWidth={1.8} /> : <CaptionsOff size={24} strokeWidth={1.8} />}
              </button>
            )
            : undefined}
          <div className='menu-anchor' ref={menuRef}>
            <button
              ref={menuTriggerRef}
              type='button'
              className='control'
              aria-label='Settings'
              aria-haspopup='menu'
              aria-expanded={menu !== undefined}
              onClick={() => setMenu(value => (value === undefined ? 'root' : undefined))}
            >
              <Settings size={24} strokeWidth={1.8} />
            </button>
            {menu === 'root'
              ? (
                <Popup label='Player settings' class='settings-menu'>
                  {onAmbientMode
                    ? (
                      <MenuItem
                        role='menuitemcheckbox'
                        selected={ambientMode}
                        detail={ambientMode ? 'On' : 'Off'}
                        onSelect={onAmbientMode}
                      >
                        Ambient mode
                      </MenuItem>
                    )
                    : undefined}
                  {onAnnotations
                    ? (
                      <MenuItem
                        role='menuitemcheckbox'
                        selected={annotations}
                        detail={annotations ? 'On' : 'Off'}
                        onSelect={onAnnotations}
                      >
                        Annotations
                      </MenuItem>
                    )
                    : undefined}
                  {hasDrc && onStableVolume
                    ? (
                      <MenuItem
                        role='menuitemcheckbox'
                        selected={stableVolume}
                        detail={stableVolume ? 'On' : 'Off'}
                        onSelect={() => onStableVolume(!stableVolume)}
                      >
                        Stable Volume
                      </MenuItem>
                    )
                    : undefined}
                  {pipSupported
                    ? (
                      <MenuItem
                        role='menuitemcheckbox'
                        selected={pip}
                        detail={pip ? 'On' : 'Off'}
                        onSelect={() => {
                          togglePip()
                          setMenu(undefined)
                        }}
                      >
                        Picture in picture
                      </MenuItem>
                    )
                    : undefined}
                  <MenuItem
                    detail={activeCaptionLabel ?? 'Off'}
                    disabled={captionTracks.length === 0}
                    onSelect={() => setMenu('captions')}
                  >
                    Subtitles
                  </MenuItem>
                  {audioTracks.length > 1 && onAudioTrack
                    ? (
                      <MenuItem
                        detail={activeAudioTrack?.label}
                        onSelect={() => setMenu('audio')}
                      >
                        Audio track
                      </MenuItem>
                    )
                    : undefined}
                  <MenuItem detail={sleepDetail(sleepTimer, videoLeft)} onSelect={() => setMenu('sleep')}>
                    Sleep timer
                  </MenuItem>
                  <MenuItem detail={rateDetail(rate)} onSelect={() => setMenu('speed')}>
                    Playback speed
                  </MenuItem>
                  <MenuItem
                    detail={quality === 'auto' ? `Auto${activeLabel ? ` (${activeLabel})` : ''}` : `${quality}p`}
                    disabled={heights.length === 0}
                    onSelect={() => setMenu('quality')}
                  >
                    Quality
                  </MenuItem>
                </Popup>
              )
              : menu === 'audio' && audioTracks.length > 1 && onAudioTrack
                ? (
                  <Popup label='Audio track' class='settings-menu'>
                    <MenuItem icon={ChevronLeft} onSelect={() => setMenu('root')}>Audio track</MenuItem>
                    {audioTracks.map(track => (
                      <MenuItem
                        key={track.id}
                        icon={audioTrackId === track.id ? Check : undefined}
                        detail={track.autoDubbed && !/auto/i.test(track.label) ? 'auto-dubbed' : undefined}
                        onSelect={() => {
                          onAudioTrack(track.id)
                          setMenu(undefined)
                        }}
                      >
                        {track.label}
                      </MenuItem>
                    ))}
                  </Popup>
                )
              : menu === 'speed'
                ? (
                  <Popup label='Playback speed' class='settings-menu speed-menu' onKeyDown={onSpeedKey}>
                    <div className='panel-header'>
                      <button type='button' className='panel-back' aria-label='Back to previous menu' onClick={() => setMenu('root')}>
                        <ChevronLeft size={24} strokeWidth={2} />
                      </button>
                      <span role='heading' aria-level={2}>Playback speed</span>
                    </div>
                    <div className='speed-picker'>
                      <SpeedPicker rate={rate} onRate={onRate} />
                    </div>
                  </Popup>
                )
                : menu === 'captions'
                  ? (
                    <Popup label='Subtitles' class='settings-menu'>
                      <MenuItem
                        icon={caption === undefined ? Check : undefined}
                        onSelect={() => {
                          onCaption(undefined)
                          setMenu(undefined)
                        }}
                      >
                        Off
                      </MenuItem>
                      {captionTracks.map(track => (
                        <MenuItem
                          key={track.id}
                          icon={caption?.trackId === track.id && !caption.translateTo ? Check : undefined}
                          detail={track.auto ? 'auto' : undefined}
                          onSelect={() => {
                            onCaption({ trackId: track.id })
                            setMenu(undefined)
                          }}
                        >
                          {track.label}
                        </MenuItem>
                      ))}
                      {canTranslate
                        ? <MenuItem onSelect={() => setMenu('caption-translate')}>Auto-translate</MenuItem>
                        : undefined}
                      {caption?.translateTo && activeCaptionLabel
                        ? <MenuItem icon={Check} onSelect={() => setMenu(undefined)}>{activeCaptionLabel}</MenuItem>
                        : undefined}
                      <MenuItem onSelect={() => setMenu('caption-options')}>Options</MenuItem>
                    </Popup>
                  )
                  : menu === 'caption-translate' && caption
                    ? (
                      <Popup label='Auto-translate' class='settings-menu'>
                        <MenuItem icon={ChevronLeft} onSelect={() => setMenu('captions')}>Auto-translate</MenuItem>
                        {translationLanguages.map(language => (
                          <MenuItem
                            key={language.languageCode}
                            icon={caption.translateTo === language.languageCode ? Check : undefined}
                            onSelect={() => {
                              onCaption({ trackId: caption.trackId, translateTo: language.languageCode })
                              setMenu(undefined)
                            }}
                          >
                            {language.label}
                          </MenuItem>
                        ))}
                      </Popup>
                    )
                  : menu === 'quality'
                    ? (
                      <Popup label='Quality' class='settings-menu'>
                        <MenuItem
                          icon={quality === 'auto' ? Check : undefined}
                          detail={activeLabel}
                          onSelect={() => {
                            onQuality('auto')
                            setMenu(undefined)
                          }}
                        >
                          Auto
                        </MenuItem>
                        {heights.map(height => (
                          <MenuItem
                            key={height}
                            icon={quality === height ? Check : undefined}
                            onSelect={() => {
                              onQuality(height)
                              setMenu(undefined)
                            }}
                          >
                            {`${height}p`}
                          </MenuItem>
                        ))}
                      </Popup>
                    )
                    : menu === 'sleep'
                      ? (
                        <Popup label='Sleep timer' class='settings-menu'>
                          <MenuItem icon={sleepTimer === undefined ? Check : undefined} onSelect={() => pickSleep(undefined)}>
                            Off
                          </MenuItem>
                          {SLEEP_MINUTES.map(minutes => (
                            <MenuItem
                              key={minutes}
                              icon={typeof sleepTimer === 'object' && sleepTimer.minutes === minutes ? Check : undefined}
                              onSelect={() => pickSleep(minutes)}
                            >
                              {`${minutes} minutes`}
                            </MenuItem>
                          ))}
                          {!isLive && duration > 0
                            ? (
                              <MenuItem icon={sleepTimer === 'end' ? Check : undefined} detail={sleepDuration(videoLeft)} onSelect={() => pickSleep('end')}>
                                End of video
                              </MenuItem>
                            )
                            : undefined}
                        </Popup>
                      )
                      : menu === 'caption-options'
                        ? (
                          <Popup label='Options' class='settings-menu'>
                            <MenuItem icon={ChevronLeft} onSelect={() => setMenu('captions')}>Options</MenuItem>
                            {CAPTION_OPTIONS.map(option => (
                              <MenuItem
                                key={option.key}
                                detail={option.choices.find(choice => choice.value === settings[option.key])?.label}
                                onSelect={() => setMenu(option)}
                              >
                                {option.label}
                              </MenuItem>
                            ))}
                            <MenuItem onSelect={() => updateSettings({
                              ...Object.fromEntries(CAPTION_OPTIONS.map(({ key }) => [key, DEFAULT_SETTINGS[key]])),
                              captionPosition: undefined,
                            })}>
                              Reset
                            </MenuItem>
                          </Popup>
                        )
                        : typeof menu === 'object'
                          ? (
                            <Popup label={menu.label} class='settings-menu'>
                              <MenuItem icon={ChevronLeft} onSelect={() => setMenu('caption-options')}>{menu.label}</MenuItem>
                              {menu.choices.map(choice => (
                                <MenuItem
                                  key={choice.value}
                                  icon={settings[menu.key] === choice.value ? Check : undefined}
                                  onSelect={() => updateSettings({ [menu.key]: choice.value })}
                                >
                                  {choice.label}
                                </MenuItem>
                              ))}
                            </Popup>
                          )
                          : undefined}
          </div>
          {pipSupported
            ? (
              <button
                type='button'
                className='control pip'
                aria-label={pip ? 'Exit picture in picture' : 'Picture in picture'}
                aria-pressed={pip}
                onClick={togglePip}
              >
                <PictureInPicture2 size={24} strokeWidth={1.8} />
              </button>
            )
            : undefined}
          <button type='button' className='control theater-toggle' aria-label='Theater mode' aria-pressed={theater} onClick={onTheater}>
            {/* two nested rectangles read as "wide screen" */}
            <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1.8'>
              <rect x='2' y='6' width='20' height='12' rx='1.5' />
              {theater ? <rect x='6' y='9' width='12' height='6' rx='1' /> : undefined}
            </svg>
          </button>
          <button type='button' className='control' aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={24} strokeWidth={1.8} /> : <Maximize size={24} strokeWidth={1.8} />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlayerControls

export const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable))
}
