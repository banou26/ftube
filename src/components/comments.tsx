import type { TargetedEvent } from 'preact'

import type { CommentCoreFragment, CommentRepliesQuery, CommentSort, CommentsQuery } from '../generated/graphql'

import type { RydComment, RydCommentSort } from '../ryd-comments'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, Heart, ListFilter, Pin, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { fetchRydComments, fetchRydReplies } from '../ryd-comments'
import { useSession } from '../session'
import { getSettings, subscribeSettings } from '../settings'
import type { CommentProfileAuthor } from './comment-profile-card'
import { CommentProfileCard } from './comment-profile-card'
import { DataFailure, lineFor } from './data-failure'
import { type CustomEmoji, EmojiButton, insertAtCursor } from './emoji-picker'
import { formatAgo, formatCompact } from './format'
import { showToast } from './ui/toast'
import { ReadMore } from './read-more'
import { RichText } from './rich-text'
import { Menu, MenuItem } from './ui/menu'
import { useInfiniteFeed } from './use-infinite-feed'
import { VerifiedBadge } from './verified-badge'
import { signIn } from '../sign-in'

type CommentPage = CommentsQuery['comments']
type RepliesPage = CommentRepliesQuery['commentReplies']
type CommentNode = CommentCoreFragment & { replies?: readonly CommentNode[] | null }

gql(`
  fragment CommentCore on Comment {
    id
    text
    runs { text url videoId startSeconds browseId }
    publishedText
    likeCountText
    replyCount
    repliesCursor
    actionsToken
    isPinned
    pinnedText
    isHearted
    heartAvatar
    heartTooltip
    isCreator
    isMember
    isLiked
    isDisliked
    author { id name avatar isVerified isVerifiedArtist }
  }
`)

gql(`
  fragment CommentPageFields on CommentPage {
    items {
      ...CommentCore
      replies {
        ...CommentCore
        replies {
          ...CommentCore
          replies {
            ...CommentCore
          }
        }
      }
    }
    cursor
    disabled
    countText
    customEmojis { id shortcut url group locked lockReason }
  }
`)

const COMMENTS_QUERY = gql(`
  query Comments($videoId: ID!, $sort: CommentSort, $cursor: String) {
    comments(videoId: $videoId, sort: $sort, cursor: $cursor) { ...CommentPageFields }
  }
`)

const POST_COMMENTS_QUERY = gql(`
  query PostComments($postId: ID!, $channelId: ID!, $sort: CommentSort, $cursor: String) {
    postComments(postId: $postId, channelId: $channelId, sort: $sort, cursor: $cursor) { ...CommentPageFields }
  }
`)

const RATE_COMMENT = gql(`
  mutation RateComment($actionsToken: String!, $status: LikeStatus!) {
    rateComment(actionsToken: $actionsToken, status: $status) {
      id
      isLiked
      isDisliked
    }
  }
`)

const POST_COMMENT = gql(`
  mutation PostComment($videoId: ID!, $text: String!) {
    postComment(videoId: $videoId, text: $text)
  }
`)

const COMMENT_ON_POST = gql(`
  mutation CommentOnPost($postId: ID!, $channelId: ID!, $text: String!) {
    commentOnPost(postId: $postId, channelId: $channelId, text: $text)
  }
`)

const REPLY_TO_COMMENT = gql(`
  mutation ReplyToComment($actionsToken: String!, $text: String!) {
    replyToComment(actionsToken: $actionsToken, text: $text)
  }
`)

const SORTS: { value: CommentSort, label: string }[] = [
  { value: 'TOP', label: 'Top comments' },
  { value: 'NEWEST', label: 'Newest first' },
]

const style = css`
  margin-top: 2.4rem;

  .heading-row {
    display: flex;
    align-items: center;
    gap: 3.2rem;
    margin-bottom: 2.4rem;
  }

  .heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2.4rem;
  }

  .comment {
    position: relative;
    display: flex;
    align-items: flex-start;
  }

  .comment.has-replies:not(:has(> .body > .replies-block > .reply-list))::before {
    content: '';
    position: absolute;
    top: 4.4rem;
    left: 2rem;
    bottom: 2rem;
    width: 2rem;
    border-left: 1.5px solid var(--border);
    border-bottom: 1.5px solid var(--border);
    border-bottom-left-radius: 1.2rem;
    pointer-events: none;
  }

  .avatar {
    flex: none;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-chip);
  }

  .avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    font-size: 1.6rem;
    font-weight: 500;
  }

  .avatar-btn {
    padding: 0;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .avatar-btn:focus-visible {
    outline: 2px solid var(--accent-focus, var(--accent));
    outline-offset: 2px;
  }

  .comment > .body {
    flex: 1;
    min-width: 0;
    margin-left: 1.6rem;
  }

  .pinned {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.4rem;
    font-size: 1.2rem;
    line-height: 1.6rem;
    color: var(--text-secondary);
  }

  .pinned svg {
    flex: none;
  }

  .byline {
    display: flex;
    align-items: baseline;
    flex-wrap: nowrap;
    gap: 0.6rem;
    min-width: 0;
    overflow: hidden;
  }

  .author {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    max-width: 100%;
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author svg,
  .reply-row .name svg {
    flex: none;
  }

  .age {
    flex: none;
    white-space: nowrap;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .comment-text {
    margin-top: 0.2rem;
  }

  .text {
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .read-more {
    margin-top: 0.4rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.4rem;
  }

  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action:hover {
    background: var(--bg-hover);
  }

  .like-count {
    margin-left: -0.4rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .reply {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .reply:hover {
    background: var(--bg-hover);
  }

  .show-more {
    margin-top: 2.4rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .show-more:hover {
    background: var(--bg-chip-hover);
  }

  .show-more:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .composer {
    display: flex;
    align-items: flex-start;
    gap: 1.6rem;
    margin-top: 1.2rem;
  }

  .composer.top {
    margin: 0 0 2.4rem;
  }

  .composer-avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    font-size: 1.1rem;
    transition:
      width 0.2s cubic-bezier(0.2, 0, 0, 1),
      height 0.2s cubic-bezier(0.2, 0, 0, 1),
      font-size 0.2s cubic-bezier(0.2, 0, 0, 1);
  }

  .composer.top .composer-avatar {
    width: 3.6rem;
    height: 3.6rem;
    font-size: 1.4rem;
  }

  .composer.top.active .composer-avatar {
    width: 4rem;
    height: 4rem;
    font-size: 1.6rem;
  }

  .composer-main {
    flex: 1;
    min-width: 0;
  }

  .composer-field {
    position: relative;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
  }

  .composer-field::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--text-primary);
    transform: scaleX(0);
    transform-origin: center;
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
    pointer-events: none;
  }

  .composer-field:focus-within::after {
    transform: scaleX(1);
  }

  .composer-input {
    display: block;
    width: 100%;
    min-height: 2.8rem;
    padding: 0.2rem 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    line-height: 2rem;
    resize: none;
    overflow-y: hidden;
  }

  .composer-input:focus {
    outline: none;
  }

  .composer-input::placeholder {
    color: var(--text-secondary);
  }

  .composer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin-top: 0.8rem;
  }

  .composer-buttons {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .creator-heart {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
  }

  .heart-avatar {
    display: block;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .heart-mark {
    position: absolute;
    right: 0;
    bottom: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--bg-primary);
  }

  .reply-row > .body {
    flex: 1;
    min-width: 0;
    margin-left: 0;
  }

  .reply-row .actions {
    margin-top: 0.2rem;
  }

  .composer-cancel,
  .composer-send {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .composer-cancel {
    background: transparent;
    color: var(--text-primary);
  }

  .composer-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .composer-send {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .composer-send:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .composer-send:disabled,
  .composer-cancel:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .composer-prompt {
    display: block;
    margin: 0 0 2.4rem;
    padding: 0.8rem 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .replies-block {
    margin-top: 0.4rem;
  }

  /* A disclosure rather than a label: it was inert text before, which read as a
     count that ought to be clickable and was not. The negative margin lines its
     text up with the comment's, as youtube.com does. */
  .replies {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 4rem;
    margin-left: -1.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 2rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .replies:hover {
    background: var(--bg-hover);
  }

  .reply-list {
    display: flex;
    flex-direction: column;
    margin-top: 0.8rem;
    /* Indented to the depth of the parent's avatar column, so a reply reads as
       hanging off the comment above it rather than as a sibling. */
    padding-left: 2.4rem;
  }

  .reply-rows {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .reply-rows + :not(.reply-rows) {
    margin-top: 1.6rem;
  }

  .thread-line {
    position: absolute;
    top: -0.4rem;
    bottom: 0;
    left: -2.4rem;
    width: 2.2rem;
    padding: 0;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    cursor: pointer;
  }

  .thread-line:focus-visible {
    outline: 2px solid var(--accent-focus, var(--accent));
    outline-offset: -2px;
  }

  .reply-row {
    position: relative;
    display: flex;
    gap: 1.2rem;
  }

  .reply-row:has(+ .reply-row) {
    padding-bottom: 1.6rem;
  }

  .reply-row::before {
    content: '';
    position: absolute;
    left: -1.6rem;
    top: 0;
    width: 1.2rem;
    height: 1.2rem;
    border-left: 1.5px solid var(--border);
    border-bottom: 1.5px solid var(--border);
    border-bottom-left-radius: 0.8rem;
    pointer-events: none;
    transition: border-color 0.15s ease;
  }

  .reply-row:first-of-type::before {
    top: -0.4rem;
    height: 1.6rem;
  }

  .reply-row:has(+ .reply-row)::after {
    content: '';
    position: absolute;
    left: -1.6rem;
    top: 0.4rem;
    bottom: 0;
    border-left: 1.5px solid var(--border);
    pointer-events: none;
    transition: border-color 0.15s ease;
  }

  .reply-rows:has(> .thread-line:hover) > .reply-row::before,
  .reply-rows:has(> .thread-line:hover) > .reply-row:has(+ .reply-row)::after,
  .reply-rows:has(> .thread-line:focus-visible) > .reply-row::before,
  .reply-rows:has(> .thread-line:focus-visible) > .reply-row:has(+ .reply-row)::after {
    border-color: var(--text-primary);
  }

  .reply-row .avatar {
    width: 2.4rem;
    height: 2.4rem;
    font-size: 1.1rem;
  }

  .reply-row .name {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    max-width: 100%;
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
  }

  .author.creator,
  .name.creator {
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    text-decoration: none;
  }

  .disabled-notice,
  .empty-notice {
    margin: 2.4rem 0 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  &.compact {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    margin-top: 0;
  }

  &.compact .compact-header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 1.2rem 1.2rem 1.2rem 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  &.compact .compact-title {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 2.4rem;
    color: var(--text-primary);
  }

  &.compact .comments-count {
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  &.compact .compact-header-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  &.compact .compact-icon-button {
    display: grid;
    place-items: center;
    width: 3.6rem;
    height: 3.6rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  &.compact .compact-icon-button:hover {
    background: var(--bg-hover);
  }

  &.compact .compact-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.2rem 1.6rem 1.6rem;
  }

  &.compact .compact-footer {
    flex: none;
    border-top: 1px solid var(--border-subtle);
    padding: 1rem 1.6rem;
    background: inherit;
  }

  &.compact .compact-footer .composer.top {
    margin: 0;
  }

  &.compact .compact-footer .composer.top .composer-avatar {
    width: 2.8rem;
    height: 2.8rem;
    font-size: 1.3rem;
  }

  &.compact .compact-footer .composer-prompt {
    margin: 0;
    padding: 0.4rem 0;
  }

  &.compact .list {
    gap: 1.6rem;
  }

  &.compact .comment > .avatar {
    width: 3.2rem;
    height: 3.2rem;
  }

  &.compact .comment > .body {
    margin-left: 1.2rem;
  }

  &.compact .comment.has-replies:not(:has(> .body > .replies-block > .reply-list))::before {
    top: 3.6rem;
    left: 1.6rem;
    width: 1.4rem;
  }

  &.compact .actions {
    gap: 0.2rem;
    flex-wrap: wrap;
  }

  &.compact .action {
    width: 2.8rem;
    height: 2.8rem;
  }

  &.compact .like-count {
    margin-left: 0;
    margin-right: 0.4rem;
  }

  &.compact .reply {
    height: 2.8rem;
    padding: 0 1rem;
  }

  &.compact .replies {
    height: 3.2rem;
    margin-left: -1rem;
    padding: 0 1rem;
    font-size: 1.3rem;
    color: var(--accent);
  }

  &.compact .reply-list {
    padding-left: 1.6rem;
  }

  &.compact .reply-rows > .thread-line {
    left: -1.8rem;
    width: 1.8rem;
  }

  &.compact .reply-rows > .reply-row::before {
    left: -1.2rem;
    width: 0.9rem;
  }

  &.compact .reply-rows > .reply-row:has(+ .reply-row)::after {
    left: -1.2rem;
  }

  &.compact .reply-row {
    gap: 1rem;
  }

  &.compact .reply-list.flat {
    margin-left: -3.4rem;
    padding-left: 0;
  }

  &.compact .reply-list.flat > .reply-rows > .reply-row::before,
  &.compact .reply-list.flat > .reply-rows > .reply-row::after {
    display: none;
  }

  &.compact .show-more {
    margin-top: 1.6rem;
  }

  &.compact .disabled-notice,
  &.compact .empty-notice {
    margin-top: 0;
  }
`

const CreatorHeart = ({ avatar, tooltip }: { avatar?: string | null, tooltip?: string | null }) => {
  const label = tooltip || 'Loved by creator'
  return (
    <span className='creator-heart' role='img' data-creator-heart='true' title={label} aria-label={label}>
      {avatar
        ? (
          <>
            <img className='heart-avatar' src={avatar} alt='' loading='lazy' />
            <span className='heart-mark' aria-hidden='true'>
              <Heart size={10} strokeWidth={2} fill='#ff0000' color='#ff0000' />
            </span>
          </>
        )
        : <Heart size={14} strokeWidth={1.5} fill='#ff0000' color='#ff0000' />}
    </span>
  )
}

const mergeCustomEmojis = (
  primary?: readonly CustomEmoji[] | null,
  extra?: readonly CustomEmoji[] | null,
): readonly CustomEmoji[] => {
  const all = [...(primary ?? []), ...(extra ?? [])]
  if (all.length === 0) return []
  const seen = new Set<string>()
  return all.filter((entry) => {
    if (seen.has(entry.shortcut)) return false
    seen.add(entry.shortcut)
    return true
  })
}

const DraftBox = ({
  className,
  draft,
  placeholder,
  ariaLabel,
  submitLabel,
  cancelDisabled = false,
  sending,
  customEmojis = [],
  avatar,
  avatarName,
  alwaysExpanded = false,
  autoFocus = false,
  active = false,
  onActivate,
  onDraft,
  onCancel,
  onSend,
}: {
  className: string
  draft: string
  placeholder: string
  ariaLabel: string
  submitLabel: string
  cancelDisabled?: boolean
  sending: boolean
  customEmojis?: readonly CustomEmoji[]
  avatar?: string | null
  avatarName?: string | null
  alwaysExpanded?: boolean
  autoFocus?: boolean
  active?: boolean
  onActivate?: () => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSend: () => void
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const expanded = alwaysExpanded || active || draft.length > 0

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [draft, expanded])

  const onPickEmoji = (emoji: string) => {
    onActivate?.()
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    const next = insertAtCursor(draft, start, end, emoji)
    onDraft(next.value)
    requestAnimationFrame(() => {
      const current = inputRef.current
      if (!current) return
      current.focus()
      current.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const fallback = (avatarName?.trim().slice(0, 1) || 'Y').toUpperCase()

  return (
    <div className={expanded ? `${className} active` : className}>
      <span className={avatar ? 'avatar composer-avatar' : 'avatar composer-avatar fallback'} aria-hidden='true'>
        {avatar ? <img src={avatar} alt='' loading='lazy' /> : fallback}
      </span>
      <div className='composer-main'>
        <div className='composer-field'>
          <textarea
            ref={inputRef}
            rows={1}
            className='composer-input'
            value={draft}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onFocus={() => onActivate?.()}
            onClick={() => onActivate?.()}
            onKeyDown={(event: KeyboardEvent) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.trim().length > 0 && !sending) {
                event.preventDefault()
                onSend()
              }
            }}
            onInput={(event: TargetedEvent<HTMLTextAreaElement>) => {
              onActivate?.()
              onDraft(event.currentTarget.value)
            }}
          />
        </div>
        {expanded
          ? (
            <div className='composer-actions'>
              <EmojiButton customEmojis={customEmojis} onPick={onPickEmoji} disabled={sending} />
              <div className='composer-buttons'>
                <button type='button' className='composer-cancel' onClick={onCancel} disabled={cancelDisabled}>
                  Cancel
                </button>
                <button
                  type='button'
                  className='composer-send'
                  disabled={draft.trim().length === 0 || sending}
                  onClick={onSend}
                >
                  {submitLabel}
                </button>
              </div>
            </div>
          )
          : undefined}
      </div>
    </div>
  )
}

/** The top-level comment box. Signed-out readers get a prompt, not a dead form. */
const Composer = ({
  videoId,
  post,
  customEmojis = [],
}: {
  videoId?: string
  post?: { id: string, channelId: string }
  customEmojis?: readonly CustomEmoji[]
}) => {
  const { ready, signedIn, avatar, name, handle } = useSession()
  const [, postComment] = useMutation(POST_COMMENT)
  const [, commentOnPost] = useMutation(COMMENT_ON_POST)
  const [draft, setDraft] = useState('')
  const [active, setActive] = useState(false)
  const [sending, setSending] = useState(false)

  if (ready && !signedIn) {
    return (
      <button type='button' className='composer-prompt' onClick={signIn}>
        Sign in to comment
      </button>
    )
  }
  if (!videoId && !post) return null

  const send = () => {
    const body = draft.trim()
    if (body.length === 0 || sending) return
    setSending(true)
    const request = post
      ? commentOnPost({ postId: post.id, channelId: post.channelId, text: body })
      : postComment({ videoId: videoId!, text: body })
    void request.then((result) => {
      setSending(false)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setDraft('')
      setActive(false)
      // no optimistic row: a fabricated id would poison the normalized cache
      showToast('Comment posted')
    })
  }

  return (
    <DraftBox
      className='composer top'
      draft={draft}
      placeholder='Add a comment…'
      ariaLabel='Add a comment'
      submitLabel='Comment'
      cancelDisabled={sending}
      sending={sending}
      customEmojis={customEmojis}
      avatar={avatar}
      avatarName={name ?? handle}
      active={active}
      onActivate={() => setActive(true)}
      onDraft={setDraft}
      onCancel={() => {
        setDraft('')
        setActive(false)
      }}
      onSend={send}
    />
  )
}

const CommentText = (
  { runs, text, videoId }: { runs: CommentNode['runs'], text: string, videoId?: string },
) => (
  <ReadMore className='comment-text' text={text}>
    {runs.length > 0
      ? <RichText className='text' runs={runs} videoId={videoId} />
      : <span className='text'>{text}</span>}
  </ReadMore>
)

/**
 * The like, dislike and reply controls for one comment.
 *
 * Signed out, each one leads to sign-in. Signed in, they act through the
 * comment's `actionsToken`, the per-comment endpoints its read carried, and are
 * disabled on a comment whose read carried none.
 */
const CommentActions = ({ comment, customEmojis = [] }: { comment: CommentNode, customEmojis?: readonly CustomEmoji[] }) => {
  const { ready, signedIn, avatar, name, handle } = useSession()
  const [, rateComment] = useMutation(RATE_COMMENT)
  const [, replyToComment] = useMutation(REPLY_TO_COMMENT)
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const token = comment.actionsToken
  const rate = (status: 'LIKE' | 'DISLIKE') => {
    if (ready && !signedIn) {
      signIn()
      return
    }
    if (!token) return
    const next = (status === 'LIKE' && comment.isLiked) || (status === 'DISLIKE' && comment.isDisliked)
      ? 'INDIFFERENT'
      : status
    void rateComment({ actionsToken: token, status: next }).then((result) => {
      if (result.error) showToast(lineFor(result.error))
    })
  }

  const reply = () => {
    if (ready && !signedIn) {
      signIn()
      return
    }
    if (token) setReplying(value => !value)
  }

  const sendReply = () => {
    const body = draft.trim()
    if (!token || body.length === 0 || sending) return
    setSending(true)
    void replyToComment({ actionsToken: token, text: body }).then((result) => {
      setSending(false)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setDraft('')
      setReplying(false)
      showToast('Reply posted')
    })
  }

  return (
    <>
      <div className='actions'>
        <button
          type='button'
          className='action'
          aria-label='Like'
          aria-pressed={comment.isLiked === true}
          disabled={!token && signedIn}
          onClick={() => rate('LIKE')}
        >
          <ThumbsUp size={16} strokeWidth={1.5} fill={comment.isLiked ? 'currentColor' : 'none'} />
        </button>
        {comment.likeCountText ? <span className='like-count'>{comment.likeCountText}</span> : undefined}
        <button
          type='button'
          className='action'
          aria-label='Dislike'
          aria-pressed={comment.isDisliked === true}
          disabled={!token && signedIn}
          onClick={() => rate('DISLIKE')}
        >
          <ThumbsDown size={16} strokeWidth={1.5} fill={comment.isDisliked ? 'currentColor' : 'none'} />
        </button>
        {comment.isHearted ? <CreatorHeart avatar={comment.heartAvatar} tooltip={comment.heartTooltip} /> : undefined}
        <button type='button' className='reply' disabled={!token && signedIn} onClick={reply}>
          Reply
        </button>
      </div>
      {replying
        ? (
          <DraftBox
            className='composer'
            draft={draft}
            placeholder='Add a reply…'
            ariaLabel='Add a reply'
            submitLabel='Reply'
            cancelDisabled={sending}
            sending={sending}
            customEmojis={customEmojis}
            avatar={avatar}
            avatarName={name ?? handle}
            alwaysExpanded
            autoFocus
            onDraft={setDraft}
            onCancel={() => { setReplying(false); setDraft('') }}
            onSend={sendReply}
          />
        )
        : undefined}
    </>
  )
}

const REPLIES_QUERY = gql(`
  query CommentReplies($cursor: String!) {
    commentReplies(cursor: $cursor) {
      items {
        ...CommentCore
        replies {
          ...CommentCore
          replies {
            ...CommentCore
            replies {
              ...CommentCore
            }
          }
        }
      }
      cursor
    }
  }
`)

const AuthorAvatarButton = (
  { profileKey, author, activeProfileKey, onOpenProfile }: {
    profileKey: string
    author?: CommentProfileAuthor | null
    activeProfileKey: string | null
    onOpenProfile: (key: string, author: CommentProfileAuthor, anchor: HTMLElement) => void
  },
) => author
  ? (
    <button
      type='button'
      className={author.avatar ? 'avatar avatar-btn' : 'avatar avatar-btn fallback'}
      aria-label={`View ${author.name} profile`}
      aria-haspopup='dialog'
      aria-expanded={activeProfileKey === profileKey}
      onClick={(event: TargetedEvent<HTMLButtonElement>) => onOpenProfile(profileKey, author, event.currentTarget)}
    >
      {author.avatar
        ? <img src={author.avatar} alt='' loading='lazy' />
        : author.name.slice(0, 1).toUpperCase()}
    </button>
  )
  : <span className='avatar fallback'>?</span>

const ReplyRow = (
  { reply, videoId, customEmojis, activeProfileKey, onOpenProfile, depth, compact }: {
    reply: CommentNode
    videoId?: string
    customEmojis?: readonly CustomEmoji[]
    activeProfileKey: string | null
    onOpenProfile: (key: string, author: CommentProfileAuthor, anchor: HTMLElement) => void
    depth: number
    compact: boolean
  },
) => {
  const replyAuthor = reply.author
  const inlineReplies = reply.replies ?? []
  return (
    <div className='reply-row'>
      <AuthorAvatarButton
        profileKey={reply.id}
        author={replyAuthor}
        activeProfileKey={activeProfileKey}
        onOpenProfile={onOpenProfile}
      />
      <div className='body'>
        <div className='byline'>
          {replyAuthor
            ? (
              <Link href={`/channel/${replyAuthor.id}`} className={reply.isCreator ? 'name creator' : 'name'}>
                <span className='name-text'>{replyAuthor.name}</span>
                <VerifiedBadge channel={replyAuthor} size={12} />
              </Link>
            )
            : undefined}
          {reply.publishedText ? <span className='age'>{reply.publishedText}</span> : undefined}
        </div>
        <CommentText runs={reply.runs} text={reply.text} videoId={videoId} />
        <CommentActions comment={reply} customEmojis={customEmojis} />
        {inlineReplies.length > 0 || reply.repliesCursor
          ? (
            <ReplyThread
              initialReplies={inlineReplies}
              cursor={reply.repliesCursor}
              count={reply.replyCount}
              defaultOpen={inlineReplies.length > 0}
              videoId={videoId}
              customEmojis={customEmojis}
              activeProfileKey={activeProfileKey}
              onOpenProfile={onOpenProfile}
              depth={depth + 1}
              compact={compact}
            />
          )
          : undefined}
      </div>
    </div>
  )
}

/**
 * One reply branch (lazy cursor-backed, inline pre-populated, or both),
 * collapsible along its vertical thread rail.
 */
const ReplyThread = (
  { initialReplies, cursor, count, defaultOpen = false, videoId, customEmojis, activeProfileKey, onOpenProfile, depth = 1, compact = false }: {
    initialReplies?: readonly CommentNode[]
    cursor?: string | null
    count?: number | null
    defaultOpen?: boolean
    videoId?: string
    customEmojis?: readonly CustomEmoji[]
    activeProfileKey: string | null
    onOpenProfile: (key: string, author: CommentProfileAuthor, anchor: HTMLElement) => void
    depth?: number
    compact?: boolean
  },
) => {
  const hasInitial = Boolean(initialReplies && initialReplies.length > 0)
  const [open, setOpen] = useState(defaultOpen)
  const [fetchingMore, setFetchingMore] = useState(!hasInitial)
  const [loaded, setLoaded] = useState<RepliesPage[]>([])
  const toggleRef = useRef<HTMLButtonElement>(null)
  const activeCursor = loaded[loaded.length - 1]?.cursor ?? cursor
  const [{ data, error, fetching }, reexecute] = useQuery({
    query: REPLIES_QUERY,
    variables: { cursor: activeCursor ?? '' },
    pause: !open || !fetchingMore || !activeCursor,
  })
  const page = data?.commentReplies
  const seeded: RepliesPage[] = hasInitial
    ? [{ items: initialReplies as RepliesPage['items'], cursor: null }]
    : []
  const { items, cursor: next } = useInfiniteFeed({
    pages: [...seeded, ...loaded, ...(page ? [page] : [])],
    key: reply => reply.id,
  })
  const positiveCount = typeof count === 'number' && count > 0 ? count : undefined
  const resolvedCount = positiveCount ?? (items.length > 0 ? items.length : undefined)
  const label = resolvedCount === undefined
    ? 'Replies'
    : resolvedCount === 1
      ? '1 reply'
      : `${resolvedCount} replies`
  // Cap visual indentation at depth 2 in narrow Shorts panels so deeper nested replies keep full width.
  const flat = Boolean(compact && depth >= 3)
  const showMore = !fetching && !error && (hasInitial && !fetchingMore ? Boolean(cursor) : Boolean(next))
  const onShowMore = () => {
    if (!fetchingMore) {
      setFetchingMore(true)
      return
    }
    if (page && loaded[loaded.length - 1] !== page) {
      setLoaded([...loaded, page])
    }
  }
  const collapse = () => {
    setOpen(false)
    toggleRef.current?.focus()
  }

  return (
    <div className='replies-block'>
      <button
        ref={toggleRef}
        type='button'
        className='replies'
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {label}
        {open ? <ChevronUp size={20} strokeWidth={1.5} /> : <ChevronDown size={20} strokeWidth={1.5} />}
      </button>
      {open
        ? (
          <div className={flat ? 'reply-list flat' : 'reply-list'} data-depth={depth}>
            {items.length > 0
              ? (
                <div className='reply-rows'>
                  {!flat
                    ? (
                      <button
                        type='button'
                        className='thread-line'
                        aria-label='Collapse replies'
                        title='Collapse replies'
                        onClick={collapse}
                      />
                    )
                    : undefined}
                  {items.map(reply => (
                    <ReplyRow
                      key={reply.id}
                      reply={reply}
                      videoId={videoId}
                      customEmojis={customEmojis}
                      activeProfileKey={activeProfileKey}
                      onOpenProfile={onOpenProfile}
                      depth={depth}
                      compact={compact}
                    />
                  ))}
                </div>
              )
              : undefined}
            {fetching ? <div className='age'>Loading replies…</div> : undefined}
            {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
            {showMore
              ? (
                <button type='button' className='replies' onClick={onShowMore}>
                  Show more replies
                </button>
              )
              : undefined}
          </div>
        )
        : undefined}
    </div>
  )
}

const RYD_SORTS: { value: RydCommentSort, label: string }[] = [
  { value: 'top', label: 'Top comments' },
  { value: 'new', label: 'Newest first' },
]

const RydReplies = ({ rootId, count }: { rootId: string, count: number }) => {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RydComment[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const load = async (nextCursor?: string) => {
    setLoading(true)
    const page = await fetchRydReplies(rootId, nextCursor)
    setLoading(false)
    setLoaded(true)
    if (!page) return
    setItems(current => {
      const seen = new Set(current.map(item => item.id))
      return [...current, ...page.items.filter(item => !seen.has(item.id))]
    })
    setCursor(page.nextCursor)
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !loaded && !loading) void load()
  }

  const collapse = () => {
    setOpen(false)
    toggleRef.current?.focus()
  }

  const label = count === 1 ? '1 reply' : `${count} replies`

  return (
    <div className='replies-block'>
      <button ref={toggleRef} type='button' className='replies' aria-expanded={open} onClick={toggle}>
        {label}
        {open ? <ChevronUp size={20} strokeWidth={1.5} /> : <ChevronDown size={20} strokeWidth={1.5} />}
      </button>
      {open
        ? (
          <div className='reply-list'>
            {items.length > 0
              ? (
                <div className='reply-rows'>
                  <button
                    type='button'
                    className='thread-line'
                    aria-label='Collapse replies'
                    title='Collapse replies'
                    onClick={collapse}
                  />
                  {items.map(reply => (
                    <div className='reply-row' key={reply.id}>
                      <span className='avatar fallback' aria-hidden='true'>{reply.authorName.slice(0, 1).toUpperCase()}</span>
                      <div className='body'>
                        <div className='byline'>
                          <span className='name'>{reply.authorName}</span>
                          {reply.createdAt ? <span className='age'>{formatAgo(reply.createdAt)}{reply.edited ? ' (edited)' : ''}</span> : undefined}
                        </div>
                        <div className='comment-text'>
                          <ReadMore>{reply.text}</ReadMore>
                        </div>
                        {reply.likes > 0 || reply.dislikes > 0
                          ? (
                            <div className='actions'>
                              {reply.likes > 0 ? <span className='age'><ThumbsUp size={14} strokeWidth={1.5} /> {formatCompact(reply.likes)}</span> : undefined}
                              {reply.dislikes > 0 ? <span className='age'><ThumbsDown size={14} strokeWidth={1.5} /> {formatCompact(reply.dislikes)}</span> : undefined}
                            </div>
                          )
                          : undefined}
                      </div>
                    </div>
                  ))}
                </div>
              )
              : undefined}
            {loading ? <div className='age'>Loading replies…</div> : undefined}
            {cursor && !loading
              ? <button type='button' className='replies' onClick={() => void load(cursor)}>Show more replies</button>
              : undefined}
          </div>
        )
        : undefined}
    </div>
  )
}

const RydComments = ({ videoId, compact = false }: { videoId: string, compact?: boolean }) => {
  const [enabled, setEnabled] = useState(() => getSettings().showDislikes)
  const [sort, setSort] = useState<RydCommentSort>('top')
  const [items, setItems] = useState<RydComment[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  useEffect(() => subscribeSettings(settings => setEnabled(settings.showDislikes)), [])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      setCursor(undefined)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setItems([])
    setCursor(undefined)
    void fetchRydComments(videoId, sort, undefined, controller.signal).then((page) => {
      if (controller.signal.aborted) return
      setLoading(false)
      if (!page) return
      setItems(page.items)
      setCursor(page.nextCursor)
    })
    return () => controller.abort()
  }, [videoId, sort, enabled])

  const onMore = () => {
    if (!cursor || loading) return
    setLoading(true)
    void fetchRydComments(videoId, sort, cursor).then((page) => {
      setLoading(false)
      if (!page) return
      setItems(current => {
        const seen = new Set(current.map(item => item.id))
        return [...current, ...page.items.filter(item => !seen.has(item.id))]
      })
      setCursor(page.nextCursor)
    })
  }

  const notice = <p className='disabled-notice'>Comments are turned off.</p>
  if (!enabled || (!loading && items.length === 0) || (loading && items.length === 0)) {
    return compact ? notice : <section css={style}>{notice}</section>
  }

  const content = (
    <>
      <p className='disabled-notice'>Comments are turned off on YouTube. Showing Return YouTube Dislike comments.</p>
      <div className='heading-row'>
        <h2 className='heading'>Return YouTube Dislike comments</h2>
        <Menu
          align={compact ? 'end' : 'start'}
          trigger={
            <button type='button' className='sort'>
              <ListFilter size={24} strokeWidth={1.5} />
              <span className='sort-label'>Sort by</span>
            </button>
          }
        >
          {RYD_SORTS.map(option => (
            <MenuItem
              key={option.value}
              label={option.label}
              checked={option.value === sort}
              onSelect={() => setSort(option.value)}
            />
          ))}
        </Menu>
      </div>
      <div className='list'>
        {items.map(comment => (
          <div className='comment' key={comment.id}>
            <span className='avatar fallback' aria-hidden='true'>{comment.authorName.slice(0, 1).toUpperCase()}</span>
            <div className='body'>
              <div className='byline'>
                <span className='author'><span className='name-text'>{comment.authorName}</span></span>
                {comment.createdAt ? <span className='age'>{formatAgo(comment.createdAt)}{comment.edited ? ' (edited)' : ''}</span> : undefined}
              </div>
              <div className='comment-text'>
                <ReadMore>{comment.text}</ReadMore>
              </div>
              <div className='actions'>
                <span className='age'><ThumbsUp size={16} strokeWidth={1.5} /> {formatCompact(comment.likes)}</span>
                <span className='age'><ThumbsDown size={16} strokeWidth={1.5} /> {formatCompact(comment.dislikes)}</span>
              </div>
              {comment.replyCount > 0 ? <RydReplies rootId={comment.id} count={comment.replyCount} /> : undefined}
            </div>
          </div>
        ))}
      </div>
      {cursor
        ? (
          <button type='button' className='show-more' disabled={loading} onClick={onMore}>
            Show more
          </button>
        )
        : undefined}
    </>
  )
  return compact ? content : <section css={style} data-ryd-comments='true'>{content}</section>
}

/** A video's comments, or with `post` instead, a channel post's. `variant='compact'` renders a unified Shorts drawer layout with pinned footer composer. */
export const Comments = ({ videoId, post, commentCountText, extraCustomEmojis, variant = 'default', onClose }: {
  videoId?: string
  post?: { id: string, channelId: string }
  commentCountText?: string | null
  extraCustomEmojis?: readonly CustomEmoji[]
  variant?: 'default' | 'compact'
  onClose?: () => void
}) => {
  const compact = variant === 'compact'
  const [sort, setSort] = useState<CommentSort>('TOP')
  // pages carry the sort they came from: without it the accumulator dedupes a reorder into a drop
  const [loaded, setLoaded] = useState<{ sort: CommentSort, pages: CommentPage[] }>({ sort, pages: [] })
  const [activeProfile, setActiveProfile] = useState<{ key: string, author: CommentProfileAuthor, anchor: HTMLElement } | null>(null)
  const toggleProfile = (key: string, author: CommentProfileAuthor, anchor: HTMLElement) => {
    setActiveProfile(current => current?.key === key && current.anchor === anchor ? null : { key, author, anchor })
  }
  const loadedPages = loaded.sort === sort ? loaded.pages : []
  const cursor = loadedPages[loadedPages.length - 1]?.cursor ?? null
  const [videoComments, reexecuteVideoComments] = useQuery({
    query: COMMENTS_QUERY,
    variables: { videoId: videoId ?? '', sort, cursor },
    pause: post !== undefined,
  })
  const [postComments, reexecutePostComments] = useQuery({
    query: POST_COMMENTS_QUERY,
    variables: { postId: post?.id ?? '', channelId: post?.channelId ?? '', sort, cursor },
    pause: post === undefined,
  })
  const { error, fetching } = post ? postComments : videoComments
  const reexecute = post ? reexecutePostComments : reexecuteVideoComments
  const page = post ? postComments.data?.postComments : videoComments.data?.comments
  const { items } = useInfiniteFeed({
    pages: page ? [...loadedPages, page] : loadedPages,
    key: comment => comment.id
  })
  // the first page carries the full count ('2,461,151 Comments'); later pages carry none, and the watch read only the rounded '2.4M'
  const firstPage = loadedPages[0] ?? page
  const count = firstPage?.countText ?? commentCountText
  const compactCount = count ? count.replace(/\s*comments?$/i, '').trim() : undefined
  const customEmojis = mergeCustomEmojis(firstPage?.customEmojis, extraCustomEmojis)
  const heading = count ? /comment/i.test(count) ? count : `${count} Comments` : 'Comments'
  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ sort, pages: loadedPages[loadedPages.length - 1] === page ? loadedPages : [...loadedPages, page] })
  }
  const initialError = Boolean(error && items.length === 0 && !fetching)
  const isDisabled = Boolean(page?.disabled && items.length === 0)
  const isEmpty = !fetching && !error && items.length === 0 && !page?.disabled

  const commentList = (
    <div className='list'>
      {items.map(comment => {
        const author = comment.author
        const inlineReplies = comment.replies ?? []
        const hasReplies = Boolean(comment.repliesCursor || inlineReplies.length > 0 || comment.replyCount)
        return (
          <div className={hasReplies ? 'comment has-replies' : 'comment'} key={comment.id}>
            <AuthorAvatarButton
              profileKey={comment.id}
              author={author}
              activeProfileKey={activeProfile?.key ?? null}
              onOpenProfile={toggleProfile}
            />
            <div className='body'>
              {comment.isPinned
                ? (
                  <div className='pinned' data-pinned-comment='true'>
                    <Pin size={13} strokeWidth={1.75} aria-hidden='true' />
                    <span>{comment.pinnedText || 'Pinned'}</span>
                  </div>
                )
                : undefined}
              <div className='byline'>
                {author
                  ? (
                    <Link href={`/channel/${author.id}`} className={comment.isCreator ? 'author creator' : 'author'}>
                      <span className='name-text'>{author.name}</span>
                      <VerifiedBadge channel={author} size={12} />
                    </Link>
                  )
                  : undefined}
                {comment.publishedText ? <span className='age'>{comment.publishedText}</span> : undefined}
              </div>
              <CommentText runs={comment.runs} text={comment.text} videoId={videoId} />
              <CommentActions comment={comment} customEmojis={customEmojis} />
              {inlineReplies.length > 0 || comment.repliesCursor
                ? (
                  <ReplyThread
                    initialReplies={inlineReplies}
                    cursor={comment.repliesCursor}
                    count={comment.replyCount}
                    defaultOpen={false}
                    videoId={videoId}
                    customEmojis={customEmojis}
                    activeProfileKey={activeProfile?.key ?? null}
                    onOpenProfile={toggleProfile}
                    depth={1}
                    compact={compact}
                  />
                )
                : comment.replyCount
                  ? <div className='replies'>{comment.replyCount === 1 ? '1 reply' : `${comment.replyCount} replies`}</div>
                  : undefined}
            </div>
          </div>
        )
      })}
    </div>
  )

  const sortMenu = (align: 'start' | 'end', iconOnly: boolean) => (
    <Menu
      align={align}
      trigger={
        iconOnly
          ? (
            <button type='button' className='compact-icon-button' aria-label='Sort comments'>
              <ListFilter size={20} strokeWidth={1.75} />
            </button>
          )
          : (
            <button type='button' className='sort'>
              <ListFilter size={24} strokeWidth={1.5} />
              <span className='sort-label'>Sort by</span>
            </button>
          )
      }
    >
      {SORTS.map(option => (
        <MenuItem
          key={option.value}
          label={option.label}
          checked={option.value === sort}
          onSelect={() => setSort(option.value)}
        />
      ))}
    </Menu>
  )

  if (compact) {
    return (
      <section css={style} className='compact'>
        <div className='compact-header'>
          <h2 className='compact-title'>
            Comments
            {compactCount ? <span className='comments-count'>{compactCount}</span> : undefined}
          </h2>
          <div className='compact-header-actions'>
            {!initialError && !isDisabled ? sortMenu('end', true) : undefined}
            {onClose
              ? (
                <button type='button' className='compact-icon-button' aria-label='Close comments' onClick={onClose}>
                  <X size={20} strokeWidth={1.75} />
                </button>
              )
              : undefined}
          </div>
        </div>
        <div className='compact-scroll'>
          {initialError
            ? <DataFailure error={error} reexecute={reexecute} />
            : isDisabled
              ? (videoId && !post ? <RydComments videoId={videoId} compact /> : <p className='disabled-notice'>Comments are turned off.</p>)
              : fetching && items.length === 0
                ? <p className='age'>Loading comments…</p>
                : isEmpty
                  ? <p className='empty-notice'>No comments yet.</p>
                  : (
                    <>
                      {commentList}
                      {activeProfile
                        ? (
                          <CommentProfileCard
                            author={activeProfile.author}
                            anchor={activeProfile.anchor}
                            onClose={() => setActiveProfile(null)}
                          />
                        )
                        : undefined}
                      {error && !fetching
                        ? <DataFailure error={error} reexecute={reexecute} />
                        : page?.cursor
                          ? (
                            <button type='button' className='show-more' disabled={fetching} onClick={onMore}>
                              Show more
                            </button>
                          )
                          : undefined}
                    </>
                  )}
        </div>
        {!initialError && !isDisabled
          ? (
            <div className='compact-footer'>
              <Composer videoId={videoId} post={post} customEmojis={customEmojis} />
            </div>
          )
          : undefined}
      </section>
    )
  }

  // a first-page failure REPORTS rather than unmounting: returning null reads as "no comments"
  if (initialError) {
    return (
      <section css={style}>
        <DataFailure error={error} reexecute={reexecute} />
      </section>
    )
  }
  if (isEmpty && !page?.countText) return null
  if (isDisabled) {
    if (videoId && !post) return <RydComments videoId={videoId} />
    return (
      <section css={style}>
        <p className='disabled-notice'>Comments are turned off.</p>
      </section>
    )
  }
  return (
    <section css={style}>
      <div className='heading-row'>
        <h2 className='heading'>{heading}</h2>
        {sortMenu('start', false)}
      </div>
      <Composer videoId={videoId} post={post} customEmojis={customEmojis} />
      {commentList}
      {activeProfile
        ? (
          <CommentProfileCard
            author={activeProfile.author}
            anchor={activeProfile.anchor}
            onClose={() => setActiveProfile(null)}
          />
        )
        : undefined}
      {error && !fetching
        ? <DataFailure error={error} reexecute={reexecute} />
        : page?.cursor
          ? (
            <button type='button' className='show-more' disabled={fetching} onClick={onMore}>
              Show more
            </button>
          )
          : undefined}
    </section>
  )
}

export default Comments
