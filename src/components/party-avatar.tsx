import type { Participant } from '../social'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

import { avatarInitialOf, safeAvatarSrc } from '../social/avatar'

const avatarStyle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  background: var(--bg-chip);
  color: var(--text-primary);
  font-weight: 700;
  line-height: 1;
  user-select: none;

  &[data-status='friend'] {
    border-color: var(--membership);
  }

  &[data-status='rekeyed'] {
    border-color: var(--danger);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`

/**
 * Verified FKN Social avatar (uploaded image or deterministic identicon, with initial fallback).
 * Renders nothing when no verified social identity is held, keeping signed-out UI unchanged.
 */
export const PartyAvatar = ({ participant, size = 24 }: { participant?: Participant, size?: number }) => {
  const identity = participant?.identity ?? null
  const safeAvatar = safeAvatarSrc(identity?.avatar)
  const safeIdenticon = safeAvatarSrc(identity?.identicon)
  const primary = safeAvatar ?? safeIdenticon
  const fallback = safeAvatar ? safeIdenticon : null
  const [failedPrimary, setFailedPrimary] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)

  useEffect(() => {
    setFailedPrimary(false)
    setFailedFallback(false)
  }, [primary, fallback])

  if (!participant || !identity) return null

  const src = !failedPrimary ? primary : !failedFallback ? fallback : null
  const rem = `${size / 10}rem`

  return (
    <span
      css={avatarStyle}
      className='party-avatar'
      data-status={participant.status}
      style={{ width: rem, height: rem, fontSize: `${Math.max(0.9, size / 22)}rem` }}
      aria-hidden='true'
    >
      {src
        ? (
          <img
            src={src}
            alt=''
            referrerPolicy='no-referrer'
            onError={() => {
              if (!failedPrimary) setFailedPrimary(true)
              else setFailedFallback(true)
            }}
          />
        )
        : <span>{avatarInitialOf(identity, participant.status)}</span>}
    </span>
  )
}

export default PartyAvatar
