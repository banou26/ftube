import type { LikeStatus } from '../generated/graphql'

import { css } from '@emotion/react'

import { useDislikes } from '../dislikes'
import { formatCompact } from './format'
import { RateGlyph, useRateVideo } from './rate-video'

const style = css`
  display: flex;
  align-items: stretch;
  height: 3.6rem;
  border-radius: 1.8rem;
  background: var(--bg-chip);
  overflow: hidden;

  .like,
  .dislike {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .like {
    padding: 0 1.2rem 0 1.6rem;
    border-right: 1px solid var(--border-subtle);
  }

  .dislike {
    padding: 0 1.6rem;
  }

  .like:hover,
  .dislike:hover {
    background: var(--bg-chip-hover);
  }
`

/** The watch page's Like and Dislike, with the video's like count and Return YouTube Dislike's dislike count. */
export const LikePill = ({ videoId, likeStatus, likeCountText }: {
  videoId: string
  likeStatus?: LikeStatus | null
  likeCountText?: string | null
}) => {
  const { rate, rating, presses } = useRateVideo(videoId, likeStatus)
  const dislikes = useDislikes(videoId)
  const liked = likeStatus === 'LIKE'
  const disliked = likeStatus === 'DISLIKE'

  return (
    <div css={style} className='like-pill'>
      <button
        type='button'
        className='like'
        aria-label='Like'
        aria-pressed={liked}
        disabled={rating}
        onClick={() => rate('LIKE')}
      >
        <RateGlyph status='LIKE' size={20} on={liked} presses={presses('LIKE')} />
        {likeCountText ? <span>{likeCountText}</span> : undefined}
      </button>
      <button
        type='button'
        className='dislike'
        aria-label='Dislike'
        aria-pressed={disliked}
        disabled={rating}
        onClick={() => rate('DISLIKE')}
      >
        <RateGlyph status='DISLIKE' size={20} on={disliked} presses={presses('DISLIKE')} />
        {dislikes !== undefined ? <span>{formatCompact(dislikes)}</span> : undefined}
      </button>
    </div>
  )
}
