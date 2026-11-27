import type { SearchCardData } from '../../../src/components/search-card'
import type { SourceApi, SourceChannelPage, SourceVideoPage } from '../../../src/sources/types'
import type { SeekHandle } from '../../../src/theme/seek-handle'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'

import { SearchCard } from '../../../src/components/search-card'
import { ShortsGrid } from '../../../src/components/shorts-grid'
import { ShortsShelf } from '../../../src/components/shorts-shelf'
import { ShortsTile } from '../../../src/components/shorts-tile'
import { VideoCard } from '../../../src/components/video-card'
import { createCache } from '../../../src/graphql'
import { HoverPreviewScrubber, hoverPreviewStyle } from '../../../src/player/hover-preview'
import { ChannelPage } from '../../../src/routes/channel'
import SubscriptionsFeedPage from '../../../src/routes/feed-subscriptions'
import HomePage from '../../../src/routes/home'
import SearchPage from '../../../src/routes/search'
import { updateSettings, useSetting } from '../../../src/settings'
import { createYoutubeSource } from '../../../src/sources/youtube'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export const ROW_PARAMS = 'YAHIAQGiBhUBqHapM4pS7yURthtEeAtKvDyfuqPSBwkJ7hwBhyohjO8='
export const CARD_PARAMS = 'YAHIAQG6BQQSAmVuogYVAah2qTMljWapEebunsDzXCMdS7Rt0gcJCe4cAYcqIYzv'
// a live search row's own, off youtube.com's "lofi" search on 2026-11-11
export const LIVE_PARAMS = 'YAHIAQGiBhUBqHapMykbq0UjDjSaUZvbMaJKQiY='
// a one-pixel GIF, so the moving thumbnail loads with nothing asked of YouTube
export const MOVING = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const channel = { id: 'channel-0', name: 'Channel 0' }

const searchRow = {
  __typename: 'Video',
  id: 'search-0',
  title: 'Guitar Lesson 1',
  inlinePlayerParams: ROW_PARAMS,
  description: null,
  descriptionSnippet: null,
  snippetRuns: null,
  thumbnail: null,
  thumbnailSrcset: null,
  durationSeconds: 754,
  isMusic: null,
  viewCount: '1.2M',
  publishedText: '2y ago',
  isLive: null,
  isUpcoming: null,
  isShort: null,
  badges: [],
  channel: { ...channel, avatar: null, isVerified: null, isVerifiedArtist: null },
  chapters: null,
  chaptersTitle: null,
  byline: null,
  collaborators: null,
}

// a Home card with its params, a channel upload with a moving thumbnail and none, and one with neither
const homeCard = { id: 'home-0', title: 'A Home card', durationSeconds: 600, inlinePlayerParams: CARD_PARAMS, channel }
const movingCard = { id: 'moving-0', title: 'A channel upload', durationSeconds: 300, animatedThumbnail: MOVING }
const stillCard = { id: 'still-0', title: 'An older channel upload', durationSeconds: 420 }

const liveRow = { ...searchRow, id: 'live-0', title: 'A live stream', inlinePlayerParams: LIVE_PARAMS, durationSeconds: null, isLive: true }
const liveCard = { id: 'live-1', title: 'A live Home card', inlinePlayerParams: LIVE_PARAMS, isLive: true, channel }

const answerSearch = (row: object) => async (_url: RequestInfo | URL, init?: RequestInit) => {
  const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
  const data = operationName === 'SearchResults' ? { search: { results: [row], refinements: [], cursor: null, unwatchedChip: false } } : null
  return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
}

// served by the dev server and imported from a spec, to hover rows and cards with and without inline playback params,
// or a live row and card with theirs
export const mountPreviews = (live = false) => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '1200px'
  document.body.append(host)
  const fetch = answerSearch(live ? liveRow : searchRow)
  const client = new Client({ url: '/preview-harness', exchanges: [fetchExchange], fetch, preferGetMethod: false })
  render(
    <Provider value={client}>
      <section data-previews='cards' style={{ display: 'grid', gridTemplateColumns: '360px 360px 360px', gap: '16px' }}>
        {live
          ? <VideoCard video={liveCard} />
          : (
            <>
              <VideoCard video={homeCard} />
              <VideoCard video={movingCard} variant='channel' />
              <VideoCard video={stillCard} variant='channel' />
            </>
          )}
      </section>
      <section data-previews='search'>
        <SearchPage />
      </section>
    </Provider>,
    host,
  )
}

const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'

// a channel's page as the worker answers it, through the app's own schema, resolvers and cache: its one upload carries
// a moving thumbnail and no params, as a channel's Home rows and Videos tab do on youtube.com
export const mountChannel = (tab: 'HOME' | 'VIDEOS') => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '1200px'
  document.body.append(host)
  const upload = { id: 'moving-0', title: 'A channel upload', durationSeconds: 300, animatedThumbnail: MOVING, badges: [] }
  const page: SourceChannelPage = {
    channel: { id: CHANNEL_ID, name: 'Channel 0' },
    videos: { items: tab === 'VIDEOS' ? [upload] : [], playlists: [] },
    availableTabs: ['HOME', 'VIDEOS'],
    tab,
    sortOptions: [],
    sortMenu: false,
    filterOptions: [],
    home: tab === 'HOME'
      ? { shelves: [{ title: 'Videos', uploads: true, videos: [upload], shorts: [], playlists: [], channels: [], games: [], posts: [] }] }
      : undefined,
  }
  const source = {
    ...createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => ({}) as never }),
    channel: async () => page,
  } as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://preview-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  render(<Provider value={client}><ChannelPage id={CHANNEL_ID} base={`/channel/${CHANNEL_ID}`} tab={tab} /></Provider>, host)
}

/**
 * Mounts SubscriptionsFeedPage backed by the local Yoga GraphQL server with two
 * sample subscription cards: one carrying `inlinePlayerParams` and one without.
 */
export const mountSubscriptions = () => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '100%'
  document.body.append(host)
  const page: SourceVideoPage = {
    items: [
      { id: 'sub-params-0', title: 'Subscription card with params', durationSeconds: 320, inlinePlayerParams: CARD_PARAMS, channel, badges: [] },
      { id: 'sub-no-params-0', title: 'Subscription card without params', durationSeconds: 240, channel, badges: [] },
    ],
    playlists: [],
  }
  const source = {
    ...createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => ({}) as never }),
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    subscriptions: async () => page,
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://preview-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  document.documentElement.dataset.engine = 'ready'
  // Mount VideoCard first so its Emotion CSS lands in <head> before SubscriptionsFeedPage (matching Home -> Subscriptions).
  const probe = document.createElement('div')
  render(<Provider value={client}><VideoCard video={homeCard} /></Provider>, probe)
  render(null, probe)
  probe.remove()
  render(<Provider value={client}><SubscriptionsFeedPage /></Provider>, host)
}

/**
 * Mounts HomePage backed by the local Yoga GraphQL server with two sample Home cards:
 * one carrying `inlinePlayerParams` and one without (carrying `animatedThumbnail` fallback).
 */
export const mountHome = () => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '100%'
  document.body.append(host)
  const page = {
    items: [
      { id: 'home-params-0', title: 'Home card with params', durationSeconds: 320, inlinePlayerParams: CARD_PARAMS, channel, badges: [] },
      { id: 'home-no-params-0', title: 'Home card without params', durationSeconds: 240, animatedThumbnail: MOVING, channel, badges: [] },
    ],
    shorts: [],
    chips: [],
  }
  const source = {
    ...createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => ({}) as never }),
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    home: async () => page,
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://preview-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  render(<Provider value={client}><HomePage /></Provider>, host)
}

/**
 * Mounts ShortsGrid, ShortsGrid skeletons, and ShortsShelf inside one harness
 * so Shorts hover backdrop, keyboard focus, rail clipping, and preview playback
 * can be verified cleanly.
 */
export const mountShorts = () => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '100%'
  document.body.append(host)
  const gridShorts = [
    {
      id: 'short-params-0',
      title: 'A Short with params',
      viewCount: '120K views',
      isShort: true,
      shortsSequence: 'shorts-seq-1',
      inlinePlayerParams: CARD_PARAMS,
      badges: [],
    },
    {
      id: 'short-moving-0',
      title: 'A Short with moving fallback',
      viewCount: '84K views',
      isShort: true,
      animatedThumbnail: MOVING,
      badges: [],
    },
    {
      id: 'short-plain-0',
      title: 'A plain Short',
      viewCount: '12K views',
      isShort: true,
      badges: [],
    },
  ]
  const shelfShorts = [
    {
      id: 'short-shelf-0',
      title: 'A shelf Short',
      viewCount: '42K views',
      isShort: true,
      shortsSequence: 'shelf-seq-1',
      badges: [],
    },
  ]
  const carouselShort = {
    id: 'carousel-short-0',
    title: 'A carousel Short',
    viewCount: '95K views',
    isShort: true,
    inlinePlayerParams: CARD_PARAMS,
    badges: [],
  }
  const client = new Client({
    url: '/preview-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })
  render(
    <Provider value={client}>
      <section data-previews='shorts-grid'>
        <ShortsGrid shorts={gridShorts} />
      </section>
      <section data-previews='shorts-skeletons'>
        <ShortsGrid shorts={[]} fetching />
      </section>
      <section data-previews='shorts-shelf'>
        <ShortsShelf shorts={shelfShorts} />
      </section>
      <section data-previews='carousel-short' style={{ width: '36rem' }}>
        <VideoCard video={carouselShort} variant='carousel' />
      </section>
    </Provider>,
    host,
  )
}

const solidSvgThumb = (hex: string, width: number, height: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><rect width='${width}' height='${height}' fill='${hex}'/></svg>`,
  )}`

/**
 * Mounts VideoCard and ShortsTile items with distinct solid-color thumbnails
 * (and a neutral gray control) for verifying thumbnail-adaptive hover tints.
 */
export const mountHoverTints = () => {
  document.getElementById('app')!.hidden = true
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '1200px'
  document.body.append(host)
  const tintedVideos = [
    { id: 'tint-blue-0', title: 'Blue video', thumbnail: solidSvgThumb('#1d4ed8', 160, 90), durationSeconds: 180, channel, badges: [] },
    { id: 'tint-orange-0', title: 'Orange video', thumbnail: solidSvgThumb('#c2410c', 160, 90), durationSeconds: 180, channel, badges: [] },
    { id: 'tint-gray-0', title: 'Gray video', thumbnail: solidSvgThumb('#808080', 160, 90), durationSeconds: 180, channel, badges: [] },
    { id: 'tint-crimson-0', title: 'Crimson video', thumbnail: solidSvgThumb('#dc2626', 160, 90), durationSeconds: 180, channel, badges: [] },
  ]
  const tintedShorts = [
    { id: 'tint-emerald-0', title: 'Emerald short', thumbnail: solidSvgThumb('#059669', 120, 180), viewCount: '10K views', isShort: true, badges: [] },
    { id: 'tint-violet-0', title: 'Violet short', thumbnail: solidSvgThumb('#7c3aed', 120, 180), viewCount: '10K views', isShort: true, badges: [] },
  ]
  const tintedSearchCard: SearchCardData = {
    __typename: 'SearchCard',
    cardChannel: {
      __typename: 'Channel',
      id: 'search-tint-channel',
      name: 'Search Channel',
      avatar: null,
      handle: '@searchchannel',
      subscriberCountText: '100K subscribers',
      videoCountText: '50 videos',
      description: 'Search card dark-pinned hover tint check',
      isSubscribed: false,
      notificationLevel: null,
      isVerified: false,
      isVerifiedArtist: false,
    },
    mix: null,
    videos: [
      {
        ...searchRow,
        __typename: 'Video' as const,
        id: 'search-tint-blue-0',
        title: 'Search card blue video',
        thumbnail: solidSvgThumb('#1d4ed8', 160, 90),
        inlinePlayerParams: null,
      },
    ],
  }
  const client = new Client({
    url: '/preview-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })
  render(
    <Provider value={client}>
      <section data-previews='tinted-cards' style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 280px)', gap: '20px' }}>
        {tintedVideos.map(video => <VideoCard key={video.id} video={video} />)}
      </section>
      <section data-previews='tinted-shorts' style={{ marginTop: '24px' }}>
        <ShortsGrid shorts={tintedShorts} />
      </section>
      <section data-previews='tinted-search-card' style={{ marginTop: '24px' }}>
        <SearchCard card={tintedSearchCard} />
      </section>
    </Provider>,
    host,
  )
}

const HoverSeekHarnessView = () => {
  const seekHandle = useSetting('seekHandle')
  const [position, setPosition] = useState(0)
  const [videoThumb, setVideoThumb] = useState<HTMLElement | null>(null)
  const [shortThumb, setShortThumb] = useState<HTMLElement | null>(null)
  const videoRef = useRef<HTMLElement>(null)
  const shortRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setVideoThumb(videoRef.current?.querySelector('a.thumb') as HTMLElement | null)
    setShortThumb(shortRef.current?.querySelector('a.thumb') as HTMLElement | null)
    const win = window as unknown as {
      __previewSeekHarness?: {
        setPosition: (ratio: number) => void
        setSeekHandle: (handle: SeekHandle) => void
      }
    }
    win.__previewSeekHarness = {
      setPosition,
      setSeekHandle: (handle: SeekHandle) => updateSettings({ seekHandle: handle }),
    }
    return () => {
      delete win.__previewSeekHarness
    }
  }, [])

  const videoCard = {
    id: 'seek-video-0',
    title: 'Preview seek handle check',
    thumbnail: solidSvgThumb('#1f2937', 320, 180),
    durationSeconds: 320,
    channel,
    badges: [],
  }
  const shortTile = {
    id: 'seek-short-0',
    title: 'Shorts preview seek handle check',
    thumbnail: solidSvgThumb('#312e81', 180, 270),
    viewCount: '15K views',
    isShort: true,
    isUpcoming: true,
    badges: [],
  }

  return (
    <>
      <section ref={videoRef} data-previews='seek-video' style={{ width: '360px', marginBottom: '24px' }}>
        <VideoCard video={videoCard} />
      </section>
      <section ref={shortRef} data-previews='seek-short' style={{ width: '210px' }}>
        <ShortsTile short={shortTile} />
      </section>
      {videoThumb
        ? createPortal(
          <div css={hoverPreviewStyle} data-painted=''>
            <HoverPreviewScrubber seekHandle={seekHandle} position={position} buffered={0.65} scrubbing={false} />
          </div>,
          videoThumb,
        )
        : undefined}
      {shortThumb
        ? createPortal(
          <div css={hoverPreviewStyle} data-painted=''>
            <HoverPreviewScrubber seekHandle={seekHandle} position={position} buffered={0.65} scrubbing={false} />
          </div>,
          shortThumb,
        )
        : undefined}
    </>
  )
}

/**
 * Mounts VideoCard and ShortsTile with HoverPreviewScrubber portaled into each `.thumb`
 * so custom seek handle visibility and clipping can be measured without network playback.
 */
export const mountHoverSeekHandle = () => {
  document.getElementById('app')!.hidden = true
  document.querySelector('[data-preview-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-preview-harness', '')
  host.style.width = '800px'
  host.style.padding = '24px'
  document.body.append(host)
  const client = new Client({
    url: '/preview-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })
  render(
    <Provider value={client}>
      <HoverSeekHarnessView />
    </Provider>,
    host,
  )
}
