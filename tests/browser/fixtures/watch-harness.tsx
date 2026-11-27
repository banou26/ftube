import type { NotificationLevel } from '../../../src/generated/graphql'
import type { TheaterMode } from '../../../src/player/theater'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createCache } from '../../../src/graphql'
import { setTheater as setPlayerTheater } from '../../../src/player/session'
import { coerceTheaterMode } from '../../../src/player/theater'
import WatchPage from '../../../src/routes/watch'
import { updateSettings } from '../../../src/settings'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type WatchHarnessOptions = {
  videoId?: string
  subscribed?: boolean
  notificationLevel?: NotificationLevel
  channelName?: string
  likeCount?: number | null
  likeCountText?: string | null
  viewCountText?: string | null
  publishedDateText?: string | null
  isLive?: boolean
  hasChatReplay?: boolean
  theater?: TheaterMode | boolean
  longDescription?: boolean
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
  setPlayerTheater(updateSettings({ theater: coerceTheaterMode(options.theater) }).theater)

  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-watch-harness]').forEach(node => node.remove())
  const { hook, searchHook } = memoryLocation({ path: `/watch?v=${videoId}` })

  const baseRelated = [
    makeRelatedVideo('rel-all-1', 'All Related Video 1', 'Alpha Channel'),
    makeRelatedVideo('rel-all-2', 'All Related Video 2', 'Beta Channel'),
    ...(options.longDescription
      ? Array.from({ length: 14 }, (_, i) => makeRelatedVideo(`rel-long-${i + 1}`, `Long Related Video ${i + 1}`, 'Stream Archives'))
      : []),
  ]
  const descriptionText = options.longDescription
    ? Array.from({ length: 18 }, (_, i) => `Paragraph ${i + 1}: Extended stream notes so the watch page is comfortably scrollable in theater mode.`).join('\n\n')
    : 'Harness description.'
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
  let closePoll: (() => void) | undefined

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: '@viewer', accounts: [] }),
    watch: async (id: string) => ({
      id,
      title: `Harness Video ${id}`,
      isLive: options.isLive ?? false,
      hasChatReplay: options.hasChatReplay ?? false,
      commentsHidden: true,
      viewCountText: 'viewCountText' in options ? options.viewCountText : '12,345 views',
      shortViewCountText: '12K views',
      publishedDateText: 'publishedDateText' in options ? options.publishedDateText : 'Nov 1, 2026',
      relativeDateText: '3 weeks ago',
      hashtags: [],
      likeCount: 'likeCount' in options ? options.likeCount : 3746,
      likeCountText: 'likeCountText' in options ? options.likeCountText : '1.2K',
      description: descriptionText,
      descriptionRuns: [{ text: descriptionText }],
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
    liveChat: async (_id: string, cursor?: string) => {
      if (!cursor) {
        return {
          items: [{
            id: 'tc-1',
            kind: 'TEXT',
            text: 'Hello theater chat!',
            runs: [{ text: 'Hello theater chat!' }],
            author: { id: 'UC-chatter', name: 'Chatter', handle: '@chatter' },
          }],
          cursor: 'theater-cur-1',
          view: 'TOP',
        }
      }
      return new Promise((resolve) => {
        closePoll = () => {
          closePoll = undefined
          resolve({ items: [] })
        }
      })
    },
    closeLiveChat: async () => {
      closePoll?.()
      return true
    },
    liveChatReplay: async () => ({
      items: [{
        id: 'cr-1',
        kind: 'TEXT',
        offsetMs: 0,
        text: 'Hello chat replay!',
        runs: [{ text: 'Hello chat replay!' }],
        author: { id: 'UC-replayer', name: 'Replayer', handle: '@replayer' },
      }],
      view: 'TOP',
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
  render(
    <Router hook={hook} searchHook={searchHook}>
      <Provider value={client}>
        <WatchPage />
      </Provider>
    </Router>,
    host,
  )
}
