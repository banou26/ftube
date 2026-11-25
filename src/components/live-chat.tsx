import type { TargetedEvent } from 'preact'

import type { ChatReplayView, LiveChatQuery } from '../generated/graphql'
import type { CustomEmoji } from './emoji-picker'
import type { MentionCandidate } from './live-chat-helpers'

import { css } from '@emotion/react'
import {
  BadgeCheck,
  BarChart2,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Gift,
  Heart,
  Info,
  Lock,
  MessageSquare,
  Pin,
  RefreshCw,
  Trophy,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link } from 'wouter'

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
type ChatPoll = NonNullable<ChatPage['poll']>
type ChatTickerItem = NonNullable<ChatPage['tickerItems']>[number]
type ChatLeaderboardEntryPoint = NonNullable<ChatPage['leaderboard']>
type ChatInputState = NonNullable<ChatPage['inputState']>
type ViewerIdentity = { name?: string | null, handle?: string | null, avatar?: string | null }

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
      customEmojis { id shortcut url }
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

  .head .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }

  .head .top-fans-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 1.4rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .head .top-fans-btn:hover,
  .head .top-fans-btn[aria-expanded='true'] {
    background: var(--bg-hover);
  }

  .head .close {
    padding: 0.8rem;
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

  .badges {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-right: 0.5rem;
    vertical-align: middle;
  }

  .badge-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.55rem;
    border: none;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.5;
    vertical-align: middle;
  }

  button.badge-chip {
    cursor: pointer;
  }

  button.badge-chip:hover {
    filter: brightness(1.08);
  }

  .badge-icon {
    width: 1.5rem;
    height: 1.5rem;
    object-fit: contain;
    vertical-align: -0.25rem;
  }

  .role-icon {
    flex: none;
    vertical-align: -0.15rem;
  }

  .role-icon.owner { color: #ffd600; }
  .role-icon.moderator { color: #5e84f1; }
  .role-icon.verified { color: var(--text-secondary); }

  .row.system {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    margin: 0.3rem 1.2rem;
    padding: 0.6rem 1rem;
    border-radius: 0.8rem;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 1.25rem;
    line-height: 1.8rem;
  }

  .row.system svg {
    flex: none;
    margin-top: 0.2rem;
  }

  .row.gift {
    margin: 0.3rem 1.2rem;
    padding: 0.6rem 1rem;
    border-radius: 0.8rem;
    background: var(--bg-elevated);
  }

  .row.gift .gift-body {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .row.gift .gift-icon {
    color: var(--text-secondary);
    vertical-align: -0.2rem;
  }

  .row.paid .paid-head-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.1rem;
  }

  .row.paid .paid-sub {
    font-size: 1.2rem;
    font-weight: 400;
    opacity: 0.9;
  }

  .row.paid.sticker .sticker-body {
    display: flex;
    justify-content: center;
    padding: 0.8rem 1rem 1rem;
  }

  .sticker-img {
    width: 6.4rem;
    height: 6.4rem;
    object-fit: contain;
  }

  .ticker-strip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1.2rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }

  .ticker-strip::-webkit-scrollbar {
    display: none;
  }

  .ticker-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.9rem 0.3rem 0.4rem;
    border: none;
    border-radius: 999px;
    font: inherit;
    font-size: 1.2rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.12s ease, opacity 0.12s ease;
  }

  .ticker-pill:hover {
    opacity: 0.92;
  }

  .ticker-pill img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .ticker-detail {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    padding: 0.7rem 1.2rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
    font-size: 1.25rem;
  }

  .ticker-detail-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .ticker-detail-text strong {
    font-weight: 600;
  }

  .ticker-detail-text span {
    color: var(--text-secondary);
  }

  .poll-card {
    margin: 0.6rem 1rem 0;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .poll-head {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1.8rem;
  }

  .poll-head > svg {
    flex: none;
    margin-top: 0.2rem;
    color: var(--text-secondary);
  }

  .poll-title {
    flex: 1;
    min-width: 0;
  }

  .poll-meta {
    color: var(--text-secondary);
    font-size: 1.15rem;
  }

  .poll-choices {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .poll-choice {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    width: 100%;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.25rem;
    text-align: left;
    cursor: pointer;
  }

  .poll-choice:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .poll-choice[data-selected='true'] {
    border-color: var(--text-primary);
    font-weight: 600;
  }

  .poll-choice:disabled {
    cursor: default;
  }

  .poll-choice-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--bg-hover-strong);
    opacity: 0.65;
    pointer-events: none;
    transition: width 0.2s ease;
  }

  .poll-choice-label,
  .poll-choice-pct {
    position: relative;
    z-index: 1;
  }

  .poll-choice-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .poll-choice-pct {
    flex: none;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .leaderboard-panel {
    position: absolute;
    inset: 4.5rem 0 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    background: var(--bg-subtle);
  }

  .leaderboard-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 1.2rem;
    border-bottom: 1px solid var(--border);
    font-size: 1.4rem;
    font-weight: 600;
  }

  .leaderboard-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: auto;
  }

  .leaderboard-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.6rem 0;
  }

  .leaderboard-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 1.4rem;
    font-size: 1.3rem;
  }

  .leaderboard-rank {
    min-width: 2.4rem;
    color: var(--text-secondary);
    font-weight: 600;
  }

  .leaderboard-avatar {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 50%;
    object-fit: cover;
    flex: none;
  }

  .leaderboard-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    overflow: hidden;
  }

  .leaderboard-name > span:first-of-type {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .leaderboard-points {
    flex: none;
    color: var(--text-secondary);
    font-size: 1.2rem;
  }

  .slow-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 1.2rem 0;
    color: var(--text-secondary);
    font-size: 1.15rem;
  }

  .restricted-bar {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 1.25rem;
  }

  .restricted-bar > svg {
    flex: none;
  }

  .restricted-text {
    flex: 1;
    min-width: 0;
    line-height: 1.7rem;
  }

  .refresh-chat-btn,
  .signin-link {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 1.6rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  .refresh-chat-btn:hover:not(:disabled),
  .signin-link:hover {
    background: var(--bg-hover);
  }

  .refresh-chat-btn:disabled {
    opacity: 0.6;
    cursor: default;
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
        return <img key={key} className='emoji' src={run.emojiUrl} alt={run.emojiLabel ?? ''} loading='lazy' referrerpolicy='no-referrer' />
      }
      if (!run.url && !run.videoId && !run.browseId) {
        const parts = splitMentionRuns(run.text)
        if (parts.some((part) => Boolean(part.mention))) {
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

const ChatBadges = (
  { badges, onTopFanClick }: {
    badges?: ChatRow['badges']
    onTopFanClick?: () => void
  },
) => {
  if (!badges?.length) return null
  return (
    <span className='badges'>
      {badges.map((badge, index) => {
        if (badge.kind === 'top-fan') {
          const style = {
            ...(badge.backgroundColor ? { background: badge.backgroundColor } : {}),
            ...(badge.textColor ? { color: badge.textColor } : {}),
          }
          if (onTopFanClick) {
            return (
              <button
                key={`top-fan-${index}`}
                type='button'
                className='badge-chip top-fan'
                style={style}
                title={`Top fan ${badge.label}`}
                aria-label={`Top fan ${badge.label}`}
                onClick={onTopFanClick}
              >
                <Crown size={11} strokeWidth={2} aria-hidden='true' />
                <span>{badge.label}</span>
              </button>
            )
          }
          return (
            <span key={`top-fan-${index}`} className='badge-chip top-fan' style={style}>
              <Crown size={11} strokeWidth={2} aria-hidden='true' />
              <span>{badge.label}</span>
            </span>
          )
        }
        if (badge.iconUrl) {
          return (
            <img
              key={`icon-${index}`}
              className='badge-icon'
              src={badge.iconUrl}
              alt={badge.label}
              title={badge.label}
              loading='lazy'
              referrerpolicy='no-referrer'
            />
          )
        }
        if (badge.kind === 'owner') {
          return <Crown key={`owner-${index}`} size={12} strokeWidth={2} className='role-icon owner' aria-label={badge.label} />
        }
        if (badge.kind === 'moderator') {
          return <Wrench key={`mod-${index}`} size={12} strokeWidth={2} className='role-icon moderator' aria-label={badge.label} />
        }
        if (badge.kind === 'verified') {
          return <BadgeCheck key={`verified-${index}`} size={12} strokeWidth={2} className='role-icon verified' aria-label={badge.label} />
        }
        return undefined
      })}
    </span>
  )
}

export const ChatLine = (
  { message, self, onAuthorClick, onTopFanClick }: {
    message: ChatLineMessage
    self?: ViewerIdentity
    onAuthorClick?: (author: NonNullable<ChatRow['author']>) => void
    onTopFanClick?: () => void
  },
) => {
  const roleClass = message.isOwner
    ? 'owner'
    : message.isModerator
      ? 'moderator'
      : message.isMember
        ? 'member'
        : ''
  const body = <ChatLineBody runs={message.runs} self={self} />
  const badges = <ChatBadges badges={message.badges} onTopFanClick={onTopFanClick} />
  const authorNode = message.author
    ? onAuthorClick
      ? (
        <button
          type='button'
          className={`who who-btn ${roleClass}`}
          title={message.timestampText ?? undefined}
          aria-label={`Mention ${message.author.name}`}
          onClick={() => onAuthorClick(message.author!)}
        >
          {message.author.name}
        </button>
      )
      : <span className={`who ${roleClass}`} title={message.timestampText ?? undefined}>{message.author.name}</span>
    : undefined

  if (message.kind === 'SYSTEM') {
    const restrictedIcon = Boolean(message.iconType && /LOCK|SLOW|SUBSCRIBER|MEMBER/i.test(message.iconType))
    return (
      <div className='row system' data-chat-kind='system'>
        {restrictedIcon ? <Lock size={14} strokeWidth={1.75} aria-hidden='true' /> : <Info size={14} strokeWidth={1.75} aria-hidden='true' />}
        <div>{body}</div>
      </div>
    )
  }

  if (message.kind === 'STICKER' || message.stickerUrl) {
    return (
      <div className='row paid sticker' data-chat-kind='sticker'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          {message.author?.avatar ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' /> : undefined}
          {badges}
          {authorNode}
          {message.purchaseAmountText ? <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span> : undefined}
        </div>
        <div className='paid-body sticker-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {message.stickerUrl
            ? <img className='sticker-img' src={message.stickerUrl} alt={message.stickerLabel ?? message.text} loading='lazy' referrerpolicy='no-referrer' />
            : body}
        </div>
      </div>
    )
  }

  if (message.kind === 'MEMBERSHIP' || message.kind === 'GIFT_MEMBERSHIP') {
    const subtitle = message.headerPrimaryText || message.headerSubtext
    const showSub = Boolean(subtitle && subtitle !== message.text)
    return (
      <div className='row paid membership' data-chat-kind={message.kind === 'GIFT_MEMBERSHIP' ? 'gift-membership' : 'membership'}>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#0f7b3e', color: '#fff' }}
        >
          {message.author?.avatar ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' /> : undefined}
          <div className='paid-head-meta'>
            <div>
              {badges}
              {authorNode}
            </div>
            {showSub ? <span className='paid-sub'>{subtitle}</span> : undefined}
          </div>
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#139b4f', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }

  if (message.purchaseAmountText || message.kind === 'PAID') {
    return (
      <div className='row paid' data-chat-kind='paid'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          {message.author?.avatar ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' /> : undefined}
          {badges}
          {authorNode}
          {message.purchaseAmountText ? <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span> : undefined}
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }

  if (message.kind === 'GIFT') {
    return (
      <div className='row gift' data-chat-kind='gift'>
        {message.author?.avatar
          ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
          : <span className='avatar' />}
        <div className='gift-body'>
          <Gift size={14} strokeWidth={1.75} className='gift-icon' aria-hidden='true' />
          {badges}
          {authorNode}
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className='row'>
      {message.author?.avatar
        ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
        : <span className='avatar' />}
      <div>
        {badges}
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

const normIdent = (value?: string | null) => value?.trim().replace(/^@/, '').toLowerCase() || undefined
const normEchoText = (value: string) => value.replace(/\s+/g, ' ').trim()

const sameAuthor = (author: ChatRow['author'] | undefined, self: ViewerIdentity | undefined) => {
  if (!author || !self) return false
  const selfKeys = [normIdent(self.handle), normIdent(self.name)].filter((v): v is string => Boolean(v))
  const authorKeys = [normIdent(author.handle), normIdent(author.name)].filter((v): v is string => Boolean(v))
  return selfKeys.some((key) => authorKeys.includes(key))
}

const LiveChatPollCard = (
  { poll, self, collapsed, onToggleCollapse, disabled, voting, onVote }: {
    poll: ChatPoll
    self?: ViewerIdentity
    collapsed: boolean
    onToggleCollapse: () => void
    disabled: boolean
    voting: boolean
    onVote: (choice: ChatPoll['choices'][number]) => void
  },
) => (
  <div className='poll-card' role='region' aria-label='Live poll'>
    <div className='poll-head'>
      <BarChart2 size={15} strokeWidth={1.75} aria-hidden='true' />
      <div className='poll-title'>
        {poll.questionRuns.length > 0 ? <ChatLineBody runs={poll.questionRuns} self={self} /> : poll.question}
      </div>
      <button
        type='button'
        className='pin-icon-btn'
        aria-label={collapsed ? 'Expand poll' : 'Collapse poll'}
        onClick={onToggleCollapse}
      >
        {collapsed ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronUp size={14} strokeWidth={1.75} />}
      </button>
    </div>
    {!collapsed
      ? (
        <>
          {poll.metadataText ? <div className='poll-meta'>{poll.metadataText}</div> : undefined}
          <div className='poll-choices'>
            {poll.choices.map((choice) => {
              const pct = Math.max(0, Math.min(100, Math.round((choice.voteRatio ?? 0) * 100)))
              const canVote = !disabled && !voting && !poll.finished && Boolean(choice.voteParams)
              return (
                <button
                  key={choice.id}
                  type='button'
                  className='poll-choice'
                  data-selected={choice.selected ? 'true' : undefined}
                  disabled={!canVote}
                  onClick={() => onVote(choice)}
                >
                  {choice.voteRatio !== null && choice.voteRatio !== undefined
                    ? <span className='poll-choice-bar' style={{ width: `${pct}%` }} aria-hidden='true' />
                    : undefined}
                  <span className='poll-choice-label'>
                    {choice.selected ? <Check size={13} strokeWidth={2.2} aria-hidden='true' /> : undefined}
                    {choice.runs.length > 0 ? <ChatLineBody runs={choice.runs} self={self} /> : choice.text}
                  </span>
                  {choice.votePercentage ? <span className='poll-choice-pct'>{choice.votePercentage}</span> : undefined}
                </button>
              )
            })}
          </div>
        </>
      )
      : undefined}
  </div>
)

/** Live stream chat panel with Top/Live filter switch, pinned banner, polls, Top fans leaderboard, restrictions, emoji picker, reactions, `@` mentions, and hide toggle. */
export const LiveChat = ({ videoId, subscribed, onHide }: { videoId: string, subscribed?: boolean, onHide?: () => void }) => {
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
  const { logRef, onScroll, pinned, setPinned } = usePinnedLog(messages)
  const [, send] = useMutation(SEND_LIVE_CHAT)
  const [, votePoll] = useMutation(VOTE_LIVE_CHAT_POLL)
  const inputRef = useRef<HTMLInputElement>(null)
  const mentionListId = useId()
  const reactionSeq = useRef(0)
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
      event.stopPropagation()
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
    const removed = new Set(page.removedIds ?? [])
    const removedAuthors = new Set(page.removedAuthorIds ?? [])
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
        pendingEchoes.current.push({ id: localId, text, at: Date.now() })
        setMessages((current) => {
          const targetText = normEchoText(text)
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
          const grown = [...current, optimisticRow]
          return grown.length > TRANSCRIPT_LIMIT ? grown.slice(grown.length - TRANSCRIPT_LIMIT) : grown
        })
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
        <div className='head-actions'>
          {leaderboardEntry && !page?.disabled
            ? (
              <button
                type='button'
                className='top-fans-btn'
                aria-expanded={leaderboardOpen}
                onClick={() => (leaderboardOpen ? setLeaderboardOpen(false) : openLeaderboard())}
              >
                <Trophy size={13} strokeWidth={1.9} aria-hidden='true' />
                <span>{leaderboardEntry.label}</span>
              </button>
            )
            : undefined}
          {onHide
            ? (
              <button type='button' className='close' aria-label='Hide chat' onClick={onHide}>
                <X size={20} strokeWidth={1.5} />
              </button>
            )
            : undefined}
        </div>
      </div>

      {page?.disabled
        ? <div className='notice'>Live chat is turned off for this stream.</div>
        : (
          <>
            {tickerItems.length > 0
              ? (
                <div className='ticker-strip' role='region' aria-label='Chat highlights'>
                  {tickerItems.map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      className='ticker-pill'
                      style={{
                        background: item.backgroundColor ?? '#1565c0',
                        color: item.textColor ?? '#fff',
                      }}
                      aria-expanded={selectedTickerId === item.id}
                      onClick={() => setSelectedTickerId((cur) => (cur === item.id ? undefined : item.id))}
                    >
                      {item.avatar ? <img src={item.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' /> : undefined}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )
              : undefined}

            {activeTicker
              ? (
                <div className='ticker-detail' role='region' aria-label='Highlight detail'>
                  <div className='ticker-detail-text'>
                    <strong>{[activeTicker.authorName, activeTicker.label].filter(Boolean).join(' ')}</strong>
                    {activeTicker.detailText ? <span>{activeTicker.detailText}</span> : undefined}
                  </div>
                  <button
                    type='button'
                    className='pin-icon-btn ticker-detail-close'
                    aria-label='Close highlight'
                    onClick={() => setSelectedTickerId(undefined)}
                  >
                    <X size={14} strokeWidth={1.75} />
                  </button>
                </div>
              )
              : undefined}

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
                      ? <img className='avatar' src={activePinned.message.author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
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

            {poll
              ? (
                <LiveChatPollCard
                  poll={poll}
                  self={self}
                  collapsed={pollCollapsed}
                  onToggleCollapse={() => setPollCollapsed((value) => !value)}
                  disabled={ended}
                  voting={votingPoll}
                  onVote={handleVotePoll}
                />
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
                      onAuthorClick={canCompose ? onAuthorClick : undefined}
                      onTopFanClick={leaderboardEntry ? openLeaderboard : undefined}
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

            {!ended && ready
              ? canCompose
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
                              {candidate.avatar ? <img src={candidate.avatar} alt='' referrerpolicy='no-referrer' /> : undefined}
                              <span className='name'>{candidate.name}</span>
                              {candidate.handle ? <span className='handle'>{candidate.handle}</span> : undefined}
                            </button>
                          ))}
                        </div>
                      )
                      : undefined}
                    {(inputState?.slowModeSeconds ?? 0) > 0 || slowModeLeft > 0
                      ? (
                        <div className='slow-mode-bar'>
                          <span>{(inputState?.slowModeSeconds ?? 0) > 0 ? `Slow mode (${inputState!.slowModeSeconds}s)` : 'Slow mode'}</span>
                          {slowModeLeft > 0 ? <span>Wait {slowModeLeft}s</span> : undefined}
                        </div>
                      )
                      : undefined}
                    <form className='compose' onSubmit={submit}>
                      <EmojiButton customEmojis={customEmojis} disabled={sending} onPick={pickEmoji} />
                      <input
                        ref={inputRef}
                        value={draft}
                        maxLength={inputState?.maxLength ?? 200}
                        placeholder={slowModeLeft > 0 ? `Slow mode: wait ${slowModeLeft}s…` : inputState?.placeholder || 'Chat…'}
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
                      <button type='submit' className='send-btn' disabled={sending || slowModeLeft > 0 || !draft.trim()}>
                        {slowModeLeft > 0 ? `${slowModeLeft}s` : 'Send'}
                      </button>
                      {reactionButton}
                    </form>
                  </div>
                )
                : !signedIn || inputState?.status === 'SIGN_IN_REQUIRED'
                  ? (
                    <div className='restricted-bar'>
                      <Lock size={14} strokeWidth={1.75} aria-hidden='true' />
                      <span className='restricted-text'>{inputState?.restrictionMessage || 'Sign in to chat'}</span>
                      <Link href='/signin' className='signin-link'>Sign in</Link>
                      {reactionButton}
                    </div>
                  )
                  : (
                    <div className='restricted-bar' role='status'>
                      <Lock size={14} strokeWidth={1.75} aria-hidden='true' />
                      <span className='restricted-text'>{inputState?.restrictionMessage || 'Chat participation is restricted.'}</span>
                      <button
                        type='button'
                        className='refresh-chat-btn'
                        onClick={refreshSession}
                        disabled={refreshing}
                      >
                        <RefreshCw size={13} strokeWidth={1.75} aria-hidden='true' />
                        {refreshing ? 'Checking…' : 'Refresh'}
                      </button>
                      {reactionButton}
                    </div>
                  )
              : reactionButton
                ? <div className='reaction-bar'>{reactionButton}</div>
                : undefined}

            {leaderboardOpen && leaderboardEntry
              ? (
                <div
                  ref={leaderboardPanelRef}
                  tabIndex={-1}
                  className='leaderboard-panel'
                  role='dialog'
                  aria-label={leaderboardResult?.title ?? leaderboardEntry.label}
                >
                  <div className='leaderboard-head'>
                    <Trophy size={15} strokeWidth={1.9} aria-hidden='true' />
                    <span>{leaderboardResult?.title ?? leaderboardEntry.label}</span>
                    <div className='leaderboard-actions'>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Refresh leaderboard'
                        onClick={() => reexecuteLeaderboard({ requestPolicy: 'network-only' })}
                      >
                        <RefreshCw size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Close leaderboard'
                        onClick={() => setLeaderboardOpen(false)}
                      >
                        <X size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <div className='leaderboard-list'>
                    {leaderboardLoading && !leaderboardResult
                      ? <div className='notice'>Loading top fans…</div>
                      : leaderboardResult?.items.length
                        ? leaderboardResult.items.map((item) => (
                          <div key={`${item.rank}-${item.displayName}`} className='leaderboard-row'>
                            <span className='leaderboard-rank'>{item.rank}</span>
                            {item.avatar
                              ? <img className='leaderboard-avatar' src={item.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
                              : <span className='leaderboard-avatar' />}
                            <div className='leaderboard-name'>
                              <span>{item.displayName}</span>
                              {item.badgeLabel
                                ? (
                                  <span
                                    className='badge-chip'
                                    style={{
                                      ...(item.badgeBackgroundColor ? { background: item.badgeBackgroundColor } : {}),
                                      ...(item.badgeTextColor ? { color: item.badgeTextColor } : {}),
                                    }}
                                  >
                                    <Crown size={11} strokeWidth={2} aria-hidden='true' />
                                    <span>{item.badgeLabel}</span>
                                  </span>
                                )
                                : undefined}
                            </div>
                            {item.points ? <span className='leaderboard-points'>{item.points}</span> : undefined}
                          </div>
                        ))
                        : leaderboardError
                          ? <div className='notice'>{lineFor(leaderboardError)}</div>
                          : <div className='notice'>No top fans ranked yet.</div>}
                  </div>
                </div>
              )
              : undefined}
          </>
        )}
    </section>
  )
}

export default LiveChat
