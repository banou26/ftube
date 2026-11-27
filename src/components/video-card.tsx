import type { FeedLayoutMode, ThumbnailPosition } from '../feeds/settings'
import type { Channel, SavePlaylistsQuery, Video } from '../generated/graphql'
import type { CollaborationData } from './byline'

import { css } from '@emotion/react'
import { Ban, Check, ChevronLeft, CircleMinus, Clock, Download, EllipsisVertical, ListPlus, ListVideo, Share2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery, useClient } from 'urql'
import { Link } from 'wouter'

// reuses save-menu.tsx's documents rather than a second gql() copy: two operations cannot share a name
import { gql } from '../generated'
import { AddToPlaylistDocument, SavePlaylistsDocument } from '../generated/graphql'
import { openDownloadDialog } from '../downloads/store'
import { cardState } from '../player/card-params'
import { HoverPreview } from '../player/hover-preview'
import { shortsHrefFor, shortsLink } from '../player/links'
import { appendQueueEntry, removeFromQueueById } from '../player/queue'
import { getPlayerSession, openPlayer } from '../player/session'
import { useSession } from '../session'
import { showUndoableToast } from '../undo'
import { AvatarStack, BylineNames, CollaboratorsButton } from './byline'
import { useCardHover } from './card-hover-tint'
import { lineFor, MenuDataFailure } from './data-failure'
import { dismissChannel, dismissVideo, undismissChannel, undismissVideo } from './dismissed-videos'
import { formatDuration, rowByline } from './format'
import { WATCH_LATER_ID } from './playlist'
import { CornerBadge, MembersOnly, MusicNote, RowMeta, ShortsMark } from './row-marks'
import { Thumbnail } from './thumbnail'
import { Menu, MenuItem, MenuSeparator } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'
import { VerifiedBadge } from './verified-badge'
import { signIn } from '../sign-in'

export type VideoCardData =
  Pick<Video, 'id' | 'title'>
  & Partial<
    Pick<
      Video,
      | 'animatedThumbnail'
      | 'badges'
      | 'description'
      | 'descriptionSnippet'
      | 'durationSeconds'
      | 'dontRecommendToken'
      | 'inlinePlayerParams'
      | 'isMembersOnly'
      | 'isMostRelevant'
      | 'isMusic'
      | 'metaDelimiter'
      | 'notInterestedToken'
      | 'progressPercent'
      | 'publishedText'
      | 'shortsSequence'
      | 'thumbnail'
      | 'thumbnailBadge'
      | 'thumbnailSrcset'
      | 'viewCount'
      | 'viewCountIcon'
    >
  >
  & {
    isLive?: boolean | null
    isShort?: boolean | null
    isUpcoming?: boolean | null
    channel?: (Pick<Channel, 'id' | 'name'> & Partial<Pick<Channel, 'avatar' | 'isVerified' | 'isVerifiedArtist'>>) | null
  }
  & CollaborationData

/**
 * The playlist a link is being followed from, so /watch opens the queue the
 * reader was already looking at instead of the video on its own.
 *
 * `index` is 1-based, matching PlaylistItem.index and upstream's own links. It
 * is optional even when `list` is set: the server resolves the position from
 * the video id, and a list that has shifted since the page was rendered would
 * otherwise open on the wrong row.
 */
export type WatchContext = { list?: string, index?: number }

export const watchHrefFor = (videoId: string, context?: WatchContext) => {
  const params = new URLSearchParams({ v: videoId })
  if (context?.list !== undefined && context.list.length > 0) {
    params.set('list', context.list)
    if (context.index !== undefined && Number.isFinite(context.index)) {
      params.set('index', String(context.index))
    }
  }
  return `/watch?${params}`
}

// upstream progress is a rounded percentage that can read slightly over 100
export const resumePercent = (progressPercent?: number | null) =>
  progressPercent !== undefined && progressPercent !== null && progressPercent > 0
    ? Math.min(progressPercent, 100)
    : undefined

type PlaylistsPage = SavePlaylistsQuery['playlists']

const menuPanelStyle = css`
  min-width: 24rem;
`

const SUBMIT_FEEDBACK = gql(`
  mutation SubmitFeedback($token: String!) {
    submitFeedback(token: $token)
  }
`)

type CardMenuView = 'root' | 'playlists'

/**
 * The card overflow menu's contents.
 *
 * Split from the trigger because Menu mounts its children only while the panel
 * is open, and a feed renders dozens of cards: the session probe, the library
 * query and the mutation all live here so a closed menu costs nothing but the
 * button. The one thing that has to outlive the panel is which playlists this
 * video has already been put into, so that state sits with the trigger.
 */
const CardMenuPanel = (
  {
    videoId, title, thumbnail, durationSeconds, channel,
    notInterestedToken, dontRecommendToken, recommendable,
    short, live, saved, onSaved,
  }: {
    videoId: string
    title: string
    thumbnail?: string | null
    durationSeconds?: number | null
    channel?: { id: string, name: string } | null
    notInterestedToken?: string | null
    dontRecommendToken?: string | null
    recommendable: boolean
    short: boolean
    live: boolean
    saved: string[]
    onSaved: (playlistId: string) => void
  },
) => {
  const { ready, signedIn } = useSession()
  const [view, setView] = useState<CardMenuView>('root')
  const [wanted, setWanted] = useState(false)
  const [loaded, setLoaded] = useState<PlaylistsPage[]>([])
  const [pending, setPending] = useState<string | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement>(null)
  // Menu moves focus onto a row only when the panel OPENS, so this covers the swap
  const shown = useRef(view)

  useLayoutEffect(() => {
    if (shown.current === view) return
    shown.current = view
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus()
  }, [view])

  const [{ data, error, fetching }, reexecute] = useQuery({
    query: SavePlaylistsDocument,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !wanted || !ready || !signedIn,
  })
  const client = useClient()
  const [, addToPlaylist] = useMutation(AddToPlaylistDocument)

  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: playlist => playlist.id,
  })
  const rows = items.filter(playlist => playlist.id !== WATCH_LATER_ID)

  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page])
  }

  const save = (playlistId: string, label: string) => {
    if (pending !== undefined || saved.includes(playlistId)) return
    setPending(playlistId)
    void addToPlaylist({ playlistId, videoIds: [videoId] }).then((result) => {
      setPending(undefined)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      onSaved(playlistId)
      showToast(`Saved to ${label}`)
    })
  }

  const onShare = () => {
    // deliberately without the playlist context: a shared link opens the video, not a queue
    const url = short ? shortsLink(location.origin, videoId) : `${location.origin}${watchHrefFor(videoId)}`
    const clipboard = navigator.clipboard
    if (!clipboard) {
      showToast('Could not copy the link')
      return
    }
    void clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy the link'),
    )
  }

  const onAddToQueue = () => {
    const added = appendQueueEntry({
      id: videoId,
      title,
      thumbnail,
      durationSeconds,
      channel,
    })
    const idle = !getPlayerSession().videoId
    if (idle) openPlayer({ videoId, title, poster: thumbnail ?? undefined })
    if (added) {
      showUndoableToast('Added to queue', {
        label: `Add ${title} to queue`,
        undo: () => removeFromQueueById(videoId),
        undoneMessage: 'Removed from queue',
      })
    } else {
      showToast(idle ? 'Playing from queue' : 'Already in queue')
    }
  }

  const onNotInterested = () => {
    dismissVideo(videoId)
    const token = signedIn ? notInterestedToken : undefined
    showUndoableToast('Video removed', {
      label: `Remove ${title}`,
      undo: () => undismissVideo(videoId),
      undoneMessage: 'Video restored',
      ...(token
        ? {
            onCommit: () => {
              // VideoCard unmounts immediately once dismissVideo hides the card, so client.mutation must outlive hook state.
              void client.mutation(SUBMIT_FEEDBACK, { token }).toPromise().then((result) => {
                if (result.error) showToast(lineFor(result.error))
              })
            },
          }
        : {}),
    })
  }

  const onDontRecommend = () => {
    const channelId = channel?.id
    if (channelId) dismissChannel(channelId)
    const token = signedIn ? dontRecommendToken : undefined
    const sendFeedback = () => {
      if (!token) return
      void client.mutation(SUBMIT_FEEDBACK, { token }).toPromise().then((result) => {
        if (result.error) showToast(lineFor(result.error))
      })
    }
    const message = channel?.name ? `We won't recommend ${channel.name}` : "We won't recommend this channel"
    if (channelId) {
      showUndoableToast(message, {
        label: message,
        undo: () => undismissChannel(channelId),
        undoneMessage: channel?.name ? `Restored ${channel.name}` : 'Channel restored',
        ...(token ? { onCommit: sendFeedback } : {}),
      })
    } else {
      sendFeedback()
      showToast(message)
    }
  }

  const savedWatchLater = saved.includes(WATCH_LATER_ID)
  const showDontRecommend = recommendable && !short && Boolean(channel?.id || dontRecommendToken)

  return (
    <div css={menuPanelStyle} role='presentation' ref={panelRef}>
      {view === 'root'
        ? (
          <>
            {!short ? <MenuItem icon={ListVideo} label='Add to queue' onSelect={onAddToQueue} /> : undefined}
            <MenuItem
              icon={savedWatchLater ? Check : Clock}
              label={savedWatchLater ? 'Saved to Watch later' : 'Save to Watch later'}
              disabled={!ready || pending !== undefined || savedWatchLater}
              onSelect={() => {
                if (!signedIn) {
                  signIn()
                  return
                }
                save(WATCH_LATER_ID, 'Watch later')
              }}
            />
            <MenuItem
              icon={ListPlus}
              label='Save to playlist'
              disabled={!ready}
              closeOnSelect={false}
              onSelect={() => {
                if (!signedIn) {
                  signIn()
                  return
                }
                setWanted(true)
                setView('playlists')
              }}
            />
            <MenuSeparator />
            {!live
              ? (
                <MenuItem
                  icon={Download}
                  label='Download'
                  onSelect={() => openDownloadDialog({
                    videoId,
                    title,
                    thumbnail,
                    channelName: channel?.name,
                  })}
                />
              )
              : undefined}
            <MenuItem icon={Share2} label='Share' onSelect={onShare} />
            {recommendable && !short
              ? (
                <>
                  <MenuSeparator />
                  <MenuItem icon={Ban} label='Not interested' onSelect={onNotInterested} />
                  {showDontRecommend
                    ? <MenuItem icon={CircleMinus} label="Don't recommend channel" onSelect={onDontRecommend} />
                    : undefined}
                </>
              )
              : undefined}
          </>
        )
        : (
          <>
            <MenuItem icon={ChevronLeft} label='Back' closeOnSelect={false} onSelect={() => setView('root')} />
            <MenuSeparator />
            {/* No visibility icon: SavePlaylists cannot select a privacy without writing nulls over the cached entity */}
            {rows.map(playlist => (
              <MenuItem
                key={playlist.id}
                label={playlist.title}
                detail={playlist.videoCountText ?? undefined}
                checked={saved.includes(playlist.id)}
                disabled={pending !== undefined || saved.includes(playlist.id)}
                onSelect={() => save(playlist.id, playlist.title)}
              />
            ))}
            {fetching && rows.length === 0 ? <MenuItem label='Loading…' disabled /> : undefined}
            {!fetching && !error && rows.length === 0
              ? <MenuItem label='No playlists yet' disabled />
              : undefined}
            {error && !fetching ? <MenuDataFailure error={error} reexecute={reexecute} /> : undefined}
            {cursor && !error
              ? (
                <MenuItem
                  label={fetching ? 'Loading more…' : 'Show more'}
                  disabled={fetching}
                  closeOnSelect={false}
                  onSelect={onMore}
                />
              )
              : undefined}
          </>
        )}
    </div>
  )
}

/**
 * The overflow menu both card layouts hang off their `.more` button.
 *
 * `iconSize` is the only thing that differs between them: the compact card's
 * button is 2.4rem where the grid card's is 3.6rem, and an icon sized for one
 * looks wrong in the other. A Shorts tile sets `short`, so Share copies a /shorts/ link as youtube.com's does.
 */
export const VideoCardMenu = (
  {
    videoId, title, thumbnail, durationSeconds, channel,
    notInterestedToken, dontRecommendToken, recommendable = false,
    iconSize = 20, short = false, live = false, class: className,
  }: {
    videoId: string
    title: string
    thumbnail?: string | null
    durationSeconds?: number | null
    channel?: { id: string, name: string } | null
    notInterestedToken?: string | null
    dontRecommendToken?: string | null
    recommendable?: boolean
    iconSize?: number
    short?: boolean
    live?: boolean
    class?: string
  },
) => {
  const [saved, setSaved] = useState<string[]>([])

  return (
    <Menu
      class={className}
      label={`More actions for ${title}`}
      // youtube.com opens a card's menu rightwards from the button, and leftwards only where that leaves the viewport
      align='start'
      trigger={
        <button type='button' className='more' aria-label={`More actions for ${title}`}>
          <EllipsisVertical size={iconSize} fill='currentColor' strokeWidth={2} />
        </button>
      }
    >
      <CardMenuPanel
        videoId={videoId}
        title={title}
        thumbnail={thumbnail}
        durationSeconds={durationSeconds}
        channel={channel}
        notInterestedToken={notInterestedToken}
        dontRecommendToken={dontRecommendToken}
        recommendable={recommendable}
        short={short}
        live={live}
        saved={saved}
        onSaved={(playlistId: string) => setSaved(ids => ids.includes(playlistId) ? ids : [...ids, playlistId])}
      />
    </Menu>
  )
}

const style = css`
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-width: 0;

  &::before {
    content: '';
    position: absolute;
    inset: var(--card-hover-inset, -0.8rem);
    z-index: -1;
    border-radius: var(--card-hover-radius, 1.6rem);
    background: transparent;
    pointer-events: none;
    transition: background-color 0.15s ease;
  }

  &.shelf::before,
  &.carousel::before {
    inset: 0;
    border-radius: 1.2rem;
  }

  @media (hover: hover) {
    &:hover::before {
      background: var(--card-hover-bg, var(--bg-hover));
    }
  }

  &:has(:focus-visible)::before {
    background: var(--card-hover-bg, var(--bg-hover));
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      transition: none;
    }
  }

  .thumb {
    position: relative;
    display: block;
    width: var(--feed-grid-thumb-width, 100%);
    aspect-ratio: 16 / 9;
    border-radius: var(--feed-thumb-radius, 1.2rem);
    overflow: hidden;
    background: var(--bg-elevated);
  }

  &.thumb-end:not(.list) {
    flex-direction: column-reverse;
    gap: 1.2rem;
  }

  &.thumb-end:not(.list) .details {
    margin-top: 0;
  }

  /* Stationary on hover: no scale lift under the pointer. */

  /* Shorts are vertical, and a 16/9 box would letterbox one into a slot mostly
     made of background. The card keeps its grid column and only the thumbnail
     changes shape, so the surrounding layout is untouched. */
  &.short .thumb {
    aspect-ratio: 9 / 16;
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb img.moving {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .badge {
    position: absolute;
    right: 0.6rem;
    bottom: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
  }

  .badge.live {
    background: var(--brand);
    text-transform: uppercase;
  }

  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: block;
    height: 0.4rem;
    background: var(--bg-scrim);
  }

  .progress span {
    display: block;
    height: 100%;
    background: var(--brand-red);
  }

  .details {
    display: flex;
    align-items: flex-start;
    margin-top: 1.2rem;
  }

  .avatar {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
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

  .avatars {
    --avatar-size: 2.4rem;
    flex: none;
    margin-top: 0.6rem;
  }

  .text {
    flex: 1;
    min-width: 0;
    margin-left: 1.2rem;
  }

  .title {
    margin: 0 0 0.4rem;
    font-family: var(--feed-font-family, inherit);
    font-size: var(--feed-title-size, 1.6rem);
    font-weight: var(--feed-title-weight, 500);
    line-height: 2.2rem;
    color: var(--feed-title-color, var(--text-primary));
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .channel-name {
    display: flex;
    align-items: center;
    width: fit-content;
    max-width: 100%;
    font-family: var(--feed-font-family, inherit);
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--feed-meta-color, var(--text-secondary));
    transition: color 0.15s ease;
  }

  .channel-name:hover {
    color: var(--text-primary);
  }

  /* the badge stays after the ellipsis, as on youtube.com */
  .channel-name .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* a collaboration's names stay on one line, cut as youtube.com cuts them */
  .channel-name.names {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-family: var(--feed-font-family, inherit);
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--feed-meta-color, var(--text-secondary));
  }

  .members-only {
    margin-top: 0.2rem;
  }

  .description {
    margin: 0.6rem 0 0;
    font-family: var(--feed-font-family, inherit);
    font-size: 1.3rem;
    line-height: 1.8rem;
    color: var(--feed-meta-color, var(--text-secondary));
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--feed-description-lines, 2);
    overflow: hidden;
  }

  &.channel .text,
  &.shelf .text {
    margin-left: 0;
  }

  &.channel .title,
  &.shelf .title {
    font-size: var(--feed-title-size, 1.4rem);
    line-height: 2rem;
  }

  &.channel .meta,
  &.shelf .meta,
  &.channel .channel-name,
  &.shelf .channel-name {
    font-size: 1.2rem;
  }

  /* A search carousel's card on youtube.com keeps the avatar at the smaller
     type: measured signed out at 1280px, 2026-11-10. */
  &.carousel .details {
    margin-top: 0.8rem;
  }

  &.carousel .text {
    margin-left: 0.8rem;
  }

  &.carousel .title {
    font-size: var(--feed-title-size, 1.4rem);
    line-height: 2rem;
  }

  &.carousel .meta,
  &.carousel .channel-name {
    font-size: 1.2rem;
    line-height: 1.8rem;
  }

  &.list {
    flex-direction: row;
    align-items: flex-start;
    gap: 1.6rem;
    width: 100%;
    max-width: var(--feed-list-max-width, 100%);
  }

  &.list.thumb-end {
    flex-direction: row-reverse;
  }

  &.list .thumb {
    flex: none;
    width: var(--feed-list-thumb-width, 24rem);
    max-width: 45%;
  }

  &.list.short .thumb {
    width: min(var(--feed-list-thumb-width, 24rem), 14rem);
  }

  &.list .details {
    flex: 1;
    min-width: 0;
    margin-top: 0;
  }

  @media (max-width: 600px) {
    &.list {
      gap: 1.2rem;
    }

    &.list .thumb {
      width: min(var(--feed-list-thumb-width, 24rem), 14rem);
      max-width: 44%;
    }

    &.list .avatar {
      width: 2.8rem;
      height: 2.8rem;
    }

    &.list .text {
      margin-left: 0.8rem;
    }

    &.list .title,
    &.list .meta,
    &.list .description {
      overflow-wrap: anywhere;
    }
  }

  .more {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .more:hover,
  .more-menu[data-open] .more {
    background: var(--bg-hover);
  }
`

export const VideoCard = (
  {
    video,
    variant,
    context,
    recommendable,
    inlinePreview,
    layout = 'grid',
    thumbnailPosition = 'start',
    showDuration = true,
    showDescription = false,
    descriptionLines = 2,
  }: {
    video: VideoCardData
    variant?: 'channel' | 'shelf' | 'carousel'
    context?: WatchContext
    recommendable?: boolean
    inlinePreview?: boolean
    layout?: FeedLayoutMode
    thumbnailPosition?: ThumbnailPosition
    showDuration?: boolean
    showDescription?: boolean
    descriptionLines?: number
  },
) => {
  // youtube.com's search carousel keeps a Short's 16:9 card, marks it and opens it in the Shorts player
  const carouselShort = variant === 'carousel' && video.isShort === true
  const watchHref = carouselShort ? shortsHrefFor(video.id) : watchHrefFor(video.id, context)
  const channelHref = video.channel ? `/channel/${video.channel.id}` : undefined
  const byline = rowByline(video, variant === 'channel')
  const duration = showDuration ? formatDuration(video.durationSeconds) : undefined
  const descriptionText = (video.descriptionSnippet ?? video.description)?.trim()
  const progress = resumePercent(video.progressPercent)
  const playerParams = video.isUpcoming !== true ? video.inlinePlayerParams ?? undefined : undefined
  const canPreview = video.isUpcoming !== true && (Boolean(playerParams) || Boolean(inlinePreview) || carouselShort)
  const hover = useCardHover({
    id: video.id,
    thumbnail: video.thumbnail,
    playerParams,
    canPreview,
    animatedThumbnail: video.animatedThumbnail,
  })
  const classes = [
    variant,
    layout === 'list' ? 'list' : undefined,
    thumbnailPosition === 'end' ? 'thumb-end' : undefined,
    video.isShort && !carouselShort ? 'short' : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  const state = carouselShort ? undefined : cardState(playerParams)
  const avatar = variant === undefined || variant === 'carousel'
  return (
    <article
      css={style}
      className={classes || undefined}
      style={hover.tintStyle}
      {...hover.handlers}
    >
      <Link href={watchHref} state={state} className='thumb' tabIndex={-1} aria-hidden='true'>
        {video.thumbnail
          ? <Thumbnail src={video.thumbnail} srcSet={video.thumbnailSrcset} sizes='(max-width: 500px) 100vw, 38rem' />
          : undefined}
        {hover.hovered && canPreview
          ? (
            <HoverPreview
              videoId={video.id}
              href={watchHref}
              playerParams={playerParams}
              carryTime={!carouselShort}
              onFail={video.animatedThumbnail ? hover.handlePreviewFail : undefined}
            />
          )
          : undefined}
        {hover.moving ? <img className='moving' src={hover.moving} alt='' /> : undefined}
        {video.thumbnailBadge ? <CornerBadge label={video.thumbnailBadge} /> : undefined}
        {video.isLive
          ? <span className='badge live'>LIVE</span>
          : hover.moving
          ? undefined
          : duration
          ? <span className='badge'>{video.isMusic ? <MusicNote /> : undefined}{duration}</span>
          : carouselShort
          ? <span className='badge'><ShortsMark /></span>
          : undefined}
        {progress !== undefined
          ? (
            <span className='progress'>
              <span style={{ width: `${progress}%` }} />
            </span>
          )
          : undefined}
      </Link>
      <div className='details'>
        {byline === 'names' && video.collaborators?.length && avatar
          ? (
            <CollaboratorsButton channels={video.collaborators} className='avatars' label='Collaboration channels'>
              <AvatarStack channels={video.collaborators} />
            </CollaboratorsButton>
          )
          : video.channel && channelHref && avatar
          ? (
            <Link
              href={channelHref}
              className={video.channel.avatar ? 'avatar' : 'avatar fallback'}
              aria-label={video.channel.name}
            >
              {video.channel.avatar
                ? <Thumbnail src={video.channel.avatar} />
                : video.channel.name.slice(0, 1).toUpperCase()}
            </Link>
          )
          : undefined}
        <div className='text'>
          <h3 className='title'>
            <Link href={watchHref} state={state}>{video.title}</Link>
          </h3>
          {/* youtube.com opens the video from a collaboration's names, and the choice of its channels from the avatars */}
          {byline === 'names'
            ? <Link href={watchHref} state={state} className='channel-name names' tabIndex={-1}><BylineNames parts={video.byline} /></Link>
            : byline === 'channel' && video.channel && channelHref
            ? <Link href={channelHref} className='channel-name'><span className='name'>{video.channel.name}</span><VerifiedBadge channel={video.channel} /></Link>
            : undefined}
          <RowMeta video={video} />
          {video.isMembersOnly ? <MembersOnly /> : undefined}
          {showDescription && descriptionLines > 0 && descriptionText
            ? (
              <p
                className='description'
                style={{ '--feed-description-lines': String(descriptionLines) } as Record<string, string>}
              >
                {descriptionText}
              </p>
            )
            : undefined}
        </div>
        <VideoCardMenu
          videoId={video.id}
          title={video.title}
          thumbnail={video.thumbnail}
          durationSeconds={video.durationSeconds}
          channel={video.channel}
          notInterestedToken={video.notInterestedToken}
          dontRecommendToken={video.dontRecommendToken}
          recommendable={recommendable}
          live={Boolean(video.isLive || video.isUpcoming)}
          class='more-menu'
        />
      </div>
    </article>
  )
}

const skeletonStyle = css`
  min-width: 0;
  animation: video-card-pulse 1.6s ease-in-out infinite;

  &.list {
    display: flex;
    align-items: flex-start;
    gap: 1.6rem;
    max-width: var(--feed-list-max-width, 100%);
  }

  .thumb {
    aspect-ratio: 16 / 9;
    border-radius: var(--feed-thumb-radius, 1.2rem);
    background: var(--bg-elevated);
  }

  &.list .thumb {
    flex: none;
    width: var(--feed-list-thumb-width, 24rem);
  }

  &.list .bars {
    flex: 1;
    min-width: 0;
  }

  .bar {
    height: 1.6rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
    margin-top: 1.2rem;
  }

  &.list .bars .bar:first-of-type {
    margin-top: 0;
  }

  .bar.short {
    width: 60%;
    margin-top: 0.8rem;
  }

  @keyframes video-card-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }
`

export const VideoCardSkeleton = ({ layout = 'grid' }: { layout?: FeedLayoutMode } = {}) => (
  <div css={skeletonStyle} className={layout === 'list' ? 'list' : undefined} aria-hidden='true'>
    <div className='thumb' />
    <div className='bars'>
      <div className='bar' />
      <div className='bar short' />
    </div>
  </div>
)

export default VideoCard
