import type { GroupChannel } from '../groups/store'

import { css } from '@emotion/react'
import { createPortal } from 'preact/compat'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { formatDuration } from './format'
import { Thumbnail } from './thumbnail'
import { VerifiedBadge } from './verified-badge'
import { watchHrefFor } from './video-card'

const CHANNEL_PREVIEW_QUERY = gql(`
  query ChannelPreview($id: ID!) {
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
        isVerified
        isVerifiedArtist
      }
      videos {
        items {
          id
          title
          thumbnail
          durationSeconds
          viewCount
          publishedText
        }
      }
    }
  }
`)

const GAP = 12
const EDGE = 8
const PREVIEW_VIDEOS = 3

const style = css`
  position: fixed;
  z-index: calc(var(--z-dialog) + 1);
  width: 36rem;
  max-width: calc(100vw - 1.6rem);
  border: 1px solid var(--border-subtle);
  border-radius: 1.2rem;
  overflow: hidden;
  background: var(--bg-menu);
  box-shadow: var(--shadow-menu);
  color: var(--text-primary);

  .banner {
    display: block;
    width: 100%;
    height: 6.4rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1.2rem 1.4rem 0.8rem;
  }

  .avatar {
    flex: none;
    width: 4.4rem;
    height: 4.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    font-weight: 500;
  }

  .identity {
    flex: 1;
    min-width: 0;
  }

  .name {
    display: flex;
    align-items: center;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 2rem;
    color: var(--text-primary);
  }

  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .description {
    margin: 0;
    padding: 0 1.4rem 1rem;
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
    padding: 0.4rem 1.4rem 1.4rem;
  }

  .video {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    color: var(--text-primary);
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

  .video-age {
    font-size: 1rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skeleton-bar {
    height: 1.2rem;
    border-radius: 0.3rem;
    background: var(--bg-elevated);
  }

  .skeleton-bar.short {
    width: 65%;
  }

  .note {
    margin: 0;
    padding: 0 1.4rem 1.4rem;
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
 * Floating preview card of a channel's page (banner, stats, description and latest videos), anchored beside `anchor`
 * and portalled onto `document.body` so dialogs cannot clip it.
 */
export const ChannelPreviewCard = (
  { channel, anchor, onPointerEnter, onPointerLeave, onNavigate }: {
    channel: GroupChannel
    anchor: HTMLElement
    onPointerEnter: () => void
    onPointerLeave: () => void
    onNavigate: (event: MouseEvent) => void
  },
) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [{ data, error, fetching }] = useQuery({
    query: CHANNEL_PREVIEW_QUERY,
    variables: { id: channel.id },
  })

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const update = () => placeBeside(card, anchor)
    update()
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    observer.observe(card)
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [anchor])

  const details = data?.channel.channel
  const avatar = details?.avatar ?? channel.avatar
  const name = details?.name ?? channel.name
  const handle = details?.handle
    ? details.handle.startsWith('@') ? details.handle : `@${details.handle}`
    : undefined
  const meta = [handle, details?.subscriberCountText, details?.videoCountText]
    .filter((part): part is string => Boolean(part))
    .join(' • ')
  const videos = (data?.channel.videos.items ?? []).slice(0, PREVIEW_VIDEOS)

  return createPortal(
    <div
      ref={cardRef}
      css={style}
      role='region'
      aria-label={`${name} preview`}
      data-channel-preview={channel.id}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {details?.banner ? <img className='banner' src={details.banner} alt='' referrerpolicy='no-referrer' /> : undefined}
      <div className='head'>
        {avatar
          ? <img className='avatar' src={avatar} alt='' referrerpolicy='no-referrer' />
          : <span className='avatar fallback' aria-hidden='true'>{name.slice(0, 1).toUpperCase()}</span>}
        <div className='identity'>
          <Link href={`/channel/${channel.id}`} className='name' onClick={onNavigate}>
            <span className='name-text'>{name}</span>
            {details ? <VerifiedBadge channel={details} size={14} /> : undefined}
          </Link>
          {meta ? <div className='meta'>{meta}</div> : undefined}
        </div>
      </div>
      {details?.description ? <p className='description'>{details.description}</p> : undefined}
      {fetching && !data
        ? (
          <div className='videos' aria-hidden='true'>
            {[0, 1, 2].map(index => (
              <div key={index} className='video'>
                <div className='thumb' />
                <div className='skeleton-bar' />
                <div className='skeleton-bar short' />
              </div>
            ))}
          </div>
        )
        : error && !data
          ? <p className='note'>Could not load preview</p>
          : videos.length > 0
            ? (
              <div className='videos'>
                {videos.map(video => {
                  const duration = formatDuration(video.durationSeconds)
                  return (
                    <Link key={video.id} href={watchHrefFor(video.id)} className='video' onClick={onNavigate}>
                      <div className='thumb'>
                        {video.thumbnail ? <Thumbnail src={video.thumbnail} /> : undefined}
                        {duration ? <span className='duration'>{duration}</span> : undefined}
                      </div>
                      <span className='video-title'>{video.title}</span>
                      {video.publishedText ? <span className='video-age'>{video.publishedText}</span> : undefined}
                    </Link>
                  )
                })}
              </div>
            )
            : <p className='note'>No videos yet</p>}
    </div>,
    document.body,
  )
}
