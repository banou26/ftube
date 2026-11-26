import type {
  SourceChatReplayView,
  SourceLiveChatEmoji,
  SourceLiveChatInputState,
  SourceLiveChatLeaderboardEntryPoint,
  SourceLiveChatMessage,
  SourceLiveChatPage,
  SourceLiveChatPinnedMessage,
  SourceLiveChatPoll,
  SourceLiveChatTickerItem,
} from '../types'

import { applyPollPatch, liveChatToken, nextLiveChatDelayMs, parseLiveChatResponse, parseSendLiveChatResult } from './live-chat'
import { normalizeWatchMeta } from './normalize'
import { encodeLiveMessageParams } from './protobuf'

// A ceiling so the request never looks hung upstream and the UI gets a heartbeat.
const LIVE_CHAT_WAIT_MS = 4_000
// The first call waits long enough for the first get_live_chat round trip to arrive immediately instead of returning a blank frame at 400 ms.
const LIVE_CHAT_OPEN_GRACE_MS = 2_500
const LIVE_CHAT_IDLE_MS = 60_000
const LIVE_CHAT_BUFFER_LIMIT = 300
const LIVE_CHAT_TICKER_LIMIT = 12
const LIVE_CHAT_MAX_RETRIES = 10

export type LiveChatClient = {
  session: { logged_in: boolean }
  actions: {
    execute(endpoint: string, args?: Record<string, unknown>): Promise<{ data?: unknown }>
  }
}

type LiveChatSession = {
  view: SourceChatReplayView
  stopped: boolean
  timer?: ReturnType<typeof setTimeout>
  cancelSleep?: () => void
  buffer: SourceLiveChatMessage[]
  removed: string[]
  removedAuthors: string[]
  pinned?: SourceLiveChatPinnedMessage
  pinnedDirty: boolean
  pinnedCleared: boolean
  customEmojis?: SourceLiveChatEmoji[]
  emojisDirty: boolean
  inputState?: SourceLiveChatInputState
  inputStateDirty: boolean
  slowModeSeconds?: number
  sendParams?: string
  channelId?: string
  leaderboard?: SourceLiveChatLeaderboardEntryPoint
  leaderboardDirty: boolean
  poll?: SourceLiveChatPoll
  pollDirty: boolean
  pollCleared: boolean
  tickerItems: SourceLiveChatTickerItem[]
  tickerDirty: boolean
  reactionBurst: number
  ended: boolean
  failure?: Error
  lastReadAt: number
  waiters: (() => void)[]
}

export type LiveChatContinuations = {
  register(kind: string, load: () => Promise<SourceLiveChatPage>): string
  resolve(kind: string, cursor: string): Promise<SourceLiveChatPage>
  kindOf(cursor: string): string | undefined
}

export type LiveChatManagerDeps = {
  getClient: () => Promise<LiveChatClient>
  requireSignIn: (client: LiveChatClient, action: string) => void
  continuations: LiveChatContinuations
  now?: () => number
  waitMs?: number
  openGraceMs?: number
  idleMs?: number
}

/**
 * Manages active live-chat polling sessions per video, draining updates for long-poll cursor reads and
 * stopping upstream `live_chat/get_live_chat` loops on explicit close or when idle past `idleMs`.
 */
export const createLiveChatManager = ({
  getClient,
  requireSignIn,
  continuations,
  now = Date.now,
  waitMs = LIVE_CHAT_WAIT_MS,
  openGraceMs = LIVE_CHAT_OPEN_GRACE_MS,
  idleMs = LIVE_CHAT_IDLE_MS,
}: LiveChatManagerDeps) => {
  const liveChatSessions = new Map<string, LiveChatSession>()
  const liveChatViewTokens = new Map<string, { TOP?: string, ALL?: string }>()
  const liveChatChannels = new Map<string, string>()

  const wakeSession = (session: LiveChatSession) => {
    for (const done of session.waiters.splice(0, session.waiters.length)) done()
  }

  const waitForLiveChat = (session: LiveChatSession, timeoutMs: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        session.waiters = session.waiters.filter((entry) => entry !== done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      session.waiters.push(done)
    })

  const close = (videoId: string): boolean => {
    const session = liveChatSessions.get(videoId)
    if (!session) return false
    liveChatSessions.delete(videoId)
    session.stopped = true
    session.ended = true
    session.cancelSleep?.()
    if (session.timer) clearTimeout(session.timer)
    wakeSession(session)
    return true
  }

  const sleepLiveChat = (session: LiveChatSession, ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        session.cancelSleep = undefined
        session.timer = undefined
        resolve()
      }
      session.timer = setTimeout(finish, ms)
      session.cancelSleep = () => {
        if (session.timer) clearTimeout(session.timer)
        finish()
      }
    })

  const hasPending = (session: LiveChatSession) =>
    session.buffer.length > 0
    || session.removed.length > 0
    || session.removedAuthors.length > 0
    || session.pinnedDirty
    || session.pinnedCleared
    || session.emojisDirty
    || session.inputStateDirty
    || session.leaderboardDirty
    || session.pollDirty
    || session.pollCleared
    || session.tickerDirty
    || session.reactionBurst > 0
    || session.ended

  const reapIdle = (keep?: string) => {
    const timestamp = now()
    for (const [videoId, session] of liveChatSessions) {
      if (videoId !== keep && timestamp - session.lastReadAt > idleMs) close(videoId)
    }
  }

  const isIdle = (session: LiveChatSession) => now() - session.lastReadAt > idleMs

  const openSession = async (videoId: string, view: SourceChatReplayView = 'TOP', forceReopen = false) => {
    const existing = liveChatSessions.get(videoId)
    if (existing) {
      if (!forceReopen && existing.view === view) return existing
      if (forceReopen && existing.inputState?.status === 'RESTRICTED') liveChatViewTokens.delete(videoId)
      close(videoId)
    }
    const active = await getClient()
    let continuation = liveChatViewTokens.get(videoId)?.[view] ?? liveChatViewTokens.get(videoId)?.TOP
    let channelId = liveChatChannels.get(videoId)
    if (!continuation) {
      const next = await active.actions.execute('/next', { videoId, racyCheckOk: true, contentCheckOk: true, parse: true })
      continuation = liveChatToken(next)
      const meta = normalizeWatchMeta(next, videoId)
      if (meta?.channel?.id) {
        channelId = meta.channel.id
        liveChatChannels.set(videoId, channelId)
      }
      if (continuation) {
        const previous = liveChatViewTokens.get(videoId)
        liveChatViewTokens.set(videoId, { TOP: continuation, ALL: previous?.ALL })
      }
    }
    if (!continuation) return undefined

    const concurrent = liveChatSessions.get(videoId)
    if (concurrent) {
      if (!forceReopen && concurrent.view === view) return concurrent
      close(videoId)
    }

    const session: LiveChatSession = {
      view,
      stopped: false,
      buffer: [],
      removed: [],
      removedAuthors: [],
      pinnedDirty: false,
      pinnedCleared: false,
      emojisDirty: false,
      inputStateDirty: false,
      channelId,
      leaderboardDirty: false,
      pollDirty: false,
      pollCleared: false,
      tickerItems: [],
      tickerDirty: false,
      reactionBurst: 0,
      ended: false,
      lastReadAt: now(),
      waiters: [],
    }
    liveChatSessions.set(videoId, session)

    void (async () => {
      let currentToken = continuation
      let filterPending = view === 'ALL' && !liveChatViewTokens.get(videoId)?.ALL
      let retryCount = 0
      let quietStreak = 0

      while (!session.stopped) {
        if (isIdle(session)) {
          if (liveChatSessions.get(videoId) === session) close(videoId)
          else session.stopped = true
          break
        }

        try {
          const response = await active.actions.execute('live_chat/get_live_chat', {
            continuation: currentToken,
            parse: false,
          })
          if (session.stopped) break
          retryCount = 0
          const parsed = parseLiveChatResponse(response.data)

          if (parsed.viewTokens) {
            const previous = liveChatViewTokens.get(videoId)
            liveChatViewTokens.set(videoId, {
              TOP: parsed.viewTokens.TOP ?? previous?.TOP,
              ALL: parsed.viewTokens.ALL ?? previous?.ALL,
            })
          }

          if (filterPending) {
            filterPending = false
            const allToken = parsed.viewTokens?.ALL
            if (parsed.selectedView !== 'ALL' && allToken && allToken !== currentToken) {
              currentToken = allToken
              continue
            }
          }

          if (parsed.slowModeUpdate !== undefined) session.slowModeSeconds = parsed.slowModeUpdate
          if (parsed.sendParams) session.sendParams = parsed.sendParams
          else if (parsed.clearSendParams) session.sendParams = undefined

          let nextInput = parsed.inputState
          if (nextInput) {
            if (nextInput.status === 'ENABLED' && nextInput.slowModeSeconds === undefined && session.slowModeSeconds !== undefined) {
              nextInput = { ...nextInput, slowModeSeconds: session.slowModeSeconds }
            }
          } else if (parsed.slowModeUpdate !== undefined && session.inputState?.status === 'ENABLED') {
            nextInput = { ...session.inputState, slowModeSeconds: parsed.slowModeUpdate }
          }
          if (nextInput && JSON.stringify(nextInput) !== JSON.stringify(session.inputState)) {
            session.inputState = nextInput
            session.inputStateDirty = true
          }

          if (parsed.leaderboard && JSON.stringify(parsed.leaderboard) !== JSON.stringify(session.leaderboard)) {
            session.leaderboard = parsed.leaderboard
            session.leaderboardDirty = true
          }

          if (parsed.customEmojis.length > 0) {
            session.customEmojis = parsed.customEmojis
            session.emojisDirty = true
          }

          if (parsed.pinned) {
            session.pinned = parsed.pinned
            session.pinnedDirty = true
            session.pinnedCleared = false
          } else if (session.pinned && parsed.removedBannerIds.includes(session.pinned.id)) {
            session.pinned = undefined
            session.pinnedDirty = false
            session.pinnedCleared = true
          }

          if (parsed.poll) {
            session.poll = parsed.poll
            session.pollDirty = true
            session.pollCleared = false
          } else if (session.poll && parsed.pollCleared) {
            session.poll = undefined
            session.pollDirty = false
            session.pollCleared = true
          } else if (parsed.pollPatch && session.poll) {
            session.poll = applyPollPatch(session.poll, parsed.pollPatch)
            session.pollDirty = true
          }

          if (parsed.tickerItems.length > 0) {
            const seenTicker = new Set(parsed.tickerItems.map((item) => item.id))
            const kept = session.tickerItems.filter((item) => !seenTicker.has(item.id))
            session.tickerItems = [...kept, ...parsed.tickerItems].slice(-LIVE_CHAT_TICKER_LIMIT)
            session.tickerDirty = true
          }

          if (parsed.removedIds.length > 0) session.removed.push(...parsed.removedIds)
          if (parsed.removedAuthorIds.length > 0) session.removedAuthors.push(...parsed.removedAuthorIds)
          if (parsed.reactionBurst > 0) session.reactionBurst = Math.min(6, session.reactionBurst + parsed.reactionBurst)
          if (parsed.items.length > 0) {
            session.buffer.push(...parsed.items)
            if (session.buffer.length > LIVE_CHAT_BUFFER_LIMIT) {
              session.buffer.splice(0, session.buffer.length - LIVE_CHAT_BUFFER_LIMIT)
            }
          }

          if (parsed.ended || !parsed.continuation?.token) {
            session.ended = true
            wakeSession(session)
            break
          }

          currentToken = parsed.continuation.token
          quietStreak = parsed.items.length > 0 ? 0 : quietStreak + 1
          if (hasPending(session)) wakeSession(session)

          const elapsedIdle = now() - session.lastReadAt
          if (elapsedIdle > idleMs) {
            if (liveChatSessions.get(videoId) === session) close(videoId)
            else session.stopped = true
            break
          }

          const delayMs = nextLiveChatDelayMs({
            continuationType: parsed.continuation.type,
            timeoutMs: parsed.continuation.timeoutMs,
            gotItems: parsed.items.length > 0,
            quietStreak,
          })
          await sleepLiveChat(session, Math.min(delayMs, Math.max(1, idleMs - elapsedIdle + 1)))
        } catch (error) {
          if (session.stopped) break
          session.failure = error instanceof Error ? error : new Error(String(error))
          wakeSession(session)
          retryCount += 1
          if (retryCount >= LIVE_CHAT_MAX_RETRIES) {
            session.ended = true
            wakeSession(session)
            break
          }
          const elapsedIdle = now() - session.lastReadAt
          if (elapsedIdle > idleMs) {
            if (liveChatSessions.get(videoId) === session) close(videoId)
            else session.stopped = true
            break
          }
          const retryDelay = Math.min(4_000, 500 * retryCount)
          await sleepLiveChat(session, Math.min(retryDelay, Math.max(1, idleMs - elapsedIdle + 1)))
        }
      }
    })()

    return session
  }

  const drain = (videoId: string, session: LiveChatSession): SourceLiveChatPage => {
    session.lastReadAt = now()
    const items = session.buffer.splice(0, session.buffer.length)
    const removedIds = session.removed.splice(0, session.removed.length)
    const removedAuthorIds = session.removedAuthors.splice(0, session.removedAuthors.length)
    const page: SourceLiveChatPage = { items }
    if (removedIds.length) page.removedIds = removedIds
    if (removedAuthorIds.length) page.removedAuthorIds = removedAuthorIds
    if (session.pinnedDirty && session.pinned) {
      page.pinned = session.pinned
      session.pinnedDirty = false
    } else if (session.pinnedCleared) {
      page.pinnedCleared = true
      session.pinnedCleared = false
    }
    if (session.emojisDirty && session.customEmojis) {
      page.customEmojis = session.customEmojis
      session.emojisDirty = false
    }
    if (session.inputStateDirty && session.inputState) {
      page.inputState = session.inputState
      session.inputStateDirty = false
    }
    if (session.leaderboardDirty && session.leaderboard) {
      page.leaderboard = session.leaderboard
      session.leaderboardDirty = false
    }
    if (session.pollDirty && session.poll) {
      page.poll = session.poll
      session.pollDirty = false
    } else if (session.pollCleared) {
      page.pollCleared = true
      session.pollCleared = false
    }
    if (session.tickerDirty) {
      page.tickerItems = [...session.tickerItems]
      session.tickerDirty = false
    }
    if (session.reactionBurst > 0) {
      page.reactionBurst = session.reactionBurst
      session.reactionBurst = 0
    }
    // No cursor once the stream is over or explicitly closed: that stops client polling.
    if (session.ended) {
      if (liveChatSessions.get(videoId) === session) close(videoId)
      return page
    }
    const kind = `livechat:${videoId}`
    const view = session.view
    page.cursor = continuations.register(kind, async () => {
      const current = liveChatSessions.get(videoId)
      if (!current || current.view !== view) {
        const reopened = await openSession(videoId, view)
        if (!reopened) return { items: [], disabled: true }
        if (!hasPending(reopened) && !reopened.failure) {
          await waitForLiveChat(reopened, openGraceMs)
        }
        return drain(videoId, reopened)
      }
      current.lastReadAt = now()
      if (!hasPending(current) && !current.failure) {
        await waitForLiveChat(current, waitMs)
      }
      if (current.failure) {
        const failure = current.failure
        current.failure = undefined
        throw failure
      }
      return drain(videoId, current)
    })
    return page
  }

  return {
    seedFromWatch: (videoId: string, channelId?: string, topToken?: string) => {
      if (channelId) liveChatChannels.set(videoId, channelId)
      if (topToken && !liveChatViewTokens.get(videoId)?.TOP) {
        const prev = liveChatViewTokens.get(videoId)
        liveChatViewTokens.set(videoId, { ...prev, TOP: topToken })
      }
    },

    poll: async (videoId: string, cursor?: string, view: SourceChatReplayView = 'TOP'): Promise<SourceLiveChatPage> => {
      reapIdle(videoId)
      // This video's cursor from an engine a reset replaced is unknown here: open again rather than failing every poll.
      const replaced = cursor?.startsWith(`youtube:livechat:${videoId}:`) && !continuations.kindOf(cursor)
      if (cursor && !replaced) {
        const current = liveChatSessions.get(videoId)
        if (!current || current.view === view) return continuations.resolve(`livechat:${videoId}`, cursor)
      }
      const session = await openSession(videoId, view, !cursor)
      if (!session) return { items: [], disabled: true }
      if (!hasPending(session) && !session.failure) {
        await waitForLiveChat(session, openGraceMs)
      }
      if (session.failure && !hasPending(session)) {
        const failure = session.failure
        session.failure = undefined
        throw failure
      }
      return drain(videoId, session)
    },

    close,

    sendMessage: async (videoId: string, textBody: string): Promise<boolean> => {
      const active = await getClient()
      requireSignIn(active, 'send a live chat message')
      const session = liveChatSessions.get(videoId)
      if (!session) throw new Error('youtube: live chat is not open for this video')
      if (session.inputState?.status === 'RESTRICTED') {
        throw new Error(session.inputState.restrictionMessage || 'youtube: live chat participation is restricted')
      }
      const params = session.sendParams
        ?? (session.channelId || liveChatChannels.get(videoId)
          ? encodeLiveMessageParams(videoId, session.channelId ?? liveChatChannels.get(videoId))
          : encodeLiveMessageParams(videoId))
      const response = await active.actions.execute('/live_chat/send_message', {
        richMessage: { textSegments: [{ text: textBody }] },
        clientMessageId: crypto.randomUUID(),
        client: 'WEB',
        params,
        parse: false,
      })
      const parsed = parseSendLiveChatResult(response.data)
      if (parsed.errorMessage) throw new Error(parsed.errorMessage)
      if (parsed.addedMessages.length > 0) {
        session.buffer.push(...parsed.addedMessages)
        if (session.buffer.length > LIVE_CHAT_BUFFER_LIMIT) {
          session.buffer.splice(0, session.buffer.length - LIVE_CHAT_BUFFER_LIMIT)
        }
        wakeSession(session)
      }
      return true
    },

    votePoll: async (videoId: string, pollId: string, voteParams: string): Promise<boolean> => {
      const active = await getClient()
      requireSignIn(active, 'vote in a live poll')
      let parsed: { endpoint?: string, params?: string }
      try {
        parsed = JSON.parse(voteParams) as { endpoint?: string, params?: string }
      } catch {
        throw new Error('youtube: invalid live poll vote parameters')
      }
      if (
        typeof parsed.endpoint !== 'string'
        || !/^\/live_chat\/[a-z_]+$/.test(parsed.endpoint)
        || typeof parsed.params !== 'string'
        || !parsed.params
      ) {
        throw new Error('youtube: invalid live poll vote parameters')
      }
      await active.actions.execute(parsed.endpoint, { params: parsed.params, parse: false })
      const session = liveChatSessions.get(videoId)
      if (session?.poll && session.poll.id === pollId) {
        session.poll = {
          ...session.poll,
          choices: session.poll.choices.map((choice) => ({
            ...choice,
            selected: choice.voteParams === voteParams ? true : undefined,
          })),
        }
        session.pollDirty = true
        wakeSession(session)
      }
      return true
    },

    hasSession: (videoId: string) => liveChatSessions.has(videoId),
  }
}
