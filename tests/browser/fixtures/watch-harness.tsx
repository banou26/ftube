import type { NotificationLevel } from '../../../src/generated/graphql'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { createCache } from '../../../src/graphql'
import WatchPage from '../../../src/routes/watch'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type WatchHarnessOptions = {
  videoId?: string
  subscribed?: boolean
  notificationLevel?: NotificationLevel
  channelName?: string
  likeCountText?: string
  isLive?: boolean
  withChips?: boolean
  chipDelays?: Record<string, number>
}

const makeRelatedVideo = (id: string, title: string, channelName = 'Creator') => ({
  id,
  title,
  durationSeconds: 320,
  viewCount: '84K views',
  publishedText: '3 days ago',
  badges: [],
  channel: { id: `UC-${id}`, name: channelName, isVerified: true },
})

export const mountWatchHarness = (options: WatchHarnessOptions = {}) => {
  const videoId = options.videoId ?? 'watch-harness-1'
  const withChips = options.withChips === true
  let subscribed = options.subscribed ?? false
  let level: NotificationLevel = options.notificationLevel ?? 'PERSONALIZED'

  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-watch-harness]').forEach(node => node.remove())
  history.replaceState(null, '', `/watch?v=${videoId}`)

  const baseRelated = [
    makeRelatedVideo('rel-all-1', 'All Related Video 1', 'Alpha Channel'),
    makeRelatedVideo('rel-all-2', 'All Related Video 2', 'Beta Channel'),
  ]
  const musicRelated = [
    makeRelatedVideo('rel-music-1', 'Music Filtered Video 1', 'Sound Lab'),
    makeRelatedVideo('rel-music-2', 'Music Filtered Video 2', 'Synth Studio'),
  ]
  const musicNextRelated = [
    makeRelatedVideo('rel-music-3', 'Music Page 2 Video', 'Encore Audio'),
  ]
  const codeRelated = [
    makeRelatedVideo('rel-code-1', 'Coding Filtered Video 1', 'Systems Weekly'),
  ]

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: '@viewer', accounts: [] }),
    watch: async (id: string) => ({
      id,
      title: `Harness Video ${id}`,
      isLive: options.isLive ?? false,
      commentsHidden: true,
      viewCountText: '12,345 views',
      shortViewCountText: '12K views',
      publishedDateText: 'Nov 1, 2026',
      relativeDateText: '3 weeks ago',
      hashtags: [],
      likeCountText: options.likeCountText ?? '1.2K',
      description: 'Harness description.',
      descriptionRuns: [{ text: 'Harness description.' }],
      channel: {
        id: 'UC-harness',
        name: options.channelName ?? 'Harness Creator Studio',
        subscriberCountText: '240K subscribers',
        isSubscribed: subscribed,
        notificationLevel: level,
        isVerified: true,
      },
      related: baseRelated,
      relatedCursor: withChips ? 'cursor:all:2' : undefined,
      relatedChips: withChips
        ? [
            { id: '', label: 'All', selected: true },
            { id: 'chip:music', label: 'Music', selected: false },
            { id: 'chip:coding', label: 'Coding', selected: false },
            { id: 'chip:recent', label: 'Recently uploaded', selected: false },
            { id: 'chip:watched', label: 'Watched', selected: false },
            { id: 'chip:channel', label: 'From Harness Creator Studio', selected: false },
            { id: 'chip:live', label: 'Live', selected: false },
            { id: 'chip:podcasts', label: 'Podcasts', selected: false },
          ]
        : [],
      chapters: [],
      cardTeasers: [],
    }),
    relatedVideos: async (cursor: string) => {
      const delay = options.chipDelays?.[cursor] ?? 0
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      if (cursor === 'chip:music') return { items: musicRelated, playlists: [], cursor: 'cursor:music:2' }
      if (cursor === 'cursor:music:2') return { items: musicNextRelated, playlists: [] }
      if (cursor === 'chip:coding') return { items: codeRelated, playlists: [] }
      if (cursor.startsWith('chip:')) return { items: [], playlists: [] }
      if (cursor === 'cursor:all:2') {
        return { items: [makeRelatedVideo('rel-all-3', 'All Related Page 2')], playlists: [] }
      }
      return { items: [], playlists: [] }
    },
    comments: async () => ({ items: [] }),
    playlists: async () => ({
      items: [{ id: 'PL-harness-1', title: 'Harness Playlist', videoCountText: '3 videos' }],
    }),
    subscribedChannels: async () => [{ id: 'UC-harness', name: options.channelName ?? 'Harness Creator Studio' }],
    channelTags: async () => [],
    addToPlaylist: async (playlistId: string) => ({ id: playlistId, title: 'Harness Playlist' }),
    setSubscribed: async (_channelId: string, next: boolean) => {
      subscribed = next
      return { id: 'UC-harness', name: options.channelName ?? 'Harness Creator Studio', isSubscribed: next }
    },
    setNotificationLevel: async (_channelId: string, next: NotificationLevel) => {
      level = next
      return { id: 'UC-harness', name: options.channelName ?? 'Harness Creator Studio', notificationLevel: next }
    },
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://watch-harness-${videoId}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  const host = document.createElement('div')
  host.setAttribute('data-watch-harness', videoId)
  document.body.append(host)
  render(<Provider value={client}><WatchPage /></Provider>, host)
}
