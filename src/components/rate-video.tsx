import type { LikeStatus } from '../generated/graphql'

import { css } from '@emotion/react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useMutation } from 'urql'

import { gql } from '../generated'
import { useSession } from '../session'
import { signIn } from '../sign-in'
import { lineFor } from './data-failure'
import { showToast } from './ui/toast'

type Rating = 'LIKE' | 'DISLIKE'

const RATE_VIDEO = gql(`
  mutation RateVideo($id: ID!, $status: LikeStatus!) {
    rateVideo(id: $id, status: $status) {
      id
      likeStatus
    }
  }
`)

/**
 * Like and Dislike for one video, as the watch page and the full screen view both draw them. Signed out, `rate` opens
 * the sign-in window; otherwise it sets the rating, or clears it when the same one is pressed again. `rating` is true
 * while a change is on its way. For each button's `RateGlyph`, `presses` counts the person's own presses of it, and
 * `burst` says whether the last of them turned its rating on.
 */
export const useRateVideo = (videoId: string, likeStatus: LikeStatus | null | undefined) => {
  const [state, rateVideo] = useMutation(RATE_VIDEO)
  const { ready, signedIn } = useSession()
  const [pressed, setPressed] = useState<{ status: Rating, count: number, on: boolean }>()

  const rate = (status: Rating) => {
    // a signed-out read says INDIFFERENT like a signed-in one, so the status alone cannot tell them apart
    if (!likeStatus || (ready && !signedIn)) {
      signIn()
      return
    }
    const next = likeStatus === status ? 'INDIFFERENT' : status
    setPressed(last => ({ status, count: (last?.count ?? 0) + 1, on: next === status }))
    void rateVideo({ id: videoId, status: next }).then((result) => {
      if (result.error) showToast(lineFor(result.error))
    })
  }

  const presses = (status: Rating) => pressed?.status === status ? pressed.count : 0
  const burst = (status: Rating) => pressed?.status === status && pressed.on

  return { rate, rating: state.fetching, presses, burst }
}

const glyphStyle = css`
  position: relative;
  display: inline-grid;
  place-items: center;

  &.pop svg {
    animation: rate-bounce 0.5s ease-out;
  }

  .burst {
    position: absolute;
    inset: -40%;
    background: repeating-conic-gradient(from -4deg, currentColor 0 8deg, transparent 0 45deg);
    mask: radial-gradient(closest-side, transparent 56%, #000 58% 86%, transparent 88%);
    opacity: 0;
    pointer-events: none;
    animation: rate-burst 0.45s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    &.pop svg,
    .burst {
      animation: none;
    }
  }

  @keyframes rate-bounce {
    25% {
      transform: scale(1.3) rotate(-12deg);
    }

    55% {
      transform: scale(0.9);
    }

    80% {
      transform: scale(1.05);
    }
  }

  @keyframes rate-burst {
    from {
      opacity: 1;
      transform: scale(0.6);
    }

    to {
      opacity: 0;
      transform: scale(1.15);
    }
  }
`

/**
 * The thumb of a Like or Dislike button, filled while `on`. Each new `presses` count (from `useRateVideo`) bounces it,
 * with a burst around it when `burst`, so a rating that loads with the page or comes back from YouTube shows still.
 */
export const RateGlyph = ({ status, size, on, presses, burst }: {
  status: Rating
  size: number
  on: boolean
  presses: number
  burst: boolean
}) => {
  const Icon = status === 'LIKE' ? ThumbsUp : ThumbsDown
  // the animation comes off once played: one left on starts again whenever the button comes back from display: none,
  // as the full screen view's settings menu does to it. The bounce outlasts the burst, so its end takes both off.
  const [played, setPlayed] = useState(0)
  const pop = presses > played
  return (
    // a new element for each press: a class that is already on would not start the animation again
    <span
      css={glyphStyle}
      key={presses}
      className={pop ? 'pop' : undefined}
      onAnimationEnd={(event: AnimationEvent) => { if (event.animationName === 'rate-bounce') setPlayed(presses) }}
    >
      <Icon size={size} strokeWidth={1.5} fill={on ? 'currentColor' : 'none'} />
      {pop && burst ? <span className='burst' /> : undefined}
    </span>
  )
}
