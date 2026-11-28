import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { useEffect } from 'preact/hooks'
import { Client, fetchExchange, Provider, useQuery } from 'urql'
import { Redirect, Route, Switch, useLocation, useSearch } from 'wouter'

import PlaylistPanel from '../../../src/components/playlist-panel'
import { createCache } from '../../../src/graphql'
import { watchRedirectHref } from '../../../src/player/links'
import { queueMode } from '../../../src/player/up-next'
import { WATCH_META_QUERY } from '../../../src/player/watch-query'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

declare global {
  interface Window {
    __watchLinksHarness?: {
      navigate: (to: string) => void
      calls: () => Array<{ id: string, playlistId?: string, playlistIndex?: number }>
    }
  }
}

const THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#1e293b"/></svg>')}`

const PLAYLIST_ID = 'PL-DUP'
const ITEMS = [
  { id: 'dup-video', title: 'Repeated Track', thumbnail: THUMB, durationSeconds: 185, badges: [] as string[] },
  { id: 'track-two', title: 'Second Track', thumbnail: THUMB, durationSeconds: 210, badges: [] as string[] },
  { id: 'dup-video', title: 'Repeated Track', thumbnail: THUMB, durationSeconds: 185, badges: [] as string[] },
  { id: 'track-four', title: 'Fourth Track', thumbnail: THUMB, durationSeconds: 240, badges: [] as string[] },
]

const HarnessRedirect = ({ videoId }: { videoId: string }) => (
  <Redirect to={watchRedirectHref(videoId, useSearch())} replace />
)

const HarnessWatch = () => {
  const params = new URLSearchParams(useSearch())
  const videoId = params.get('v') ?? ''
  const listId = params.get('list') ?? undefined
  const indexParam = Number(params.get('index'))
  const playlistIndex = Number.isInteger(indexParam) && indexParam > 0 ? indexParam - 1 : undefined

  const [{ data }] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: videoId, playlistId: listId, playlistIndex },
    requestPolicy: 'cache-and-network',
    pause: videoId === '',
  })

  const watch = data?.watch
  const playlist = listId === undefined || watch?.playlist?.id !== listId ? undefined : watch.playlist

  return (
    <main style='padding: 2.4rem 1.6rem; max-width: 48rem'>
      <div data-watch-meta='true'>
        {watch?.title ?? 'Loading'} | v={videoId} | list={listId ?? ''} | index={params.get('index') ?? ''} | t={params.get('t') ?? ''}
      </div>
      {playlist ? <PlaylistPanel playlist={playlist} /> : undefined}
    </main>
  )
}

const HarnessShell = ({ initialPath, onReady }: { initialPath: string, onReady: (nav: (to: string) => void) => void }) => {
  const [, navigate] = useLocation()

  useEffect(() => {
    onReady((to: string) => navigate(to))
  }, [navigate, onReady])

  useEffect(() => {
    navigate(initialPath, { replace: true })
  }, [initialPath, navigate])

  return (
    <div data-watch-links-harness='' style='position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding-top: 4.8rem'>
      <Switch>
        <Route path='/watch'>
          {() => <HarnessWatch />}
        </Route>
        <Route path='/watch/:videoId'>
          {(params: { videoId: string }) => <HarnessRedirect videoId={params.videoId} />}
        </Route>
        <Route path='/live/:videoId'>
          {(params: { videoId: string }) => <HarnessRedirect videoId={params.videoId} />}
        </Route>
        <Route path='/embed/:videoId'>
          {(params: { videoId: string }) => <HarnessRedirect videoId={params.videoId} />}
        </Route>
      </Switch>
    </div>
  )
}

/** Mounts an isolated duplicate-video playlist Watch queue and WatchRedirect router. */
export const mountWatchLinksHarness = (initialPath = '/embed/dup-video?list=PL-DUP&index=3&start=30') => {
  document.documentElement.dataset.engine = 'ready'
  queueMode.loop = false
  queueMode.shuffle = false

  const existing = document.querySelector('[data-watch-links-host]')
  if (existing) {
    render(null, existing)
    existing.remove()
  }

  const host = document.createElement('div')
  host.setAttribute('data-watch-links-host', '')
  document.body.prepend(host)

  const watchCalls: Array<{ id: string, playlistId?: string, playlistIndex?: number }> = []
  let navigateImpl: ((to: string) => void) | undefined

  const source = {
    watch: async (id: string, playlistId?: string, playlistIndex?: number) => {
      watchCalls.push({ id, playlistId, playlistIndex })
      const resolvedIndex = playlistIndex !== undefined && ITEMS[playlistIndex]?.id === id
        ? playlistIndex
        : Math.max(ITEMS.findIndex(item => item.id === id), 0)
      const active = ITEMS[resolvedIndex] ?? ITEMS[0]!
      return {
        id,
        title: active.title,
        hashtags: [],
        descriptionRuns: [],
        related: [],
        relatedChips: [],
        chapters: [],
        heatmap: [],
        cardTeasers: [],
        playlist: playlistId === PLAYLIST_ID
          ? {
              id: PLAYLIST_ID,
              title: 'Duplicate Entry Playlist',
              author: 'NASA',
              currentIndex: resolvedIndex,
              isInfinite: false,
              items: ITEMS,
            }
          : undefined,
      }
    },
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://watch-links-${Date.now()}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  window.__watchLinksHarness = {
    navigate: (to: string) => navigateImpl?.(to),
    calls: () => [...watchCalls],
  }

  render(
    <Provider value={client}>
      <HarnessShell
        initialPath={initialPath}
        onReady={(nav: (to: string) => void) => {
          navigateImpl = nav
        }}
      />
    </Provider>,
    host,
  )
}
