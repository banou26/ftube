import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { groupStore } from '../../../src/groups/store'
import { createCache } from '../../../src/graphql'
import HistoryFeedPage from '../../../src/routes/feed-history'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

declare global {
  interface Window {
    __historyHarness?: {
      queries: (string | undefined)[]
      cleared: number
    }
  }
}

export const mountHistoryHarness = () => {
  for (const existing of groupStore.getGroups()) groupStore.deleteGroup(existing.id)
  groupStore.createGroup({
    name: 'Tech',
    emoji: '🔧',
    channels: [{ id: 'UCtech111111111111111111', name: 'Tech Channel' }],
  })

  const state = {
    queries: [] as (string | undefined)[],
    cleared: 0,
  }
  window.__historyHarness = state

  const entries = [
    {
      id: 'vid-long-tech',
      title: 'Vulkan Engine Deep Dive',
      isShort: false,
      durationSeconds: 720,
      channel: { id: 'UCtech111111111111111111', name: 'Tech Channel' },
      badges: [],
    },
    {
      id: 'vid-short-tip',
      title: 'Quick CSS Grid Trick',
      isShort: true,
      durationSeconds: 35,
      channel: { id: 'UCother22222222222222222', name: 'Design Bits' },
      badges: [],
    },
  ]

  let isCleared = false

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    history: async (_cursor?: string, query?: string) => {
      state.queries.push(query)
      if (isCleared) return { sections: [] }
      if (query) {
        const needle = query.toLowerCase()
        const matched = entries.filter(entry =>
          entry.title.toLowerCase().includes(needle)
          || entry.channel.name.toLowerCase().includes(needle))
        return {
          sections: matched.length > 0 ? [{ title: 'Search results', items: matched }] : [],
        }
      }
      return {
        sections: [{ title: 'Today', items: entries }],
      }
    },
    removeFromHistory: async (videoId: string) => videoId,
    clearHistory: async () => {
      isCleared = true
      state.cleared += 1
      return true
    },
  } as unknown as SourceApi

  const host = document.createElement('div')
  host.setAttribute('data-history-harness', 'true')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding-top: var(--header-height)'
  document.body.append(host)

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://history-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <HistoryFeedPage />
    </Provider>,
    host,
  )
}
