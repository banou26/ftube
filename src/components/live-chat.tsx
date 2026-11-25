import type { TargetedEvent } from 'preact'

import type { ChatReplayView, LiveChatQuery } from '../generated/graphql'
import type { CustomEmoji } from './emoji-picker'
import type { MentionCandidate } from './live-chat-helpers'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, Heart, MessageSquare, Pin, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'

import { gql } from '../generated'
import { useSession } from '../session'
import { lineFor } from './data-failure'
import { EmojiButton, insertAtCursor } from './emoji-picker'
import {
  activeMentionQuery,
  applyMention,
  filterMentionCandidates,
  isSelfMention,
  mentionTagFor,
  splitMentionRuns,
} from './live-chat-helpers'
import { RichText } from './rich-text'
import { Menu, MenuItem } from './ui/menu'
import { showToast } from './ui/toast'

type ChatPage = LiveChatQuery['liveChat']
export type ChatRow = ChatPage['items'][number]
type ChatRun = ChatRow['runs'][number]
type ChatPinned = NonNullable<ChatPage['pinned']>
type ViewerIdentity = { name?: string | null, handle?: string | null }

const LIVE_CHAT_QUERY = gql(`
  query LiveChat($videoId: ID!, $view: ChatReplayView, $cursor: String) {
    liveChat(videoId: $videoId, view: $view, cursor: $cursor) {
      items {
        id
        text
        runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
        timestampText
        isOwner
        isModerator
        isMember
        purchaseAmountText
        headerBackgroundColor
        bodyBackgroundColor
        author { id name avatar handle }
      }
      cursor
      removedIds
      disabled
      pinned {
        id
        header
        message {
          id
          text
          runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
          timestampText
          isOwner
          isModerator
          isMember
          purchaseAmountText
          headerBackgroundColor
          bodyBackgroundColor
          author { id name avatar handle }
        }
      }
      pinnedCleared
      customEmojis { id shortcut url }
    }
  }
`)

const SEND_LIVE_CHAT = gql(`
  mutation SendLiveChatMessage($videoId: ID!, $text: String!) {
    sendLiveChatMessage(videoId: $videoId, text: $text)
  }
`)

// youtube.com's own maxItemsToDisplay
export const TRANSCRIPT_LIMIT = 250

/** Quick reaction emojis offered in the live chat reaction bar. */
export const LIVE_REACTIONS = ['❤️', '😂', '😮', '🎉', '💯'] as const

const PINNED_SLACK_PX = 40
const REACTION_LIFETIME_MS = 1_800
const MAX_ACTIVE_REACTIONS = 12

const VIEWS: { value: ChatReplayView, label: string }[] = [
  { value: 'TOP', label: 'Top chat' },
  { value: 'ALL', label: 'Live chat' },
]

export const chatStyles = css`
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--bg-subtle);
  overflow: hidden;
  /* youtube.com's chat panel, live or replay, at any window height (measured 2026-11-10) */
  height: 59.6rem;

  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.4rem 0.4rem 0.8rem;
    border-bottom: 1px solid var(--border);
    font-size: 1.4rem;
    font-weight: 500;
  }

  .head .view,
  .head .close {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    background: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    border-radius: 1.8rem;
  }

  .head .view {
    padding: 0.6rem 0.8rem;
    font-size: 1.5rem;
    font-weight: 500;
  }

  .head .close {
    padding: 0.8rem;
    margin-left: auto;
  }

  .head .view:hover,
  .head .close:hover {
    background: var(--bg-hover);
  }

  .head .ended-badge {
    margin-left: 0.4rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    font-weight: 400;
  }

  .pinned-banner {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.8rem 1.2rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
    font-size: 1.3rem;
  }

  .pinned-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    font-weight: 500;
  }

  .pinned-head-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: auto;
  }

  .pin-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .pin-icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pinned-body {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .pinned-body img.avatar,
  .pinned-body span.avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    flex: none;
  }

  .pinned-content {
    flex: 1;
    min-width: 0;
    line-height: 1.8rem;
  }

  .pinned-content.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .log-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .log {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.6rem 0;
    display: flex;
    flex-direction: column;
  }

  /* youtube.com's line: 32 px for a one-line message */
  .row {
    display: grid;
    grid-template-columns: 2.4rem 1fr;
    column-gap: 1.2rem;
    padding: 0.4rem 1.6rem;
    font-size: 1.35rem;
    line-height: 2rem;
  }

  .row img.avatar {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    grid-row: 1 / span 2;
  }

  .who {
    color: var(--text-secondary);
    font-weight: 500;
    margin-right: 0.6rem;
  }

  .who-btn {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .who-btn:hover {
    text-decoration: underline;
  }

  .who.owner { color: #ffd600; }
  .who.moderator { color: #5e84f1; }
  .who.member { color: #2ba640; }

  .mention {
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-weight: 500;
  }

  .mention.self {
    background: var(--accent-tint);
    color: var(--accent);
  }

  /* A paid message is a coloured card rather than a line, which is the whole
     point of paying for it. */
  .row.paid {
    display: block;
    margin: 0.4rem 1.2rem;
    padding: 0;
    border-radius: 0.8rem;
    overflow: hidden;
  }

  .row.paid .paid-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    font-weight: 700;
  }

  .row.paid .paid-head .who-btn {
    color: inherit;
    margin-right: 0;
  }

  .row.paid .paid-body {
    padding: 0.8rem 1rem;
  }

  .row.paid .paid-body:empty { display: none; }

  .emoji {
    display: inline-block;
    width: 1.8rem;
    height: 1.8rem;
    vertical-align: -0.35rem;
  }

  .reaction-stage {
    position: absolute;
    right: 1.2rem;
    bottom: 0.8rem;
    width: 6.4rem;
    height: 14rem;
    pointer-events: none;
    overflow: hidden;
  }

  .reaction-particle {
    position: absolute;
    bottom: 0.4rem;
    font-size: 2rem;
    line-height: 1;
    animation: reaction-float 1.7s ease-out forwards;
  }

  @keyframes reaction-float {
    0% {
      opacity: 0;
      transform: translateY(0) scale(0.8);
    }

    15% {
      opacity: 1;
      transform: translateY(-1.8rem) scale(1);
    }

    100% {
      opacity: 0;
      transform: translateY(-11rem) scale(1.05);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reaction-particle {
      animation: reaction-fade 1.2s ease-out forwards;
    }

    @keyframes reaction-fade {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }
  }

  .compose-shell {
    position: relative;
    border-top: 1px solid var(--border);
  }

  .mention-menu {
    position: absolute;
    left: 0.8rem;
    right: 0.8rem;
    bottom: calc(100% + 0.4rem);
    max-height: 22rem;
    overflow-y: auto;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
    z-index: 2;
  }

  .mention-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem 0.8rem;
    border: none;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    text-align: left;
    cursor: pointer;
  }

  .mention-option:hover,
  .mention-option[aria-selected='true'] {
    background: var(--bg-hover);
  }

  .mention-option img {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    flex: none;
  }

  .mention-option .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-option .handle {
    margin-left: auto;
    color: var(--text-secondary);
    font-size: 1.2rem;
    white-space: nowrap;
  }

  .reaction-tray {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .reaction-pick {
    width: 3.2rem;
    height: 3.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    font-size: 1.7rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .reaction-pick:hover {
    background: var(--bg-hover);
  }

  .compose {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
  }

  .compose input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: inherit;
    font: inherit;
    font-size: 1.3rem;
    padding: 0.4rem 0;
  }

  .compose input:focus {
    outline: none;
    border-bottom-color: var(--text-primary);
  }

  .compose .send-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    padding: 0.4rem 0.8rem;
    border-radius: 1.6rem;
  }

  .compose .send-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .compose .send-btn:disabled { opacity: 0.5; cursor: default; }

  .reaction-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0.4rem 0.8rem;
    border-top: 1px solid var(--border);
  }

  .reaction-toggle {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .reaction-toggle:hover,
  .reaction-toggle[aria-expanded='true'] {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .notice {
    padding: 1.6rem 1.2rem;
    color: var(--text-secondary);
    font-size: 1.3rem;
    text-align: center;
  }

  .resume {
    border: none;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.5rem 1rem;
    margin: 0 1.2rem 0.8rem;
    border-radius: 1.6rem;
    cursor: pointer;
  }
`

const liveChatMobileStyle = css`
  @media (max-width: 999px) {
    height: 48rem;
  }
`

const teaserStyle = css`
  margin-bottom: 0.4rem;

  button {
    width: 100%;
    height: 3.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 1.9rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  button:hover {
    background: var(--bg-hover);
  }
`

/** Collapsed control rendered in place of live chat when the viewer hides the chat panel. */
export const LiveChatTeaser = ({ onShow }: { onShow: () => void }) => (
  <div css={teaserStyle} className='live-chat-teaser'>
    <button type='button' onClick={onShow}>
      <MessageSquare size={18} strokeWidth={1.5} aria-hidden='true' />
      Show chat
    </button>
  </div>
)

const ChatLineBody = (
  { runs, self }: {
    runs: readonly ChatRun[]
    self?: ViewerIdentity
  },
) => (
  <RichText
    runs={runs}
    renderRun={(run: ChatRun, key: string) => {
      if (run.emojiUrl) {
        return <img key={key} className='emoji' src={run.emojiUrl} alt={run.emojiLabel ?? ''} loading='lazy' />
      }
      if (!run.url && !run.videoId && !run.browseId) {
        const parts = splitMentionRuns(run.text)
        if (parts.some(part => Boolean(part.mention))) {
          return (
            <span key={key}>
              {parts.map((part, index) =>
                part.mention
                  ? (
                    <span
                      key={index}
                      className={isSelfMention(part.mention, self) ? 'mention self' : 'mention'}
                    >
                      {part.text}
                    </span>
                  )
                  : part.text)}
            </span>
          )
        }
      }
      return undefined
    }}
  />
)

export const ChatLine = (
  { message, self, onAuthorClick }: {
    message: ChatRow
    self?: ViewerIdentity
    onAuthorClick?: (author: NonNullable<ChatRow['author']>) => void
  },
) => {
  const badge = message.isOwner
    ? 'owner'
    : message.isModerator
      ? 'moderator'
      : message.isMember
        ? 'member'
        : ''
  const body = <ChatLineBody runs={message.runs} self={self} />
  const authorNode = message.author
    ? onAuthorClick
      ? (
        <button
          type='button'
          className={`who who-btn ${badge}`}
          title={message.timestampText ?? undefined}
          aria-label={`Mention ${message.author.name}`}
          onClick={() => onAuthorClick(message.author!)}
        >
          {message.author.name}
        </button>
      )
      : <span className={`who ${badge}`} title={message.timestampText ?? undefined}>{message.author.name}</span>
    : undefined

  if (message.purchaseAmountText) {
    return (
      <div className='row paid'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          {message.author?.avatar ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' /> : undefined}
          {authorNode}
          <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span>
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }
  return (
    <div className='row'>
      {message.author?.avatar
        ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' />
        : <span className='avatar' />}
      <div>
        {authorNode}
        {body}
      </div>
    </div>
  )
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

/** Live stream chat panel with Top/Live filter switch, pinned banner, emoji picker, reactions, `@` mentions, and hide toggle. */
export const LiveChat = ({ videoId, onHide }: { videoId: string, onHide?: () => void }) => {
  const { ready, signedIn, name, handle } = useSession()
  const self = useMemo<ViewerIdentity | undefined>(
    () => (signedIn ? { name, handle } : undefined),
    [signedIn, name, handle],
  )
  const [view, setView] = useState<ChatReplayView>('TOP')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ChatRow[]>([])
  const [pinnedMessage, setPinnedMessage] = useState<ChatPinned | undefined>(undefined)
  const [dismissedPinId, setDismissedPinId] = useState<string | undefined>(undefined)
  const [pinExpanded, setPinExpanded] = useState(false)
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([])
  const [ended, setEnded] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [dismissedMentionAt, setDismissedMentionAt] = useState<number | undefined>(undefined)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [reactions, setReactions] = useState<{ id: number, emoji: string, leftPx: number }[]>([])
  const { logRef, onScroll, pinned, setPinned } = usePinnedLog(messages)
  const [, send] = useMutation(SEND_LIVE_CHAT)
  const inputRef = useRef<HTMLInputElement>(null)
  const mentionListId = useId()
  const reactionSeq = useRef(0)
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const caretFrame = useRef<number | undefined>(undefined)
  const pinnedIdRef = useRef<string | undefined>(undefined)

  /* the server parks each request until something arrives, so the cursor chain IS the poll: no interval belongs here */
  const [{ data, error }, reexecute] = useQuery({
    query: LIVE_CHAT_QUERY,
    variables: { videoId, view, cursor },
    requestPolicy: 'network-only',
    pause: ended,
  })

  const page = data?.liveChat

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
    if (caretFrame.current !== undefined) cancelAnimationFrame(caretFrame.current)
  }, [])

  const attemptRef = useRef(0)
  useEffect(() => {
    if (!error || ended) {
      if (!error) attemptRef.current = 0
      return
    }
    const delay = Math.min(8_000, 500 * 2 ** attemptRef.current)
    attemptRef.current += 1
    const timer = setTimeout(() => reexecute({ requestPolicy: 'network-only' }), delay)
    return () => clearTimeout(timer)
  }, [error, ended, reexecute])

  useEffect(() => {
    if (!page) return
    const removed = new Set(page.removedIds ?? [])
    if (page.items.length || removed.size) {
      setMessages((current) => {
        const next = removed.size
          ? current.filter((message) => !removed.has(message.id))
          : current
        // ids repeat when urql replays a cursor on remount
        const seen = new Set(next.map((message) => message.id))
        const added = page.items.filter((message) => !seen.has(message.id) && !removed.has(message.id))
        const grown = added.length ? [...next, ...added] : next
        return grown.length > TRANSCRIPT_LIMIT ? grown.slice(grown.length - TRANSCRIPT_LIMIT) : grown
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
    if (page.customEmojis?.length) {
      setCustomEmojis(page.customEmojis)
    }
    if (!page.cursor) setEnded(true)
    else if (page.cursor !== cursor) setCursor(page.cursor)
  }, [page])

  const switchView = (nextView: ChatReplayView) => {
    if (nextView === view) return
    pinnedIdRef.current = undefined
    setView(nextView)
    setCursor(undefined)
    setMessages([])
    setPinnedMessage(undefined)
    setDismissedPinId(undefined)
    setPinExpanded(false)
    setEnded(false)
    setPinned(true)
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

  const mentionMatch = ready && signedIn && !ended ? activeMentionQuery(draft, caret) : undefined
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

  const triggerReaction = (emoji: string) => {
    const id = ++reactionSeq.current
    const leftPx = (id * 13) % 36
    setReactions((current) => [...current.slice(-(MAX_ACTIVE_REACTIONS - 1)), { id, emoji, leftPx }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setReactions((current) => current.filter((item) => item.id !== id))
    }, REACTION_LIFETIME_MS)
    timers.current.add(timer)
  }

  const submit = async (event: TargetedEvent<HTMLFormElement, Event>) => {
    event.preventDefault()
    if (sending) return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setDraft('')
    setCaret(0)
    try {
      const result = await send({ videoId, text })
      if (result.error) {
        showToast(lineFor(result.error))
        setDraft(text)
        setCaret(text.length)
      }
    } finally {
      setSending(false)
    }
  }

  const activeMentionIdx = mentionSuggestions.length > 0 ? Math.min(mentionIndex, mentionSuggestions.length - 1) : -1
  const activeMentionOptionId = activeMentionIdx >= 0 ? `${mentionListId}-${activeMentionIdx}` : undefined
  const activePinned = pinnedMessage && dismissedPinId !== pinnedMessage.id ? pinnedMessage : undefined
  const currentView = VIEWS.find((option) => option.value === view)!
  const reactionButton = !ended
    ? (
      <button
        type='button'
        className='reaction-toggle'
        aria-label='Reactions'
        aria-expanded={reactionsOpen}
        onClick={() => setReactionsOpen((open) => !open)}
      >
        <Heart size={18} strokeWidth={1.5} />
      </button>
    )
    : undefined

  return (
    <section css={[chatStyles, liveChatMobileStyle]} className='live-chat' aria-label='Live chat'>
      <div className='head'>
        <Menu
          label='Live chat view'
          align='start'
          trigger={
            <button type='button' className='view'>
              {currentView.label}
              <ChevronDown size={20} strokeWidth={1.5} />
            </button>
          }
        >
          {VIEWS.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              checked={option.value === view}
              closeOnSelect
              onSelect={() => switchView(option.value)}
            />
          ))}
        </Menu>
        {ended ? <span className='ended-badge'>Ended</span> : undefined}
        {onHide
          ? (
            <button type='button' className='close' aria-label='Hide chat' onClick={onHide}>
              <X size={20} strokeWidth={1.5} />
            </button>
          )
          : undefined}
      </div>

      {page?.disabled
        ? <div className='notice'>Live chat is turned off for this stream.</div>
        : (
          <>
            {activePinned
              ? (
                <div className='pinned-banner' role='region' aria-label='Pinned message'>
                  <div className='pinned-head'>
                    <Pin size={14} strokeWidth={1.75} aria-hidden='true' />
                    <span>{activePinned.header ?? 'Pinned message'}</span>
                    <div className='pinned-head-actions'>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label={pinExpanded ? 'Collapse pinned message' : 'Expand pinned message'}
                        onClick={() => setPinExpanded((value) => !value)}
                      >
                        {pinExpanded ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
                      </button>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Dismiss pinned message'
                        onClick={() => setDismissedPinId(activePinned.id)}
                      >
                        <X size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <div className='pinned-body'>
                    {activePinned.message.author?.avatar
                      ? <img className='avatar' src={activePinned.message.author.avatar} alt='' loading='lazy' />
                      : <span className='avatar' />}
                    <div className={pinExpanded ? 'pinned-content' : 'pinned-content clamped'}>
                      {activePinned.message.author
                        ? <span className='who'>{activePinned.message.author.name}</span>
                        : undefined}
                      <ChatLineBody runs={activePinned.message.runs} self={self} />
                    </div>
                  </div>
                </div>
              )
              : undefined}

            <div className='log-wrap'>
              <div className='log' ref={logRef} onScroll={onScroll}>
                {messages.length === 0
                  ? (
                    <div className='notice'>
                      {error ? 'Reconnecting to live chat…' : 'Waiting for messages…'}
                    </div>
                  )
                  : messages.map((message) => (
                    <ChatLine
                      key={message.id}
                      message={message}
                      self={self}
                      onAuthorClick={ready && signedIn && !ended ? onAuthorClick : undefined}
                    />
                  ))}
              </div>
              {reactions.length > 0
                ? (
                  <div className='reaction-stage' aria-hidden='true'>
                    {reactions.map((item) => (
                      <span
                        key={item.id}
                        className='reaction-particle'
                        style={{ left: `${item.leftPx}px` }}
                      >
                        {item.emoji}
                      </span>
                    ))}
                  </div>
                )
                : undefined}
            </div>

            {!pinned && messages.length > 0
              ? <button type='button' className='resume' onClick={() => setPinned(true)}>Jump to latest</button>
              : undefined}

            {reactionsOpen && !ended
              ? (
                <div className='reaction-tray' role='group' aria-label='Local reactions'>
                  {LIVE_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type='button'
                      className='reaction-pick'
                      aria-label={`React ${emoji}`}
                      onClick={() => triggerReaction(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )
              : undefined}

            {ready && signedIn && !ended
              ? (
                <div className='compose-shell'>
                  {mentionSuggestions.length > 0
                    ? (
                      <div id={mentionListId} className='mention-menu' role='listbox' aria-label='Mention suggestions'>
                        {mentionSuggestions.map((candidate, index) => (
                          <button
                            key={candidate.id}
                            id={`${mentionListId}-${index}`}
                            type='button'
                            role='option'
                            aria-selected={index === activeMentionIdx}
                            className='mention-option'
                            onMouseDown={(event: MouseEvent) => {
                              event.preventDefault()
                              chooseMention(candidate)
                            }}
                          >
                            {candidate.avatar ? <img src={candidate.avatar} alt='' /> : undefined}
                            <span className='name'>{candidate.name}</span>
                            {candidate.handle ? <span className='handle'>{candidate.handle}</span> : undefined}
                          </button>
                        ))}
                      </div>
                    )
                    : undefined}
                  <form className='compose' onSubmit={submit}>
                    <EmojiButton customEmojis={customEmojis} disabled={sending} onPick={pickEmoji} />
                    <input
                      ref={inputRef}
                      value={draft}
                      maxLength={200}
                      placeholder='Chat…'
                      aria-autocomplete='list'
                      aria-expanded={mentionSuggestions.length > 0}
                      aria-controls={mentionSuggestions.length > 0 ? mentionListId : undefined}
                      aria-activedescendant={activeMentionOptionId}
                      onKeyDown={onInputKeyDown}
                      onInput={(event: TargetedEvent<HTMLInputElement, Event>) => {
                        const input = event.currentTarget
                        setDraft(input.value)
                        setCaret(input.selectionStart ?? input.value.length)
                        setDismissedMentionAt(undefined)
                        setMentionIndex(0)
                      }}
                      onClick={(event: TargetedEvent<HTMLInputElement, MouseEvent>) => {
                        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                      }}
                      onKeyUp={(event: TargetedEvent<HTMLInputElement, KeyboardEvent>) => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape') return
                        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                      }}
                    />
                    <button type='submit' className='send-btn' disabled={sending || !draft.trim()}>Send</button>
                    {reactionButton}
                  </form>
                </div>
              )
              : reactionButton
              ? <div className='reaction-bar'>{reactionButton}</div>
              : undefined}
          </>
        )}
    </section>
  )
}

export default LiveChat
