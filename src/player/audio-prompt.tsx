import type { TargetedMouseEvent } from 'preact'

import { css } from '@emotion/react'
import { Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useMemo } from 'preact/hooks'

import { getSettings, updateSettings } from '../settings'
import { audioPermissionTip } from './audio-tip'

export { audioPermissionTip }

const style = css`
  position: absolute;
  z-index: 3;
  padding: 1.2rem 1.4rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 1.2rem;
  background: rgba(15, 15, 15, 0.86);
  backdrop-filter: blur(16px);
  box-shadow: 0 0.8rem 2.4rem rgba(0, 0, 0, 0.45);
  color: #ffffff;
  font-family: 'Roboto', Arial, sans-serif;
  cursor: auto;
  animation: audio-prompt-in 0.18s ease;

  &.video {
    top: 1.6rem;
    left: 1.6rem;
    max-width: min(34rem, calc(100% - 3.2rem));
  }

  &.shorts {
    top: 7.2rem;
    left: 1.2rem;
    right: 1.2rem;
    max-width: none;
  }

  @keyframes audio-prompt-in {
    from {
      opacity: 0;
      transform: translateY(-0.4rem);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex: 1;
    min-width: 0;
  }

  .title-icon {
    flex: none;
    color: #ffffff;
  }

  .heading {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 600;
    line-height: 1.9rem;
    color: #ffffff;
  }

  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.8rem;
    height: 2.8rem;
    margin: -0.4rem -0.4rem 0 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .close:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }

  .body {
    margin: 0.6rem 0 0;
    font-size: 1.25rem;
    line-height: 1.75rem;
    color: rgba(255, 255, 255, 0.88);
  }

  .tip {
    margin: 0.4rem 0 0;
    font-size: 1.2rem;
    line-height: 1.65rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .actions {
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .unmute {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.2rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.6rem;
    background: #ffffff;
    color: #0f0f0f;
    font-size: 1.3rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .unmute:hover {
    background: #e5e5e5;
  }

  .unmute:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @container player (max-width: 480px) {
    &.video {
      top: 1.2rem;
      left: 1.2rem;
      max-width: calc(100% - 2.4rem);
    }
  }
`

/**
 * Overlay card shown when the browser forces playback muted on autoplay.
 *
 * Lets the viewer unmute with a single gesture (without pausing playback),
 * points to the browser's site audio permission setting so future videos start
 * with sound, and dismisses itself if sound is turned on through any other
 * player control.
 */
export const AudioPermissionPrompt = (
  { video, onDismiss, placement = 'video' }: {
    video: HTMLVideoElement
    onDismiss: () => void
    placement?: 'video' | 'shorts'
  },
) => {
  const tip = useMemo(() => audioPermissionTip(), [])

  useEffect(() => {
    if (!video.muted && video.volume > 0) {
      onDismiss()
      return
    }
    const onVolumeChange = () => {
      if (!video.muted && video.volume > 0) onDismiss()
    }
    video.addEventListener('volumechange', onVolumeChange)
    return () => video.removeEventListener('volumechange', onVolumeChange)
  }, [video, onDismiss])

  const enableSound = (event: TargetedMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const settings = getSettings()
    const volume = settings.volume > 0 ? settings.volume : 1
    video.volume = volume
    video.muted = false
    void video.play().catch(() => {})
    if (settings.muted || settings.volume <= 0) updateSettings({ muted: false, volume })
    onDismiss()
  }

  const dismiss = (event: TargetedMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDismiss()
  }

  return (
    <div
      css={style}
      className={placement}
      role='region'
      aria-label='Audio permission'
      data-audio-prompt
      onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}
      onDblClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <div className='head'>
        <div className='title-row'>
          <VolumeX className='title-icon' size={18} strokeWidth={2} aria-hidden='true' />
          <p className='heading'>Sound is muted by your browser</p>
        </div>
        <button
          type='button'
          className='close'
          aria-label='Dismiss audio prompt'
          onClick={dismiss}
        >
          <X size={16} strokeWidth={2} aria-hidden='true' />
        </button>
      </div>
      <p className='body'>
        Unmute now, or allow audio for this site so videos play with sound by default.
      </p>
      <p className='tip'>{tip}</p>
      <div className='actions'>
        <button type='button' className='unmute' onClick={enableSound}>
          <Volume2 size={16} strokeWidth={2} aria-hidden='true' />
          Enable sound
        </button>
      </div>
    </div>
  )
}
