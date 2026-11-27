import type { ComponentChildren } from 'preact'

import type { FeedCardStyle, FeedLayoutMode } from '../feeds/settings'
import type { VideoCardData, WatchContext } from './video-card'

import { css } from '@emotion/react'

import { feedCardCssVars } from '../feeds/settings'
import { VideoCard, VideoCardSkeleton } from './video-card'

// 38rem is the smallest minimum that lands on three across at a 1650px viewport, where upstream lands on three
const style = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--feed-grid-card-width, 38rem)), 1fr));
  column-gap: 1.6rem;
  row-gap: var(--feed-row-gap, 4rem);

  /* The channel column is 642, 856, 1070 or 1284px wide, and youtube.com puts
     two, two, three and three cards across them: 31rem is a minimum that does. */
  &.channel {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--feed-grid-card-width, 31rem)), 1fr));
    row-gap: var(--feed-row-gap, 2.4rem);
  }

  &.list {
    display: flex;
    flex-direction: column;
    gap: var(--feed-row-gap, 1.6rem);
  }

  @media (max-width: 500px) {
    &:not(.list),
    &.channel:not(.list) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

const FIRST_PAGE_SKELETONS = 12
const NEXT_PAGE_SKELETONS = 4

// No paging props here: every route already renders its own FeedSentinel as a sibling, so a grid that owned one would fire the same page twice
export const VideoGrid = (
  {
    videos,
    fetching = false,
    variant,
    context,
    shelf,
    recommendable,
    inlinePreview,
    layout = 'grid',
    cardStyle,
    showDuration = true,
    showDescription = false,
    descriptionLines = 2,
  }: {
    videos: VideoCardData[]
    fetching?: boolean
    variant?: 'channel'
    context?: WatchContext
    shelf?: ComponentChildren
    recommendable?: boolean
    inlinePreview?: boolean
    layout?: FeedLayoutMode
    cardStyle?: FeedCardStyle
    showDuration?: boolean
    showDescription?: boolean
    descriptionLines?: number
  },
) => {
  const classes = [variant, layout === 'list' ? 'list' : undefined].filter(Boolean).join(' ')
  const vars = cardStyle ? feedCardCssVars(layout, cardStyle) : undefined
  return (
    <div css={style} className={classes || undefined} style={vars}>
      {/* placed by its own CSS after the first row, whatever its place here */}
      {shelf}
      {videos.map(video => (
        <VideoCard
          key={video.id}
          video={video}
          variant={variant}
          context={context}
          recommendable={recommendable}
          inlinePreview={inlinePreview}
          layout={layout}
          thumbnailPosition={cardStyle?.thumbPosition}
          showDuration={showDuration}
          showDescription={showDescription}
          descriptionLines={descriptionLines}
        />
      ))}
      {fetching
        ? Array.from(
          { length: videos.length === 0 ? FIRST_PAGE_SKELETONS : NEXT_PAGE_SKELETONS },
          (_, index) => <VideoCardSkeleton key={`skeleton-${index}`} layout={layout} />,
        )
        : undefined}
    </div>
  )
}

export default VideoGrid
