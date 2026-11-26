import type { LikeStatus } from '../generated/graphql'
import type { RichTextRun } from './rich-text'
import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { useMutation } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { useSession } from '../session'
import { signIn } from '../sign-in'
import { lineFor } from './data-failure'
import { ReadMore } from './read-more'
import { RichText } from './rich-text'
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
      </div>
      {post.text
        ? readMore
          ? <ReadMore className='post-text' text={post.text}>{body}</ReadMore>
          : <p className='post-text'>{body}</p>
        : undefined}
      {images
        ? (
          <div className='post-images'>
            {images.map((src, index) => <img key={`${src}-${index}`} className='post-image' src={src} alt='' loading='lazy' />)}
          </div>
        )
        : post.attachedImage
          ? <img className='post-image' src={post.attachedImage} alt='' loading='lazy' />
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
    </article>
  )
}

export default PostCard
