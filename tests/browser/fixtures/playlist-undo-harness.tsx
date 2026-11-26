import type { SourceApi, SourcePlaylist, SourcePlaylistItem } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { createCache } from '../../../src/graphql'
import PlaylistPage from '../../../src/routes/playlist'
import { clearUndo } from '../../../src/undo'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

declare global {
  interface Window {
    __playlistUndoHarness?: {
      moves: { playlistId: string, setVideoId: string, afterSetVideoId?: string }[]
      adds: { playlistId: string, videoIds: string[] }[]
      removes: { playlistId: string, setVideoIds: string[] }[]
      cleanup: () => void
    }
  }
}

const PLAYLIST_ID = 'PL-undo-order'

const initialPlaylist = (): SourcePlaylist => ({
  id: PLAYLIST_ID,
  title: 'Undo Order Playlist',
  isEditable: true,
  canReorder: true,
})

const initialItems = (): SourcePlaylistItem[] => [
  { setVideoId: 's1', index: 1, video: { id: 'v1', title: 'Alpha Video', badges: [] } },
  { setVideoId: 's2', index: 2, video: { id: 'v2', title: 'Beta Video', badges: [] } },
  { setVideoId: 's3', index: 3, video: { id: 'v3', title: 'Gamma Video', badges: [] } },
]

export const mountPlaylistUndoHarness = () => {
  clearUndo()
  let items = initialItems()
  let addedSeq = 0
  const catalog = new Map(items.map(entry => [entry.video.id, entry.video]))

  const state = {
    moves: [] as { playlistId: string, setVideoId: string, afterSetVideoId?: string }[],
    adds: [] as { playlistId: string, videoIds: string[] }[],
    removes: [] as { playlistId: string, setVideoIds: string[] }[],
    cleanup: () => {
      clearUndo()
      render(null, host)
      host.remove()
    },
  }
  window.__playlistUndoHarness = state

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    playlist: async (id: string) => ({
      playlist: { ...initialPlaylist(), id },
      items: items.map((entry, idx) => ({ ...entry, index: idx + 1 })),
    }),
    removeFromPlaylist: async (playlistId: string, setVideoIds: string[]) => {
      state.removes.push({ playlistId, setVideoIds })
      const dropped = new Set(setVideoIds)
      items = items.filter(entry => !entry.setVideoId || !dropped.has(entry.setVideoId))
      return initialPlaylist()
    },
    addToPlaylist: async (playlistId: string, videoIds: string[]) => {
      state.adds.push({ playlistId, videoIds })
      let lastAddedSetVideoId: string | undefined
      for (const videoId of videoIds) {
        const video = catalog.get(videoId)
        if (!video) continue
        addedSeq += 1
        lastAddedSetVideoId = `added-s-${addedSeq}`
        items = [...items, { setVideoId: lastAddedSetVideoId, index: items.length + 1, video }]
      }
      return { ...initialPlaylist(), ...(lastAddedSetVideoId ? { addedSetVideoId: lastAddedSetVideoId } : {}) }
    },
    movePlaylistItem: async (playlistId: string, setVideoId: string, afterSetVideoId?: string) => {
      state.moves.push({ playlistId, setVideoId, afterSetVideoId })
      const currentIndex = items.findIndex(entry => entry.setVideoId === setVideoId)
      if (currentIndex !== -1) {
        const [moved] = items.splice(currentIndex, 1)
        if (moved) {
          if (!afterSetVideoId) {
            items.unshift(moved)
          } else {
            const predIndex = items.findIndex(entry => entry.setVideoId === afterSetVideoId)
            items.splice(predIndex === -1 ? items.length : predIndex + 1, 0, moved)
          }
        }
      }
      return initialPlaylist()
    },
  } as unknown as SourceApi

  const host = document.createElement('div')
  host.setAttribute('data-playlist-undo-harness', 'true')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto'
  document.body.append(host)

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://playlist-undo-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <PlaylistPage />
    </Provider>,
    host,
  )
}
