import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Route, Switch } from 'wouter'

import GroupDialog from '../../../src/components/group-dialog'
import { Guide } from '../../../src/components/guide'
import NotificationsMenu from '../../../src/components/notifications-menu'
import { SaveMenu } from '../../../src/components/save-menu'
import SubscribeButton from '../../../src/components/subscribe-button'
import { TranscriptPanel } from '../../../src/components/transcript'
import { VideoCardMenu } from '../../../src/components/video-card'
import { createCache } from '../../../src/graphql'
import ChannelPage from '../../../src/routes/channel'
import FeedChannelsPage from '../../../src/routes/feed-channels'
import SubscriptionsFeedPage from '../../../src/routes/feed-subscriptions'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type Which = 'notifications' | 'save' | 'row' | 'group' | 'subscribe' | 'transcript'

// every read and every action asks here and fails as the answer a spec routes here does
const DATA_PATH = '/menu-data-harness/'

// what each call asks youtube.com, and youtubei.js's words for an answer that is not ok, which the resolvers pass on
const request = async <T,>(endpoint: string, answer: T) => {
  const response = await fetch(`${DATA_PATH}${endpoint}`)
  if (!response.ok) throw new Error(`Request to https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false&alt=json failed with status code ${response.status}`)
  return answer
}

const lines = [{ startSeconds: 0, timestamp: '0:00', text: 'Line 1' }]

const NOTIF_AVATAR = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#2563eb"/><circle cx="128" cy="128" r="76" fill="#ffffff"/></svg>')}`
const NOTIF_THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#0f766e"/><rect x="40" y="40" width="560" height="280" fill="#14b8a6"/></svg>')}`

const source = {
  session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
  unseenNotificationCount: async () => 0,
  notifications: (cursor?: string) => request('notification/get_notification_menu', cursor
    ? {
        items: [{
          id: 'notification-2',
          message: 'Channel 2 uploaded: Video 2',
          sentText: '2 days ago',
          avatar: NOTIF_AVATAR,
          thumbnail: NOTIF_THUMB,
          videoId: 'dQw4w9WgXcQ',
          read: true,
        }],
      }
    : {
        items: [
          {
            id: 'notification-1',
            message: 'Channel 1 uploaded: Video 1',
            sentText: '1 hour ago',
            avatar: NOTIF_AVATAR,
            thumbnail: NOTIF_THUMB,
            videoId: 'dQw4w9WgXcQ',
            read: false,
          },
          {
            id: 'notification-long',
            message: 'Le Monde a mis en ligne une nouvelle video: Comment la France reorganise son reseau ferroviaire et ses lignes a grande vitesse Magazine',
            sentText: 'il y a 21 heures',
            avatar: NOTIF_AVATAR,
            thumbnail: NOTIF_THUMB,
            videoId: 'dQw4w9WgXcQ',
            read: false,
          },
        ],
        cursor: 'notifications-2',
      }),
  playlists: (cursor?: string) => request('browse', cursor
    ? { items: [{ id: 'PL-2', title: 'Playlist 2', videoCountText: '2 videos' }] }
    : { items: [{ id: 'PL-1', title: 'Playlist 1', videoCountText: '1 video' }], cursor: 'playlists-2' }),
  subscribedChannels: () => request('browse', [{ id: 'UC-1', name: 'Channel 1' }]),
  transcript: () => request('get_transcript', { sections: [{ lines }], searchToken: 'transcript-search' }),
  transcriptSearch: () => request('get_transcript', { sections: [{ lines }] }),
  markNotificationRead: (id: string) => request('notification/record_interactions', id),
  addToPlaylist: (id: string) => request('browse/edit_playlist', { id, title: 'Playlist 1' }),
  createPlaylist: (title: string) => request('playlist/create', { id: 'PL-3', title }),
  setSubscribed: (id: string, isSubscribed: boolean) => request('subscription/subscribe', { id, name: 'Channel 1', isSubscribed }),
} as unknown as SourceApi

/**
 * Renders a menu, dialog, button or panel that reads the signed-in account's data or acts on it, through the app's own
 * schema, resolvers and cache, over a source whose every call asks DATA_PATH. Served by the dev server and imported
 * from a spec.
 */
export const mountMenuData = (which: Which) => {
  const host = document.createElement('div')
  host.setAttribute('data-menu-data-harness', which)
  host.style.cssText = 'position: fixed; inset: 6rem 2rem auto auto; z-index: 10000; display: flex; justify-content: flex-end; width: 60rem; background: var(--bg)'
  document.body.append(host)
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://menu-data-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  // useSession reads only once the engine is up
  document.documentElement.dataset.engine = 'ready'
  const close = () => render(null, host)
  const shown = {
    notifications: () => <NotificationsMenu />,
    save: () => <SaveMenu videoId='video-0' />,
    row: () => <VideoCardMenu videoId='video-0' title='Video 0' />,
    group: () => <GroupDialog onClose={close} />,
    subscribe: () => <SubscribeButton channelId='UC-1' subscribed={false} />,
    transcript: () => <TranscriptPanel videoId='video-0' panel={{ panelId: 'transcript-panel', params: 'transcript-params' }} onClose={close} />,
  }[which]
  render(<Provider value={client}>{shown()}</Provider>, host)
}

/** Renders GroupDialog with multiple subscribed channels and a channel preview resolver for filter/select-all/preview tests. */
export const mountGroupPicker = () => {
  const host = document.createElement('div')
  host.setAttribute('data-group-picker-harness', 'true')
  document.body.append(host)
  const channels = [
    { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Tech', handle: '@alphatech', subscriberCountText: '120K subscribers', videoCountText: '42 videos', description: 'Tech builds and reviews.' },
    { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Tech', handle: '@betatech', subscriberCountText: '50K subscribers', videoCountText: '18 videos', description: 'More tech content.' },
    { id: 'UCcccccccccccccccccccccc', name: 'Gamma Music', handle: '@gammamusic', subscriberCountText: '1M subscribers', videoCountText: '200 videos', description: 'Music channel.' },
  ]
  const pickerSource = {
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    subscribedChannels: async () => channels,
    channelTags: async () => [],
    channel: async (id: string) => {
      const found = channels.find(entry => entry.id === id) ?? channels[0]!
      return {
        channel: found,
        videos: {
          items: [
            { id: 'vid12345678', title: `${found.name} latest video`, durationSeconds: 325, publishedText: '2 days ago', badges: [] },
          ],
          playlists: [],
        },
        availableTabs: ['VIDEOS'],
        tab: 'VIDEOS',
        sortOptions: [],
        filterOptions: [],
      }
    },
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://group-picker-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source: pickerSource }),
  })
  document.documentElement.dataset.engine = 'ready'
  const close = () => render(null, host)
  render(
    <Provider value={client}>
      <GroupDialog onClose={close} />
    </Provider>,
    host,
  )
}

/** Renders the guide, /feed/subscriptions and /feed/channels over a signed-in mock source for YTB-124 tests. */
export const mountChannelsSurface = (options?: { withLinux?: boolean }) => {
  const host = document.createElement('div')
  host.setAttribute('data-channels-harness', 'true')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding-left: 24rem'
  document.body.append(host)
  const now = Date.now()
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()
  const channels = [
    {
      id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Alpha Tech',
      handle: '@alphatech',
      subscriberCountText: '120K subscribers',
      description: 'Weekly hardware teardowns.',
      isSubscribed: true,
    },
    {
      id: 'UCbbbbbbbbbbbbbbbbbbbbbb',
      name: 'Beta Music',
      handle: '@betamusic',
      subscriberCountText: '2.4M subscribers',
      description: 'Live synth sessions.',
      isSubscribed: true,
    },
    {
      id: 'UCcccccccccccccccccccccc',
      name: 'Old Archive',
      handle: '@oldarchive',
      subscriberCountText: '15K subscribers',
      description: 'Classic uploads.',
      isSubscribed: true,
    },
    ...(options?.withLinux
      ? [{
          id: 'UC55tEex69nxJF2uB40wLnxE',
          name: 'The Linux Experiment',
          handle: '@TheLinuxEXP',
          subscriberCountText: '434K subscribers',
          description: 'Linux desktop news and tutorials.',
          isSubscribed: true,
        }]
      : []),
  ]
  const uploadsByChannel: Record<string, { id: string, title: string, publishedAt: string, badges: string[] }[]> = {
    UCaaaaaaaaaaaaaaaaaaaaaa: [{ id: 'vid11111111', title: 'New build', publishedAt: daysAgo(2), badges: [] }],
    UCbbbbbbbbbbbbbbbbbbbbbb: [{ id: 'vid22222222', title: 'Monthly jam', publishedAt: daysAgo(20), badges: [] }],
    UCcccccccccccccccccccccc: [{ id: 'vid33333333', title: 'Old clip', publishedAt: daysAgo(450), badges: [] }],
    UC55tEex69nxJF2uB40wLnxE: [{ id: 'vid44444444', title: 'Linux desktop weekly', publishedAt: daysAgo(1), badges: [] }],
  }
  const channelsSource = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: '@viewer', accounts: [] }),
    subscribedChannels: async () => channels,
    channelTags: async (id: string) => id === 'UCbbbbbbbbbbbbbbbbbbbbbb'
      ? ['Music']
      : id === 'UC55tEex69nxJF2uB40wLnxE'
        ? ['linux', 'linux desktop', 'linux news', 'linux hardware', 'linux 2025', 'best linux', 'linux videos', 'switching to linux']
        : [],
    subscriptions: async () => ({ items: [], playlists: [] }),
    channelUploads: async (channelId: string) => uploadsByChannel[channelId] ?? [],
    setSubscribed: async (id: string, isSubscribed: boolean) => ({
      ...(channels.find(channel => channel.id === id) ?? { id, name: id }),
      isSubscribed,
    }),
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://channels-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source: channelsSource }),
  })
  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <Guide variant='expanded' />
      <Switch>
        <Route path='/feed/subscriptions' component={SubscriptionsFeedPage} />
        <Route path='/feed/channels' component={FeedChannelsPage} />
      </Switch>
    </Provider>,
    host,
  )
}

/** Renders ChannelPage with signed-in session over mock channels for own-channel vs other-channel header tests. */
export const mountChannelHeader = (mode: 'own-flag' | 'own-handle' | 'other' | 'tags-fallback') => {
  const host = document.createElement('div')
  host.setAttribute('data-channel-header-harness', mode)
  host.style.cssText = 'position: fixed; inset: 0; z-index: 10000; background: var(--bg-base); overflow: auto'
  document.body.append(host)
  const channelByMode = {
    'own-flag': { id: 'UCown1111111111111111111', name: 'My Channel', handle: '@otherhandle', isOwnChannel: true },
    'own-handle': { id: 'UCown2222222222222222222', name: 'My Handle Channel', handle: '@viewer' },
    other: { id: 'UCoth3333333333333333333', name: 'Someone Else', handle: '@someoneelse', isSubscribed: false },
    'tags-fallback': { id: 'UCtag4444444444444444444', name: 'Quiet Creator', handle: '@quietcreator', tags: null, isSubscribed: false },
  }[mode]
  const channelSource = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: '@Viewer', accounts: [] }),
    channelTags: async (id: string) => id === 'UCtag4444444444444444444' ? ['asmr'] : [],
    channel: async () => ({
      channel: channelByMode,
      videos: { items: [], playlists: [] },
      availableTabs: ['VIDEOS'],
      tab: 'VIDEOS',
      sortOptions: [],
      sortMenu: false,
      filterOptions: [],
    }),
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://channel-header-${mode}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source: channelSource }),
  })
  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <ChannelPage id={channelByMode.id} base={`/channel/${channelByMode.id}`} />
    </Provider>,
    host,
  )
}
