import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Parser, YT } from 'youtubei.js'

import { createCache } from '../../../src/graphql'
import HistoryFeedPage from '../../../src/routes/feed-history'
import SubscriptionsFeedPage from '../../../src/routes/feed-subscriptions'
import { ChannelPage } from '../../../src/routes/channel'
import HomePage from '../../../src/routes/home'
import SearchPage from '../../../src/routes/search'
import WatchPage from '../../../src/routes/watch'
import { updateSettings } from '../../../src/settings'
import { createYoutubeSource } from '../../../src/sources/youtube'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'
import channelHome from '../../unit/fixtures/channel-home.json'

const CHANNEL_ID = 'UCXuqSBlHAE6Xw-yeJA0Tunw'

const makeChannel = (id: string, name: string) => ({
  __typename: 'Channel',
  id,
  name,
  avatar: null,
  isVerified: true,
  isVerifiedArtist: null,
})

const makeVideo = (id: string, title: string, isShort = false) => ({
  __typename: 'Video',
  id,
  title,
  inlinePlayerParams: null,
  description: null,
  descriptionSnippet: null,
  snippetRuns: null,
  thumbnail: null,
  thumbnailSrcset: null,
  animatedThumbnail: null,
  thumbnailBadge: null,
  durationSeconds: isShort ? null : 420,
  isMusic: null,
  viewCount: '95K',
  viewCountIcon: null,
  publishedText: '2w ago',
  metaDelimiter: null,
  isLive: null,
  isUpcoming: null,
  isShort: isShort ? true : null,
  isMembersOnly: null,
  progressPercent: null,
  badges: [],
  channel: makeChannel('UC123', 'Creator'),
  chapters: null,
  chaptersTitle: null,
  byline: null,
  collaborators: null,
})

const makeSearchVideo = (id: string, title: string, isShort = false) => ({
  __typename: 'Video',
  id,
  title,
  inlinePlayerParams: null,
  description: null,
  descriptionSnippet: null,
  snippetRuns: null,
  thumbnail: null,
  thumbnailSrcset: null,
  durationSeconds: isShort ? null : 420,
  isMusic: null,
  viewCount: '95K',
  publishedText: '2w ago',
  isLive: null,
  isUpcoming: null,
  isShort: isShort ? true : null,
  badges: [],
  channel: makeChannel('UC123', 'Creator'),
  chapters: null,
  chaptersTitle: null,
  byline: null,
  collaborators: null,
})

const makeShelfShort = (id: string, title: string) => ({
  __typename: 'Video',
  id,
  title,
  thumbnail: null,
  thumbnailSrcset: null,
  viewCount: '12K views',
  shortsSequence: null,
})

const answers: Record<string, unknown> = {
  Session: {
    session: {
      __typename: 'Session',
      signedIn: true,
      name: 'Viewer',
      avatar: null,
      handle: '@viewer',
      accounts: [],
    },
  },
  HomeFeed: {
    home: {
      __typename: 'HomeFeed',
      items: [
        makeVideo('home-video', 'Home Regular Video'),
        makeVideo('home-short', 'Home Feed Short', true),
      ],
      shorts: [makeShelfShort('home-shelf-short', 'Home Shelf Short')],
      chips: [],
      cursor: null,
    },
  },
  SearchResults: {
    search: {
      __typename: 'SearchPage',
      results: [
        makeSearchVideo('search-video', 'Search Regular Video'),
        makeSearchVideo('search-short', 'Search Feed Short', true),
        {
          __typename: 'SearchShelf',
          title: 'Shorts',
          subtitle: null,
          horizontal: null,
          collapsedCount: null,
          videos: [],
          shorts: [makeShelfShort('search-shelf-short', 'Search Shelf Short')],
        },
        {
          __typename: 'SearchShelf',
          title: 'Mixed carousel',
          subtitle: 'People also search for',
          horizontal: true,
          collapsedCount: null,
          videos: [
            makeSearchVideo('carousel-video', 'Carousel Regular Video'),
            makeSearchVideo('carousel-short', 'Carousel Short', true),
          ],
          shorts: [],
        },
        {
          __typename: 'SearchCard',
          cardChannel: {
            __typename: 'Channel',
            id: 'UCcard',
            name: 'Artist Card',
            avatar: null,
            handle: '@artist',
            subscriberCountText: '1M subscribers',
            videoCountText: '50 videos',
            description: 'Artist description',
            isSubscribed: false,
            notificationLevel: null,
            isVerified: true,
            isVerifiedArtist: null,
          },
          mix: null,
          videos: [
            makeSearchVideo('card-video', 'Card Regular Video'),
            makeSearchVideo('card-short', 'Card Short', true),
          ],
        },
      ],
      topic: null,
      refinements: [],
      cursor: null,
      unwatchedChip: false,
    },
  },
  SubscriptionsFeed: {
    subscriptions: {
      __typename: 'VideoPage',
      items: [
        makeVideo('sub-video', 'Subscription Regular Video'),
        makeVideo('sub-short', 'Subscription Short', true),
      ],
      cursor: null,
    },
  },
  WatchHistory: {
    history: {
      __typename: 'SectionedVideoPage',
      sections: [
        {
          __typename: 'VideoSection',
          title: 'Today',
          items: [
            makeVideo('hist-video', 'History Regular Video'),
            makeVideo('hist-short', 'History Short', true),
          ],
        },
        {
          __typename: 'VideoSection',
          title: 'Yesterday',
          items: [
            makeVideo('hist-short-only', 'History Short Only', true),
          ],
        },
      ],
      cursor: null,
    },
  },
  WatchMeta: {
    watch: {
      __typename: 'WatchMeta',
      id: 'watch-main',
      unavailableText: null,
      isLive: false,
      hasChatReplay: false,
      concurrentViewers: null,
      title: 'Main Watch Video',
      isMembersOnly: false,
      commentsHidden: true,
      viewCountText: '100 views',
      publishedDateText: 'Today',
      shortViewCountText: '100 views',
      relativeDateText: 'Today',
      hashtags: [],
      likeCountText: '10',
      commentCountText: null,
      description: 'Main video description',
      descriptionRuns: [],
      likeStatus: null,
      channel: {
        __typename: 'Channel',
        id: 'UCmain',
        name: 'Main Channel',
        avatar: null,
        handle: '@main',
        subscriberCountText: '1K subscribers',
        isSubscribed: false,
        notificationLevel: null,
        isVerified: null,
        isVerifiedArtist: null,
      },
      byline: null,
      collaborators: null,
      relatedCursor: null,
      autoplayId: 'watch-related-video',
      chapters: [],
      transcriptPanel: null,
      music: null,
      channelCard: null,
      cardTeasers: [],
      related: [
        makeVideo('watch-related-video', 'Related Regular Video'),
        makeVideo('watch-related-short', 'Related Short Video', true),
      ],
      playlist: null,
    },
  },
}

const createMockClient = () => new Client({
  url: '/hide-shorts-harness',
  exchanges: [createCache(), fetchExchange],
  fetch: async (_input, init) => {
    const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
    return new Response(JSON.stringify({ data: answers[operationName] ?? null }), {
      headers: { 'content-type': 'application/json' },
    })
  },
  preferGetMethod: false,
})

const prepareHost = (name: string) => {
  const app = document.getElementById('app')
  if (app) {
    render(null, app)
    app.hidden = true
  }
  document.querySelectorAll('[data-hide-shorts-harness]').forEach(node => node.remove())
  const host = document.createElement('div')
  host.setAttribute('data-hide-shorts-harness', name)
  document.body.append(host)
  return host
}

export const setHideShorts = (hideShorts: boolean) => {
  updateSettings({ hideShorts })
}

export const mountHome = () => {
  const host = prepareHost('home')
  render(<Provider value={createMockClient()}><HomePage /></Provider>, host)
}

export const mountSearch = (search = '?search_query=test') => {
  history.replaceState(null, '', `/results${search}`)
  const host = prepareHost('search')
  render(<Provider value={createMockClient()}><SearchPage /></Provider>, host)
}

export const mountSubscriptions = () => {
  const host = prepareHost('subscriptions')
  render(<Provider value={createMockClient()}><SubscriptionsFeedPage /></Provider>, host)
}

export const mountHistory = () => {
  const host = prepareHost('history')
  render(<Provider value={createMockClient()}><HistoryFeedPage /></Provider>, host)
}

export const mountWatch = () => {
  history.replaceState(null, '', '/watch?v=watch-main')
  const host = prepareHost('watch')
  render(<Provider value={createMockClient()}><WatchPage /></Provider>, host)
}

export const mountChannel = () => {
  const host = prepareHost('channel')
  const source: SourceApi = createYoutubeSource({
    fetch: globalThis.fetch,
    createClient: async () => ({
      getChannel: async () => new YT.Channel({ session: { logged_in: false } } as never, Parser.parseResponse(channelHome as never), true),
    }) as never,
  })
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://hide-shorts-channel.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  render(<Provider value={client}><ChannelPage id={CHANNEL_ID} base={`/channel/${CHANNEL_ID}`} /></Provider>, host)
}
