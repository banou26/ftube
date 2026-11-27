import type { TargetedEvent } from 'preact'

import { css } from '@emotion/react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef } from 'preact/hooks'

import { updateSettings } from '../settings'
import { applyVideoVolume, bindWheelVolume, effectiveVolumeOf, toggleVideoMute } from './volume'

const rangeStyle = css`
  flex: none;
  width: var(--vol-width);
  height: var(--vol-height);
  margin: 0;
  padding: 0;
  background: transparent;
  appearance: none;
  cursor: pointer;

  &::-webkit-slider-runnable-track {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: linear-gradient(to right, #ffffff var(--fill), var(--vol-track) var(--fill));
  }

  &::-webkit-slider-thumb {
    width: var(--vol-thumb);
    height: var(--vol-thumb);
    margin-top: calc((0.2rem - var(--vol-thumb)) / 2);
    border: none;
    border-radius: 50%;
    background: #ffffff;
    appearance: none;
  }

  &::-moz-range-track {
    height: 0.2rem;
    border: none;
    border-radius: 0.1rem;
    background: var(--vol-track);
  }

  &::-moz-range-progress {
    height: 0.2rem;
    border-radius: 0.1rem;
    background: #ffffff;
  }

  &::-moz-range-thumb {
    width: var(--vol-thumb);
    height: var(--vol-thumb);
    border: none;
    border-radius: 50%;
    background: #ffffff;
  }

  &:focus-visible {
    outline: none;
  }

  &:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
  }

  &:focus-visible::-moz-range-thumb {
    box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.45);
  }
`

const VARIANT_CONFIG = {
  bar: {
    width: '5.2rem',
    height: '4rem',
    thumb: '1.2rem',
    halfThumb: '0.6rem',
    track: 'rgba(255, 255, 255, 0.2)',
    iconSize: 24,
    iconStroke: 1.8,
    buttonClass: 'control',
  },
  mini: {
    width: '6.4rem',
    height: '3.2rem',
    thumb: '1rem',
    halfThumb: '0.5rem',
    track: 'rgba(255, 255, 255, 0.25)',
    iconSize: 18,
    iconStroke: 2,
    buttonClass: 'mute',
  },
} as const

export type VolumeControlProps = {
  video: HTMLVideoElement
  state: { volume: number, muted: boolean }
  variant: 'bar' | 'mini'
  onAdjustingChange?: (adjusting: boolean) => void
  onWheelVolumeChange?: (next: { volume: number, muted: boolean }) => void
}

/** Shared mute toggle and volume slider for both the full player bar and docked miniplayer. */
export const VolumeControl = ({ video, state, variant, onAdjustingChange, onWheelVolumeChange }: VolumeControlProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const onWheelRef = useRef(onWheelVolumeChange)
  onWheelRef.current = onWheelVolumeChange

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    return bindWheelVolume(root, video, {
      stopPropagation: true,
      onVolumeChange: next => onWheelRef.current?.(next),
      onPersist: next => updateSettings(next),
    })
  }, [video])

  const config = VARIANT_CONFIG[variant]
  const effectiveVolume = effectiveVolumeOf(state)
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2

  const button = (
    <button
      type='button'
      className={config.buttonClass}
      aria-label={effectiveVolume === 0 ? 'Unmute' : 'Mute'}
      aria-keyshortcuts='m'
      onClick={() => updateSettings(toggleVideoMute(video))}
    >
      <VolumeIcon size={config.iconSize} strokeWidth={config.iconStroke} />
    </button>
  )

  const slider = (
    <input
      css={rangeStyle}
      type='range'
      min={0}
      max={1}
      step={0.01}
      value={effectiveVolume}
      aria-label='Volume'
      aria-valuetext={`${Math.round(effectiveVolume * 100)}%`}
      style={{
        '--vol-width': config.width,
        '--vol-height': config.height,
        '--vol-thumb': config.thumb,
        '--vol-track': config.track,
        '--fill': `calc(${config.halfThumb} + ${effectiveVolume} * (100% - ${config.thumb}))`,
      }}
      onPointerDown={onAdjustingChange ? () => onAdjustingChange(true) : undefined}
      onPointerUp={onAdjustingChange ? () => onAdjustingChange(false) : undefined}
      onPointerCancel={onAdjustingChange ? () => onAdjustingChange(false) : undefined}
      onLostPointerCapture={onAdjustingChange ? () => onAdjustingChange(false) : undefined}
      onBlur={onAdjustingChange ? () => onAdjustingChange(false) : undefined}
      onInput={(event: TargetedEvent<HTMLInputElement>) => {
        const value = Number(event.currentTarget.value)
        updateSettings(applyVideoVolume(video, value))
      }}
    />
  )

  if (variant === 'mini') {
    return (
      <div ref={rootRef} className='mini-volume'>
        {button}
        {slider}
      </div>
    )
  }

  return (
    <div ref={rootRef} className='group volume'>
      {button}
      <div className='volume-slider'>
        {slider}
      </div>
    </div>
  )
}
