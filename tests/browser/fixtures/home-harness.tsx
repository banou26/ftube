import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Parser, YT } from 'youtubei.js'

import { createCache } from '../../../src/graphql'
import HomePage from '../../../src/routes/home'
import { createYoutubeSource } from '../../../src/sources/youtube'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

const feed = (filters: boolean) => ({
  home: {
    items: filters ? [{ id: 'video-0', title: 'Video 0', badges: [], channel: { id: 'channel-0', name: 'Channel 0' } }] : [],
    shorts: [],
    chips: filters
      ? [{ id: 'chip-all', label: 'All', selected: true }, { id: 'chip-music', label: 'Music', selected: false }]
      : [],
    cursor: null,
  },
})

// served by the dev server and imported from a spec, to render Home over a feed with filters (as signed in) or an empty one (as signed out)
export const mountHome = (filters: boolean) => {
  const host = document.createElement('div')
  host.setAttribute('data-home-harness', filters ? 'filters' : 'empty')
  document.body.append(host)
  const fetchAnswer = async () =>
    new Response(JSON.stringify({ data: feed(filters) }), { headers: { 'content-type': 'application/json' } })
  const client = new Client({ url: '/home-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  render(<Provider value={client}><HomePage /></Provider>, host)
}

let reopen: ((event: Event) => void) | undefined

/**
 * Renders Home through the app's own schema, resolvers and cache over a source whose every Home read answers one new
 * video, `video-<n>` for the nth read, so the video on screen tells which read Home shows. `reopenHome` closes it and
 * opens it again after the event a navigation dispatches.
 */
export const mountCachedHome = () => {
  const host = document.createElement('div')
  host.setAttribute('data-cached-home-harness', '')
  document.body.append(host)
  let reads = 0
  const source = {
    home: async () => {
      reads += 1
      return { items: [{ id: `video-${reads}`, title: `Video ${reads}`, badges: [], channel: { id: 'channel-0', name: 'Channel 0' } }], shorts: [], chips: [] }
    },
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://home-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  const home = () => <Provider value={client}><HomePage /></Provider>
  render(home(), host)
  reopen = (event) => {
    render(null, host)
    dispatchEvent(event)
    render(home(), host)
  }
}

/** Opens the cached Home again as a link click does (`pushState`, which wouter's history patch dispatches) or as going back does. */
export const reopenHome = (how: 'pushState' | 'popstate') => reopen!(how === 'popstate' ? new PopStateEvent('popstate') : new Event('pushState'))

/**
 * Renders Home through createYoutubeSource and YT.HomeFeed with rotating chip continuation tokens per getHomeFeed()
 * response, matching real InnerTube home chip bars.
 */
export const mountFilterableHome = () => {
  document.querySelector('[data-filterable-home-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-filterable-home-harness', '')
  ;(document.querySelector('main') ?? document.body).replaceWith(host)

  const chipRenderer = (label: string, token: string, isSelected: boolean) => ({
    chipCloudChipRenderer: {
      text: { runs: [{ text: label }] },
      isSelected,
      navigationEndpoint: {
        commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
        continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
      },
    },
  })
  const videoRenderer = (id: string, title: string) => ({
    richItemRenderer: { content: { videoRenderer: { videoId: id, title: { runs: [{ text: title }] } } } },
  })
  const homeResponse = (suffix: string) => ({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            selected: true,
            content: {
              richGridRenderer: {
                contents: [
                  videoRenderer(`base-${suffix}-1`, `Home Video ${suffix}`),
                  videoRenderer(`base-${suffix}-2`, 'Home Unfiltered Extra'),
                ],
                header: {
                  feedFilterChipBarRenderer: {
                    contents: [
                      chipRenderer('Tous', `ALL_${suffix}`, true),
                      chipRenderer('Jeux vidéo', `GAMING_${suffix}`, false),
                      chipRenderer('Musique', `MUSIQUE_${suffix}`, false),
                      chipRenderer('Podcasts', `PODCASTS_${suffix}`, false),
                    ],
                  },
                },
              },
            },
          },
        }],
      },
    },
  })
  const reloadResponse = (items: unknown[]) => ({
    onResponseReceivedActions: [{
      reloadContinuationItemsCommand: {
        targetId: 'home-page-grid',
        slot: 'RELOAD_CONTINUATION_SLOT_BODY',
        continuationItems: items,
      },
    }],
  })

  let homeCalls = 0
  const actions = {
    session: { logged_in: false },
    execute: async (_path: string, args: Record<string, unknown>) => {
      const token = String(args.continuation ?? '')
      if (token.startsWith('MUSIQUE_')) {
        return Parser.parseResponse(reloadResponse([
          videoRenderer('music-1', 'Musique Track One'),
          videoRenderer('music-2', 'Musique Album Live'),
        ]) as never)
      }
      if (token.startsWith('PODCASTS_')) {
        return Parser.parseResponse(reloadResponse([
          videoRenderer('podcast-1', 'Podcast Episode 42'),
        ]) as never)
      }
      if (token.startsWith('GAMING_')) {
        return Parser.parseResponse(reloadResponse([
          videoRenderer('gaming-1', 'Gaming Stream Highlight'),
        ]) as never)
      }
      return Parser.parseResponse(reloadResponse([]) as never)
    },
  }

  const source = createYoutubeSource({
    fetch: globalThis.fetch,
    createClient: async () => ({
      session: { logged_in: false },
      actions,
      getHomeFeed: async () => {
        homeCalls += 1
        return new YT.HomeFeed(actions as never, { data: homeResponse(String(homeCalls)) } as never) as never
      },
    }) as never,
  }) as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://filterable-home-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  render(<Provider value={client}><HomePage /></Provider>, host)
}
