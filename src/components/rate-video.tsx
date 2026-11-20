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
 * while a change is on its way. `presses` counts the person's own presses of one button on this video, for its
 * `RateGlyph`.
 */
export const useRateVideo = (videoId: string, likeStatus: LikeStatus | null | undefined) => {
  const [state, rateVideo] = useMutation(RATE_VIDEO)
  const { ready, signedIn } = useSession()
  const [pressed, setPressed] = useState<{ videoId: string, status: Rating, count: number }>()

  const rate = (status: Rating) => {
    // a signed-out read says INDIFFERENT like a signed-in one, so the status alone cannot tell them apart
    if (!likeStatus || (ready && !signedIn)) {
      signIn()
      return
    }
    setPressed(last => ({ videoId, status, count: (last?.count ?? 0) + 1 }))
    const next = likeStatus === status ? 'INDIFFERENT' : status
    void rateVideo({ id: videoId, status: next }).then((result) => {
      if (result.error) showToast(lineFor(result.error))
    })
  }

  const presses = (status: Rating) => pressed?.videoId === videoId && pressed.status === status ? pressed.count : 0

  return { rate, rating: state.fetching, presses }
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
 * with a burst around it when the press turned it on, so a rating that loads with the page or comes from YouTube shows
 * still.
 */
export const RateGlyph = ({ status, size, on, presses }: { status: Rating, size: number, on: boolean, presses: number }) => {
  const Icon = status === 'LIKE' ? ThumbsUp : ThumbsDown
  return (
    // a new element for each press: a class that is already on would not start the animation again
    <span css={glyphStyle} key={presses} className={presses ? 'pop' : undefined}>
      <Icon size={size} strokeWidth={1.5} fill={on ? 'currentColor' : 'none'} />
      {presses && on ? <span className='burst' /> : undefined}
    </span>
  )
}
