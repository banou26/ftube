import type { TargetedEvent } from 'preact'

import type { ChatReplayView, LiveChatQuery } from '../generated/graphql'
import type { CustomEmoji } from './emoji-picker'
import type { MentionCandidate } from './live-chat-helpers'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useClient, useMutation, useQuery } from 'urql'

import { gql } from '../generated'
import { useSession } from '../session'
import { lineFor } from './data-failure'
import { insertAtCursor } from './emoji-picker'
import { activeMentionQuery, applyMention, filterMentionCandidates, mentionTagFor } from './live-chat-helpers'
import { showToast } from './ui/toast'

export type ChatPage = LiveChatQuery['liveChat']
export type ChatRow = ChatPage['items'][number]
export type ChatRun = ChatRow['runs'][number]
export type ChatPinned = NonNullable<ChatPage['pinned']>
export type ChatPoll = NonNullable<ChatPage['poll']>
export type ChatTickerItem = NonNullable<ChatPage['tickerItems']>[number]
export type ChatLeaderboardEntryPoint = NonNullable<ChatPage['leaderboard']>
export type ChatInputState = NonNullable<ChatPage['inputState']>
export type ViewerIdentity = { name?: string | null, handle?: string | null, avatar?: string | null }

export type ChatLineMessage = {
  id: string
  kind?: ChatRow['kind']
  author?: ChatRow['author']
  text: string
  runs: readonly ChatRun[]
  timestampText?: string | null
  isOwner?: boolean | null
  isModerator?: boolean | null
  isMember?: boolean | null
  badges?: ChatRow['badges']
  purchaseAmountText?: string | null
  headerBackgroundColor?: string | null
  bodyBackgroundColor?: string | null
  headerPrimaryText?: string | null
  headerSubtext?: string | null
  stickerUrl?: string | null
  stickerLabel?: string | null
  iconType?: string | null
}

const LIVE_CHAT_QUERY = gql(`
  query LiveChat($videoId: ID!, $view: ChatReplayView, $cursor: String) {
    liveChat(videoId: $videoId, view: $view, cursor: $cursor) {
      items {
        id
        kind
        text
        runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
        timestampText
        isOwner
        isModerator
        isMember
        badges { label iconUrl kind backgroundColor textColor }
        purchaseAmountText
        headerBackgroundColor
        bodyBackgroundColor
        headerPrimaryText
        headerSubtext
        stickerUrl
        stickerLabel
        iconType
        author { id name avatar handle }
      }
      cursor
      removedIds
      removedAuthorIds
      disabled
      pinned {
        id
        header
        message {
          id
          kind
          text
          runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
          timestampText
          isOwner
          isModerator
          isMember
          badges { label iconUrl kind backgroundColor textColor }
          purchaseAmountText
          headerBackgroundColor
          bodyBackgroundColor
          headerPrimaryText
          headerSubtext
          stickerUrl
          stickerLabel
          iconType
          author { id name avatar handle }
        }
      }
      pinnedCleared
      customEmojis { id shortcut url group locked lockReason }
      inputState {
        status
        restrictionMessage
        restrictionMode
        placeholder
        maxLength
        slowModeSeconds
      }
      leaderboard {
        label
        panelId
        params
      }
      poll {
        id
        question
        questionRuns { text url videoId startSeconds browseId emojiUrl emojiLabel }
        metadataText
        choices {
          id
          text
          runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
          votePercentage
          voteRatio
          selected
          voteParams
        }
        finished
      }
      pollCleared
      tickerItems {
        id
        label
        avatar
        authorName
        backgroundColor
        textColor
        durationSeconds
        detailText
      }
      reactionBurst
    }
  }
`)

const LIVE_CHAT_LEADERBOARD_QUERY = gql(`
  query LiveChatLeaderboard($panelId: String!, $params: String!) {
    liveChatLeaderboard(panelId: $panelId, params: $params) {
      title
      items {
        rank
        displayName
        avatar
        points
        badgeLabel
        badgeBackgroundColor
        badgeTextColor
      }
    }
  }
`)

const SEND_LIVE_CHAT = gql(`
  mutation SendLiveChatMessage($videoId: ID!, $text: String!) {
    sendLiveChatMessage(videoId: $videoId, text: $text)
  }
`)

const VOTE_LIVE_CHAT_POLL = gql(`
  mutation VoteLiveChatPoll($videoId: ID!, $pollId: ID!, $voteParams: String!) {
    voteLiveChatPoll(videoId: $videoId, pollId: $pollId, voteParams: $voteParams)
  }
`)

const CLOSE_LIVE_CHAT = gql(`
  mutation CloseLiveChat($videoId: ID!) {
    closeLiveChat(videoId: $videoId)
  }
`)

// youtube.com's own maxItemsToDisplay
export const TRANSCRIPT_LIMIT = 250

/** Quick reaction emojis offered in the live chat reaction bar. */
export const LIVE_REACTIONS = ['❤️', '😂', '😮', '🎉', '💯'] as const

const PINNED_SLACK_PX = 40
const REACTION_LIFETIME_MS = 1_800
const MAX_ACTIVE_REACTIONS = 12

export const LIVE_CHAT_VIEWS: { value: ChatReplayView, label: string }[] = [
  { value: 'TOP', label: 'Top chat' },
  { value: 'ALL', label: 'Live chat' },
]

// Tracks active mounted panels per videoId so responsive breakpoint remounts in the same commit
// do not prematurely close an active session while real hides/unmounts stop upstream polling immediately.
const activeLiveChatMounts = new Map<string, number>()

const normIdent = (value?: string | null) => value?.trim().replace(/^@/, '').toLowerCase() || undefined
const normEchoText = (value: string) => value.replace(/\s+/g, ' ').trim()

const sameAuthor = (author: ChatRow['author'] | undefined, self: ViewerIdentity | undefined) => {
  if (!author || !self) return false
  const selfKeys = [normIdent(self.handle), normIdent(self.name)].filter((v): v is string => Boolean(v))
  const authorKeys = [normIdent(author.handle), normIdent(author.name)].filter((v): v is string => Boolean(v))
  return selfKeys.some((key) => authorKeys.includes(key))
}

/** Keeps a chat log on its newest line until the reader scrolls up, which `pinned` false offers a way back from. */
export const usePinnedLog = (lines: unknown) => {
  const [pinned, setPinned] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const log = logRef.current
    if (!log || !pinned) return
    log.scrollTop = log.scrollHeight
  }, [lines, pinned])

  const onScroll = () => {
    const log = logRef.current
    if (!log) return
    setPinned(log.scrollHeight - log.scrollTop - log.clientHeight <= PINNED_SLACK_PX)
  }

  return { logRef, onScroll, pinned, setPinned }
}

export type OverlayChatEvent = {
  seq: number
  items: ChatRow[]
  removedIds: string[]
  removedAuthorIds: string[]
}

/**
 * Manages client-side live chat polling, state transitions, mutations, and server session lifecycle
 * (`closeLiveChat` on hide or unmount) for a live stream `videoId`.
 */
export const useLiveChatSession = ({
  videoId,
  subscribed,
  keepAliveOnHide = false,
  onHide,
}: {
  videoId: string
  subscribed?: boolean
  keepAliveOnHide?: boolean
  onHide?: () => void
}) => {
  const { ready, signedIn, name, avatar, handle } = useSession()
  const self = useMemo<ViewerIdentity | undefined>(
    () => (signedIn ? { name, avatar, handle } : undefined),
    [signedIn, name, avatar, handle],
  )
  const [view, setView] = useState<ChatReplayView>('TOP')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ChatRow[]>([])
  const [pinnedMessage, setPinnedMessage] = useState<ChatPinned | undefined>(undefined)
  const [dismissedPinId, setDismissedPinId] = useState<string | undefined>(undefined)
  const [pinExpanded, setPinExpanded] = useState(false)
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([])
  const [inputState, setInputState] = useState<ChatInputState | undefined>(undefined)
  const [leaderboardEntry, setLeaderboardEntry] = useState<ChatLeaderboardEntryPoint | undefined>(undefined)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [poll, setPoll] = useState<ChatPoll | undefined>(undefined)
  const [pollCollapsed, setPollCollapsed] = useState(false)
  const [votingPoll, setVotingPoll] = useState(false)
  const [tickerItems, setTickerItems] = useState<ChatTickerItem[]>([])
  const [selectedTickerId, setSelectedTickerId] = useState<string | undefined>(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [slowModeUntil, setSlowModeUntil] = useState(0)
  const [slowModeLeft, setSlowModeLeft] = useState(0)
  const [ended, setEnded] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [dismissedMentionAt, setDismissedMentionAt] = useState<number | undefined>(undefined)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [reactions, setReactions] = useState<{ id: number, emoji: string, leftPx: number }[]>([])
  const [overlayEvent, setOverlayEvent] = useState<OverlayChatEvent | undefined>(undefined)
  const [overlayResetSeq, setOverlayResetSeq] = useState(0)
  const { logRef, onScroll, pinned, setPinned } = usePinnedLog(messages)
  const client = useClient()
  const [, send] = useMutation(SEND_LIVE_CHAT)
  const [, votePoll] = useMutation(VOTE_LIVE_CHAT_POLL)
  const inputRef = useRef<HTMLInputElement>(null)
  const mentionListId = useId()
  const reactionSeq = useRef(0)
  const overlaySeq = useRef(0)
  const overlaySeededRef = useRef(false)
  const seenOverlayIdsRef = useRef<Set<string>>(new Set())
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const caretFrame = useRef<number | undefined>(undefined)
  const pinnedIdRef = useRef<string | undefined>(undefined)
  const pendingEchoes = useRef<{ id: string, text: string, at: number }[]>([])
  const prevSubscribed = useRef(subscribed)
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const leaderboardPanelRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef(client)
  clientRef.current = client
  const keepAliveOnHideRef = useRef(keepAliveOnHide)
  keepAliveOnHideRef.current = keepAliveOnHide
  const closedByUserRef = useRef(false)

  useLayoutEffect(() => {
    closedByUserRef.current = false
    overlaySeededRef.current = false
    seenOverlayIdsRef.current.clear()
    setOverlayEvent(undefined)
    setOverlayResetSeq((seq) => seq + 1)
    activeLiveChatMounts.set(videoId, (activeLiveChatMounts.get(videoId) ?? 0) + 1)
    return () => {
      const remaining = Math.max(0, (activeLiveChatMounts.get(videoId) ?? 1) - 1)
      if (remaining === 0) activeLiveChatMounts.delete(videoId)
      else activeLiveChatMounts.set(videoId, remaining)
      queueMicrotask(() => {
        if (!activeLiveChatMounts.has(videoId) && !closedByUserRef.current) {
          void clientRef.current.mutation(CLOSE_LIVE_CHAT, { videoId }).toPromise().catch(() => {})
        }
      })
    }
  }, [videoId])

  const hideChat = () => {
    if (keepAliveOnHideRef.current) {
      onHide?.()
      return
    }
    closedByUserRef.current = true
    setEnded(true)
    void clientRef.current.mutation(CLOSE_LIVE_CHAT, { videoId }).toPromise().catch(() => {})
    onHide?.()
  }

  /* the server parks each request until something arrives, so the cursor chain IS the poll: no interval belongs here */
  const [{ data, error }, reexecute] = useQuery({
    query: LIVE_CHAT_QUERY,
    variables: { videoId, view, cursor },
    requestPolicy: 'network-only',
    pause: ended,
  })

  const [{ data: leaderboardQueryData, fetching: leaderboardLoading, error: leaderboardError }, reexecuteLeaderboard] = useQuery({
    query: LIVE_CHAT_LEADERBOARD_QUERY,
    variables: {
      panelId: leaderboardEntry?.panelId ?? '',
      params: leaderboardEntry?.params ?? '',
    },
    requestPolicy: 'network-only',
    pause: !leaderboardOpen || !leaderboardEntry,
  })

  const page = data?.liveChat

  const scheduleTimer = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      fn()
    }, ms)
    timers.current.add(timer)
    return timer
  }

  useLayoutEffect(() => {
    if (!leaderboardOpen) return
    const previous = document.activeElement as HTMLElement | null
    leaderboardPanelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setLeaderboardOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [leaderboardOpen])

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
    if (caretFrame.current !== undefined) cancelAnimationFrame(caretFrame.current)
  }, [])

  useEffect(() => {
    if (!slowModeUntil) {
      setSlowModeLeft(0)
      return
    }
    const update = () => {
      const remaining = Math.ceil((slowModeUntil - Date.now()) / 1_000)
      if (remaining <= 0) {
        setSlowModeLeft(0)
        setSlowModeUntil(0)
        return false
      }
      setSlowModeLeft(remaining)
      return true
    }
    if (!update()) return
    const interval = setInterval(() => {
      if (!update()) clearInterval(interval)
    }, 250)
    return () => clearInterval(interval)
  }, [slowModeUntil])

  const attemptRef = useRef(0)
  useEffect(() => {
    if (!error || ended) {
      if (!error) attemptRef.current = 0
      return
    }
    setRefreshing(false)
    const delay = Math.min(8_000, 500 * 2 ** attemptRef.current)
    attemptRef.current += 1
    const timer = scheduleTimer(() => reexecute({ requestPolicy: 'network-only' }), delay)
    return () => {
      clearTimeout(timer)
      timers.current.delete(timer)
    }
  }, [error, ended, reexecute])

  const triggerReaction = (emoji: string) => {
    const id = ++reactionSeq.current
    const leftPx = (id * 13) % 36
    setReactions((current) => [...current.slice(-(MAX_ACTIVE_REACTIONS - 1)), { id, emoji, leftPx }])
    scheduleTimer(() => {
      setReactions((current) => current.filter((item) => item.id !== id))
    }, REACTION_LIFETIME_MS)
  }

  useEffect(() => {
    if (!page) return
    setRefreshing(false)
    const removedIds = page.removedIds ?? []
    const removedAuthorIds = page.removedAuthorIds ?? []
    const removed = new Set(removedIds)
    const removedAuthors = new Set(removedAuthorIds)

    if (!overlaySeededRef.current) {
      overlaySeededRef.current = true
      for (const item of page.items) seenOverlayIdsRef.current.add(item.id)
    } else if (page.items.length || removedIds.length || removedAuthorIds.length) {
      const liveItems: ChatRow[] = []
      for (const item of page.items) {
        const alreadySeen = seenOverlayIdsRef.current.has(item.id)
        seenOverlayIdsRef.current.add(item.id)
        if (alreadySeen) continue
        if (removed.has(item.id)) continue
        if (item.author?.id && removedAuthors.has(item.author.id)) continue
        if (item.kind === 'SYSTEM') continue
        const matchesLocalEcho = pendingEchoes.current.length > 0
          && sameAuthor(item.author, self)
          && pendingEchoes.current.some((pending) => normEchoText(pending.text) === normEchoText(item.text))
        if (matchesLocalEcho) continue
        liveItems.push(item)
      }
      if (seenOverlayIdsRef.current.size > 600) {
        const retained = new Set(messagesRef.current.map((entry) => entry.id))
        for (const item of liveItems) retained.add(item.id)
        seenOverlayIdsRef.current = retained
      }
      if (liveItems.length > 0 || removedIds.length > 0 || removedAuthorIds.length > 0) {
        setOverlayEvent({
          seq: ++overlaySeq.current,
          items: liveItems,
          removedIds,
          removedAuthorIds,
        })
      }
    }

    if (page.items.length || removed.size || removedAuthors.size) {
      const now = Date.now()
      pendingEchoes.current = pendingEchoes.current.filter((entry) => now - entry.at < 15_000)
      setMessages((current) => {
        let next = current.filter((message) => {
          if (removed.has(message.id)) return false
          if (message.author?.id && removedAuthors.has(message.author.id)) return false
          return true
        })

        for (const item of page.items) {
          if (removed.has(item.id)) continue
          if (item.author?.id && removedAuthors.has(item.author.id)) continue

          const existingIndex = next.findIndex((existing) => existing.id === item.id)
          if (existingIndex >= 0) {
            next = next.map((existing, idx) => (idx === existingIndex ? item : existing))
            continue
          }

          if (pendingEchoes.current.length > 0 && sameAuthor(item.author, self)) {
            const incomingText = normEchoText(item.text)
            const matchIdx = pendingEchoes.current.findIndex((pending) => normEchoText(pending.text) === incomingText)
            if (matchIdx >= 0) {
              const matched = pendingEchoes.current.splice(matchIdx, 1)[0]
              if (matched) {
                const localIndex = next.findIndex((existing) => existing.id === matched.id)
                if (localIndex >= 0) {
                  next = next.map((existing, idx) => (idx === localIndex ? item : existing))
                  continue
                }
              }
            }
          }

          next = [...next, item]
        }

        return next.length > TRANSCRIPT_LIMIT ? next.slice(next.length - TRANSCRIPT_LIMIT) : next
      })
    }
    if (page.pinned) {
      if (pinnedIdRef.current !== page.pinned.id) {
        pinnedIdRef.current = page.pinned.id
        setPinExpanded(false)
      }
      setPinnedMessage(page.pinned)
    } else if (page.pinnedCleared) {
      pinnedIdRef.current = undefined
      setPinnedMessage(undefined)
    }
    if (page.customEmojis?.length) setCustomEmojis(page.customEmojis)
    if (page.inputState) {
      setInputState(page.inputState)
      if (page.inputState.slowModeSeconds === 0) setSlowModeUntil(0)
    }
    if (page.leaderboard) setLeaderboardEntry(page.leaderboard)
    if (page.poll) setPoll(page.poll)
    else if (page.pollCleared) setPoll(undefined)
    if (page.tickerItems) setTickerItems(page.tickerItems)
    if ((page.reactionBurst ?? 0) > 0) {
      const count = Math.min(6, page.reactionBurst ?? 0)
      for (let idx = 0; idx < count; idx += 1) {
        const emoji = LIVE_REACTIONS[(reactionSeq.current + idx) % LIVE_REACTIONS.length]!
        if (idx === 0) triggerReaction(emoji)
        else scheduleTimer(() => triggerReaction(emoji), idx * 180)
      }
    }
    if (!page.cursor) setEnded(true)
    else if (page.cursor !== cursor) setCursor(page.cursor)
  }, [page])

  const refreshSession = () => {
    setRefreshing(true)
    setEnded(false)
    overlaySeededRef.current = false
    seenOverlayIdsRef.current.clear()
    setOverlayEvent(undefined)
    setOverlayResetSeq((seq) => seq + 1)
    if (cursorRef.current !== undefined) {
      setCursor(undefined)
    } else {
      reexecute({ requestPolicy: 'network-only' })
    }
  }

  useEffect(() => {
    const wasFalse = prevSubscribed.current === false
    prevSubscribed.current = subscribed
    if (wasFalse && subscribed === true && inputState?.status === 'RESTRICTED') {
      const timer = scheduleTimer(() => refreshSession(), 250)
      return () => {
        clearTimeout(timer)
        timers.current.delete(timer)
      }
    }
    return undefined
  }, [subscribed, inputState?.status])

  const switchView = (nextView: ChatReplayView) => {
    if (nextView === view) return
    pinnedIdRef.current = undefined
    pendingEchoes.current = []
    overlaySeededRef.current = false
    seenOverlayIdsRef.current.clear()
    setOverlayEvent(undefined)
    setOverlayResetSeq((seq) => seq + 1)
    setView(nextView)
    setCursor(undefined)
    setMessages([])
    setPinnedMessage(undefined)
    setDismissedPinId(undefined)
    setPinExpanded(false)
    setInputState(undefined)
    setLeaderboardEntry(undefined)
    setLeaderboardOpen(false)
    setPoll(undefined)
    setPollCollapsed(false)
    setTickerItems([])
    setSelectedTickerId(undefined)
    setSlowModeUntil(0)
    setSlowModeLeft(0)
    setRefreshing(false)
    setEnded(false)
    setPinned(true)
  }

  const openLeaderboard = () => {
    if (!leaderboardEntry) return
    const alreadyOpen = leaderboardOpen
    setLeaderboardOpen(true)
    if (alreadyOpen) reexecuteLeaderboard({ requestPolicy: 'network-only' })
  }

  const updateDraftWithCaret = (nextValue: string, nextCaret: number) => {
    setDraft(nextValue)
    setCaret(nextCaret)
    setDismissedMentionAt(undefined)
    setMentionIndex(0)
    if (caretFrame.current !== undefined) cancelAnimationFrame(caretFrame.current)
    caretFrame.current = requestAnimationFrame(() => {
      caretFrame.current = undefined
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const pickEmoji = (emoji: string) => {
    const input = inputRef.current
    const start = input?.selectionStart ?? caret
    const end = input?.selectionEnd ?? start
    const next = insertAtCursor(draft, start, end, emoji)
    updateDraftWithCaret(next.value, next.cursor)
  }

  const onAuthorClick = (author: NonNullable<ChatRow['author']>) => {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? start
    const prefix = start > 0 && !/\s$/.test(draft.slice(0, start)) ? ' ' : ''
    const next = insertAtCursor(draft, start, end, `${prefix}@${mentionTagFor(author)} `)
    updateDraftWithCaret(next.value, next.cursor)
  }

  const canCompose = ready && signedIn && !ended && inputState?.status !== 'RESTRICTED' && inputState?.status !== 'SIGN_IN_REQUIRED'
  const mentionMatch = canCompose ? activeMentionQuery(draft, caret) : undefined
  const candidates = useMemo<MentionCandidate[]>(() => {
    const authors: MentionCandidate[] = []
    if (pinnedMessage?.message.author) authors.push(pinnedMessage.message.author)
    for (const message of messages) {
      if (message.author) authors.push(message.author)
    }
    return authors
  }, [messages, pinnedMessage])

  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch || dismissedMentionAt === mentionMatch.start) return []
    return filterMentionCandidates(candidates, mentionMatch.query)
  }, [candidates, mentionMatch, dismissedMentionAt])

  const chooseMention = (candidate: MentionCandidate) => {
    if (!mentionMatch) return
    const next = applyMention(draft, mentionMatch.start, caret, mentionTagFor(candidate))
    updateDraftWithCaret(next.value, next.cursor)
  }

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (mentionSuggestions.length === 0 || !mentionMatch) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setMentionIndex((index) => (index + 1) % mentionSuggestions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length)
      return
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      const selected = mentionSuggestions[Math.min(mentionIndex, mentionSuggestions.length - 1)]
      if (selected) chooseMention(selected)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedMentionAt(mentionMatch.start)
    }
  }

  const submit = async (event: TargetedEvent<HTMLFormElement, Event>) => {
    event.preventDefault()
    if (sending || slowModeLeft > 0) return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setDraft('')
    setCaret(0)
    const seenBeforeSend = new Set(messagesRef.current.map((item) => item.id))
    try {
      const result = await send({ videoId, text })
      if (result.error) {
        showToast(lineFor(result.error))
        setDraft(text)
        setCaret(text.length)
        return
      }
      if (self) {
        const localId = `local:${crypto.randomUUID()}`
        const targetText = normEchoText(text)
        const alreadyInMessages = messagesRef.current.some((item) =>
          !seenBeforeSend.has(item.id)
          && !item.id.startsWith('local:')
          && normEchoText(item.text) === targetText
          && sameAuthor(item.author, self),
        )
        const optimisticRow: ChatRow = {
          __typename: 'LiveChatMessage',
          id: localId,
          kind: 'TEXT',
          text,
          runs: [{ __typename: 'LiveChatRun', text, url: null, videoId: null, startSeconds: null, browseId: null, emojiUrl: null, emojiLabel: null }],
          timestampText: null,
          isOwner: false,
          isModerator: false,
          isMember: false,
          badges: null,
          purchaseAmountText: null,
          headerBackgroundColor: null,
          bodyBackgroundColor: null,
          headerPrimaryText: null,
          headerSubtext: null,
          stickerUrl: null,
          stickerLabel: null,
          iconType: null,
          author: {
            __typename: 'Author',
            id: 'self',
            name: self.name || self.handle || 'You',
            avatar: self.avatar ?? null,
            handle: self.handle ?? null,
          },
        }
        pendingEchoes.current.push({ id: localId, text, at: Date.now() })
        setMessages((current) => {
          const alreadyArrived = current.some((item) =>
            !seenBeforeSend.has(item.id)
            && !item.id.startsWith('local:')
            && normEchoText(item.text) === targetText
            && sameAuthor(item.author, self),
          )
          if (alreadyArrived) {
            pendingEchoes.current = pendingEchoes.current.filter((entry) => entry.id !== localId)
            return current
          }
          const grown = [...current, optimisticRow]
          return grown.length > TRANSCRIPT_LIMIT ? grown.slice(grown.length - TRANSCRIPT_LIMIT) : grown
        })
        if (!alreadyInMessages) {
          seenOverlayIdsRef.current.add(localId)
          setOverlayEvent({
            seq: ++overlaySeq.current,
            items: [optimisticRow],
            removedIds: [],
            removedAuthorIds: [],
          })
        }
      }
      if ((inputState?.slowModeSeconds ?? 0) > 0) {
        setSlowModeUntil(Date.now() + inputState!.slowModeSeconds! * 1_000)
      }
    } finally {
      setSending(false)
    }
  }

  const handleVotePoll = async (choice: ChatPoll['choices'][number]) => {
    if (!poll || !choice.voteParams || votingPoll || ended || poll.finished) return
    if (!signedIn) {
      showToast('Sign in to vote in live polls')
      return
    }
    setVotingPoll(true)
    try {
      const result = await votePoll({ videoId, pollId: poll.id, voteParams: choice.voteParams })
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setPoll((current) => {
        if (!current || current.id !== poll.id) return current
        return {
          ...current,
          choices: current.choices.map((item) => ({
            ...item,
            selected: item.id === choice.id,
          })),
        }
      })
    } finally {
      setVotingPoll(false)
    }
  }

  const activeMentionIdx = mentionSuggestions.length > 0 ? Math.min(mentionIndex, mentionSuggestions.length - 1) : -1
  const activeMentionOptionId = activeMentionIdx >= 0 ? `${mentionListId}-${activeMentionIdx}` : undefined
  const activePinned = pinnedMessage && dismissedPinId !== pinnedMessage.id ? pinnedMessage : undefined
  const activeTicker = tickerItems.find((item) => item.id === selectedTickerId)
  const leaderboardResult = leaderboardQueryData?.liveChatLeaderboard
  const currentView = LIVE_CHAT_VIEWS.find((option) => option.value === view)!

  return {
    ready,
    signedIn,
    self,
    view,
    currentView,
    error,
    page,
    messages,
    activePinned,
    pinExpanded,
    setPinExpanded,
    setDismissedPinId,
    customEmojis,
    inputState,
    leaderboardEntry,
    leaderboardOpen,
    setLeaderboardOpen,
    leaderboardResult,
    leaderboardLoading,
    leaderboardError,
    leaderboardPanelRef,
    reexecuteLeaderboard,
    openLeaderboard,
    poll,
    pollCollapsed,
    setPollCollapsed,
    votingPoll,
    handleVotePoll,
    tickerItems,
    selectedTickerId,
    setSelectedTickerId,
    activeTicker,
    refreshing,
    refreshSession,
    slowModeLeft,
    ended,
    sending,
    draft,
    setDraft,
    setCaret,
    setDismissedMentionAt,
    setMentionIndex,
    canCompose,
    mentionSuggestions,
    mentionListId,
    activeMentionIdx,
    activeMentionOptionId,
    chooseMention,
    onInputKeyDown,
    pickEmoji,
    onAuthorClick,
    submit,
    reactionsOpen,
    setReactionsOpen,
    reactions,
    triggerReaction,
    overlayEvent,
    overlayResetSeq,
    logRef,
    onScroll,
    pinned,
    setPinned,
    inputRef,
    switchView,
    hideChat,
  }
}
