import type { TargetedFocusEvent, TargetedSubmitEvent } from 'preact'

import type { ChannelTab, ChannelViewQuery, CommunityPostsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ChevronDown, Link2, Search } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure } from '../components/data-failure'
import { GroupsButton } from '../components/groups-button'
import { PlaylistCard } from '../components/playlist-card'
import { PostCard } from '../components/post-card'
import { ShortsGrid } from '../components/shorts-grid'
import { SubscribeButton } from '../components/subscribe-button'
import { Menu, MenuItem } from '../components/ui/menu'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VerifiedBadge } from '../components/verified-badge'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'
import { useSession } from '../session'
import { useSetting } from '../settings'
import { CHANNEL_NOT_FOUND, CHANNEL_UNAVAILABLE } from '../sources/types'
import { CHANNEL_ABOUT_QUERY, ChannelAboutDialog } from './channel-about'
import { ChannelHome } from './channel-home'
import { visibleChannelShelves } from './channel-rows'
import { ChannelStore } from './channel-store'
import { CHANNEL_TAB_PATHS } from './channel-tabs'

type VideosPage = ChannelViewQuery['channel']['videos']
type PostsPage = CommunityPostsQuery['communityPosts'] | NonNullable<ChannelViewQuery['channel']['posts']>

const COMMUNITY_POSTS_QUERY = gql(`
  query CommunityPosts($channelId: ID!, $cursor: String) {
    communityPosts(channelId: $channelId, cursor: $cursor) {
      items {
        id
        text
        publishedText
        voteCountText
        commentCountText
        commentCountLabel
        attachedImage
        author { id name avatar }
        attachedVideo {
          id
          title
          thumbnail
          thumbnailSrcset
          durationSeconds
          viewCount
          publishedText
          channel { id name }
        }
      }
      cursor
    }
  }
`)

const CHANNEL_VIEW_QUERY = gql(`
  query ChannelView($id: ID!, $tab: ChannelTab, $sort: String, $filter: String, $query: String, $cursor: String) {
    channel(id: $id, tab: $tab, sort: $sort, filter: $filter, query: $query, cursor: $cursor) {
      channel {
        id
        name
        avatar
        handle
        subscriberCountText
        videoCountText
        banner
        description
        tags
        isSubscribed
        isOwnChannel
        notificationLevel
        isVerified
        isVerifiedArtist
      }
      videos {
        items {
          id
          title
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
          isMembersOnly
          badges
          byline { text isVerified isVerifiedArtist }
        }
        playlists {
          id
          title
          thumbnail
          videoCountText
          updatedText
          channel { id name }
        }
        cursor
      }
      availableTabs
      tab
      sortOptions
      appliedSort
      sortMenu
      filterOptions
      appliedFilter
      home {
        featured {
          id
          title
          description
          descriptionRuns { text url videoId startSeconds browseId }
          thumbnail
          thumbnailSrcset
          durationSeconds
          isLive
          isMusic
          isUpcoming
          inlinePlayerParams
          viewCount
          publishedText
        }
        shelves {
          title
          subtitle
          url
          expandable
          uploads
          videos {
            id
            title
            thumbnail
            thumbnailSrcset
            animatedThumbnail
            durationSeconds
            isMusic
            viewCount
            viewCountIcon
            publishedText
            metaDelimiter
            isLive
            isShort
            isUpcoming
            isMembersOnly
            badges
            channel { id name avatar isVerified isVerifiedArtist }
            byline { text isVerified isVerifiedArtist }
            collaborators { id name avatar handle subscriberCountText isVerified isVerifiedArtist }
          }
          shorts {
            id
            title
            thumbnail
            viewCount
            shortsSequence
          }
          playlists {
            id
            title
            thumbnail
            videoCountText
          }
          channels {
            id
            name
            avatar
            subscriberCountText
          }
          games {
            id
            title
            boxArt
          }
          posts {
            id
            text
            publishedText
            voteCountText
            commentCountText
            commentCountLabel
            attachedImage
            author { id name avatar }
            attachedVideo {
              id
              title
              thumbnail
              thumbnailSrcset
              durationSeconds
              viewCount
              publishedText
              channel { id name }
            }
          }
        }
        message
      }
      store {
        title
        scrolls
        products { title url thumbnail price priceNote merchant }
      }
      posts {
        items {
          id
          text
          publishedText
          voteCountText
          commentCountText
          commentCountLabel
          attachedImage
          author { id name avatar }
          attachedVideo {
            id
            title
            thumbnail
            thumbnailSrcset
            durationSeconds
            viewCount
            publishedText
            channel { id name }
          }
        }
        cursor
      }
    }
  }
`)

const TAB_LABELS: Record<ChannelTab, string> = {
  HOME: 'Home',
  VIDEOS: 'Videos',
  SHORTS: 'Shorts',
  LIVE: 'Live',
  RELEASES: 'Releases',
  PODCASTS: 'Podcasts',
  COURSES: 'Courses',
  SHOWS: 'Shows',
  PLAYLISTS: 'Playlists',
  COMMUNITY: 'Posts',
  STORE: 'Store',
  ABOUT: 'About',
  SEARCH: 'Search',
}

const emptyMessageFor = (tab?: ChannelTab) => {
  if (tab === undefined || tab === 'VIDEOS' || tab === 'HOME') return 'This channel has no videos.'
  if (tab === 'SHORTS') return 'This channel has no shorts.'
  if (tab === 'LIVE') return 'This channel has no live streams.'
  return `This channel has nothing under ${TAB_LABELS[tab]}.`
}

const style = css`
  /* youtube.com widens the channel column in steps of one 214px row card, up
     to six of them, and centres it. Measured on youtube.com/@RickAstleyYT at
     1000 to 2560px wide, 2026-11-05. */
  width: max(min(100% - 3.2rem, 64.2rem), min(128.4rem, round(down, 100% - 4.8rem, 21.4rem)));
  margin: 0 auto;
  padding: 2.4rem 0;

  .banner {
    display: block;
    width: 100%;
    aspect-ratio: 6.2 / 1;
    border-radius: 1.6rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    margin-top: 2.4rem;
  }

  .avatar {
    flex: none;
    width: 16rem;
    height: 16rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-chip);
  }

  .avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 6.4rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name {
    font-size: 3.6rem;
    font-weight: 700;
    line-height: 5rem;
    color: var(--text-primary);
  }

  .meta {
    margin-top: 0.4rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  .description {
    display: flex;
    max-width: min(60rem, 100%);
    margin-top: 0.8rem;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
    text-align: left;
  }

  button.description {
    cursor: pointer;
  }

  .description-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button.description .description-text {
    text-overflow: clip;
    mask-image: linear-gradient(to right, #000 calc(100% - 2.4rem), transparent);
  }

  .description .more,
  .more-links {
    flex: none;
    margin-left: 0.4rem;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
  }

  .links {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.8rem;
    min-height: 2rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--accent);
  }

  .links-skeleton span {
    display: block;
    width: 18rem;
    max-width: 100%;
    height: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
  }

  .links a {
    min-width: 0;
    overflow: hidden;
    color: var(--accent);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .links .more-links {
    margin-left: 0;
  }

  .subscribe-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  .owner-action {
    display: inline-flex;
    align-items: center;
    height: 3.6rem;
    padding: 0 1.6rem;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .owner-action:hover {
    background: var(--bg-chip-hover);
  }

  /* The rule is an inset shadow rather than a border so the active tab's
     underline can cover it inside the strip, which scrolls on a phone. */
  .tabs {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    min-height: 4.8rem;
    margin-top: 2.4rem;
    overflow-x: auto;
    scrollbar-width: none;
    box-shadow: inset 0 -1px var(--border-subtle);
  }

  .tab-skeleton {
    flex: none;
    width: 5.6rem;
    height: 1.6rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
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

  .tab-icon {
    display: flex;
    padding: 1rem 0;
  }

  .tab-search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    color: var(--text-secondary);
  }

  .tab-search input {
    width: 22rem;
    padding: 0.4rem 0;
    border: none;
    border-bottom: 1px solid var(--text-primary);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    outline: none;
  }

  /* Only rendered when the tab offers more than one ordering, so it never shows
     a single dead option next to itself. The labels are upstream's own and are
     already localized. */
  .sorts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 1.6rem 0 0;
  }

  .sort {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .sort:hover {
    background: var(--bg-chip-hover);
  }

  .sort.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .sort.menu {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
  }

  .sort-skeleton {
    width: 7.2rem;
    background: var(--bg-elevated);
    pointer-events: none;
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
  }

  .videos {
    margin-top: 2.4rem;
  }

  /* Five cards across a 1284px channel column (four at 1070px), matching
     youtube.com's Playlists grid density while collapsing cleanly on phones. */
  .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(21rem, 100%), 1fr));
    column-gap: 1.6rem;
    row-gap: 2.4rem;
  }

  /* A single readable column rather than a grid: a post is a body of text, and
     the video grid's card width would set the measure far too wide. */
  .posts {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 68rem;
  }

  .skeleton-pulse {
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
  }

  .skeleton-slot {
    display: flex;
    align-items: center;
    height: 2rem;
  }

  .skeleton-slot span {
    display: block;
    height: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
  }

  .skeleton-name {
    height: 5rem;
  }

  .skeleton-name span {
    width: 24rem;
    max-width: 70%;
    height: 3.4rem;
    border-radius: 0.6rem;
  }

  .skeleton-meta {
    margin-top: 0.4rem;
  }

  .skeleton-meta span {
    width: 28rem;
    max-width: 85%;
  }

  .skeleton-desc {
    margin-top: 0.8rem;
  }

  .skeleton-desc span {
    width: 42rem;
    max-width: 100%;
  }

  .skeleton-links {
    margin-top: 0.8rem;
  }

  .skeleton-links span {
    width: 18rem;
    max-width: 60%;
  }

  .skeleton-button {
    display: block;
    width: 10.6rem;
    height: 3.6rem;
    border-radius: 1.8rem;
    background: var(--bg-elevated);
  }

  .post-skeleton {
    padding: 1.6rem;
    border: 1px solid var(--border-subtle);
    border-radius: 1.2rem;
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
  }

  .post-skeleton-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .post-skeleton-avatar {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: var(--bg-elevated);
  }

  .post-skeleton-bar {
    height: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
  }

  .post-skeleton-body {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  .post-skeleton-footer {
    width: 12rem;
    height: 2rem;
    margin-top: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
  }

  .playlist-skeleton {
    min-width: 0;
    animation: channel-skeleton-pulse 1.6s ease-in-out infinite;
  }

  .playlist-skeleton-cover {
    margin-top: 0.6rem;
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    background: var(--bg-elevated);
  }

  .playlist-skeleton-bar {
    height: 1.6rem;
    margin-top: 1.2rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
  }

  .playlist-skeleton-bar.short {
    width: 60%;
    margin-top: 0.8rem;
  }

  @keyframes channel-skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }

  .status {
    margin-top: 2.4rem;
    color: var(--text-secondary);
  }

  /* youtube.com's 404 page, measured at 1280 px on 2026-11-10 */
  .not-found {
    margin-top: 16rem;
    text-align: center;
    font-size: 1.6rem;
    line-height: 1.8rem;
    color: var(--text-primary);
  }

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .avatar {
      width: 9.6rem;
      height: 9.6rem;
    }

    .avatar.fallback {
      font-size: 4rem;
    }

    /* full width rather than shrink-wrapped, or the one-line description
       would size it to the whole unwrapped text */
    .info {
      width: 100%;
    }

    .description,
    .links,
    .subscribe-row {
      justify-content: center;
    }

    .description {
      margin-inline: auto;
    }

    .name {
      font-size: 2.4rem;
      line-height: 3.2rem;
    }

    .skeleton-slot {
      justify-content: center;
    }

    .skeleton-name {
      height: 3.2rem;
    }

    .skeleton-name span {
      width: 18rem;
      height: 2.4rem;
    }
  }
`

const ChannelHeaderSkeleton = () => (
  <>
    <div className='banner skeleton-pulse' aria-hidden='true' />
    <header className='header skeleton-pulse' aria-hidden='true'>
      <div className='avatar' />
      <div className='info'>
        <div className='skeleton-slot skeleton-name'><span /></div>
        <div className='skeleton-slot skeleton-meta'><span /></div>
        <div className='skeleton-slot skeleton-desc'><span /></div>
        <div className='skeleton-slot skeleton-links'><span /></div>
        <div className='subscribe-row'>
          <span className='skeleton-button' />
        </div>
      </div>
    </header>
  </>
)

const PostCardSkeleton = () => (
  <div className='post-skeleton' aria-hidden='true'>
    <div className='post-skeleton-head'>
      <div className='post-skeleton-avatar' />
      <div className='post-skeleton-bar' style={{ width: '16rem' }} />
    </div>
    <div className='post-skeleton-body'>
      <div className='post-skeleton-bar' style={{ width: '92%' }} />
      <div className='post-skeleton-bar' style={{ width: '78%' }} />
      <div className='post-skeleton-bar' style={{ width: '54%' }} />
    </div>
    <div className='post-skeleton-footer' />
  </div>
)

const PlaylistCardSkeleton = () => (
  <div className='playlist-skeleton' aria-hidden='true'>
    <div className='playlist-skeleton-cover' />
    <div className='playlist-skeleton-bar' />
    <div className='playlist-skeleton-bar short' />
  </div>
)

const SORTABLE_TABS = new Set<ChannelTab>(['VIDEOS', 'SHORTS', 'LIVE', 'PLAYLISTS'])
const PLAYLIST_TABS = new Set<ChannelTab>(['PLAYLISTS', 'SHOWS', 'RELEASES', 'PODCASTS', 'COURSES'])

const normalizeHandle = (value: string | null | undefined) =>
  value ? value.replace(/^@/, '').trim().toLowerCase() : undefined

/**
 * A channel at one of youtube.com's addresses for it. `id` is what the source resolves (a UC id, `@handle`, `c/<name>` or
 * `user/<name>`), `base` the address without a tab, and `tab` the one the address names.
 */
export const ChannelPage = ({ id, base, tab: requestedTab }: { id: string, base: string, tab?: ChannelTab }) => {
  const { signedIn, handle: sessionHandle } = useSession()
  const search = useSearch()
  const urlParams = new URLSearchParams(search)
  const [location, navigate] = useLocation()
  // youtube.com's /about opens the channel with its About dialog over it
  const aboutRequested = requestedTab === 'ABOUT'
  const tab = aboutRequested ? undefined : requestedTab
  const sort = urlParams.get('sort') ?? undefined
  const filter = urlParams.get('filter') ?? undefined
  const channelQuery = urlParams.get('query') ?? undefined
  // tab, sort, filter and in-channel query are part of the feed identity: switching any of them MUST restart paging
  const feedKey = `${id}|${tab ?? ''}|${sort ?? ''}|${filter ?? ''}|${channelQuery ?? ''}`
  const [loaded, setLoaded] = useState<{ id: string, pages: VideosPage[] }>({ id: feedKey, pages: [] })
  const pages = loaded.id === feedKey ? loaded.pages : []
  const [{ data: answer, error, fetching }, reexecute] = useQuery({
    query: CHANNEL_VIEW_QUERY,
    variables: { id, tab, sort, filter, query: channelQuery, cursor: pages[pages.length - 1]?.cursor }
  })
  // a later page that failed answers with no data, which would take the header and tabs above the loaded pages with it
  const lastAnswer = useRef<{ key: string, data: typeof answer }>(undefined)
  if (answer) lastAnswer.current = { key: feedKey, data: answer }
  const data = answer ?? (pages.length > 0 && lastAnswer.current?.key === feedKey ? lastAnswer.current.data : undefined)
  const channel = data?.channel.channel
  const unavailable = error?.graphQLErrors.find(entry => entry.message.startsWith(CHANNEL_UNAVAILABLE))
  const missing = error?.graphQLErrors.some(entry => entry.message === CHANNEL_NOT_FOUND) === true
  const page = data?.channel.videos
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id
  })
  const { items: playlists } = useInfiniteFeed({
    pages: (page ? [...pages, page] : pages).map(entry => ({ items: entry.playlists, cursor: entry.cursor })),
    key: playlist => playlist.id,
  })
  useDocumentTitle(channel?.name ?? 'Channel')
  const handle = channel?.handle
    ? channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`
    : undefined
  const activeHandle = normalizeHandle(sessionHandle)
  const isOwnChannel = channel?.isOwnChannel === true
    || (signedIn && Boolean(activeHandle) && activeHandle === normalizeHandle(channel?.handle))
  const metaParts = [handle, channel?.subscriberCountText, channel?.videoCountText]
    .filter(part => part != null && part.length > 0)
  const meta = metaParts.length > 0 ? metaParts.join(' • ') : undefined
  // youtube.com's tabs open under the channel's handle whichever address it was opened at
  const channelPath = channel ? handle ? `/${handle}` : `/channel/${channel.id}` : base

  const setView = (param: 'sort' | 'filter', value: string) => {
    const next = new URLSearchParams(search)
    if (next.get(param) === value) next.delete(param)
    else next.set(param, value)
    const rest = next.toString()
    navigate(rest ? `${location}?${rest}` : location)
  }

  const activeTab = data?.channel.tab
  const displayTab = activeTab ?? tab
  const hasAbout = data?.channel.availableTabs.includes('ABOUT') === true
  // asked with the page rather than on "...more": the header's links line is read off it
  const [{ data: aboutData, error: aboutError }] = useQuery({
    query: CHANNEL_ABOUT_QUERY,
    variables: { id },
    pause: !hasAbout,
  })
  const about = aboutData?.channelAbout ?? undefined
  const [firstLink, ...moreLinks] = about?.links ?? []
  const aboutPending = hasAbout && aboutData === undefined && !aboutError
  const hasSearch = data?.channel.availableTabs.includes('SEARCH') === true
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // focused before the first paint, so the keystroke after the click lands in the box
  useLayoutEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching])
  const onSearch = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = searchRef.current?.value.trim()
    if (!value) return
    setSearching(false)
    navigate(`${channelPath}/${CHANNEL_TAB_PATHS.SEARCH}?${new URLSearchParams({ query: value })}`)
  }

  const [aboutOpen, setAboutOpen] = useState(false)
  const openAbout = () => setAboutOpen(true)
  // stable, since the dialog re-runs its focus effect whenever onClose changes
  const closeAbout = useCallback(() => {
    setAboutOpen(false)
    if (aboutRequested) navigate(base, { replace: true })
  }, [aboutRequested, base, navigate])

  const initialPosts = data?.channel.posts ?? undefined
  const [morePosts, setMorePosts] = useState<{ id: string, pages: PostsPage[], cursor?: string }>({ id: feedKey, pages: [] })
  const loadedPostPages = morePosts.id === feedKey ? morePosts.pages : []
  const requestedPostsCursor = morePosts.id === feedKey ? morePosts.cursor : undefined
  const [{ data: postsData, error: postsError, fetching: postsFetching }, reexecutePosts] = useQuery({
    query: COMMUNITY_POSTS_QUERY,
    variables: { channelId: id, cursor: requestedPostsCursor },
    pause: activeTab !== 'COMMUNITY' || !requestedPostsCursor,
  })
  const nextPostPage = requestedPostsCursor && postsData?.communityPosts && postsData.communityPosts !== loadedPostPages[loadedPostPages.length - 1]
    ? postsData.communityPosts
    : undefined
  const { items: posts, cursor: postsCursor } = useInfiniteFeed({
    pages: [
      ...(initialPosts ? [initialPosts] : []),
      ...loadedPostPages,
      ...(nextPostPage ? [nextPostPage] : []),
    ],
    key: post => post.id,
  })

  const onMorePosts = () => {
    if (!postsCursor || postsFetching || fetching) return
    const nextLoaded = nextPostPage ? [...loadedPostPages, nextPostPage] : loadedPostPages
    setMorePosts({ id: feedKey, pages: nextLoaded, cursor: postsCursor })
  }

  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ id: feedKey, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  const showHeaderSkeleton = !channel && fetching && !error
  const hideShorts = useSetting('hideShorts')
  const expectsSorts = tab !== undefined && SORTABLE_TABS.has(tab)
  const isPlaylistTab = displayTab !== undefined && PLAYLIST_TABS.has(displayTab)
  const visibleItems = hideShorts ? items.filter(video => !video.isShort) : items
  const visibleHome = data?.channel.home
    ? { ...data.channel.home, shelves: visibleChannelShelves(data.channel.home.shelves, hideShorts) }
    : undefined

  return (
    <main css={style}>
      {channel?.banner ? <img className='banner' src={channel.banner} alt='' /> : undefined}
      {channel
        ? (
          <header className='header'>
            <div className={channel.avatar ? 'avatar' : 'avatar fallback'}>
              {channel.avatar
                ? <img src={channel.avatar} alt='' />
                : channel.name.slice(0, 1).toUpperCase()}
            </div>
            <div className='info'>
              <h1 className='name'>{channel.name}<VerifiedBadge channel={channel} size={20} /></h1>
              {meta ? <p className='meta'>{meta}</p> : undefined}
              {hasAbout
                ? (
                  <button type='button' className='description' onClick={openAbout}>
                    <span className='description-text'>{channel.description ?? 'More about this channel'}</span>
                    <span className='more'>...more</span>
                  </button>
                )
                : channel.description
                  ? <p className='description'><span className='description-text'>{channel.description}</span></p>
                  : undefined}
              {firstLink
                ? (
                  <p className='links'>
                    <Link2 size={14} strokeWidth={2} aria-hidden='true' />
                    <a href={firstLink.url} target='_blank' rel='noreferrer noopener'>{firstLink.displayUrl ?? firstLink.title}</a>
                    {moreLinks.length > 0
                      ? (
                        <button type='button' className='more-links' onClick={openAbout}>
                          and {moreLinks.length} more {moreLinks.length === 1 ? 'link' : 'links'}
                        </button>
                      )
                      : undefined}
                  </p>
                )
                : aboutPending
                  ? <p className='links links-skeleton' aria-hidden='true'><span /></p>
                  : undefined}
              <div className='subscribe-row'>
                {isOwnChannel
                  ? (
                    <>
                      <a
                        className='owner-action'
                        href={`https://studio.youtube.com/channel/${encodeURIComponent(channel.id)}/editing`}
                        target='_blank'
                        rel='noreferrer noopener'
                      >
                        Customize channel
                      </a>
                      <a
                        className='owner-action'
                        href={`https://studio.youtube.com/channel/${encodeURIComponent(channel.id)}/videos`}
                        target='_blank'
                        rel='noreferrer noopener'
                      >
                        Manage videos
                      </a>
                    </>
                  )
                  : (
                    <>
                      <SubscribeButton
                        channelId={channel.id}
                        subscribed={channel.isSubscribed}
                        notificationLevel={channel.notificationLevel}
                      />
                      <GroupsButton
                        channel={{ id: channel.id, name: channel.name, avatar: channel.avatar ?? undefined }}
                        hints={{ handle: channel.handle, description: channel.description, tags: channel.tags, isVerifiedArtist: channel.isVerifiedArtist }}
                      />
                    </>
                  )}
              </div>
            </div>
          </header>
        )
        : showHeaderSkeleton
          ? <ChannelHeaderSkeleton />
          : undefined}
      {channel && (aboutOpen || aboutRequested)
        ? <ChannelAboutDialog name={channel.name} about={about} description={channel.description} onClose={closeAbout} />
        : undefined}
      {missing
        ? (
          <div className='not-found'>
            <p>This page isn't available. Sorry about that.</p>
            <p>Try searching for something else.</p>
          </div>
        )
        : undefined}
      {unavailable ? <p className='status'>{unavailable.message.slice(CHANNEL_UNAVAILABLE.length)}</p> : undefined}
      {error && !missing && !unavailable && !fetching && pages.length === 0 ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {!missing && !unavailable && (!error || Boolean(data))
        ? (
          <nav className='tabs' aria-label='Channel sections'>
            {!data && fetching && !error
              ? Array.from({ length: 6 }, (_, index) => <span key={index} className='tab-skeleton' aria-hidden='true' />)
              : undefined}
            {(data?.channel.availableTabs ?? []).filter(available => available !== 'ABOUT' && available !== 'SEARCH' && (!hideShorts || available !== 'SHORTS')).map(available => {
              const active = available === data?.channel.tab
              return (
                <Link
                  key={available}
                  href={`${channelPath}/${CHANNEL_TAB_PATHS[available]}`}
                  className={active ? 'tab active' : 'tab'}
                  aria-current={active ? 'page' : undefined}
                >
                  {TAB_LABELS[available]}
                </Link>
              )
            })}
            {hasSearch && (searching || channelQuery !== undefined)
              ? (
                <form className='tab-search' onSubmit={onSearch}>
                  <Search size={20} strokeWidth={1.5} aria-hidden='true' />
                  <input
                    key={channelQuery}
                    ref={searchRef}
                    type='search'
                    placeholder='Search'
                    aria-label='Search this channel'
                    defaultValue={channelQuery}
                    onBlur={(event: TargetedFocusEvent<HTMLInputElement>) => {
                      if (!event.currentTarget.value) setSearching(false)
                    }}
                  />
                </form>
              )
              : hasSearch
                ? (
                  <button type='button' className='tab tab-icon' aria-label='Search' onClick={() => setSearching(true)}>
                    <Search size={20} strokeWidth={1.5} />
                  </button>
                )
                : undefined}
          </nav>
        )
        : undefined}
      {(data?.channel.sortOptions.length ?? 0) > 1 || (data?.channel.filterOptions.length ?? 0) > 0
        ? (
          <div className='sorts'>
            {data?.channel.sortMenu
              ? (
                <Menu
                  label='Sort by'
                  align='start'
                  trigger={
                    <button type='button' className='sort menu'>
                      {data.channel.appliedSort ?? data.channel.sortOptions[0]}
                      <ChevronDown size={20} strokeWidth={1.5} />
                    </button>
                  }
                >
                  {data.channel.sortOptions.map(option => (
                    <MenuItem
                      key={option}
                      label={option}
                      onSelect={() => {
                        if (option !== (data.channel.appliedSort ?? data.channel.sortOptions[0])) setView('sort', option)
                      }}
                    />
                  ))}
                </Menu>
              )
              : data?.channel.sortOptions.map(option => {
                const active = option === (data.channel.appliedSort ?? data.channel.sortOptions[0])
                return (
                  <button
                    key={option}
                    type='button'
                    className={active ? 'sort active' : 'sort'}
                    aria-pressed={active}
                    onClick={() => setView('sort', option)}
                  >
                    {option}
                  </button>
                )
              })}
            {data?.channel.filterOptions.map(option => {
              const active = option === data.channel.appliedFilter
              return (
                <button
                  key={option}
                  type='button'
                  className={active ? 'sort active' : 'sort'}
                  aria-pressed={active}
                  onClick={() => setView('filter', option)}
                >
                  {option}
                </button>
              )
            })}
          </div>
        )
        : !data && fetching && !error && expectsSorts
          ? (
            <div className='sorts' aria-hidden='true'>
              <span className='sort sort-skeleton' />
              <span className='sort sort-skeleton' />
              <span className='sort sort-skeleton' />
            </div>
          )
          : undefined}
      {displayTab === 'COMMUNITY'
        ? (
          <div className='videos'>
            <div className='posts'>
              {posts.map(post => <PostCard key={post.id} post={post} />)}
              {(fetching && posts.length === 0 && !error) || postsFetching
                ? Array.from({ length: posts.length === 0 ? 3 : 1 }, (_, index) => (
                  <PostCardSkeleton key={`post-skeleton-${index}`} />
                ))
                : undefined}
            </div>
            {postsError && !postsFetching
              ? <DataFailure error={postsError} reexecute={reexecutePosts} />
              : data && !fetching && !postsFetching && !error && !postsError && posts.length === 0
                ? <p className='status'>This channel has no posts.</p>
                : undefined}
            <FeedSentinel onVisible={onMorePosts} disabled={fetching || postsFetching || Boolean(postsError) || !postsCursor} />
          </div>
        )
        : activeTab === 'STORE' && data?.channel.store
          ? (
            <div className='videos'>
              <ChannelStore shelves={data.channel.store} />
              {data.channel.store.length === 0 ? <p className='status'>{emptyMessageFor('STORE')}</p> : undefined}
            </div>
          )
          : activeTab === 'HOME' && visibleHome
          ? (
            <div className='videos'>
              <ChannelHome home={visibleHome} />
              {!visibleHome.featured && visibleHome.shelves.length === 0
                ? <p className='status'>{visibleHome.message ?? emptyMessageFor('HOME')}</p>
                : undefined}
            </div>
          )
          : (
              <>
                <div className='videos'>
                  {displayTab === 'SHORTS'
                    ? <ShortsGrid shorts={visibleItems} fetching={fetching && !error} />
                    : visibleItems.length > 0 || (fetching && !error && !isPlaylistTab)
                      ? <VideoGrid videos={visibleItems} fetching={fetching && !error && !isPlaylistTab && visibleItems.length === 0} variant='channel' />
                      : undefined}
                  {playlists.length > 0
                    ? (
                      <div className='playlist-grid'>
                        {playlists.map(playlist => (
                          <PlaylistCard
                            key={playlist.id}
                            id={playlist.id}
                            title={playlist.title}
                            thumbnail={playlist.thumbnail}
                            videoCountText={playlist.videoCountText}
                            updatedText={playlist.updatedText}
                            channelName={activeTab === 'SHOWS' ? playlist.channel?.name : undefined}
                          />
                        ))}
                      </div>
                    )
                    : fetching && !error && isPlaylistTab && visibleItems.length === 0
                      ? (
                        <div className='playlist-grid' aria-hidden='true'>
                          {Array.from({ length: 10 }, (_, index) => <PlaylistCardSkeleton key={index} />)}
                        </div>
                      )
                      : undefined}
                  {data && !fetching && !error && visibleItems.length === 0 && playlists.length === 0
                    ? <p className='status'>{emptyMessageFor(tab)}</p>
                    : undefined}
                </div>
                {fetching && visibleItems.length > 0 ? <p className='status'>Loading more…</p> : undefined}
                {error && !fetching && pages.length > 0 ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
                <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
              </>
            )}
    </main>
  )
}

export default ChannelPage
