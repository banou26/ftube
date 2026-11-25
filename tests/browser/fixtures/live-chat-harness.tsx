import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'

import { LiveChat, LiveChatTeaser } from '../../../src/components/live-chat'
import { createCache } from '../../../src/graphql'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

declare global {
  interface Window {
    __liveChatHarness?: {
      views: (string | undefined)[]
      sent: string[]
      clearPin: () => void
    }
  }
}

const CUSTOM_EMOJI_IMG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="%233ea6ff"/></svg>'

const PanelWrapper = () => {
  const [hidden, setHidden] = useState(false)
  return (
    <div style={{ width: '40rem', margin: '0 auto' }}>
      {hidden
        ? <LiveChatTeaser onShow={() => setHidden(false)} />
        : <LiveChat videoId='live-1' onHide={() => setHidden(true)} />}
    </div>
  )
}

export const mountLiveChatHarness = () => {
  const state = {
    views: [] as (string | undefined)[],
    sent: [] as string[],
    clearPin: () => {},
  }
  window.__liveChatHarness = state

  let pinPending = true
  let clearPinNext = false
  let pendingPush: ((page: { pinnedCleared?: boolean }) => void) | undefined
  state.clearPin = () => {
    pinPending = false
    clearPinNext = true
    pendingPush?.({ pinnedCleared: true })
  }

  let seq = 0

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: '@viewer', accounts: [] }),
    liveChat: async (_videoId: string, cursor?: string, view?: string) => {
      if (!cursor) {
        state.views.push(view)
        if (view === 'ALL') {
          return {
            items: [
              {
                id: 'all-msg-1',
                text: 'Unfiltered message in Live chat',
                runs: [{ text: 'Unfiltered message in Live chat' }],
                author: { id: 'UCcarol', name: 'Carol', handle: '@carol' },
              },
            ],
            cursor: 'cursor-all-1',
            customEmojis: [{ id: 'ce-1', shortcut: ':party:', url: CUSTOM_EMOJI_IMG }],
          }
        }
        return {
          items: [
            {
              id: 'top-msg-1',
              text: 'Hello @viewer from chat',
              runs: [{ text: 'Hello @viewer from chat' }],
              author: { id: 'UCalice', name: 'Alice', handle: '@alice' },
            },
            {
              id: 'top-msg-2',
              text: 'Welcome @alice!',
              runs: [{ text: 'Welcome @alice!' }],
              author: { id: 'UCbob', name: 'Bob', handle: '@bob_dev' },
            },
          ],
          cursor: 'cursor-top-1',
          pinned: pinPending
            ? {
                id: 'pin-banner-1',
                header: 'Pinned by Streamer',
                message: {
                  id: 'pin-msg-1',
                  text: 'Welcome to the stream @viewer',
                  runs: [{ text: 'Welcome to the stream @viewer' }],
                  author: { id: 'UCowner', name: 'Streamer', handle: '@streamer' },
                },
              }
            : undefined,
          customEmojis: [{ id: 'ce-1', shortcut: ':party:', url: CUSTOM_EMOJI_IMG }],
        }
      }

      if (clearPinNext) {
        clearPinNext = false
        return {
          items: [],
          cursor: `cursor-${++seq}`,
          pinnedCleared: true,
        }
      }

      return new Promise((resolve) => {
        pendingPush = (extra) => {
          pendingPush = undefined
          resolve({
            items: [],
            cursor: `cursor-${++seq}`,
            ...extra,
          })
        }
      })
    },
    sendLiveChatMessage: async (_videoId: string, text: string) => {
      state.sent.push(text)
      return true
    },
  } as unknown as SourceApi

  const host = document.createElement('div')
  host.setAttribute('data-live-chat-harness', 'true')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding: 2.4rem'
  document.body.append(host)

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://live-chat-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <PanelWrapper />
    </Provider>,
    host,
  )
}
