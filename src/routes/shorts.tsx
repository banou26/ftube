import type { ShortsFeedQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, MessageCircle, MonitorPlay, MoreVertical, Share2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useRoute } from 'wouter'

import { useDocumentTitle } from '../app'
import { Comments } from '../components/comments'
import { DataFailure } from '../components/data-failure'
import { formatCompact, safeDecode } from '../components/format'
import { RateGlyph, useRateVideo } from '../components/rate-video'
import ShareDialog from '../components/share-dialog'
import { shortsSequenceIn } from '../components/shorts-tile'
import SubscribeButton from '../components/subscribe-button'
import { Menu, MenuItem } from '../components/ui/menu'
import useInfiniteFeed from '../components/use-infinite-feed'
import { VerifiedBadge } from '../components/verified-badge'
import { useDislikes } from '../dislikes'
import { gql } from '../generated'
import { isTypingTarget } from '../player/controls'
import { shortsHrefFor } from '../player/links'
import ShortsPlayer from '../player/shorts-player'
import { closePlayer } from '../player/session'
import { useSession } from '../session'

const SHORTS_FEED_QUERY = gql(`
  query ShortsFeed($seed: ID, $sequence: String, $cursor: String) {
    shorts(seed: $seed, sequence: $sequence, cursor: $cursor) {
      items { id poster title }
      cursor
    }
  }
`)

const SHORT_META_QUERY = gql(`
  query ShortMeta($id: ID!) {
    watch(id: $id) {
      id
      title
      viewCountText
      likeCountText
      commentCountText
      likeStatus
      channel { id name avatar handle isSubscribed notificationLevel isVerified isVerifiedArtist }
    }
  }
`)

type ShortsPage = ShortsFeedQuery['shorts']

const style = css`
  /* Owns the viewport below the header: the pager scrolls itself rather than
     the document, so snapping is not fighting the page's own scroll. */
  height: calc(100vh - var(--header-height));
  overflow-y: auto;
  overflow-x: hidden;
  scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  .slide {
    height: 100%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.6rem;
    padding: 1.2rem 0;
  }

  /* A Short's video and its buttons, positioned so that below the breakpoint
     the buttons sit on that Short's video. Uses the full slide height below
     the header, matching youtube.com's Shorts stage (984px at 1440x1080). */
  .reel {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 1.6rem;
    height: 100%;
    max-width: 100%;
    flex: none;
  }

  /* The 9:16 box IS the player element, so the quality the player asks for is
     derived from the size the video is actually shown at. Sizing the element to
     the whole slide and letterboxing inside it would make it request a stream
     far larger than any pixel on screen. */
  .stage {
    position: relative;
    height: 100%;
    aspect-ratio: 9 / 16;
    max-width: calc(100vw - 10rem);
    flex: none;
  }

  .rail {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 1.6rem;
    padding-bottom: 0.4rem;
  }

  .rail-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.8rem;
    cursor: pointer;
  }

  .rail-button .glyph {
    display: grid;
    place-items: center;
    width: 4.8rem;
    height: 4.8rem;
    border-radius: 50%;
    background: var(--bg-chip);
    transition: background 0.15s ease, color 0.15s ease;
  }

  .rail-button:hover .glyph {
    background: var(--bg-chip-hover);
  }

  .rail-button.on .glyph {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .rail-channel {
    display: block;
    width: 4rem;
    height: 4rem;
    border-radius: 0.8rem;
    overflow: hidden;
    background: var(--bg-chip);
    border: 1px solid var(--border-subtle);
  }

  .rail-channel img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .meta {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 5.6rem 1.6rem 2.4rem;
    /* The scrubber owns the bottom edge, so this overlay must not swallow the
       pointer before it gets there. */
    pointer-events: none;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.38) 40%, rgba(0, 0, 0, 0.78));
    color: #fff;
  }

  .meta a,
  .meta button {
    pointer-events: auto;
  }

  .byline {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  .byline .avatar-link {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.18);
  }

  .byline .avatar-link img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .byline .name {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: #fff;
    font-size: 1.4rem;
    font-weight: 700;
    text-decoration: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }

  .short-title {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 1.9rem;
    /* Two lines, the way the Shorts overlay clamps: a long title otherwise
       covers the video it belongs to. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .views {
    margin: 0;
    font-size: 1.2rem;
    color: rgba(255, 255, 255, 0.8);
  }

  .comments-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 42rem;
    max-width: 100%;
    height: 100%;
    border-radius: 1.2rem;
    background: var(--bg-elevated, var(--bg-subtle));
    overflow: hidden;
  }

  .comments-scrim {
    display: none;
  }

  .comments-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .comments-title {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
  }

  .comments-count {
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .comments-panel .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 1.6rem 1.6rem;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .notice,
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 2.4rem;
    color: var(--text-secondary);
    font-size: 1.4rem;
    text-align: center;
  }

  .empty h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 2rem;
  }

  /* Fixed to the viewport's right edge, where youtube.com keeps them, rather
     than to a slide: the pager scrolls under them. */
  .pager {
    position: fixed;
    right: 2.4rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    z-index: 2;
  }

  .pager button {
    display: grid;
    place-items: center;
    width: 5.6rem;
    height: 5.6rem;
    border: none;
    border-radius: 50%;
    background: var(--bg-subtle);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pager button:hover:not(:disabled) {
    background: var(--bg-hover, var(--border-subtle));
  }

  .pager button:disabled {
    visibility: hidden;
  }

  /* With the comments open and a full-height stage, the slide reaches under the
     pager below this width, which would cover the comments. */
  @media (max-width: 1560px) {
    &.comments-open .pager {
      display: none;
    }
  }

  @media (max-width: 900px) {
    /* a wheel over the comments sheet's backdrop would otherwise move to the next Short */
    &.comments-open {
      overflow-y: hidden;
    }

    .stage {
      max-width: 100%;
    }

    .rail {
      /* Below the breakpoint the rail sits on top of the video, which is where
         it lives on a phone anyway. */
      position: absolute;
      right: 0.8rem;
      bottom: 2.0rem;
      gap: 1.0rem;
      padding: 0;
      z-index: 1;
    }

    .meta {
      padding: 4.8rem 6.4rem 2.0rem 1.2rem;
    }

    .rail-button {
      gap: 0.2rem;
      color: #fff;
      font-size: 1.2rem;
      line-height: 1.5rem;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    }

    .rail-button .glyph {
      width: 4.2rem;
      height: 4.2rem;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(0, 0, 0, 0.5);
      color: #fff;
    }

    .rail-button.on .glyph {
      border-color: transparent;
      background: #fff;
      color: #0f0f0f;
    }

    .rail-channel {
      width: 3.4rem;
      height: 3.4rem;
    }

    .pager {
      display: none;
    }

    /* A sheet over the Short, as youtube.com opens it at this width (measured
       2026-11-10): about three quarters of the height below the header, at
       most 48rem wide, closed by a tap beside it. */
    .comments-scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: var(--z-dialog);
      background: var(--bg-scrim);
    }

    .comments-panel {
      position: fixed;
      inset: calc(var(--header-height) + 11%) 0 10%;
      z-index: var(--z-dialog);
      width: auto;
      max-width: 48rem;
      height: auto;
      margin: 0 auto;
    }
  }
`

/**
 * One slide.
 *
 * Split out so the metadata query is scoped to the slide and unmounts with it:
 * a hook on the parent would have to key on the active id and would keep every
 * visited slide's data alive for the life of the route.
 */
const Slide = (
  { id, poster, fallbackTitle, active, preload, shortcutsDisabled, onReady, onComments, onShare, onCommentCount, onTitle, onRefused }: {
    id: string
    poster?: string | null
    fallbackTitle?: string | null
    active: boolean
    preload: boolean
    shortcutsDisabled?: boolean
    onReady?: (ready: boolean) => void
    onComments: () => void
    onShare: () => void
    onCommentCount?: (count?: string) => void
    onTitle?: (title?: string) => void
    onRefused?: () => void
  },
) => {
  const [, navigate] = useLocation()
  const [{ data }] = useQuery({
    query: SHORT_META_QUERY,
    variables: { id },
    pause: !active && !preload,
  })
  const meta = data?.watch
  const title = meta?.title || fallbackTitle || undefined
  const { rate, rating, presses, burst } = useRateVideo(id, meta?.likeStatus)
  const dislikes = useDislikes(active || preload ? id : '')
  const liked = meta?.likeStatus === 'LIKE'
  const disliked = meta?.likeStatus === 'DISLIKE'
  const handle = meta?.channel?.handle
    ? meta.channel.handle.startsWith('@') ? meta.channel.handle : `@${meta.channel.handle}`
    : undefined

  useEffect(() => {
    if (active) onCommentCount?.(meta?.commentCountText ?? undefined)
  }, [active, meta?.commentCountText, onCommentCount])

  useEffect(() => {
    if (active) onTitle?.(title)
  }, [active, title, onTitle])

  return (
    <div className='reel'>
      <div className='stage'>
        <ShortsPlayer
          videoId={id}
          poster={poster ?? undefined}
          active={active}
          preload={preload}
          shortcutsDisabled={shortcutsDisabled}
          onReady={onReady}
          onRefused={onRefused}
        />
        <div className='meta'>
          <div className='byline'>
            {meta?.channel?.avatar
              ? (
                <Link className='avatar-link' href={`/channel/${meta.channel.id}`} aria-label={meta.channel.name}>
                  <img src={meta.channel.avatar} alt='' loading='lazy' />
                </Link>
              )
              : undefined}
            {meta?.channel
              ? (
                <Link className='name' href={`/channel/${meta.channel.id}`}>
                  {handle ?? meta.channel.name}
                  <VerifiedBadge channel={meta.channel} size={14} />
                </Link>
              )
              : undefined}
            <SubscribeButton
              channelId={meta?.channel?.id}
              subscribed={meta?.channel?.isSubscribed}
              notificationLevel={meta?.channel?.notificationLevel}
            />
          </div>
          <p className='short-title'>{title ?? ''}</p>
          {meta?.viewCountText ? <p className='views'>{meta.viewCountText}</p> : undefined}
        </div>
      </div>
      <div className='rail'>
        <button
          type='button'
          className={liked ? 'rail-button on' : 'rail-button'}
          aria-pressed={liked}
          aria-label='Like'
          disabled={rating}
          onClick={() => rate('LIKE')}
        >
          <span className='glyph'>
            <RateGlyph status='LIKE' size={24} on={liked} presses={presses('LIKE')} burst={burst('LIKE')} />
          </span>
          {meta?.likeCountText ?? 'Like'}
        </button>
        <button
          type='button'
          className={disliked ? 'rail-button on' : 'rail-button'}
          aria-pressed={disliked}
          aria-label='Dislike'
          disabled={rating}
          onClick={() => rate('DISLIKE')}
        >
          <span className='glyph'>
            <RateGlyph status='DISLIKE' size={24} on={disliked} presses={presses('DISLIKE')} burst={burst('DISLIKE')} />
          </span>
          {dislikes !== undefined ? formatCompact(dislikes) : 'Dislike'}
        </button>
        <button type='button' className='rail-button' aria-label='Comments' onClick={onComments}>
          <span className='glyph'><MessageCircle size={24} strokeWidth={1.5} /></span>
          {meta?.commentCountText ?? 'Comments'}
        </button>
        <button type='button' className='rail-button' aria-label='Share' onClick={onShare}>
          <span className='glyph'><Share2 size={24} strokeWidth={1.5} /></span>
          Share
        </button>
        <Menu
          label='More actions'
          align='start'
          // the rail ends at the bottom of the video, so its menu opens upwards
          side='above'
          trigger={
            <button type='button' className='rail-button' aria-label='More actions'>
              <span className='glyph'><MoreVertical size={24} strokeWidth={1.5} /></span>
            </button>
          }
        >
          <MenuItem
            icon={MonitorPlay}
            label='Open in the full player'
            onSelect={() => navigate(`/watch?v=${encodeURIComponent(id)}`)}
          />
        </Menu>
        {meta?.channel?.avatar
          ? (
            <Link className='rail-channel' href={`/channel/${meta.channel.id}`} aria-label={meta.channel.name}>
              <img src={meta.channel.avatar} alt='' loading='lazy' />
            </Link>
          )
          : undefined}
      </div>
    </div>
  )
}

const ShortsPage = () => {
  const [, params] = useRoute('/shorts/:videoId')
  // frozen at mount: re-reading the param would refetch the whole sequence on every path rewrite the pager makes
  const [seed] = useState(() => (params?.videoId ? safeDecode(params.videoId) : undefined))
  const [sequence] = useState(() => shortsSequenceIn(history.state))
  const { ready } = useSession()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<ShortsPage[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(seed)
  const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showComments, setShowComments] = useState(false)
  const [activeCommentCount, setActiveCommentCount] = useState<string | undefined>(undefined)
  const [activeTitle, setActiveTitle] = useState<string | undefined>(undefined)
  const [sharing, setSharing] = useState<string | undefined>(undefined)
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())

  const setSlideReady = useCallback((id: string, isReady: boolean) => {
    setReadyIds(previous => {
      if (previous.has(id) === isReady) return previous
      const next = new Set(previous)
      if (isReady) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const [{ data, error, fetching }, reexecute] = useQuery({
    query: SHORTS_FEED_QUERY,
    variables: { seed, sequence, cursor: loaded[loaded.length - 1]?.cursor },
    pause: !ready,
  })
  const page = data?.shorts
  const { items: feed } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: short => short.id,
  })
  // a Short the address named stays to say why it does not play; any other YouTube refuses is passed over
  const items = feed.filter(short => !refused.has(short.id))
  const active = useMemo(() => items.find(short => short.id === activeId), [items, activeId])

  useDocumentTitle((active ? activeTitle : undefined) || 'Shorts')

  // the persistent player survives route changes, so leaving it alive would play two videos at once
  useEffect(() => closePlayer(), [])

  const onMore = useCallback(() => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }, [page, fetching, error])

  useEffect(() => {
    if (!activeId && items[0]) setActiveId(items[0].id)
  }, [items, activeId])

  // the threshold MUST stay over half, so exactly one slide can qualify as active
  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const id = (visible?.target as HTMLElement | undefined)?.dataset.shortId
        if (id) setActiveId(id)
      },
      { root, threshold: 0.6 },
    )
    for (const node of root.querySelectorAll('[data-short-id]')) observer.observe(node)
    return () => observer.disconnect()
  }, [items.length])

  useEffect(() => {
    const index = items.findIndex(short => short.id === activeId)
    if (index >= 0 && index >= items.length - 3) onMore()
  }, [activeId, items, onMore])

  useEffect(() => {
    if (!activeId) return
    const next = shortsHrefFor(activeId)
    if (location.pathname !== next) history.replaceState(null, '', next)
  }, [activeId])

  const activeIndex = items.findIndex(short => short.id === activeId)
  const step = (by: 1 | -1) => {
    const target = items[activeIndex + by]
    if (!target) return
    scrollerRef.current?.querySelector(`[data-short-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ behavior: 'smooth' })
  }

  const latest = useRef({ step, sharing })
  latest.current = { step, sharing }

  // on the document, so the keys work before anything on the page has been clicked
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (isTypingTarget(event.target) || latest.current.sharing) return
      event.preventDefault()
      latest.current.step(event.key === 'ArrowDown' ? 1 : -1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready || (fetching && items.length === 0)) {
    return <main css={style}><p className='notice'>Loading Shorts…</p></main>
  }

  if (error && items.length === 0) {
    return <main css={style}><DataFailure error={error} reexecute={reexecute} /></main>
  }

  if (items.length === 0) {
    return (
      <main css={style}>
        <div className='empty'>
          <h2>No Shorts right now</h2>
        </div>
      </main>
    )
  }

  const activeReady = Boolean(activeId && readyIds.has(activeId))

  return (
    <main css={style} className={showComments ? 'comments-open' : undefined} ref={scrollerRef}>
      {items.map((short, index) => {
        const isActive = short.id === activeId
        const isNext = activeIndex >= 0 && index === activeIndex + 1
        // gate starting a preload on active readiness so the current Short never competes for bandwidth, while keeping an already-loaded next slide warm after scrolling up
        const shouldPreload = isNext && (activeReady || readyIds.has(short.id))
        return (
          <section className='slide' key={short.id} data-short-id={short.id}>
            <Slide
              id={short.id}
              poster={short.poster}
              fallbackTitle={short.title}
              active={isActive}
              preload={shouldPreload}
              shortcutsDisabled={Boolean(sharing)}
              onReady={(isReady: boolean) => setSlideReady(short.id, isReady)}
              onComments={() => setShowComments(value => !value)}
              onShare={() => setSharing(short.id)}
              onCommentCount={setActiveCommentCount}
              onTitle={setActiveTitle}
              onRefused={short.id === seed ? undefined : () => setRefused(previous => new Set(previous).add(short.id))}
            />
            {showComments && isActive
              ? (
                <>
                  <div className='comments-scrim' onClick={() => setShowComments(false)} />
                  <aside className='comments-panel' aria-label='Comments'>
                    <header>
                      <span className='comments-title'>
                        Comments
                        {activeCommentCount ? <span className='comments-count'>{activeCommentCount}</span> : undefined}
                      </span>
                      <button type='button' className='icon-button' aria-label='Close comments' onClick={() => setShowComments(false)}>
                        <X size={24} strokeWidth={1.5} />
                      </button>
                    </header>
                    <div className='body'>
                      <Comments videoId={short.id} />
                    </div>
                  </aside>
                </>
              )
              : undefined}
          </section>
        )
      })}
      {sharing ? <ShareDialog videoId={sharing} title={items.find(short => short.id === sharing)?.title ?? undefined} short onClose={() => setSharing(undefined)} /> : undefined}
      {active === undefined && fetching ? <p className='notice'>Loading more…</p> : undefined}
      <div className='pager'>
        <button type='button' aria-label='Previous short' disabled={activeIndex <= 0} onClick={() => step(-1)}>
          <ChevronUp size={24} strokeWidth={1.5} />
        </button>
        <button type='button' aria-label='Next short' disabled={activeIndex >= items.length - 1} onClick={() => step(1)}>
          <ChevronDown size={24} strokeWidth={1.5} />
        </button>
      </div>
    </main>
  )
}

export default ShortsPage
