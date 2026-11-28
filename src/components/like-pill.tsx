import type { LikeStatus } from '../generated/graphql'

import { css } from '@emotion/react'

import { computeLikeDislikeRatio, useVotes } from '../dislikes'
import { formatCompact } from './format'
import { RateGlyph, useRateVideo } from './rate-video'

/** Shared YouTube-style hover label revealed below icon-only watch action controls. */
export const actionTooltipStyle = css`
  .action-tooltip {
    position: absolute;
    top: calc(100% + 0.8rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-popup);
    padding: 0.6rem 0.8rem;
    border-radius: 0.4rem;
    background: rgba(96, 96, 96, 0.92);
    color: #ffffff;
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.6rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .action-tooltip {
      transition: none;
    }
  }
`

const style = css`
  position: relative;
  display: flex;
  align-items: stretch;
  height: var(--action-height, 3.6rem);
  border-radius: calc(var(--action-height, 3.6rem) / 2);
  background: var(--bg-chip);

  .like-slot,
  .dislike-slot {
    position: relative;
    display: flex;
    align-items: stretch;
  }

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
    position: relative;
    padding: 0 1.4rem 0 1.6rem;
    border-radius: calc(var(--action-height, 3.6rem) / 2) 0 0 calc(var(--action-height, 3.6rem) / 2);
  }

  .like::after {
    content: '';
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 2.4rem;
    background: var(--border-subtle);
  }

  .dislike {
    padding: 0 1.6rem;
    border-radius: 0 calc(var(--action-height, 3.6rem) / 2) calc(var(--action-height, 3.6rem) / 2) 0;
  }

  .like:hover,
  .dislike:hover {
    background: var(--bg-chip-hover);
  }

  .ratio-bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    padding: 0.5rem 0 0.3rem;
    cursor: default;
  }

  .ratio-track {
    width: 100%;
    height: 0.25rem;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text-primary) 28%, transparent);
  }

  .ratio-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--text-primary);
    transition: width 0.2s ease;
  }

  .ratio-tooltip {
    position: absolute;
    bottom: calc(100% + 0.6rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-popup);
    padding: 0.5rem 0.9rem;
    border-radius: 0.6rem;
    background: rgba(33, 33, 33, 0.88);
    color: #ffffff;
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.8rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease;
  }

  .ratio-bar:hover .ratio-tooltip,
  .ratio-bar:focus-visible .ratio-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .ratio-bar:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 2px;
    border-radius: 0.2rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .ratio-fill,
    .ratio-tooltip {
      transition: none;
    }
  }

  ${actionTooltipStyle}

  .like:not(:disabled):hover + .action-tooltip,
  .like:not(:disabled):focus-visible + .action-tooltip,
  .dislike:not(:disabled):hover + .action-tooltip,
  .dislike:not(:disabled):focus-visible + .action-tooltip {
    opacity: 1;
    visibility: visible;
  }
`

/** The watch page's Like and Dislike, with the video's like count, Return YouTube Dislike's dislike count, and ratio bar. */
export const LikePill = ({ videoId, likeStatus, likeCount, likeCountText }: {
  videoId: string
  likeStatus?: LikeStatus | null
  likeCount?: number | null
  likeCountText?: string | null
}) => {
  const { rate, rating, presses, burst } = useRateVideo(videoId, likeStatus)
  const votes = useVotes(videoId)
  const dislikes = votes?.dislikes
  const ratio = computeLikeDislikeRatio({ likeCount, rydLikes: votes?.likes, dislikes })
  const liked = likeStatus === 'LIKE'
  const disliked = likeStatus === 'DISLIKE'

  return (
    <div css={style} className='like-pill'>
      <div className='like-slot'>
        <button
          type='button'
          className='like'
          aria-label='Like'
          aria-pressed={liked}
          disabled={rating}
          onClick={() => rate('LIKE')}
        >
          <RateGlyph status='LIKE' size={20} on={liked} presses={presses('LIKE')} burst={burst('LIKE')} />
          {likeCountText ? <span>{likeCountText}</span> : undefined}
        </button>
        <span className='action-tooltip' role='tooltip'>{liked ? 'Unlike' : 'I like this'}</span>
      </div>
      <div className='dislike-slot'>
        <button
          type='button'
          className='dislike'
          aria-label='Dislike'
          aria-pressed={disliked}
          disabled={rating}
          onClick={() => rate('DISLIKE')}
        >
          <RateGlyph status='DISLIKE' size={20} on={disliked} presses={presses('DISLIKE')} burst={burst('DISLIKE')} />
          {dislikes !== undefined ? <span>{formatCompact(dislikes)}</span> : undefined}
        </button>
        <span className='action-tooltip' role='tooltip'>{disliked ? 'Remove dislike' : 'I dislike this'}</span>
      </div>
      {ratio
        ? (
          <div
            className='ratio-bar'
            role='meter'
            tabIndex={0}
            aria-label={`Like ratio: ${ratio.tooltip}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio.likePercent)}
            aria-valuetext={`${ratio.likePercent.toFixed(1)}% likes (${ratio.tooltip})`}
            data-ratio-bar='true'
            data-like-percent={ratio.likePercent.toFixed(2)}
          >
            <div className='ratio-track' aria-hidden='true'>
              <div className='ratio-fill' style={{ width: `${ratio.likePercent.toFixed(2)}%` }} />
            </div>
            <span className='ratio-tooltip' role='tooltip'>{ratio.tooltip}</span>
          </div>
        )
        : undefined}
    </div>
  )
}
