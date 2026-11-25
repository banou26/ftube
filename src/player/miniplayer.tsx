import type { PlayerState } from './use-player-state'

import { css } from '@emotion/react'
import { Pause, Play, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'

import { updateSettings } from '../settings'
import { clock } from './controls'
import { closePlayer } from './session'
import { applyVideoVolume, effectiveVolumeOf, toggleVideoMute } from './volume'

/* youtube.com's miniplayer, measured signed out 2026-11-10 at 1280 and 1920 px: while the pointer is on the video, a
   50% black wash with Expand and Close in the top corners, a 42 px play button in the middle and the clock at the bottom
   left, plus volume control at the bottom right. It draws no Previous or Next at its 400 px, and no control groups. */
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
  &.adjusting {
    opacity: 1;
  }

  &.washed {
    background: rgba(0, 0, 0, 0.5);
  }

  .expand,
  .close,
  .play {
    position: absolute;
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    pointer-events: auto;
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

  .mini-volume input {
    flex: none;
    width: 6.4rem;
    height: 3.2rem;
    margin: 0;
    padding: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }

  .mini-volume input::-webkit-slider-runnable-track {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: linear-gradient(to right, #ffffff var(--fill), rgba(255, 255, 255, 0.25) var(--fill));
  }

  .mini-volume input::-webkit-slider-thumb {
    width: 1rem;
    height: 1rem;
    margin-top: -0.4rem;
    border: none;
    border-radius: 50%;
    background: #ffffff;
    appearance: none;
  }

  .mini-volume input::-moz-range-track {
    height: 0.2rem;
    border: none;
    border-radius: 0.1rem;
    background: rgba(255, 255, 255, 0.25);
  }

  .mini-volume input::-moz-range-progress {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: #ffffff;
  }

  .mini-volume input::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    border: none;
    border-radius: 50%;
    background: #ffffff;
  }

  .mini-volume input:focus-visible {
    outline: none;
  }

  .mini-volume input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
  }

  .mini-volume input:focus-visible::-moz-range-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
  }
`

/**
 * The docked player's own controls, drawn over the video in place of the player bar. `video` is left out while the
 * video cannot play, which leaves Expand and Close; at the end of the video the end screen has the middle of it.
 */
export const MiniplayerControls = (
  { video, state, isLive, onExpand }: {
    video?: HTMLVideoElement
    state: PlayerState
    isLive: boolean
    onExpand?: () => void
  },
) => {
  const [adjusting, setAdjusting] = useState(false)
  useEffect(() => {
    if (!adjusting) return
    const stop = () => setAdjusting(false)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [adjusting])

  const playing = video !== undefined && !state.ended
  const effectiveVolume = effectiveVolumeOf(state)
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2
  const classes = [playing ? 'washed' : undefined, adjusting ? 'adjusting' : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div css={style} className={classes}>
      <button type='button' className='expand' aria-label='Expand' aria-keyshortcuts='i' onClick={onExpand}>
        {/* youtube.com's mark: the small picture back in the corner of the large one */}
        <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M22 11V5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h9' />
          <rect x='5' y='7' width='7' height='5' rx='0.5' />
          <path d='M16 19v-5h5M16.5 14.5l5.5 5.5' />
        </svg>
      </button>
      <button type='button' className='close' aria-label='Close miniplayer' onClick={closePlayer}>
        <X size={24} strokeWidth={2} />
      </button>
      {playing
        ? (
          <>
            <button
              type='button'
              className='play'
              aria-label={state.paused ? 'Play' : 'Pause'}
              aria-keyshortcuts='k'
              onClick={() => (state.paused ? void video.play().catch(() => {}) : video.pause())}
            >
              {state.paused ? <Play size={42} fill='currentColor' strokeWidth={0} /> : <Pause size={42} fill='currentColor' strokeWidth={0} />}
            </button>
            {/* a live presentation timeline is the stream's own clock, with no duration to show */}
            {isLive ? undefined : <span className='time'>{clock(state.currentTime)} / {clock(state.duration)}</span>}
            <div className='mini-volume'>
              <button
                type='button'
                className='mute'
                aria-label={effectiveVolume === 0 ? 'Unmute' : 'Mute'}
                aria-keyshortcuts='m'
                onClick={() => updateSettings(toggleVideoMute(video))}
              >
                <VolumeIcon size={18} strokeWidth={2} />
              </button>
              <input
                type='range'
                min={0}
                max={1}
                step={0.01}
                value={effectiveVolume}
                aria-label='Volume'
                aria-valuetext={`${Math.round(effectiveVolume * 100)}%`}
                style={{ '--fill': `calc(0.5rem + ${effectiveVolume} * (100% - 1rem))` }}
                onPointerDown={() => setAdjusting(true)}
                onInput={(event: Event) => {
                  const value = Number((event.currentTarget as HTMLInputElement).value)
                  updateSettings(applyVideoVolume(video, value))
                }}
              />
            </div>
          </>
        )
        : undefined}
    </div>
  )
}
