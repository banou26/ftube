import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { Link } from 'wouter'

import { HoverPreview } from '../player/hover-preview'
import { shortsHrefFor } from '../player/links'
import { useCardHover } from './card-hover-tint'
import { formatViews } from './format'
import { PreviewTriggerButton, usePreviewActivation } from './preview-trigger'
import { Thumbnail } from './thumbnail'
import { VideoCardMenu } from './video-card'

type ShortsLinkState = { sequence?: string }

/**
 * The reel sequence of the tile the Shorts pager was opened from. A tile hands it over in the history entry, so the
 * address stays /shorts/<id> as youtube.com's does.
 */
export const shortsSequenceIn = (state: unknown) => {
  const sequence = (state as ShortsLinkState | null | undefined)?.sequence
  return typeof sequence === 'string' ? sequence : undefined
}

/* youtube.com draws every Shorts tile alike, in a channel's Shorts tab, a channel's Home shelf and a search's shelf:
   a 2:3 still with 8px corners, a 16/22px title beside a 40px More actions button, and 14/20px views that step down
   to 12/18px below a 1024px window. Measured signed out on @MKBHD and a "rick astley" search, 2026-11-10. */
export const shortsTileStyle = css`
  position: relative;
  isolation: isolate;
  min-width: 0;

  &:not([aria-hidden='true'])::before {
    content: '';
    position: absolute;
    inset: var(--card-hover-inset, -1rem);
    z-index: -1;
    border-radius: var(--card-hover-radius, 1.6rem);
    background: transparent;
    pointer-events: none;
    transition: background-color 0.15s ease;
  }

  @media (hover: hover) {
    &:not([aria-hidden='true']):hover::before {
      background: var(--card-hover-bg, var(--bg-hover));
    }
  }

  &:not([aria-hidden='true']):has(:focus-visible)::before {
    background: var(--card-hover-bg, var(--bg-hover));
  }

  @media (prefers-reduced-motion: reduce) {
    &:not([aria-hidden='true'])::before {
      transition: none;
    }
  }

  .thumb-wrap,
  & > .thumb {
    position: relative;
    display: block;
    aspect-ratio: 2 / 3;
    border-radius: 1.2rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .thumb-wrap > .thumb {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb img.moving {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .details {
    position: relative;
    padding: 0.8rem 3.6rem 0.2rem 0;
  }

  .title {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .views {
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  .more-menu {
    position: absolute;
    top: 0.8rem;
    right: 0;
  }

  .more {
    width: 4rem;
    height: 4rem;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .more:hover,
  .more-menu[data-open] .more {
    background: var(--bg-hover);
  }

  @media (max-width: 1023px) {
    .views {
      font-size: 1.2rem;
      line-height: 1.8rem;
    }
  }
`

/** One vertical tile that opens the Shorts player, as youtube.com draws a Short in a grid or a shelf. */
export const ShortsTile = ({ short }: { short: VideoCardData }) => {
  const href = shortsHrefFor(short.id)
  const state: ShortsLinkState | undefined = short.shortsSequence ? { sequence: short.shortsSequence } : undefined
  const views = formatViews(short.viewCount)
  const playerParams = short.isUpcoming !== true ? short.inlinePlayerParams ?? undefined : undefined
  const canPreview = short.isUpcoming !== true
  const hover = useCardHover({
    id: short.id,
    thumbnail: short.thumbnail,
    playerParams,
    canPreview,
    animatedThumbnail: short.animatedThumbnail,
  })
  const preview = usePreviewActivation({ canPreview, hovered: hover.hovered })
  return (
    <article
      css={shortsTileStyle}
      className='tile'
      style={hover.tintStyle}
      {...hover.handlers}
    >
      <div className='thumb-wrap' {...preview.containerProps}>
        <Link href={href} state={state} className='thumb' tabIndex={-1} aria-hidden='true'>
          {short.thumbnail ? <Thumbnail src={short.thumbnail} srcSet={short.thumbnailSrcset} sizes='21rem' /> : undefined}
          {hover.moving ? <img className='moving' src={hover.moving} alt='' /> : undefined}
        </Link>
        {canPreview
          ? (
            <PreviewTriggerButton
              title={short.title}
              active={preview.keyboardActive}
              onToggle={preview.toggleKeyboard}
              buttonRef={preview.triggerRef}
            />
          )
          : undefined}
        {preview.active
          ? (
            <HoverPreview
              videoId={short.id}
              href={href}
              playerParams={playerParams}
              carryTime={false}
              linkState={state}
              immediate={preview.keyboardActive}
              onFail={short.animatedThumbnail ? hover.handlePreviewFail : undefined}
            />
          )
          : undefined}
      </div>
      <div className='details'>
        <h3 className='title'>
          <Link href={href} state={state}>{short.title}</Link>
        </h3>
        {views ? <div className='views'>{views}</div> : undefined}
        <VideoCardMenu videoId={short.id} title={short.title} iconSize={24} short class='more-menu' />
      </div>
    </article>
  )
}

export default ShortsTile
