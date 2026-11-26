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
      votes: { videoId: string, pollId: string, voteParams: string }[]
      leaderboardRequests: { panelId: string, params: string }[]
      closedVideoIds: string[]
      clearPin: () => void
      pushPage: (extra: Record<string, unknown>) => void
      setRestricted: (restricted: boolean) => void
      unmount: () => void
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
    votes: [] as { videoId: string, pollId: string, voteParams: string }[],
    leaderboardRequests: [] as { panelId: string, params: string }[],
    closedVideoIds: [] as string[],
    clearPin: () => {},
    pushPage: (_extra: Record<string, unknown>) => {},
    setRestricted: (_restricted: boolean) => {},
    unmount: () => {},
  }
  window.__liveChatHarness = state

  let pinPending = true
  let restricted = false
  let unlockedOnce = false
  let pendingPush: ((page: Record<string, unknown>) => void) | undefined
  const pushQueue: Record<string, unknown>[] = []

  const enqueuePush = (extra: Record<string, unknown>) => {
    if (pendingPush) {
      pendingPush(extra)
      return
    }
    pushQueue.push(extra)
  }

  state.pushPage = (extra) => {
    enqueuePush(extra)
  }
  state.clearPin = () => {
    pinPending = false
    enqueuePush({ pinnedCleared: true })
  }
  state.setRestricted = (next) => {
    restricted = next
    if (next) {
      enqueuePush({
        inputState: {
          status: 'RESTRICTED',
          restrictionMode: 'SUBSCRIBERS_ONLY',
          restrictionMessage: 'Subscribers-only mode',
        },
      })
    } else {
      unlockedOnce = true
      enqueuePush({
        inputState: {
          status: 'ENABLED',
          slowModeSeconds: 2,
          placeholder: 'Chat…',
        },
      })
    }
  }

  let seq = 0

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', handle: 'viewer', accounts: [] }),
    liveChat: async (_videoId: string, cursor?: string, view?: string) => {
      if (!cursor) {
        pendingPush = undefined
        pushQueue.length = 0
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
            cursor: `cursor-all-${++seq}`,
            customEmojis: [{ id: 'ce-1', shortcut: ':party:', url: CUSTOM_EMOJI_IMG }],
          }
        }
        const refreshedAfterSubscribe = restricted
        if (refreshedAfterSubscribe) {
          restricted = false
          unlockedOnce = true
        }
        return {
          items: [
            {
              id: 'top-msg-1',
              kind: 'TEXT',
              text: 'Hello @viewer from chat',
              runs: [{ text: 'Hello @viewer from chat' }],
              badges: [
                { label: '#1', kind: 'top-fan', backgroundColor: '#ffd600', textColor: '#0f0f0f' },
                { label: 'Member', iconUrl: CUSTOM_EMOJI_IMG, kind: 'member' },
              ],
              isMember: true,
              author: { id: 'UCalice', name: 'Alice', handle: '@alice' },
            },
            {
              id: 'top-msg-2',
              kind: 'TEXT',
              text: 'Welcome @alice!',
              runs: [{ text: 'Welcome @alice!' }],
              badges: [{ label: 'Moderator', kind: 'moderator' }],
              isModerator: true,
              author: { id: 'UCbob', name: 'Bob', handle: '@bob_dev' },
            },
            {
              id: 'top-msg-3',
              kind: 'STICKER',
              text: 'Party Sticker',
              runs: [],
              purchaseAmountText: '$5.00',
              headerBackgroundColor: '#e65100',
              bodyBackgroundColor: '#ef6c00',
              stickerUrl: CUSTOM_EMOJI_IMG,
              stickerLabel: 'Party Sticker',
              author: { id: 'UCsupporter', name: 'Supporter', handle: '@supporter' },
            },
            {
              id: 'top-msg-4',
              kind: 'MEMBERSHIP',
              text: 'Glad to be here!',
              runs: [{ text: 'Glad to be here!' }],
              headerBackgroundColor: '#0f7b3e',
              bodyBackgroundColor: '#139b4f',
              headerPrimaryText: 'Member for 3 months',
              headerSubtext: 'Green Tier',
              isMember: true,
              author: { id: 'UCmember', name: 'Mina', handle: '@mina' },
            },
            {
              id: 'top-msg-5',
              kind: 'GIFT',
              text: 'sent a Treat!',
              runs: [{ text: 'sent a Treat!' }],
              author: { id: 'UCdonor', name: 'Donor', handle: '@donor' },
            },
            {
              id: 'top-msg-6',
              kind: 'SYSTEM',
              text: 'Slow mode is active',
              runs: [{ text: 'Slow mode is active' }],
              iconType: 'SLOW_MODE',
            },
          ],
          cursor: `cursor-top-${++seq}`,
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
          leaderboard: {
            label: 'Top fans',
            panelId: 'PAlive_viewer_leaderboard',
            params: 'top-fans-params',
          },
          poll: {
            id: 'poll-1',
            question: 'Favorite player layout?',
            questionRuns: [{ text: 'Favorite player layout?' }],
            metadataText: 'Poll - 10 votes',
            choices: [
              {
                id: '0',
                text: 'Theater',
                runs: [{ text: 'Theater' }],
                votePercentage: '60%',
                voteRatio: 0.6,
                voteParams: 'vote-theater',
              },
              {
                id: '1',
                text: 'Default',
                runs: [{ text: 'Default' }],
                votePercentage: '40%',
                voteRatio: 0.4,
                voteParams: 'vote-default',
              },
            ],
            finished: false,
          },
          tickerItems: [
            {
              id: 'ticker-1',
              label: '$10.00',
              authorName: 'Carol',
              backgroundColor: '#1565c0',
              textColor: '#ffffff',
              durationSeconds: 120,
              detailText: 'Great stream today!',
            },
          ],
          inputState: unlockedOnce
            ? { status: 'ENABLED', slowModeSeconds: 2, placeholder: 'Chat…' }
            : { status: 'ENABLED', placeholder: 'Chat…' },
          customEmojis: [{ id: 'ce-1', shortcut: ':party:', url: CUSTOM_EMOJI_IMG }],
        }
      }

      const queued = pushQueue.shift()
      if (queued) {
        return {
          items: [],
          cursor: `cursor-${++seq}`,
          ...queued,
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
    liveChatLeaderboard: async (panelId: string, params: string) => {
      state.leaderboardRequests.push({ panelId, params })
      return {
        title: 'Top fans',
        items: [
          {
            rank: '#1',
            displayName: 'Alice',
            points: '1,200 points',
            badgeLabel: '#1',
            badgeBackgroundColor: '#ffd600',
            badgeTextColor: '#0f0f0f',
          },
          {
            rank: '#2',
            displayName: 'Bob',
            points: '900 points',
            badgeLabel: '#2',
          },
        ],
      }
    },
    voteLiveChatPoll: async (videoId: string, pollId: string, voteParams: string) => {
      state.votes.push({ videoId, pollId, voteParams })
      enqueuePush({
        poll: {
          id: pollId,
          question: 'Favorite player layout?',
          questionRuns: [{ text: 'Favorite player layout?' }],
          metadataText: 'Poll - 11 votes',
          choices: [
            {
              id: '0',
              text: 'Theater',
              runs: [{ text: 'Theater' }],
              votePercentage: '64%',
              voteRatio: 0.64,
              selected: voteParams === 'vote-theater',
              voteParams: 'vote-theater',
            },
            {
              id: '1',
              text: 'Default',
              runs: [{ text: 'Default' }],
              votePercentage: '36%',
              voteRatio: 0.36,
              selected: voteParams === 'vote-default',
              voteParams: 'vote-default',
            },
          ],
          finished: false,
        },
      })
      return true
    },
    sendLiveChatMessage: async (_videoId: string, text: string) => {
      state.sent.push(text)
      if (text.includes('after unlock')) {
        enqueuePush({
          items: [{
            id: `echo-${++seq}`,
            kind: 'TEXT',
            text,
            runs: [{ text: 'after unlock ' }, { text: '', emojiUrl: CUSTOM_EMOJI_IMG, emojiLabel: ':party:' }, { text: ' 😀' }],
            author: { id: 'UCself', name: '@viewer', handle: '@viewer' },
          }],
        })
      }
      return true
    },
    closeLiveChat: async (videoId: string) => {
      state.closedVideoIds.push(videoId)
      if (pendingPush) pendingPush({})
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

  state.unmount = () => {
    render(null, host)
    host.remove()
  }

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <PanelWrapper />
    </Provider>,
    host,
  )
}
