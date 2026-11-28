import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { useEffect } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'
import { Link, Route, Switch, useLocation } from 'wouter'

import Toasts from '../../../src/components/ui/toast'
import { createCache } from '../../../src/graphql'
import ChannelPage from '../../../src/routes/channel'
import FeedGroupsPage from '../../../src/routes/feed-groups'
import GroupPage from '../../../src/routes/group'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type GroupsHarnessOptions = {
  signedIn?: boolean
  initialPath?: string
  subscriptions?: Array<{ id: string, name: string, handle?: string }>
}

const AVATAR = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#1d4ed8"/></svg>')}`
const THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#0f172a"/></svg>')}`

const NASA_CHANNEL = {
  id: 'UCLA_DiR1FfKNvjuUpBHmylQ',
  name: 'NASA',
  handle: '@NASA',
  description: 'Explore the universe and discover our home planet.',
  subscriberCountText: '12M subscribers',
  videoCountText: '8K videos',
  isSubscribed: false,
}

const DEFAULT_SUBSCRIPTIONS = [
  { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Tech', handle: '@alphatech' },
  { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Music', handle: '@betamusic' },
]

const HarnessShell = ({ initialPath }: { initialPath?: string }) => {
  const [, navigate] = useLocation()
  useEffect(() => {
    if (initialPath && window.location.pathname !== initialPath) {
      navigate(initialPath, { replace: true })
    }
  }, [initialPath])

  return (
    <div style='position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding-top: 4.8rem'>
      <div style='display: flex; gap: 1.6rem; padding: 1.2rem 1.6rem; border-bottom: 1px solid var(--border-subtle)'>
        <Link href='/feed/groups'>All groups</Link>
        <Link href={`/channel/${NASA_CHANNEL.id}`}>Open NASA channel</Link>
      </div>
      <Switch>
        <Route path='/feed/groups' component={FeedGroupsPage} />
        <Route path='/feed/groups/:id'>{({ id }: { id: string }) => <GroupPage params={{ id }} />}</Route>
        <Route path='/channel/:id'>{({ id }: { id: string }) => <ChannelPage id={id} base={`/channel/${id}`} />}</Route>
        <Route path='/'>
          {() => (
            <main style='padding: 2.4rem 1.6rem'>
              <h1>Browse Home</h1>
              <Link href={`/channel/${NASA_CHANNEL.id}`}>NASA</Link>
            </main>
          )}
        </Route>
      </Switch>
      <Toasts />
    </div>
  )
}

/** Mounts an isolated Yoga + wouter environment covering New/Edit group, Group feed, and Channel group assignment. */
export const mountGroupsDiscoverabilityHarness = (options?: GroupsHarnessOptions) => {
  const existing = document.querySelector('[data-groups-discoverability-harness]')
  if (existing) {
    render(null, existing)
    existing.remove()
  }

  const host = document.createElement('div')
  host.setAttribute('data-groups-discoverability-harness', 'true')
  document.body.append(host)

  const subs = options?.subscriptions ?? (options?.signedIn ? DEFAULT_SUBSCRIPTIONS : [])
  const now = Date.now()
  const recent = new Date(now - 3 * 3600 * 1000).toISOString()

  const uploadsByChannel: Record<string, Array<{ id: string, title: string, publishedAt: string, thumbnail: string, durationSeconds: number, viewCount: string, badges: string[] }>> = {
    [NASA_CHANNEL.id]: [
      { id: 'nasavid0001', title: 'NASA launch coverage', publishedAt: recent, thumbnail: THUMB, durationSeconds: 245, viewCount: '450K views', badges: [] },
    ],
    UCaaaaaaaaaaaaaaaaaaaaaa: [
      { id: 'alphavid001', title: 'Alpha Tech build log', publishedAt: recent, thumbnail: THUMB, durationSeconds: 180, viewCount: '25K views', badges: [] },
    ],
    UCbbbbbbbbbbbbbbbbbbbbbb: [
      { id: 'betavid0001', title: 'Beta Music session', publishedAt: recent, thumbnail: THUMB, durationSeconds: 210, viewCount: '18K views', badges: [] },
    ],
  }

  const source = {
    session: async () => options?.signedIn
      ? { signedIn: true, name: 'Viewer', handle: '@viewer', accounts: [] }
      : { signedIn: false, accounts: [] },
    subscribedChannels: async () => subs.map(sub => ({
      id: sub.id,
      name: sub.name,
      handle: sub.handle ?? '@channel',
      avatar: AVATAR,
      isSubscribed: true,
    })),
    channelTags: async () => [],
    channel: async (id: string) => {
      const sub = subs.find(entry => entry.id === id)
      const info = sub
        ? {
            id: sub.id,
            name: sub.name,
            handle: sub.handle ?? '@channel',
            avatar: AVATAR,
            description: `${sub.name} channel`,
            subscriberCountText: '100K subscribers',
            videoCountText: '20 videos',
            isSubscribed: true,
          }
        : {
            ...NASA_CHANNEL,
            avatar: AVATAR,
            isSubscribed: false,
          }
      return {
        channel: info,
        videos: { items: uploadsByChannel[id] ?? [], playlists: [] },
        availableTabs: ['VIDEOS'],
        tab: 'VIDEOS',
        sortOptions: [],
        sortMenu: false,
        filterOptions: [],
      }
    },
    channelUploads: async (channelId: string) => uploadsByChannel[channelId] ?? [],
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://groups-discoverability-${Date.now()}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <HarnessShell initialPath={options?.initialPath ?? '/feed/groups'} />
    </Provider>,
    host,
  )
}
