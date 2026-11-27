import { css } from '@emotion/react'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { signIn } from '../sign-in'
import { lineFor } from './data-failure'
import { formatDuration } from './format'
import { useToggleSubscription } from './subscribe-button'
import { Thumbnail } from './thumbnail'
import { VerifiedBadge } from './verified-badge'
import { watchHrefFor } from './video-card'

const COMMENT_PROFILE_CARD_QUERY = gql(`
  query CommentProfileCard($id: ID!) {
    channel(id: $id, tab: VIDEOS) {
      channel {
        id
        name
        avatar
        handle
        subscriberCountText
        videoCountText
        banner
        description
        isSubscribed
        isVerified
        isVerifiedArtist
      }
      videos {
        items {
          id
          title
          thumbnail
          durationSeconds
          publishedText
        }
      }
    }
    channelAbout(id: $id) {
      joinedDateText
    }
  }
`)

export type CommentProfileAuthor = {
  id: string
  name: string
  avatar?: string | null
  isVerified?: boolean | null
  isVerifiedArtist?: boolean | null
}

const GAP = 12
const EDGE = 8
const PREVIEW_VIDEOS = 3

const style = css`
  position: fixed;
  z-index: calc(var(--z-dialog) + 1);
  width: 34rem;
  max-width: calc(100vw - 1.6rem);
  max-height: calc(100vh - 1.6rem);
  max-height: calc(100dvh - 1.6rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.2rem;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg-menu);
  box-shadow: var(--shadow-menu);
  color: var(--text-primary);

  .banner {
    display: block;
    width: 100%;
    height: 5.6rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1.4rem 1.4rem 1rem;
  }

  .avatar {
    flex: none;
    width: 5.2rem;
    height: 5.2rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: 500;
  }

  .identity {
    flex: 1;
    min-width: 0;
  }

  .name-row {
    display: flex;
    align-items: center;
    font-size: 1.6rem;
    font-weight: 600;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .handle {
    margin-top: 0.1rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    margin-top: 0.3rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0 1.4rem 1.2rem;
  }

  .sub-btn,
  .view-channel {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 3.6rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.3rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .sub-btn {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .sub-btn:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .sub-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .sub-btn.subscribed {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .sub-btn.subscribed:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .view-channel {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .view-channel:hover {
    background: var(--bg-chip-hover);
  }

  .description {
    margin: 0 1.4rem 1.2rem;
    padding: 0;
    font-size: 1.2rem;
    line-height: 1.7rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .videos {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
    padding: 0 1.4rem 1.4rem;
  }

  .video {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    color: var(--text-primary);
    text-decoration: none;
  }

  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 0.6rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .duration {
    position: absolute;
    right: 0.4rem;
    bottom: 0.4rem;
    padding: 0 0.3rem;
    border-radius: 0.3rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5rem;
  }

  .video-title {
    font-size: 1.1rem;
    font-weight: 500;
    line-height: 1.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .note {
    margin: 0;
    padding: 0 1.4rem 1.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }
`

const placeBeside = (card: HTMLElement, anchor: HTMLElement) => {
  const box = anchor.getBoundingClientRect()
  const { clientWidth: vw, clientHeight: vh } = document.documentElement
  const width = card.offsetWidth
  const height = card.offsetHeight
  const rightSpace = vw - box.right - GAP - EDGE
  const leftSpace = box.left - GAP - EDGE
  const left = rightSpace >= width || rightSpace >= leftSpace
    ? Math.min(box.right + GAP, vw - width - EDGE)
    : Math.max(EDGE, box.left - width - GAP)
  const top = Math.max(EDGE, Math.min(box.top - 12, vh - height - EDGE))
  card.style.left = `${Math.max(EDGE, left)}px`
  card.style.top = `${top}px`
}

/**
 * Floating mini profile card shown when clicking a commenter avatar, displaying channel
 * handle, join date, subscriber count, subscription action, and a channel navigation link.
 */
export const CommentProfileCard = (
  { author, anchor, onClose }: {
    author: CommentProfileAuthor
    anchor: HTMLElement
    onClose: () => void
  },
) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const { fetching: subscribing, toggle } = useToggleSubscription()
  const [subscribedOverride, setSubscribedOverride] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    setSubscribedOverride(undefined)
  }, [author.id])

  const [{ data, error, fetching }] = useQuery({
    query: COMMENT_PROFILE_CARD_QUERY,
    variables: { id: author.id },
  })

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const update = () => {
      if (!anchor.isConnected) {
        onCloseRef.current()
        return
      }
      placeBeside(card, anchor)
    }
    update()
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update)
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(card)
    resizeObserver.observe(anchor)
    const mutationObserver = new MutationObserver(() => {
      if (!anchor.isConnected) onCloseRef.current()
    })
    if (document.body) mutationObserver.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const card = cardRef.current
      const target = event.target
      if (target instanceof Node && (card?.contains(target) || anchor.contains(target))) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      anchor.focus()
    }
    const onBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [anchor, onClose])

  const details = data?.channel.channel
  const avatar = details?.avatar ?? author.avatar
  const name = details?.name ?? author.name
  const handle = details?.handle
    ? details.handle.startsWith('@') ? details.handle : `@${details.handle}`
    : undefined
  const joinedDateText = data?.channelAbout?.joinedDateText
  const meta = [joinedDateText, details?.subscriberCountText]
    .filter((part): part is string => Boolean(part))
    .join(' • ')
  const badgeChannel = details ?? {
    isVerified: author.isVerified ?? false,
    isVerifiedArtist: author.isVerifiedArtist ?? false,
  }
  const rawSubscribed = subscribedOverride ?? details?.isSubscribed
  const isSubscribed = rawSubscribed === true
  const videos = (data?.channel.videos.items ?? []).slice(0, PREVIEW_VIDEOS)

  const onSubscribe = () => {
    if (subscribing || (fetching && !data)) return
    if (rawSubscribed === undefined || rawSubscribed === null) {
      signIn()
      return
    }
    void toggle(author.id, isSubscribed, restored => setSubscribedOverride(restored)).then((next) => {
      if (next !== undefined) setSubscribedOverride(next)
    })
  }

  return createPortal(
    <div
      ref={cardRef}
      css={style}
      role='dialog'
      aria-label={`${name} profile`}
      data-comment-profile-card={author.id}
    >
      {details?.banner ? <img className='banner' src={details.banner} alt='' referrerpolicy='no-referrer' /> : undefined}
      <div className='head'>
        {avatar
          ? <img className='avatar' src={avatar} alt='' referrerpolicy='no-referrer' />
          : <span className='avatar fallback' aria-hidden='true'>{name.slice(0, 1).toUpperCase()}</span>}
        <div className='identity'>
          <div className='name-row'>
            <span className='name-text'>{name}</span>
            <VerifiedBadge channel={badgeChannel} size={14} />
          </div>
          {handle ? <div className='handle'>{handle}</div> : undefined}
          {meta ? <div className='meta'>{meta}</div> : undefined}
        </div>
      </div>
      <div className='actions'>
        <button
          type='button'
          className={isSubscribed ? 'sub-btn subscribed' : 'sub-btn'}
          disabled={subscribing || (fetching && !data)}
          aria-pressed={isSubscribed}
          onClick={onSubscribe}
        >
          {isSubscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/channel/${author.id}`} className='view-channel' onClick={onClose}>
          View channel
        </Link>
      </div>
      {details?.description ? <p className='description'>{details.description}</p> : undefined}
      {error && !data
        ? <p className='note'>{lineFor(error)}</p>
        : videos.length > 0
          ? (
            <div className='videos'>
              {videos.map(video => {
                const duration = formatDuration(video.durationSeconds)
                return (
                  <Link key={video.id} href={watchHrefFor(video.id)} className='video' onClick={onClose}>
                    <div className='thumb'>
                      {video.thumbnail ? <Thumbnail src={video.thumbnail} /> : undefined}
                      {duration ? <span className='duration'>{duration}</span> : undefined}
                    </div>
                    <span className='video-title'>{video.title}</span>
                  </Link>
                )
              })}
            </div>
          )
          : undefined}
    </div>,
    document.body,
  )
}
