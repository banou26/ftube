import type { SourceLiveChatPage } from '../../../../src/sources/types'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { createContinuations } from '../../../../src/sources/youtube'
import { createLiveChatManager } from '../../../../src/sources/youtube/live-chat-session'

const fakeChatResponse = (text: string, continuation?: string) => ({
  data: {
    continuationContents: {
      liveChatContinuation: {
        continuations: continuation
          ? [{ timedContinuationData: { continuation, timeoutMs: 200 } }]
          : [],
        actions: [
          {
            addChatItemAction: {
              item: {
                liveChatTextMessageRenderer: {
                  id: `msg-${text}`,
                  message: { runs: [{ text }] },
                  authorName: { simpleText: 'Viewer' },
                  authorExternalChannelId: 'UCviewer',
                },
              },
            },
          },
        ],
      },
    },
  },
})

describe('createLiveChatManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops upstream get_live_chat polling immediately on close(videoId) and allows clean reopen', async () => {
    let getLiveChatCount = 0
    const continuations = createContinuations<SourceLiveChatPage>()
    const manager = createLiveChatManager({
      continuations,
      requireSignIn: () => {},
      waitMs: 4_000,
      openGraceMs: 2_500,
      idleMs: 60_000,
      getClient: async () => ({
        session: { logged_in: true },
        actions: {
          execute: async (endpoint, args) => {
            if (endpoint === '/next') {
              return {
                data: undefined,
                contents_memo: new Map([
                  ['TwoColumnWatchNextResults', [{ conversation_bar: { is_replay: false, continuation: 'tok-open' } }]],
                ]),
              } as never
            }
            if (endpoint === 'live_chat/get_live_chat') {
              getLiveChatCount += 1
              return fakeChatResponse(`poll-${getLiveChatCount}`, `tok-${getLiveChatCount + 1}`)
            }
            throw new Error(`unexpected ${endpoint} ${JSON.stringify(args)}`)
          },
        },
      }),
    })
    manager.seedFromWatch('vid-1', 'UCch1', 'tok-open')

    const first = await manager.poll('vid-1')
    expect(first.items.map((item) => item.id)).toEqual(['msg-poll-1'])
    expect(first.cursor).toBeTruthy()
    expect(manager.hasSession('vid-1')).toBe(true)

    const waitingRead = manager.poll('vid-1', first.cursor)
    await vi.advanceTimersByTimeAsync(10)
    expect(manager.close('vid-1')).toBe(true)
    expect(manager.hasSession('vid-1')).toBe(false)
    const closedPage = await waitingRead
    expect(closedPage.cursor).toBeUndefined()

    const countAtClose = getLiveChatCount
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getLiveChatCount).toBe(countAtClose)

    // Subsequent close returns false; opening again starts a clean new session.
    expect(manager.close('vid-1')).toBe(false)
    const reopened = await manager.poll('vid-1')
    expect(reopened.items.length).toBeGreaterThanOrEqual(1)
    expect(manager.hasSession('vid-1')).toBe(true)
    expect(manager.close('vid-1')).toBe(true)
  })

  it('self-reaps abandoned polling loops once idleMs passes without requiring another liveChat call', async () => {
    let nowMs = 1_000
    let getLiveChatCount = 0
    const continuations = createContinuations<SourceLiveChatPage>()
    const manager = createLiveChatManager({
      continuations,
      requireSignIn: () => {},
      now: () => nowMs,
      waitMs: 500,
      openGraceMs: 500,
      idleMs: 1_000,
      getClient: async () => ({
        session: { logged_in: true },
        actions: {
          execute: async (endpoint) => {
            if (endpoint === 'live_chat/get_live_chat') {
              getLiveChatCount += 1
              return fakeChatResponse(`tick-${getLiveChatCount}`, `tok-${getLiveChatCount + 1}`)
            }
            return { data: {} }
          },
        },
      }),
    })
    manager.seedFromWatch('vid-idle', 'UCch', 'tok-start')

    const page = await manager.poll('vid-idle')
    expect(page.items).toHaveLength(1)
    expect(manager.hasSession('vid-idle')).toBe(true)

    // Abandon the client completely (no further manager.poll calls). Advance simulated time + timers.
    const countAfterOpen = getLiveChatCount
    nowMs += 2_000
    await vi.advanceTimersByTimeAsync(2_000)
    expect(manager.hasSession('vid-idle')).toBe(false)

    const countAfterReap = getLiveChatCount
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getLiveChatCount).toBe(countAfterReap)
    expect(countAfterReap - countAfterOpen).toBeLessThanOrEqual(1)
  })
})
