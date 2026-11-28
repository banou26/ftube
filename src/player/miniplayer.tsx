import type { PlayerState } from './use-player-state'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, Pause, PictureInPicture2, Play, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { clock } from './controls'
import { closePlayer } from './session'
import { VolumeControl } from './volume-control'

/* youtube.com's miniplayer, measured signed out 2026-11-10 at 1280 and 1920 px: while the pointer is on the video, a
   50% black wash with Expand and Close in the top corners, a 42 px play button in the middle and the clock at the bottom
   left, with no Previous or Next at 400 px and no control groups. FTube adds a compact volume control at the bottom right. */
const style = css`
  position: absolute;
  inset: 0;
  color: #ffffff;
  opacity: 0;
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1) 0.1s;
  /* a click between the buttons reaches the video, which plays and pauses as on youtube.com */
  pointer-events: none;

  /* not :focus-within: a click leaves the focus on its button, and youtube.com hides the controls once the pointer
     leaves even then */
  [data-player-root]:hover &,
  &:has(:focus-visible),
  &.adjusting,
  &.revealed {
    opacity: 1;
  }

  &.washed {
    background: rgba(0, 0, 0, 0.5);
  }

  .expand,
  .close,
  .play,
  .top-btn,
  .short-nav {
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    pointer-events: auto;
  }

  .expand,
  .close,
  .play {
    position: absolute;
    width: 4rem;
    height: 4rem;
  }

  .expand:focus-visible,
  .close:focus-visible,
  .play:focus-visible,
  .top-btn:focus-visible,
  .short-nav:focus-visible {
    outline: 2px solid var(--accent-focus, #3ea6ff);
    outline-offset: -2px;
    border-radius: 50%;
  }

  .expand {
    top: 0;
    left: 0;
  }

  .close {
    top: 0;
    right: 0;
  }

  .play {
    top: 50%;
    left: 50%;
    width: 4.2rem;
    height: 4.2rem;
    transform: translate(-50%, -50%);
  }

  .top-actions {
    position: absolute;
    top: 0;
    right: 4rem;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    height: 4rem;
    pointer-events: none;
  }

  .top-btn {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    transition: background 0.15s ease;
  }

  .top-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .autoplay-switch {
    width: 3.8rem;
    border-radius: 1.8rem;
  }

  .autoplay-track {
    position: relative;
    width: 3rem;
    height: 1.8rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.2);
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

  .autoplay-switch[aria-checked='true'] .autoplay-track {
    background: #ffffff;
  }

  .autoplay-switch[aria-checked='true'] .autoplay-knob {
    background: #000000;
    color: #ffffff;
    transform: translateX(1.2rem);
  }

  .shorts-transport {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    pointer-events: none;
  }

  .shorts-transport .play {
    position: static;
    transform: none;
  }

  .short-nav {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .short-nav:hover:enabled {
    background: rgba(0, 0, 0, 0.68);
  }

  .short-nav:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .time {
    position: absolute;
    left: 1.2rem;
    bottom: 1.7rem;
    color: #eeeeee;
    font-size: 1.2rem;
    line-height: 1.4rem;
    font-variant-numeric: tabular-nums;
  }

  .mini-volume {
    position: absolute;
    right: 0.8rem;
    bottom: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 3.2rem;
    padding: 0 0.8rem 0 0.2rem;
    border-radius: 1.6rem;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: auto;
  }

  .mini-volume .mute {
    display: grid;
    place-items: center;
    flex: none;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  @container player (max-width: 230px) {
    .mini-volume {
      padding: 0;
    }

    .mini-volume input[type='range'] {
      display: none;
    }
  }
`

/**
 * The docked player's own controls, drawn over the video in place of the player bar. `video` is left out while the
 * video cannot play, which leaves Expand and Close (and Shorts nav/autoplay/PiP when in Shorts mode); at the end of
 * the video the end screen has the middle of it.
 */
export const MiniplayerControls = ({
  video,
  state,
  isLive,
  revealed = false,
  isShort = false,
  shortsAutoplay = true,
  onShortsAutoplay,
  hasPreviousShort = false,
  hasNextShort = false,
  onPreviousShort,
  onNextShort,
  canDocumentPip = false,
  inDocumentPip = false,
  onToggleDocumentPip,
  onExpand,
  onVolumeChange,
  onUserPause,
}: {
  video?: HTMLVideoElement
  state: PlayerState
  isLive: boolean
  revealed?: boolean
  isShort?: boolean
  shortsAutoplay?: boolean
  onShortsAutoplay?: (next: boolean) => void
  hasPreviousShort?: boolean
  hasNextShort?: boolean
  onPreviousShort?: () => void
  onNextShort?: () => void
  canDocumentPip?: boolean
  inDocumentPip?: boolean
  onToggleDocumentPip?: () => void
  onExpand?: () => void
  onVolumeChange?: (next: { volume: number, muted: boolean }) => void
  onUserPause?: () => void
}) => {
  const [adjusting, setAdjusting] = useState(false)
  const stopDragRef = useRef<(() => void) | undefined>(undefined)
  const hostWindowRef = useRef<Window>(typeof window === 'undefined' ? (undefined as unknown as Window) : window)
  if (video?.ownerDocument.defaultView) hostWindowRef.current = video.ownerDocument.defaultView

  const setAdjustingState = useCallback((next: boolean) => {
    if (!next) {
      stopDragRef.current?.()
      stopDragRef.current = undefined
      setAdjusting(false)
      return
    }
    setAdjusting(true)
    if (stopDragRef.current) return
    const targetWin = video?.ownerDocument.defaultView ?? hostWindowRef.current
    const stop = () => {
      stopDragRef.current?.()
      stopDragRef.current = undefined
      setAdjusting(false)
    }
    targetWin.addEventListener('pointerup', stop)
    targetWin.addEventListener('pointercancel', stop)
    stopDragRef.current = () => {
      targetWin.removeEventListener('pointerup', stop)
      targetWin.removeEventListener('pointercancel', stop)
    }
  }, [video])

  useEffect(() => () => {
    stopDragRef.current?.()
    stopDragRef.current = undefined
  }, [])

  const playing = video !== undefined && !state.ended
  const classes = [
    playing || isShort ? 'washed' : undefined,
    adjusting ? 'adjusting' : undefined,
    revealed ? 'revealed' : undefined,
  ].filter(Boolean).join(' ') || undefined

  const playButton = playing
    ? (
      <button
        type='button'
        className='play'
        aria-label={state.paused ? 'Play' : 'Pause'}
        aria-keyshortcuts='k'
        onClick={() => {
          if (state.paused) {
            void video.play().catch(() => {})
            return
          }
          onUserPause?.()
          video.pause()
        }}
      >
        {state.paused ? <Play size={42} fill='currentColor' strokeWidth={0} /> : <Pause size={42} fill='currentColor' strokeWidth={0} />}
      </button>
    )
    : undefined

  return (
    <div css={style} className={classes} data-miniplayer-controls>
      <button type='button' className='expand' aria-label='Expand' aria-keyshortcuts='i' onClick={onExpand}>
        {/* youtube.com's mark: the small picture back in the corner of the large one */}
        <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M22 11V5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h9' />
          <rect x='5' y='7' width='7' height='5' rx='0.5' />
          <path d='M16 19v-5h5M16.5 14.5l5.5 5.5' />
        </svg>
      </button>
      {isShort
        ? (
          <div className='top-actions'>
            <button
              type='button'
              className='top-btn autoplay-switch'
              role='switch'
              aria-label='Autoplay'
              aria-checked={shortsAutoplay}
              title={shortsAutoplay ? 'Autoplay is on' : 'Autoplay is off'}
              onClick={() => onShortsAutoplay?.(!shortsAutoplay)}
            >
              <span className='autoplay-track'>
                <span className='autoplay-knob'>
                  {shortsAutoplay ? <Play size={9} fill='currentColor' strokeWidth={0} /> : <Pause size={9} fill='currentColor' strokeWidth={0} />}
                </span>
              </span>
            </button>
            {canDocumentPip
              ? (
                <button
                  type='button'
                  className='top-btn pip-toggle'
                  aria-label={inDocumentPip ? 'Exit picture in picture' : 'Picture in picture'}
                  aria-pressed={inDocumentPip}
                  title={inDocumentPip ? 'Exit picture in picture' : 'Picture in picture'}
                  onClick={onToggleDocumentPip}
                >
                  <PictureInPicture2 size={20} strokeWidth={2} />
                </button>
              )
              : undefined}
          </div>
        )
        : undefined}
      <button type='button' className='close' aria-label='Close miniplayer' onClick={closePlayer}>
        <X size={24} strokeWidth={2} />
      </button>
      {isShort
        ? (
          <div className='shorts-transport'>
            <button
              type='button'
              className='short-nav short-prev'
              aria-label='Previous short'
              title='Previous short'
              disabled={!hasPreviousShort}
              onClick={onPreviousShort}
            >
              <ChevronUp size={22} strokeWidth={2} />
            </button>
            {playButton}
            <button
              type='button'
              className='short-nav short-next'
              aria-label='Next short'
              title='Next short'
              disabled={!hasNextShort}
              onClick={onNextShort}
            >
              <ChevronDown size={22} strokeWidth={2} />
            </button>
          </div>
        )
        : playButton}
      {playing
        ? (
          <>
            {/* a live presentation timeline is the stream's own clock, with no duration to show */}
            {isLive ? undefined : <span className='time'>{clock(state.currentTime)} / {clock(state.duration)}</span>}
            <VolumeControl
              video={video}
              state={state}
              variant='mini'
              onAdjustingChange={setAdjustingState}
              onWheelVolumeChange={onVolumeChange}
            />
          </>
        )
        : undefined}
    </div>
  )
}
