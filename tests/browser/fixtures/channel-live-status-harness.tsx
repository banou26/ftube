import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { createCache } from '../../../src/graphql'
import { ChannelPage } from '../../../src/routes/channel'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type ChannelLiveVariant = 'live-linked' | 'live-unlinked' | 'offline'

const AVATAR_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#2b4c7e"/></svg>')}`

export const mountChannelLiveHarness = (variant: ChannelLiveVariant) => {
  const id = `UC-${variant}`
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-channel-live-status-harness]').forEach(node => node.remove())
  history.replaceState(null, '', `/channel/${id}`)

  const isLive = variant !== 'offline'
  const liveVideoId = variant === 'live-linked' ? 'live-vid-956' : undefined

  const source = {
    session: async () => ({ signedIn: false, accounts: [] }),
    channel: async () => ({
      channel: {
        id,
        name: variant === 'offline' ? 'Offline Channel' : 'Streaming Channel',
        avatar: AVATAR_DATA_URI,
        handle: `@${variant}`,
        subscriberCountText: '120K subscribers',
        videoCountText: '85 videos',
        tags: [],
        isSubscribed: false,
        isLive,
        liveVideoId,
      },
      videos: { items: [], playlists: [] },
      availableTabs: ['VIDEOS'],
      tab: 'VIDEOS',
      sortOptions: [],
      sortMenu: false,
      filterOptions: [],
    }),
    channelTags: async () => [],
    subscribedChannels: async () => [],
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://channel-live-${variant}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  const host = document.createElement('div')
  host.setAttribute('data-channel-live-status-harness', variant)
  document.body.append(host)
  render(<Provider value={client}><ChannelPage id={id} base={`/channel/${id}`} /></Provider>, host)
}
