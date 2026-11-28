import type { ShortsFeedQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, MessageCircle, MoreVertical, Share2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useRoute } from 'wouter'

import { useDocumentTitle, useMediaQuery } from '../app'
import { Comments } from '../components/comments'
import { DataFailure } from '../components/data-failure'
import { dismissChannel, dismissVideo, undismissChannel, undismissVideo, useDismissed } from '../components/dismissed-videos'
import { formatCompact, safeDecode } from '../components/format'
import { RateGlyph, useRateVideo } from '../components/rate-video'
import { SaveDialog } from '../components/save-menu'
import ShareDialog from '../components/share-dialog'
import { shortsSequenceIn } from '../components/shorts-tile'
import SubscribeButton from '../components/subscribe-button'
import useInfiniteFeed from '../components/use-infinite-feed'
import { VerifiedBadge } from '../components/verified-badge'
import { useDislikes } from '../dislikes'
import { gql } from '../generated'
import { AmbientGlow } from '../player/ambient-glow'
import { isTypingTarget } from '../player/controls'
import { shortsHrefFor } from '../player/links'
import { prefetchPlayback } from '../player/prefetch'
import { ShortsDescriptionPanel, type ShortsMediaState, type ShortsMenuActions, ShortsOptionsMenu } from '../player/shorts-menu'
import ShortsPlayer, { type ShortsPlaybackSnapshot } from '../player/shorts-player'
import { playheadAt } from '../player/seek'
import { closePlayer, getPlayerSession, openPlayer, playerHost } from '../player/session'
import { useSetting } from '../settings'
import { showUndoableToast } from '../undo'

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
      shortViewCountText
      publishedDateText
      relativeDateText
      hashtags
      likeCountText
      commentCountText
      description
      descriptionRuns { text url videoId startSeconds browseId }
      likeStatus
      channel { id name avatar handle isSubscribed notificationLevel isVerified isVerifiedArtist }
    }
  }
`)

type ShortsPage = ShortsFeedQuery['shorts']

const style = css`
  --slide-pad: 1.2rem;
  --stage-height: calc(100vh - var(--header-height, 5.6rem) - var(--slide-pad) * 2);
  /* Owns the viewport below the header: the pager scrolls itself rather than
     the document, so snapping is not fighting the page's own scroll. */
  height: calc(100vh - var(--header-height, 5.6rem));
  overflow-y: auto;
  overflow-x: hidden;
  scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  .slide {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    box-sizing: border-box;
    height: 100%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.6rem;
    padding: var(--slide-pad) 0;
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
     far larger than any pixel on screen.
     Explicit width is derived from the slide's inner height so WebKit does not
     fall back to max-width when computing the flex width of .reel. */
  .stage {
    position: relative;
    height: 100%;
    width: min(calc(var(--stage-height) * 9 / 16), calc(100vw - 10rem));
    aspect-ratio: 9 / 16;
    max-width: calc(100vw - 10rem);
    flex: none;
  }

  .rail {
    position: relative;
    z-index: 1;
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
      width: min(calc(var(--stage-height) * 9 / 16), 100vw);
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

    .slide:not([data-active='true']) .comments-panel {
      display: none;
    }
  }

  .slide:not([data-active='true']) .rail {
    pointer-events: none;
  }

  /* Compact rail sizing when viewport height is tight so every action fits below the header without overflowing into adjacent slides. */
  @media (max-height: 560px) {
    --slide-pad: 0.6rem;

    .rail {
      gap: 0.4rem;
      bottom: 0.8rem;
      max-height: calc(100% - 1.2rem);
    }

    .rail-button {
      font-size: 1rem;
      line-height: 1.2rem;
    }

    .rail-button .glyph {
      width: 3.4rem;
      height: 3.4rem;
    }

    .rail-channel {
      width: 2.8rem;
      height: 2.8rem;
    }
  }

  /* Landscape phone viewports have plenty of horizontal room beside the 9:16 stage: lay the rail out in two short columns beside it. */
  @media (max-height: 560px) and (min-width: 500px) {
    .reel {
      gap: 1.2rem;
    }

    .stage {
      width: min(calc(var(--stage-height) * 9 / 16), calc(100vw - 15rem));
      max-width: calc(100vw - 15rem);
    }

    .meta {
      padding: 4.8rem 1.2rem 1.6rem;
    }

    .rail {
      position: relative;
      right: auto;
      bottom: auto;
      display: grid;
      grid-template-columns: repeat(2, minmax(5.2rem, auto));
      align-content: end;
      justify-items: center;
      gap: 0.8rem 1rem;
      padding-bottom: 0.4rem;
      max-height: 100%;
    }

    .rail-button {
      gap: 0.2rem;
      color: var(--text-primary);
      font-size: 1.1rem;
      line-height: 1.4rem;
      text-shadow: none;
    }

    .rail-button .glyph {
      width: 4rem;
      height: 4rem;
      border: none;
      background: var(--bg-chip);
      color: inherit;
    }

    .rail-button:hover .glyph {
      background: var(--bg-chip-hover);
    }

    .rail-button.on .glyph {
      background: var(--bg-inverse);
      color: var(--text-inverse);
    }

    .rail-channel {
      width: 3.6rem;
      height: 3.6rem;
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
type ActiveShortMeta = {
  id: string
  title?: string
  channelName?: string
  poster?: string
  video?: HTMLVideoElement | null
}

const Slide = (
  {
    id,
    poster,
    fallbackTitle,
    active,
    preload,
    initialTime,
    commentsOpen,
    shortcutsDisabled,
    descriptionOpen,
    onReady,
    onComments,
    onCloseComments,
    onShare,
    onDescription,
    onCloseDescription,
    onSave,
    onNotInterested,
    onDontRecommend,
    onMenuOpenChange,
    onTitle,
    onActiveMeta,
    onPlaybackChange,
    onRefused,
  }: {
    id: string
    poster?: string | null
    fallbackTitle?: string | null
    active: boolean
    preload: boolean
    initialTime?: number
    commentsOpen: boolean
    shortcutsDisabled?: boolean
    descriptionOpen: boolean
    onReady?: (ready: boolean) => void
    onComments: () => void
    onCloseComments: () => void
    onShare: () => void
    onDescription: () => void
    onCloseDescription: () => void
    onSave: () => void
    onNotInterested: () => void
    onDontRecommend: (channelId?: string, channelName?: string) => void
    onMenuOpenChange?: (open: boolean) => void
    onTitle?: (title?: string) => void
    onActiveMeta?: (meta: ActiveShortMeta) => void
    onPlaybackChange?: (snapshot: ShortsPlaybackSnapshot) => void
    onRefused?: () => void
  },
) => {
  const [, navigate] = useLocation()
  const ambientMode = useSetting('ambientMode')
  const [ambientVideo, setAmbientVideo] = useState<HTMLVideoElement | null>(null)
  const [mediaState, setMediaState] = useState<ShortsMediaState | undefined>(undefined)
  const commentsPanelRef = useRef<HTMLElement>(null)
  const [{ data }] = useQuery({
    query: SHORT_META_QUERY,
    variables: { id },
    pause: !active && !preload && !commentsOpen,
  })
  const meta = data?.watch
  const title = meta?.title || fallbackTitle || undefined
  const channelName = meta?.channel?.name?.trim() || undefined
  const { rate, rating, presses, burst } = useRateVideo(id, meta?.likeStatus)
  const dislikes = useDislikes(active || preload ? id : '')
  const liked = meta?.likeStatus === 'LIKE'
  const disliked = meta?.likeStatus === 'DISLIKE'
  const rawHandle = meta?.channel?.handle
  const handle = rawHandle
    ? rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`
    : undefined

  useLayoutEffect(() => {
    if (commentsPanelRef.current) commentsPanelRef.current.inert = !active
  }, [active, commentsOpen])

  useEffect(() => {
    if (!active) return
    onTitle?.(title)
    onActiveMeta?.({ id, title, channelName, poster: poster ?? undefined, video: ambientVideo })
  }, [active, id, title, channelName, poster, ambientVideo, onTitle, onActiveMeta])

  const menuActions = useMemo<ShortsMenuActions>(() => ({
    onDescription,
    onSave,
    onNotInterested,
    onDontRecommend: () => onDontRecommend(meta?.channel?.id, meta?.channel?.name),
    canDontRecommend: Boolean(meta?.channel?.id),
    onOpenFullPlayer: () => navigate(`/watch?v=${encodeURIComponent(id)}`),
  }), [id, meta?.channel?.id, meta?.channel?.name, navigate, onDescription, onDontRecommend, onNotInterested, onSave])

  return (
    <>
    <div className='reel'>
      <div className='stage'>
        <AmbientGlow
          video={ambientVideo}
          enabled={ambientMode && active}
          fullscreen={mediaState?.fullscreen ?? false}
          docked={false}
          placement='shorts'
        />
        <ShortsPlayer
          videoId={id}
          poster={poster ?? undefined}
          active={active}
          preload={preload}
          initialTime={initialTime}
          shortcutsDisabled={shortcutsDisabled}
          menuActions={menuActions}
          onMediaState={setMediaState}
          onVideoElement={setAmbientVideo}
          onPlaybackChange={onPlaybackChange}
          onMenuOpenChange={onMenuOpenChange}
          onReady={onReady}
          onRefused={onRefused}
        />
        {descriptionOpen && active
          ? (
            <ShortsDescriptionPanel
              videoId={id}
              title={title}
              channel={meta?.channel}
              likeCountText={meta?.likeCountText}
              viewCountText={meta?.viewCountText}
              shortViewCountText={meta?.shortViewCountText}
              publishedDateText={meta?.publishedDateText}
              relativeDateText={meta?.relativeDateText}
              description={meta?.description}
              descriptionRuns={meta?.descriptionRuns}
              hashtags={meta?.hashtags}
              hasAutoDubbed={Boolean(mediaState?.audioTracks.some(track => track.autoDubbed))}
              onClose={onCloseDescription}
            />
          )
          : undefined}
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
                  {meta.channel.name.trim() || handle}
                  <VerifiedBadge channel={meta.channel} size={14} />
                </Link>
              )
              : undefined}
            <SubscribeButton
              channelId={meta?.channel?.id}
              subscribed={meta?.channel?.isSubscribed}
              notificationLevel={meta?.channel?.notificationLevel}
              compact
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
        <ShortsOptionsMenu
          label='More actions'
          align='start'
          // the rail ends at the bottom of the video, so its menu opens upwards
          side='above'
          media={mediaState}
          actions={menuActions}
          onOpenChange={onMenuOpenChange}
          trigger={
            <button type='button' className='rail-button' aria-label='More actions'>
              <span className='glyph'><MoreVertical size={24} strokeWidth={1.5} /></span>
            </button>
          }
        />
        {meta?.channel?.avatar
          ? (
            <Link className='rail-channel' href={`/channel/${meta.channel.id}`} aria-label={meta.channel.name}>
              <img src={meta.channel.avatar} alt='' loading='lazy' />
            </Link>
          )
          : undefined}
      </div>
    </div>
    {commentsOpen && active
      ? <div className='comments-scrim' onClick={onCloseComments} />
      : undefined}
    {commentsOpen
      ? (
        <aside
          className='comments-panel'
          aria-label='Comments'
          aria-hidden={active ? undefined : true}
          ref={commentsPanelRef}
        >
          <Comments
            videoId={id}
            variant='compact'
            commentCountText={meta?.commentCountText}
            onClose={onCloseComments}
          />
        </aside>
      )
      : undefined}
    </>
  )
}

export const ShortsPage = () => {
  const [, params] = useRoute('/shorts/:videoId')
  // frozen at mount: re-reading the param would refetch the whole sequence on every path rewrite the pager makes
  const [seed] = useState(() => (params?.videoId ? safeDecode(params.videoId) : undefined))
  const [sequence] = useState(() => shortsSequenceIn(history.state))
  if (seed) prefetchPlayback(seed)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Capture the docked Short's resume position before closing the persistent player below.
  const [resumeTime] = useState<number | undefined>(() => {
    const current = getPlayerSession()
    if (current.kind !== 'short' || !current.videoId) return undefined
    if (seed && current.videoId !== seed) return undefined
    const playhead = playheadAt(current.videoId)
    if (playhead !== undefined && playhead > 0) return playhead
    const dockedVideo = playerHost().querySelector('video')
    if (dockedVideo && Number.isFinite(dockedVideo.currentTime) && dockedVideo.currentTime > 0) {
      return dockedVideo.currentTime
    }
    return current.startAt
  })
  const [loaded, setLoaded] = useState<ShortsPage[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(seed)
  const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showComments, setShowComments] = useState(false)
  const narrowViewport = useMediaQuery('(max-width: 900px)')
  const closeComments = useCallback(() => setShowComments(false), [])
  const [activeTitle, setActiveTitle] = useState<string | undefined>(undefined)
  const [sharing, setSharing] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState<string | undefined>(undefined)
  const [descriptionFor, setDescriptionFor] = useState<string | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())
  const [dismissedInSession, setDismissedInSession] = useState<ReadonlySet<string>>(() => new Set())
  const dismissed = useDismissed()

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
  })
  const page = data?.shorts
  const { items: feed } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: short => short.id,
  })
  // When the URL already names a seed Short, mount its slide immediately instead of waiting on the sequence query;
  // once the feed arrives it keeps the same key so ShortsPlayer and SHORT_META_QUERY never remount.
  const seeded = useMemo(() => {
    if (!seed || feed.some(short => short.id === seed)) return feed
    return [{ id: seed, poster: null, title: null }, ...feed]
  }, [seed, feed])
  // a Short the address named stays to say why it does not play unless dismissed in this session
  const items = seeded.filter(short =>
    !refused.has(short.id)
    && !dismissedInSession.has(short.id)
    && (short.id === seed || !dismissed.videos.has(short.id)),
  )
  const active = useMemo(() => items.find(short => short.id === activeId), [items, activeId])

  const hideSlide = useCallback((id: string) => {
    setDismissedInSession(previous => new Set(previous).add(id))
    setDescriptionFor(current => (current === id ? undefined : current))
  }, [])

  const restoreSlide = useCallback((id: string) => {
    setDismissedInSession(previous => {
      if (!previous.has(id)) return previous
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    setActiveId(id)
  }, [])

  const handleNotInterested = useCallback((id: string, shortTitle?: string | null) => {
    dismissVideo(id)
    hideSlide(id)
    showUndoableToast('Video removed', {
      label: shortTitle ? `Remove ${shortTitle}` : 'Remove video',
      undo: () => {
        undismissVideo(id)
        restoreSlide(id)
      },
      undoneMessage: 'Video restored',
    })
  }, [hideSlide, restoreSlide])

  const handleDontRecommend = useCallback((id: string, channelId?: string, channelName?: string) => {
    if (!channelId) return
    // The Shorts sequence feed only returns { id, poster, title } without channel ids, so dismissChannel applies across other feeds while hideSlide removes this slide immediately.
    dismissChannel(channelId)
    hideSlide(id)
    const message = channelName ? `We won't recommend ${channelName}` : "We won't recommend this channel"
    showUndoableToast(message, {
      label: message,
      undo: () => {
        undismissChannel(channelId)
        restoreSlide(id)
      },
      undoneMessage: channelName ? `Restored ${channelName}` : 'Channel restored',
    })
  }, [hideSlide, restoreSlide])

  useDocumentTitle((active ? activeTitle : undefined) || 'Shorts')

  const activePlaybackRef = useRef<{
    id: string
    title?: string
    channelName?: string
    poster?: string
    video?: HTMLVideoElement | null
    currentTime: number
    playing: boolean
  } | undefined>(undefined)

  useEffect(() => {
    if (!activeId) return
    if (activePlaybackRef.current?.id !== activeId) {
      activePlaybackRef.current = {
        id: activeId,
        title: active?.title ?? undefined,
        poster: active?.poster ?? undefined,
        currentTime: 0,
        playing: false,
      }
    }
  }, [activeId, active?.title, active?.poster])

  const onActiveMeta = useCallback((meta: ActiveShortMeta) => {
    const prev = activePlaybackRef.current
    activePlaybackRef.current = {
      id: meta.id,
      title: meta.title ?? (prev?.id === meta.id ? prev.title : undefined),
      channelName: meta.channelName ?? (prev?.id === meta.id ? prev.channelName : undefined),
      poster: meta.poster ?? (prev?.id === meta.id ? prev.poster : undefined),
      video: meta.video ?? (prev?.id === meta.id ? prev.video : undefined),
      currentTime: prev?.id === meta.id ? prev.currentTime : 0,
      playing: prev?.id === meta.id ? prev.playing : false,
    }
  }, [])

  const onPlaybackSnapshot = useCallback((snapshot: ShortsPlaybackSnapshot) => {
    if (snapshot.videoId !== activeIdRef.current) return
    const prev = activePlaybackRef.current
    activePlaybackRef.current = {
      id: snapshot.videoId,
      title: prev?.id === snapshot.videoId ? prev.title : undefined,
      channelName: prev?.id === snapshot.videoId ? prev.channelName : undefined,
      poster: prev?.id === snapshot.videoId ? prev.poster : undefined,
      video: prev?.id === snapshot.videoId ? prev.video : undefined,
      currentTime: snapshot.currentTime,
      playing: snapshot.playing,
    }
  }, [])

  // the persistent player survives route changes, so leaving it alive would play two videos at once
  useEffect(() => closePlayer(), [])

  // Hand off an actively playing Short into a vertical miniplayer when navigating away from /shorts (except to /watch).
  useLayoutEffect(() => () => {
    const dest = window.location.pathname
    if (dest.startsWith('/watch') || dest.startsWith('/shorts')) return
    const snap = activePlaybackRef.current
    if (!snap) return
    const livePlaying = snap.video ? (!snap.video.paused && !snap.video.ended) : snap.playing
    if (!livePlaying) return
    const liveTime = snap.video && Number.isFinite(snap.video.currentTime) && snap.video.currentTime > 0
      ? snap.video.currentTime
      : snap.currentTime
    openPlayer({
      videoId: snap.id,
      startAt: liveTime > 0 ? liveTime : undefined,
      title: snap.title,
      channelName: snap.channelName,
      poster: snap.poster,
      kind: 'short',
    })
  }, [])

  const onMore = useCallback(() => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }, [page, fetching, error])

  useEffect(() => {
    if ((!activeId || !items.some(short => short.id === activeId)) && items[0]) {
      setActiveId(items[0].id)
    }
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
    setDescriptionFor(undefined)
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    const next = shortsHrefFor(activeId)
    if (location.pathname !== next) history.replaceState(null, '', next)
  }, [activeId])

  const activeIndex = items.findIndex(short => short.id === activeId)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  useEffect(() => {
    const root = scrollerRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    let lastHeight = root.clientHeight
    const observer = new ResizeObserver(() => {
      const nextHeight = root.clientHeight
      if (nextHeight <= 0 || nextHeight === lastHeight) return
      lastHeight = nextHeight
      const id = activeIdRef.current
      if (!id) return
      const slide = root.querySelector<HTMLElement>(`[data-short-id="${CSS.escape(id)}"]`)
      if (!slide) return
      const delta = slide.getBoundingClientRect().top - root.getBoundingClientRect().top
      if (Math.abs(delta) > 1) root.scrollTo({ top: root.scrollTop + delta, behavior: 'instant' })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [items.length])
  const step = (by: 1 | -1) => {
    const target = items[activeIndex + by]
    if (!target) return
    scrollerRef.current?.querySelector(`[data-short-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ behavior: 'smooth' })
  }

  const descriptionOpen = Boolean(activeId && descriptionFor === activeId)
  const overlayOpen = Boolean(sharing || saving || descriptionOpen || menuOpen)
  const latest = useRef({ step, overlayOpen })
  latest.current = { step, overlayOpen }

  // on the document, so the keys work before anything on the page has been clicked
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (isTypingTarget(event.target) || latest.current.overlayOpen) return
      event.preventDefault()
      latest.current.step(event.key === 'ArrowDown' ? 1 : -1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (fetching && items.length === 0) {
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
        const isAdjacent = activeIndex >= 0 && Math.abs(index - activeIndex) === 1
        // gate starting a preload on active readiness so the current Short never competes for bandwidth, while keeping an already-loaded next slide warm after scrolling up
        const shouldPreload = isNext && (activeReady || readyIds.has(short.id))
        const commentsOpen = showComments && (isActive || (!narrowViewport && isAdjacent))
        return (
          <section className='slide' key={short.id} data-short-id={short.id} data-active={isActive ? 'true' : undefined}>
            <Slide
              id={short.id}
              poster={short.poster}
              fallbackTitle={short.title}
              active={isActive}
              preload={shouldPreload}
              initialTime={short.id === seed ? resumeTime : undefined}
              commentsOpen={commentsOpen}
              shortcutsDisabled={overlayOpen}
              descriptionOpen={isActive && descriptionOpen}
              onReady={(isReady: boolean) => setSlideReady(short.id, isReady)}
              onComments={() => setShowComments(value => !value)}
              onCloseComments={closeComments}
              onShare={() => setSharing(short.id)}
              onDescription={() => setDescriptionFor(current => (current === short.id ? undefined : short.id))}
              onCloseDescription={() => setDescriptionFor(undefined)}
              onSave={() => setSaving(short.id)}
              onNotInterested={() => handleNotInterested(short.id, short.title)}
              onDontRecommend={(channelId?: string, channelName?: string) =>
                handleDontRecommend(short.id, channelId, channelName)}
              onMenuOpenChange={setMenuOpen}
              onTitle={setActiveTitle}
              onActiveMeta={onActiveMeta}
              onPlaybackChange={onPlaybackSnapshot}
              onRefused={short.id === seed ? undefined : () => setRefused(previous => new Set(previous).add(short.id))}
            />
          </section>
        )
      })}
      {sharing ? <ShareDialog videoId={sharing} title={items.find(short => short.id === sharing)?.title ?? undefined} short onClose={() => setSharing(undefined)} /> : undefined}
      {saving ? <SaveDialog videoId={saving} onClose={() => setSaving(undefined)} /> : undefined}
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
