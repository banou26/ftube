import type { LikeStatus } from '../generated/graphql'
import type { RichTextRun } from './rich-text'
import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight, MessageSquareText, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { useSession } from '../session'
import { signIn } from '../sign-in'
import { lineFor } from './data-failure'
import { ReadMore } from './read-more'
import { RichText } from './rich-text'
import { MembersOnly } from './row-marks'
import { showToast } from './ui/toast'
import { VerifiedBadge } from './verified-badge'
import { VideoCardCompact } from './video-card-compact'

export type PostCardPollChoice = {
  text: string
  votePercentage?: string | null
  image?: string | null
}

export type PostCardPoll = {
  totalVotesText?: string | null
  choices: readonly PostCardPollChoice[]
}

export type PostCardData = {
  id: string
  text: string
  runs?: readonly RichTextRun[] | null
  publishedText?: string | null
  voteCountText?: string | null
  likeStatus?: LikeStatus | null
  actionsToken?: string | null
  isCreator?: boolean | null
  isMembersOnly?: boolean | null
  membersOnlyLabel?: string | null
  commentCountText?: string | null
  commentCountLabel?: string | null
  attachedImage?: string | null
  attachedImages?: readonly string[] | null
  author?: {
    id: string
    name: string
    avatar?: string | null
    isVerified?: boolean | null
    isVerifiedArtist?: boolean | null
  } | null
  attachedVideo?: VideoCardData | null
  poll?: PostCardPoll | null
}

// Keep selection minimal (`{ id likeStatus }`): returning `text` would overwrite or require re-sending it under non-null cache rules.
const RATE_POST = gql(`
  mutation RatePost($actionsToken: String!, $status: LikeStatus!) {
    ratePost(actionsToken: $actionsToken, status: $status) {
      id
      likeStatus
    }
  }
`)

const style = css`
  padding: 1.6rem;
  border: 1px solid var(--border-subtle);
  border-radius: 1.2rem;

  .post-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .post-author {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .post-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
    font-size: 1.1rem;
  }

  .creator-badge {
    display: inline-flex;
    align-items: center;
    height: 2rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .members-only-pill {
    display: inline-flex;
    align-items: center;
    height: 2.2rem;
    padding: 0 0.8rem;
    border-radius: 0.4rem;
    background: var(--bg-chip);
  }

  .post-text {
    margin-top: 1.2rem;
    font-size: 1.6rem;
    line-height: 2.2rem;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .post-image {
    display: block;
    width: 100%;
    margin-top: 1.2rem;
    border-radius: 0.8rem;
  }

  .post-images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  .post-images .post-image {
    margin-top: 0;
    aspect-ratio: 1 / 1;
    object-fit: cover;
  }

  .post-image-btn {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: zoom-in;
    border-radius: 0.8rem;
    overflow: hidden;
    margin-top: 1.2rem;
  }

  .post-image-btn .post-image {
    margin-top: 0;
  }

  .post-images .post-image-btn {
    margin-top: 0;
  }

  .post-poll {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  .poll-choice {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 0.9rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    overflow: hidden;
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .poll-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--bg-chip);
    pointer-events: none;
  }

  .poll-label {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
  }

  .poll-choice-img {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 0.4rem;
    object-fit: cover;
  }

  .poll-pct {
    position: relative;
    flex: none;
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .poll-total {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .post-footer {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    margin-top: 0.8rem;
    font-size: 1.2rem;
    color: var(--text-primary);
  }

  .post-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .post-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .post-action:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .post-action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .post-vote-count {
    min-width: 1.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .post-votes,
  .post-comments {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .post-comments {
    height: 3.2rem;
    padding: 0 1.2rem;
    border-radius: 1.6rem;
    font-weight: 500;
    transition: background 0.15s ease;
  }

  .post-comments:hover {
    background: var(--bg-hover);
  }
`

const parsePercentage = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined
  const num = Number.parseFloat(value.replace('%', '').trim())
  if (!Number.isFinite(num)) return undefined
  return Math.max(0, Math.min(100, num))
}

const PostActions = ({ post }: { post: PostCardData }) => {
  const { ready, signedIn } = useSession()
  const [, ratePost] = useMutation(RATE_POST)
  const [optimisticStatus, setOptimisticStatus] = useState<LikeStatus | undefined>(undefined)

  useEffect(() => {
    setOptimisticStatus(undefined)
  }, [post.id, post.likeStatus])

  const effectiveStatus: LikeStatus = optimisticStatus ?? post.likeStatus ?? 'INDIFFERENT'

  const rate = (target: 'LIKE' | 'DISLIKE') => {
    if (ready && !signedIn) {
      signIn()
      return
    }
    const token = post.actionsToken
    if (!token) return
    const next: LikeStatus = effectiveStatus === target ? 'INDIFFERENT' : target
    setOptimisticStatus(next)
    void ratePost({ actionsToken: token, status: next }).then((result) => {
      if (result.error) {
        setOptimisticStatus(undefined)
        showToast(lineFor(result.error))
      }
    })
  }

  return (
    <div className='post-actions'>
      <button
        type='button'
        className='post-action'
        aria-label='Like post'
        aria-pressed={effectiveStatus === 'LIKE'}
        disabled={!post.actionsToken && signedIn}
        onClick={() => rate('LIKE')}
      >
        <ThumbsUp size={18} strokeWidth={1.5} fill={effectiveStatus === 'LIKE' ? 'currentColor' : 'none'} />
      </button>
      {post.voteCountText ? <span className='post-vote-count'>{post.voteCountText}</span> : undefined}
      <button
        type='button'
        className='post-action'
        aria-label='Dislike post'
        aria-pressed={effectiveStatus === 'DISLIKE'}
        disabled={!post.actionsToken && signedIn}
        onClick={() => rate('DISLIKE')}
      >
        <ThumbsDown size={18} strokeWidth={1.5} fill={effectiveStatus === 'DISLIKE' ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

const lightboxStyle = css`
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.4rem;
  background: rgba(0, 0, 0, 0.88);

  .viewer-img {
    max-width: min(92vw, 128rem);
    max-height: 90vh;
    object-fit: contain;
    border-radius: 0.8rem;
    user-select: none;
  }

  .viewer-btn {
    position: absolute;
    width: 4.4rem;
    height: 4.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .viewer-btn:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  .viewer-close {
    top: 1.6rem;
    right: 1.6rem;
  }

  .viewer-prev {
    left: 1.6rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .viewer-next {
    right: 1.6rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .viewer-count {
    position: absolute;
    bottom: 1.6rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.4rem 1.2rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.65);
    color: #ffffff;
    font-size: 1.3rem;
    font-weight: 500;
  }
`

const PostImageLightbox = (
  { images, index, onChange, onClose }: {
    images: readonly string[]
    index: number
    onChange: (nextIndex: number) => void
    onClose: () => void
  },
) => {
  const viewerRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ index, total: images.length, onChange, onClose })
  latest.current = { index, total: images.length, onChange, onClose }

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    viewerRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      const { index: cur, total, onChange: step, onClose: close } = latest.current
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === 'Tab') {
        const root = viewerRef.current
        if (!root) return
        const focusables = [...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((el) => !el.hidden && el.getClientRects().length > 0)
        event.preventDefault()
        if (focusables.length === 0) {
          root.focus()
          return
        }
        const active = document.activeElement as HTMLElement | null
        const currentIndex = active ? focusables.indexOf(active) : -1
        const nextIndex = currentIndex === -1
          ? (event.shiftKey ? focusables.length - 1 : 0)
          : (currentIndex + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length
        focusables[nextIndex]?.focus()
      } else if (total > 1 && event.key === 'ArrowLeft') {
        event.preventDefault()
        step((cur - 1 + total) % total)
      } else if (total > 1 && event.key === 'ArrowRight') {
        event.preventDefault()
        step((cur + 1) % total)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.documentElement.style.overflow = previousOverflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const total = images.length
  const src = images[index]
  if (!src) return null

  return (
    <div
      ref={viewerRef}
      css={lightboxStyle}
      role='dialog'
      aria-modal='true'
      aria-label='Post image viewer'
      tabIndex={-1}
      onClick={(event: MouseEvent) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button type='button' className='viewer-btn viewer-close' aria-label='Close image' onClick={onClose}>
        <X size={22} strokeWidth={2} />
      </button>
      {total > 1
        ? (
          <button
            type='button'
            className='viewer-btn viewer-prev'
            aria-label='Previous image'
            onClick={() => onChange((index - 1 + total) % total)}
          >
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
        )
        : undefined}
      <img className='viewer-img' src={src} alt='' />
      {total > 1
        ? (
          <>
            <button
              type='button'
              className='viewer-btn viewer-next'
              aria-label='Next image'
              onClick={() => onChange((index + 1) % total)}
            >
              <ChevronRight size={24} strokeWidth={2} />
            </button>
            <span className='viewer-count'>{index + 1} / {total}</span>
          </>
        )
        : undefined}
    </div>
  )
}

/**
 * A channel post, on a channel's Posts tab, Community page, on its own page, or in a row of a topic channel's Home.
 * Interactive voting (`PostActions`) renders when `readMore` is true so Home harness tests without an urql Provider
 * keep rendering cleanly.
 */
export const PostCard = (
  { post, readMore = true, showCommentLink = readMore }: {
    post: PostCardData
    readMore?: boolean
    showCommentLink?: boolean
  },
) => {
  const images = post.attachedImages && post.attachedImages.length > 1
    ? post.attachedImages
    : undefined
  const allImages = images ?? (post.attachedImage ? [post.attachedImage] : [])
  const [viewerIndex, setViewerIndex] = useState<number>()

  useEffect(() => {
    setViewerIndex(undefined)
  }, [post.id])

  const body = post.runs && post.runs.length > 0
    ? <RichText runs={post.runs} />
    : post.text
  const hasCommentLink = Boolean(post.commentCountText) || showCommentLink

  return (
    <article css={style} className='post'>
      <div className='post-head'>
        {post.author
          ? (
            <Link href={`/channel/${post.author.id}`} className='post-author'>
              {post.author.avatar
                ? <img className='post-avatar' src={post.author.avatar} alt='' loading='lazy' />
                : <span className='post-avatar' aria-hidden='true'>{post.author.name.slice(0, 1)}</span>}
              <span>{post.author.name}</span>
              <VerifiedBadge channel={post.author} size={13} />
            </Link>
          )
          : undefined}
        {post.isCreator ? <span className='creator-badge'>Creator</span> : undefined}
        {post.publishedText ? <Link href={`/post/${post.id}`} className='post-date'>{post.publishedText}</Link> : undefined}
        {post.isMembersOnly
          ? (
            <span className='members-only-pill'>
              <MembersOnly label={post.membersOnlyLabel ?? undefined} />
            </span>
          )
          : undefined}
      </div>
      {post.text
        ? readMore
          ? <ReadMore className='post-text' text={post.text}>{body}</ReadMore>
          : <p className='post-text'>{body}</p>
        : undefined}
      {images
        ? (
          <div className='post-images'>
            {images.map((src, index) => (
              <button
                key={`${src}-${index}`}
                type='button'
                className='post-image-btn'
                aria-label={`View image ${index + 1} of ${images.length} full size`}
                onClick={() => setViewerIndex(index)}
              >
                <img className='post-image' src={src} alt='' loading='lazy' />
              </button>
            ))}
          </div>
        )
        : post.attachedImage
          ? (
            <button
              type='button'
              className='post-image-btn'
              aria-label='View image full size'
              onClick={() => setViewerIndex(0)}
            >
              <img className='post-image' src={post.attachedImage} alt='' loading='lazy' />
            </button>
          )
          : undefined}
      {post.attachedVideo ? <VideoCardCompact video={post.attachedVideo} /> : undefined}
      {post.poll && post.poll.choices.length > 0
        ? (
          <div className='post-poll'>
            {post.poll.choices.map((choice, index) => {
              const pct = parsePercentage(choice.votePercentage)
              return (
                <div key={`${choice.text}-${index}`} className='poll-choice'>
                  {pct !== undefined ? <span className='poll-bar' style={{ width: `${pct}%` }} aria-hidden='true' /> : undefined}
                  <span className='poll-label'>
                    {choice.image ? <img className='poll-choice-img' src={choice.image} alt='' loading='lazy' /> : undefined}
                    <span>{choice.text}</span>
                  </span>
                  {choice.votePercentage ? <span className='poll-pct'>{choice.votePercentage}</span> : undefined}
                </div>
              )
            })}
            {post.poll.totalVotesText ? <span className='poll-total'>{post.poll.totalVotesText}</span> : undefined}
          </div>
        )
        : undefined}
      {(readMore || post.voteCountText || hasCommentLink)
        ? (
          <div className='post-footer'>
            {readMore
              ? <PostActions post={post} />
              : post.voteCountText
                ? <span className='post-votes'><ThumbsUp size={18} strokeWidth={1.5} />{post.voteCountText}</span>
                : undefined}
            {post.commentCountText
              ? (
                <Link
                  href={`/post/${post.id}`}
                  className='post-comments'
                  aria-label={post.commentCountLabel ?? `${post.commentCountText} comments`}
                >
                  <MessageSquareText size={18} strokeWidth={1.5} />
                  {post.commentCountText}
                </Link>
              )
              : showCommentLink
                ? (
                  <Link href={`/post/${post.id}`} className='post-comments' aria-label='Comments'>
                    <MessageSquareText size={18} strokeWidth={1.5} />
                    Comments
                  </Link>
                )
                : undefined}
          </div>
        )
        : undefined}
      {viewerIndex !== undefined
        ? (
          <PostImageLightbox
            images={allImages}
            index={viewerIndex}
            onChange={setViewerIndex}
            onClose={() => setViewerIndex(undefined)}
          />
        )
        : undefined}
    </article>
  )
}

export default PostCard
