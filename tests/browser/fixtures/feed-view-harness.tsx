import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Route, Switch } from 'wouter'

import { createCache } from '../../../src/graphql'
import { ChannelPage } from '../../../src/routes/channel'
import SubscriptionsFeedPage from '../../../src/routes/feed-subscriptions'
import HashtagPage from '../../../src/routes/hashtag'
import HomePage from '../../../src/routes/home'
import SearchPage from '../../../src/routes/search'

const CHANNEL_DEMO = {
  __typename: 'Channel',
  id: 'UC_DEMO',
  name: 'Creator One',
  avatar: null,
  handle: '@creatorone',
  subscriberCountText: '120K subscribers',
  videoCountText: '85 videos',
  banner: null,
  description: 'Demo channel for feed view tests.',
  tags: null,
  isSubscribed: true,
  isOwnChannel: false,
  notificationLevel: 'ALL',
  isVerified: true,
  isVerifiedArtist: false,
  hasCommunityPage: false,
  isLive: false,
  liveVideoId: null,
}

const makeChannelRef = (id: string, name: string, handle?: string) => ({
  __typename: 'Channel',
  id,
  name,
  avatar: null,
  ...(handle !== undefined ? { handle } : {}),
  isVerified: true,
  isVerifiedArtist: null,
})

const makeVideo = (overrides: {
  id: string
  title: string
  durationSeconds?: number | null
  publishedText?: string
  descriptionSnippet?: string | null
  description?: string | null
  isLive?: boolean | null
  isUpcoming?: boolean | null
  isShort?: boolean | null
  isMostRelevant?: boolean | null
  progressPercent?: number | null
  badges?: string[]
  channel?: ReturnType<typeof makeChannelRef>
}) => ({
  __typename: 'Video',
  id: overrides.id,
  title: overrides.title,
  inlinePlayerParams: null,
  description: overrides.description ?? overrides.descriptionSnippet ?? null,
  descriptionSnippet: overrides.descriptionSnippet ?? null,
  snippetRuns: null,
  thumbnail: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  thumbnailSrcset: null,
  animatedThumbnail: null,
  thumbnailBadge: null,
  durationSeconds: overrides.durationSeconds === undefined ? 420 : overrides.durationSeconds,
  isMusic: null,
  viewCount: '12K views',
  viewCountIcon: null,
  publishedText: overrides.publishedText ?? 'il y a 2 h',
  metaDelimiter: null,
  isLive: overrides.isLive ?? null,
  isUpcoming: overrides.isUpcoming ?? null,
  isShort: overrides.isShort ?? null,
  shortsSequence: null,
  isMostRelevant: overrides.isMostRelevant ?? null,
  isMembersOnly: null,
  progressPercent: overrides.progressPercent ?? null,
  badges: overrides.badges ?? [],
  channel: overrides.channel ?? makeChannelRef('UC_DEMO', 'Creator One'),
  chapters: null,
  chaptersTitle: null,
  byline: null,
  collaborators: null,
  notInterestedToken: null,
  dontRecommendToken: null,
})

const makeChannelVideo = (overrides: Parameters<typeof makeVideo>[0]) => {
  const { channel: _omit, ...rest } = makeVideo(overrides)
  return rest
}

const SUBSCRIPTIONS_ITEMS = [
  makeVideo({
    id: 'sub-regular',
    title: 'Regular Tutorial Today',
    durationSeconds: 720,
    publishedText: 'il y a 2 h',
    descriptionSnippet: 'Step by step walk through the feed architecture and customization panel.',
  }),
  makeVideo({
    id: 'sub-long',
    title: 'Deep Systems Over 20 Minutes',
    durationSeconds: 1800,
    publishedText: 'il y a 2 sem.',
    descriptionSnippet: 'Long form talk covering memory layout.',
  }),
  makeVideo({
    id: 'sub-short',
    title: 'Quick Clip Short',
    durationSeconds: null,
    isShort: true,
    publishedText: 'il y a 1 h',
  }),
  makeVideo({
    id: 'sub-live',
    title: 'Live Coding Session',
    durationSeconds: null,
    isLive: true,
    publishedText: 'Watching now',
  }),
  makeVideo({
    id: 'sub-premiere',
    title: 'Premiere Release Trailer',
    durationSeconds: 300,
    badges: ['Premiere'],
    publishedText: 'il y a 3 h',
  }),
  makeVideo({
    id: 'sub-upcoming',
    title: 'Upcoming Architecture Talk',
    durationSeconds: null,
    isUpcoming: true,
    publishedText: 'Scheduled',
  }),
  makeVideo({
    id: 'sub-past-stream',
    title: 'Weekend Q&A Replay',
    durationSeconds: 3600,
    isLive: false,
    publishedText: 'Diffusé il y a 1 j',
  }),
  makeVideo({
    id: 'sub-watched',
    title: 'Already Watched Video',
    durationSeconds: 300,
    progressPercent: 95,
    publishedText: '2 days ago',
  }),
  makeVideo({
    id: 'sub-relevant',
    title: 'Most Relevant Pick',
    durationSeconds: 500,
    isMostRelevant: true,
    publishedText: '1 day ago',
  }),
  makeVideo({
    id: 'sub-blocked-kw',
    title: 'Secret Spoiler Review',
    durationSeconds: 480,
    publishedText: '3 hours ago',
  }),
  makeVideo({
    id: 'sub-blocked-ch',
    title: 'Channel Block Target Video',
    durationSeconds: 480,
    publishedText: '3 hours ago',
    channel: makeChannelRef('UC_SPAM', 'Spam Channel', '@spamchannel'),
  }),
]

const CHANNEL_VIDEOS = [
  makeChannelVideo({
    id: 'ch-video-1',
    title: 'Channel Video Alpha',
    durationSeconds: 540,
    publishedText: 'il y a 5 h',
    descriptionSnippet: 'First channel description visible when toggled.',
  }),
  makeChannelVideo({
    id: 'ch-video-2',
    title: 'Channel Video Beta',
    durationSeconds: 1500,
    publishedText: '3 weeks ago',
    descriptionSnippet: 'Second channel video description.',
  }),
  makeChannelVideo({
    id: 'ch-video-3',
    title: 'Channel Video Gamma',
    durationSeconds: 600,
    publishedText: '1 month ago',
    description: null,
    descriptionSnippet: null,
  }),
]

const CHANNEL_SPAM = {
  ...CHANNEL_DEMO,
  id: 'UC_SPAM',
  name: 'Spam Channel',
  handle: '@spamchannel',
}

const HASHTAG_SHORTS = [
  {
    ...makeVideo({
      id: 'ht-short-1',
      title: 'Hashtag Short Without Date',
      durationSeconds: 30,
      isShort: true,
    }),
    publishedText: null,
  },
]

let homeRequests = 0
let videoDescriptionRequests: string[] = []

const answers = (operationName: string, variables: Record<string, unknown> = {}): unknown => {
  if (operationName === 'VideoDescription') {
    const id = typeof variables.id === 'string' ? variables.id : ''
    videoDescriptionRequests.push(id)
    return {
      video: {
        __typename: 'Video',
        id,
        description: `Lazy description for ${id}\n\nwith   normalized   whitespace.`,
      },
    }
  }
  if (operationName === 'HomeFeed') {
    const cursor = typeof variables.cursor === 'string' ? variables.cursor : undefined
    const pageNum = cursor ? Number(cursor.replace('home-p', '')) : 0
    homeRequests += 1
    return {
      home: {
        __typename: 'HomePage',
        items: [
          makeVideo({
            id: `home-filtered-${pageNum}`,
            title: `Old Short Video Page ${pageNum}`,
            durationSeconds: 180,
            publishedText: '2 years ago',
          }),
        ],
        shorts: [],
        chips: [],
        cursor: pageNum < 6 ? `home-p${pageNum + 1}` : null,
      },
    }
  }
  if (operationName === 'HashtagPage') {
    return {
      hashtag: {
        __typename: 'HashtagPage',
        tag: typeof variables.tag === 'string' ? variables.tag : 'demo',
        title: `#${typeof variables.tag === 'string' ? variables.tag : 'demo'}`,
        stats: '12 videos',
        tab: variables.tab === 'SHORTS' ? 'SHORTS' : 'ALL',
        availableTabs: ['ALL', 'SHORTS'],
        items: HASHTAG_SHORTS,
        cursor: null,
      },
    }
  }
  if (operationName === 'ChannelView') {
    const channelId = typeof variables.id === 'string' ? variables.id : 'UC_DEMO'
    return {
      channel: {
        __typename: 'ChannelPage',
        channel: channelId === 'UC_SPAM' ? CHANNEL_SPAM : CHANNEL_DEMO,
        videos: {
          __typename: 'VideoPage',
          items: CHANNEL_VIDEOS,
          playlists: [],
          cursor: null,
        },
        availableTabs: ['HOME', 'VIDEOS', 'SHORTS', 'LIVE'],
        tab: 'VIDEOS',
        sortOptions: ['Latest', 'Popular', 'Oldest'],
        appliedSort: 'Latest',
        sortMenu: false,
        filterOptions: [],
        appliedFilter: null,
        home: null,
        store: null,
        posts: null,
      },
    }
  }
  if (operationName === 'SearchResults') {
    return {
      search: {
        __typename: 'SearchPage',
        results: [
          makeVideo({ id: 'search-normal', title: 'Normal Search Video' }),
          makeVideo({ id: 'search-live', title: 'Live Stream In Search', durationSeconds: null, isLive: true, publishedText: 'Watching now' }),
          makeVideo({ id: 'search-watched', title: 'Watched Video In Search', progressPercent: 95 }),
          makeVideo({ id: 'search-blocked-kw', title: 'Hidden Spoiler Result' }),
          makeVideo({
            id: 'search-blocked-ch',
            title: 'Channel Blocked In Search',
            channel: makeChannelRef('UC_SPAM', 'Spam Channel'),
          }),
          {
            __typename: 'SearchShelf',
            title: 'Most relevant',
            subtitle: null,
            horizontal: false,
            collapsedCount: null,
            videos: [makeVideo({ id: 'search-mr', title: 'Most Relevant Shelf Item' })],
            shorts: [],
          },
        ],
        topic: null,
        refinements: [],
        cursor: null,
        unwatchedChip: false,
      },
    }
  }
  const staticAnswers: Record<string, unknown> = {
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
    SubscriptionsFeed: {
      subscriptions: {
        __typename: 'VideoPage',
        items: SUBSCRIPTIONS_ITEMS,
        cursor: null,
      },
    },
    ChannelAbout: {
      channelAbout: null,
    },
  }
  return staticAnswers[operationName] ?? null
}

const createMockClient = () => new Client({
  url: '/feed-view-harness',
  exchanges: [createCache(), fetchExchange],
  fetch: async (_input, init) => {
    const { operationName, variables } = JSON.parse(init?.body as string) as {
      operationName: string
      variables?: Record<string, unknown>
    }
    return new Response(JSON.stringify({ data: answers(operationName, variables) }), {
      headers: { 'content-type': 'application/json' },
    })
  },
  preferGetMethod: false,
})

const prepareHost = (name: string) => {
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-feed-view-harness]').forEach(node => node.remove())
  const host = document.createElement('div')
  host.setAttribute('data-feed-view-harness', name)
  document.body.append(host)
  document.documentElement.dataset.engine = 'ready'
  return host
}

export const getHomeRequestCount = () => homeRequests
export const getVideoDescriptionRequests = () => [...videoDescriptionRequests]

export const mountApp = (initialUrl = '/feed/subscriptions') => {
  if (initialUrl === '/') homeRequests = 0
  videoDescriptionRequests = []
  history.replaceState(null, '', initialUrl)
  const host = prepareHost('app')
  const client = createMockClient()
  render(
    <Provider value={client}>
      <Switch>
        <Route path='/' component={HomePage} />
        <Route path='/feed/subscriptions' component={SubscriptionsFeedPage} />
        <Route path='/channel/:id/videos'>
          {(params: { id: string }) => <ChannelPage id={params.id} base={`/channel/${params.id}`} tab='VIDEOS' />}
        </Route>
        <Route path='/hashtag/:tag/shorts'>
          {(params: { tag: string }) => <HashtagPage tag={params.tag} tab='SHORTS' />}
        </Route>
        <Route path='/results' component={SearchPage} />
      </Switch>
    </Provider>,
    host,
  )
}
