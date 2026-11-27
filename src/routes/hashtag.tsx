import type { HashtagPageQuery, HashtagTab } from '../generated/graphql'

import { css } from '@emotion/react'
import { useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure } from '../components/data-failure'
import { FeedSettingsPanel } from '../components/feed-settings-panel'
import { FeedFilterChips, FeedViewButtons } from '../components/feed-view-controls'
import { ShortsGrid } from '../components/shorts-grid'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoGrid } from '../components/video-grid'
import {
  EMPTY_PAGES_LIMIT,
  matchesBlockedChannels,
  matchesBlockedKeywords,
  matchesFeedViewFilter,
  trailingEmptyPages,
} from '../feeds/filter'
import { useFeedViewSettings } from '../feeds/settings'
import { gql } from '../generated'
import { useSetting } from '../settings'

const HASHTAG_PAGE_QUERY = gql(`
  query HashtagPage($tag: String!, $tab: HashtagTab, $cursor: String) {
    hashtag(tag: $tag, tab: $tab, cursor: $cursor) {
      tag
      title
      stats
      tab
      availableTabs
      items {
        id
        title
        description
        descriptionSnippet
        inlinePlayerParams
        thumbnail
        thumbnailSrcset
        animatedThumbnail
        thumbnailBadge
        durationSeconds
        isMusic
        viewCount
        viewCountIcon
        publishedText
        metaDelimiter
        isLive
        isShort
        shortsSequence
        isUpcoming
        isMostRelevant
        isMembersOnly
        progressPercent
        badges
        channel { id name avatar isVerified isVerifiedArtist }
        byline { text isVerified isVerifiedArtist }
        collaborators { id name avatar handle subscriberCountText isVerified isVerifiedArtist }
      }
      cursor
    }
  }
`)

type HashtagPageResult = HashtagPageQuery['hashtag']

const style = css`
  width: max(min(100% - 3.2rem, 64.2rem), min(128.4rem, round(down, 100% - 4.8rem, 21.4rem)));
  margin: 0 auto;
  padding: 2.4rem 0;

  .header {
    margin-bottom: 1.6rem;
  }

  .name {
    margin: 0;
    font-size: 3.6rem;
    font-weight: 700;
    line-height: 5rem;
    color: var(--text-primary);
  }

  .stats {
    margin: 0.4rem 0 0;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    min-height: 4.8rem;
    margin-top: 1.6rem;
    overflow-x: auto;
    scrollbar-width: none;
    box-shadow: inset 0 -1px var(--border-subtle);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.2rem 1.6rem;
    margin-top: 1.6rem;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 4.8rem;
    padding: 0;
    border: none;
    border-bottom: 0.25rem solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font-size: 1.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--text-primary);
  }

  .videos {
    margin-top: 2.4rem;
  }

  .status {
    margin-top: 2.4rem;
    color: var(--text-secondary);
  }

  .load-more {
    display: block;
    height: 3.6rem;
    margin: 2.4rem auto 0;
    padding: 0 1.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .load-more:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  @media (max-width: 768px) {
    .name {
      font-size: 2.4rem;
      line-height: 3.2rem;
    }
  }
`

export const HashtagPage = ({ tag, tab = 'ALL' }: { tag: string, tab?: HashtagTab }) => {
  const feedKey = `${tag.toLowerCase()}|${tab}`
  const [loaded, setLoaded] = useState<{ key: string, pages: HashtagPageResult[] }>({ key: feedKey, pages: [] })
  const pages = loaded.key === feedKey ? loaded.pages : []
  const [{ data: answer, error, fetching }, reexecute] = useQuery({
    query: HASHTAG_PAGE_QUERY,
    variables: { tag, tab, cursor: pages[pages.length - 1]?.cursor },
  })
  const lastAnswer = useRef<{ key: string, data: typeof answer }>(undefined)
  if (answer) lastAnswer.current = { key: feedKey, data: answer }
  const data = answer ?? (pages.length > 0 && lastAnswer.current?.key === feedKey ? lastAnswer.current.data : undefined)
  const page = data?.hashtag
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id,
  })
  const hideShorts = useSetting('hideShorts')
  const feedSettings = useFeedViewSettings()
  const [panelOpen, setPanelOpen] = useState(false)
  const layout = feedSettings.layouts.other
  const cardStyle = feedSettings.cardStyles[layout]
  const allPages = page && pages[pages.length - 1] !== page ? [...pages, page] : pages
  const keeps = (item: HashtagPageResult['items'][number]) =>
    tab === 'SHORTS'
      ? !matchesBlockedKeywords(item, feedSettings.blockedKeywords)
        && !matchesBlockedChannels(item, feedSettings.blockedChannels)
      : matchesFeedViewFilter(item, feedSettings, hideShorts)
  const visibleItems = items.filter(keeps)
  const stalled = trailingEmptyPages(allPages, keeps) >= EMPTY_PAGES_LIMIT
  const filteredOut = items.length > 0 && visibleItems.length === 0
  const heading = page?.title ?? `#${tag.toLowerCase()}`
  useDocumentTitle(heading)

  const availableTabs = page?.availableTabs ?? (tab === 'SHORTS' ? ['ALL', 'SHORTS'] as HashtagTab[] : ['ALL'] as HashtagTab[])
  const showTabs = !hideShorts && availableTabs.includes('SHORTS')
  const basePath = `/hashtag/${encodeURIComponent(page?.tag || tag.toLowerCase())}`

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded({ key: feedKey, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  return (
    <main css={style}>
      <header className='header'>
        <h1 className='name'>{heading}</h1>
        {page?.stats ? <p className='stats'>{page.stats}</p> : undefined}
      </header>
      {showTabs
        ? (
          <nav className='tabs' aria-label='Hashtag sections'>
            <Link
              href={basePath}
              className={tab === 'ALL' ? 'tab active' : 'tab'}
              aria-current={tab === 'ALL' ? 'page' : undefined}
            >
              All
            </Link>
            <Link
              href={`${basePath}/shorts`}
              className={tab === 'SHORTS' ? 'tab active' : 'tab'}
              aria-current={tab === 'SHORTS' ? 'page' : undefined}
            >
              Shorts
            </Link>
          </nav>
        )
        : undefined}
      {tab !== 'SHORTS'
        ? (
          <div className='toolbar'>
            <FeedFilterChips />
            <FeedViewButtons
              surface='other'
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(open => !open)}
            />
          </div>
        )
        : undefined}
      {error && !fetching && pages.length === 0 ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      <div className='videos'>
        {tab === 'SHORTS'
          ? <ShortsGrid shorts={visibleItems} fetching={fetching && !error} />
          : visibleItems.length > 0 || (fetching && !error)
            ? (
              <VideoGrid
                videos={visibleItems}
                fetching={fetching && !error && visibleItems.length === 0}
                variant='channel'
                layout={layout}
                cardStyle={cardStyle}
                showDuration={feedSettings.showDuration}
                showDescription={cardStyle.descriptionLines > 0}
                descriptionLines={cardStyle.descriptionLines}
              />
            )
            : undefined}
        {data && !fetching && !error && visibleItems.length === 0 && (stalled || !cursor)
          ? (
            <p className='status'>
              {filteredOut
                ? 'Filters hide everything on this page.'
                : tab === 'SHORTS'
                  ? 'No Shorts for this hashtag.'
                  : 'No videos for this hashtag.'}
            </p>
          )
          : undefined}
      </div>
      {fetching && visibleItems.length > 0 ? <p className='status'>Loading more…</p> : undefined}
      {error && !fetching && pages.length > 0 ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {stalled && cursor && !fetching && !error
        ? <button type='button' className='load-more' onClick={onMore}>Load more</button>
        : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor || stalled} />
      <FeedSettingsPanel surface='other' open={panelOpen} onClose={() => setPanelOpen(false)} />
    </main>
  )
}

export default HashtagPage
