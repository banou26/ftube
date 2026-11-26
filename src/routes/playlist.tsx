import type { PlaylistViewQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { CircleUserRound, ListVideo, Play, Share2, Shuffle, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useClient, useMutation, useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure, lineFor } from '../components/data-failure'
import { linkifyRuns } from '../components/linkify'
import { LIKED_VIDEOS_ID, playlistHrefFor, WATCH_LATER_ID } from '../components/playlist'
import { setQueueShuffle } from '../components/playlist-panel'
import { RichText } from '../components/rich-text'
import { useSession } from '../session'
import { showToast } from '../components/ui/toast'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { watchHrefFor } from '../components/video-card'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import { signIn } from '../sign-in'
import { PLAYLIST_UNAVAILABLE } from '../sources/types'
import { showUndoableToast } from '../undo'

const PLAYLIST_VIEW_QUERY = gql(`
  query PlaylistView($id: ID!, $cursor: String) {
    playlist(id: $id, cursor: $cursor) {
      playlist {
        id
        title
        description
        thumbnail
        videoCountText
        viewCountText
        updatedText
        privacy
        isEditable
        canReorder
        channel { id name avatar }
      }
      items {
        setVideoId
        index
        video {
          id
          title
          thumbnail
          thumbnailSrcset
          durationSeconds
          isMusic
          viewCount
          viewCountIcon
          publishedText
          metaDelimiter
          isLive
          isMembersOnly
          channel { id name isVerified isVerifiedArtist }
        }
      }
      cursor
    }
  }
`)

// only identity is selected back: the write cannot recompute a localized count, so `videoCountText` would overwrite the cached one (src/worker/schema.gql)
const REMOVE_FROM_PLAYLIST = gql(`
  mutation RemoveFromPlaylist($playlistId: ID!, $setVideoIds: [ID!]!) {
    removeFromPlaylist(playlistId: $playlistId, setVideoIds: $setVideoIds) {
      id
    }
  }
`)

const RESTORE_TO_PLAYLIST = gql(`
  mutation RestoreToPlaylist($playlistId: ID!, $videoIds: [ID!]!) {
    addToPlaylist(playlistId: $playlistId, videoIds: $videoIds) {
      id
      addedSetVideoId
    }
  }
`)

const MOVE_PLAYLIST_ITEM = gql(`
  mutation MovePlaylistItem($playlistId: ID!, $setVideoId: ID!, $afterSetVideoId: ID) {
    movePlaylistItem(playlistId: $playlistId, setVideoId: $setVideoId, afterSetVideoId: $afterSetVideoId) {
      id
    }
  }
`)

type PlaylistViewPage = PlaylistViewQuery['playlist']
type PlaylistItemData = PlaylistViewPage['items'][number]

const SKELETON_ROWS = 8

// a playlist can hold the same video twice, each occurrence its own slot, so the dedupe key addresses the SLOT
const keyOf = (item: PlaylistItemData) => item.setVideoId ?? `${item.index ?? ''}:${item.video.id}`

const style = css`
  padding: 2.4rem 1.6rem;

  .layout {
    display: grid;
    grid-template-columns: 36rem minmax(0, 1fr);
    gap: 2.4rem;
    /* Without this the side column stretches to the height of the whole list
       and its sticky offset never has any room to take effect. */
    align-items: start;
  }

  .side {
    position: sticky;
    /* Under the fixed header rather than at the viewport top. */
    top: calc(var(--header-height) + 2.4rem);
    min-width: 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    overflow: hidden;
    isolation: isolate;
  }

  /* Dark cover-tinted hero surface in both themes so text, links and buttons
     keep AA+ contrast regardless of page theme or cover brightness. */
  .side.ambient {
    background: #1a1a1a;
    --text-primary: #ffffff;
    --text-secondary: rgba(255, 255, 255, 0.78);
    --text-tertiary: rgba(255, 255, 255, 0.65);
    --accent: #8acbff;
    --bg-inverse: #ffffff;
    --bg-inverse-hover: rgba(255, 255, 255, 0.85);
    --text-inverse: #0f0f0f;
    --bg-chip: rgba(255, 255, 255, 0.16);
    --bg-chip-hover: rgba(255, 255, 255, 0.26);
    --bg-hover: rgba(255, 255, 255, 0.16);
  }

  .ambient-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .ambient-backdrop img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(40px) saturate(1.4);
    transform: scale(1.25);
  }

  .ambient-backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(15, 15, 15, 0.4) 0%,
      rgba(15, 15, 15, 0.72) 45%,
      rgba(15, 15, 15, 0.88) 100%
    );
  }

  .side-content {
    position: relative;
    z-index: 1;
  }

  .cover {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .side.ambient .cover {
    box-shadow: 0 0.4rem 2.4rem rgba(0, 0, 0, 0.28);
  }

  .cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-tertiary);
  }

  .heading {
    margin: 1.6rem 0 0;
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .owner {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: fit-content;
    max-width: 100%;
    margin-top: 1.2rem;
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .owner-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
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
    font-size: 1.2rem;
  }

  .stats {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
  }

  .description-wrap {
    margin-top: 1.2rem;
  }

  .description {
    font-size: 1.2rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .description.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    max-height: 5.4rem;
    overflow: hidden;
  }

  .description-toggle {
    display: inline-block;
    margin-top: 0.4rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
    cursor: pointer;
  }

  .description-toggle:hover {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.6rem;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pill:hover {
    background: var(--bg-inverse-hover);
  }

  .pill.secondary {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .pill.secondary:hover {
    background: var(--bg-chip-hover);
  }

  .round {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--bg-chip);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .round:hover {
    background: var(--bg-chip-hover);
  }

  .side-skeleton {
    animation: playlist-side-pulse 1.6s ease-in-out infinite;
  }

  .side-skeleton .cover {
    background: var(--bg-chip);
  }

  .skel-bar,
  .skel-avatar,
  .skel-pill,
  .skel-round {
    background: var(--bg-chip);
  }

  .skel-bar {
    height: 1.4rem;
    border-radius: 0.4rem;
  }

  .skel-title {
    margin-top: 1.6rem;
    width: 78%;
    height: 3rem;
    border-radius: 0.6rem;
  }

  .skel-owner {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  .skel-avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
  }

  .skel-owner-name {
    width: 12rem;
  }

  .skel-stats {
    margin-top: 0.4rem;
    width: 56%;
    height: 1.8rem;
  }

  .skel-desc {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1.2rem;
  }

  .skel-desc-short {
    width: 68%;
  }

  .skel-actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.6rem;
  }

  .skel-pill {
    width: 10.6rem;
    height: 3.6rem;
    border-radius: 1.8rem;
  }

  .skel-round {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
  }

  @keyframes playlist-side-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .row,
  .row-skeleton {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.4rem;
    border-radius: 0.8rem;
  }

  .row {
    transition: background 0.15s ease;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.playing {
    background: var(--bg-selected);
  }

  .number {
    flex: none;
    width: 2.4rem;
    text-align: center;
    font-size: 1.2rem;
    color: var(--text-tertiary);
  }

  .card {
    flex: 1;
    min-width: 0;
  }

  /* youtube.com's playlist rows keep their ⋮ up without a hover, where the other compact rows show it on hover */
  .card .more {
    opacity: 1;
  }

  .remove {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .row:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    background: var(--bg-hover);
  }

  .remove:disabled {
    cursor: default;
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .prompt {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .prompt h2 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .sign-in {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    margin-top: 1.6rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    /* Relative rather than static so the absolute ambient backdrop stays clipped inside .side. */
    .side {
      position: relative;
      top: auto;
    }
  }
`

const PlaylistDescription = ({ description }: { description: string }) => {
  const runs = useMemo(() => linkifyRuns(description), [description])
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (expanded || !element) return
    const check = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    check()
    // a clamped box keeps its height when the web font swaps in and the lines rewrap
    void document.fonts.ready.then(check)
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, description])

  if (runs.length === 0) return null

  return (
    <div className='description-wrap'>
      <div ref={ref} className={expanded ? 'description' : 'description clamped'}>
        <RichText runs={runs} />
      </div>
      {expanded || overflowing
        ? (
          <button
            type='button'
            className='description-toggle'
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? 'Show less' : '...more'}
          </button>
        )
        : undefined}
    </div>
  )
}

const PlaylistSideSkeleton = () => (
  <div className='side-skeleton' aria-hidden='true'>
    <div className='cover' />
    <div className='skel-bar skel-title' />
    <div className='skel-owner'>
      <div className='skel-avatar' />
      <div className='skel-bar skel-owner-name' />
    </div>
    <div className='skel-bar skel-stats' />
    <div className='skel-desc'>
      <div className='skel-bar' />
      <div className='skel-bar' />
      <div className='skel-bar skel-desc-short' />
    </div>
    <div className='skel-actions'>
      <div className='skel-pill' />
      <div className='skel-pill' />
      <div className='skel-round' />
    </div>
  </div>
)

// the route has NO path params, and reading one would yield undefined silently: wouter checks the component prop bivariantly
const PlaylistPage = () => {
  const params = new URLSearchParams(useSearch())
  const listId = params.get('list') ?? ''
  const indexParam = params.get('index')
  // 1-based, the way youtube.com writes it and the way PlaylistItem.index comes back
  const activeIndex = indexParam !== null && /^\d+$/.test(indexParam) ? Number(indexParam) : undefined
  const [, navigate] = useLocation()
  const [loaded, setLoaded] = useState<{ id: string, pages: PlaylistViewPage[] }>({ id: listId, pages: [] })
  const pages = loaded.id === listId ? loaded.pages : []
  // the two account-scoped ids the guide links on every page; browsing one anonymously comes back as an upstream ERROR alert
  const accountScoped = listId === WATCH_LATER_ID || listId === LIKED_VIDEOS_ID
  const { ready, signedIn } = useSession()
  const signedOutOfOwnList = accountScoped && ready && !signedIn
  const [{ data, error, fetching }, reexecute] = useQuery({
    query: PLAYLIST_VIEW_QUERY,
    variables: { id: listId, cursor: pages[pages.length - 1]?.cursor },
    pause: listId.length === 0 || (accountScoped && (!ready || !signedIn))
  })
  const client = useClient()
  const mountedRef = useRef(true)
  useEffect(() => () => {
    mountedRef.current = false
  }, [])
  const [, removeFromPlaylist] = useMutation(REMOVE_FROM_PLAYLIST)
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removing, setRemoving] = useState<string[]>([])

  const unavailable = error?.graphQLErrors.find(entry => entry.message.startsWith(PLAYLIST_UNAVAILABLE))
  const page = data?.playlist
  // urql keeps the previous result while the next page is in flight, so the live page can repeat one already consumed
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: keyOf
  })
  const playlist = page?.playlist ?? pages[0]?.playlist
  useDocumentTitle(playlist?.title ?? 'Playlist')

  const loadingInitial = !playlist && !error && (fetching || !data)
  const hasAmbient = Boolean(playlist?.thumbnail)

  const rows = items.filter(item => !item.setVideoId || !removed.has(item.setVideoId))
  const first = rows[0]

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded({ id: listId, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  const onRemove = (setVideoId: string) => {
    if (removing.includes(setVideoId)) return
    const removedIndex = rows.findIndex(item => item.setVideoId === setVideoId)
    const targetVideoId = removedIndex === -1 ? undefined : rows[removedIndex]?.video.id
    const predecessorSetVideoId = removedIndex > 0 ? rows[removedIndex - 1]?.setVideoId : undefined
    const wasLast = removedIndex !== -1 && removedIndex === rows.length - 1 && !cursor
    setRemoving(previous => [...previous, setVideoId])
    void removeFromPlaylist({ playlistId: listId, setVideoIds: [setVideoId] }).then((result) => {
      if (mountedRef.current) setRemoving(previous => previous.filter(value => value !== setVideoId))
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      if (mountedRef.current) setRemoved(previous => new Set(previous).add(setVideoId))
      if (targetVideoId) {
        showUndoableToast('Removed from playlist', {
          label: 'Remove from playlist',
          undo: async () => {
            // client.mutation bypasses hook unmount guards if the user navigates before pressing Undo.
            const added = await client.mutation(RESTORE_TO_PLAYLIST, { playlistId: listId, videoIds: [targetVideoId] }).toPromise()
            if (added.error) throw added.error
            const addedSetVideoId = added.data?.addToPlaylist.addedSetVideoId ?? undefined
            if (
              playlist?.canReorder !== false
              && !wasLast
              && addedSetVideoId
              && (removedIndex === 0 || predecessorSetVideoId !== undefined)
            ) {
              const moved = await client.mutation(MOVE_PLAYLIST_ITEM, {
                playlistId: listId,
                setVideoId: addedSetVideoId,
                ...(predecessorSetVideoId !== undefined ? { afterSetVideoId: predecessorSetVideoId } : {}),
              }).toPromise()
              if (moved.error) showToast(lineFor(moved.error))
            }
            if (!mountedRef.current) return
            setRemoved(previous => {
              const next = new Set(previous)
              next.delete(setVideoId)
              return next
            })
            reexecute({ requestPolicy: 'network-only' })
          },
          undoneMessage: 'Restored to playlist',
        })
      } else {
        showToast('Removed from playlist')
      }
    })
  }

  const onShare = () => {
    const clipboard = navigator.clipboard
    if (!clipboard) {
      showToast('Could not copy the link')
      return
    }
    void clipboard.writeText(`${location.origin}${playlistHrefFor(listId)}`).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy the link'),
    )
  }

  const onShuffle = () => {
    const pick = rows[Math.floor(Math.random() * rows.length)]
    if (!pick) return
    setQueueShuffle(true)
    navigate(watchHrefFor(pick.video.id, { list: listId, index: pick.index ?? undefined }))
  }

  if (listId.length === 0) {
    return (
      <main css={style}>
        <div className='prompt'>
          <h2>No playlist selected</h2>
        </div>
      </main>
    )
  }

  if (signedOutOfOwnList) {
    const label = listId === WATCH_LATER_ID ? 'Watch later' : 'Liked videos'
    return (
      <main css={style}>
        <div className='prompt'>
          <h2>Sign in to see {label}</h2>
          <button type='button' className='sign-in' onClick={signIn}>
            <CircleUserRound size={24} strokeWidth={1.5} />
            Sign in
          </button>
        </div>
      </main>
    )
  }

  const stats = [playlist?.videoCountText, playlist?.viewCountText, playlist?.updatedText]
    .filter(part => part !== undefined && part !== null && part !== '')
    .join(' • ')

  return (
    <main css={style}>
      <div className='layout'>
        <aside className={hasAmbient ? 'side ambient' : 'side'}>
          {playlist?.thumbnail
            ? (
              <div className='ambient-backdrop' aria-hidden='true'>
                <img src={playlist.thumbnail} alt='' />
              </div>
            )
            : undefined}
          <div className='side-content'>
            {loadingInitial
              ? <PlaylistSideSkeleton />
              : (
                <>
                  <div className='cover'>
                    {playlist?.thumbnail
                      ? <img src={playlist.thumbnail} alt='' />
                      : (
                        <span className='cover-fallback'>
                          <ListVideo size={48} strokeWidth={1.5} />
                        </span>
                      )}
                  </div>
                  <h1 className='heading'>{playlist?.title ?? 'Playlist'}</h1>
                  {playlist?.channel
                    ? (
                      <Link href={`/channel/${playlist.channel.id}`} className='owner'>
                        <span className={playlist.channel.avatar ? 'avatar' : 'avatar fallback'}>
                          {playlist.channel.avatar
                            ? <img src={playlist.channel.avatar} alt='' loading='lazy' />
                            : playlist.channel.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className='owner-name'>{playlist.channel.name}</span>
                      </Link>
                    )
                    : undefined}
                  {stats ? <div className='stats'>{stats}</div> : undefined}
                  {playlist?.description
                    ? <PlaylistDescription key={listId} description={playlist.description} />
                    : undefined}
                  <div className='actions'>
                    {first
                      ? (
                        <Link
                          href={watchHrefFor(first.video.id, { list: listId, index: first.index ?? undefined })}
                          className='pill'
                        >
                          <Play size={20} strokeWidth={1.5} fill='currentColor' />
                          Play all
                        </Link>
                      )
                      : undefined}
                    {rows.length > 1
                      ? (
                        <button type='button' className='pill secondary' onClick={onShuffle}>
                          <Shuffle size={20} strokeWidth={1.5} />
                          Shuffle
                        </button>
                      )
                      : undefined}
                    {/* no rename, privacy or delete controls: privacy only applies reliably at creation, see setPlaylistPrivacy in src/worker/schema.gql */}
                    <button
                      type='button'
                      className='round'
                      aria-label='Share'
                      title='Share'
                      onClick={onShare}
                    >
                      <Share2 size={20} strokeWidth={1.5} />
                    </button>
                  </div>
                </>
              )}
          </div>
        </aside>
        <div>
          {unavailable ? <p className='notice'>{unavailable.message.slice(PLAYLIST_UNAVAILABLE.length)}</p> : undefined}
          <div className='rows'>
            {rows.map((item, position) => {
              // the number on screen counts the rows rendered; the one in the href is upstream's slot, which is what ?index= addresses
              const queueIndex = item.index ?? position + 1
              const setVideoId = item.setVideoId
              return (
                <div
                  className={queueIndex === activeIndex ? 'row playing' : 'row'}
                  key={keyOf(item)}
                  aria-current={queueIndex === activeIndex ? 'true' : undefined}
                >
                  <span className='number' aria-hidden='true'>{position + 1}</span>
                  <div className='card'>
                    {/* the shared card carries the row's own overflow menu and the queue-aware href */}
                    <VideoCardCompact video={item.video} context={{ list: listId, index: queueIndex }} />
                  </div>
                  {playlist?.isEditable === true && setVideoId
                    ? (
                      <button
                        type='button'
                        className='remove'
                        aria-label={`Remove ${item.video.title} from this playlist`}
                        disabled={removing.includes(setVideoId)}
                        onClick={() => onRemove(setVideoId)}
                      >
                        <X size={16} strokeWidth={1.5} />
                      </button>
                    )
                    : undefined}
                </div>
              )
            })}
            {(loadingInitial || fetching) && rows.length === 0
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <div className='row-skeleton' key={index} aria-hidden='true'>
                  <span className='number' />
                  <div className='card'>
                    <VideoCardCompactSkeleton />
                  </div>
                </div>
              ))
              : undefined}
          </div>
          {data && !fetching && !error && rows.length === 0
            ? (
              <div className='prompt'>
                <h2>Nothing in this playlist</h2>
              </div>
            )
            : undefined}
          {fetching && rows.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
          {error && !unavailable && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
          <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
        </div>
      </div>
    </main>
  )
}

export default PlaylistPage
