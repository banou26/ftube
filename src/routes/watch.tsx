import type { WatchActionId } from '../components/watch-actions-layout'
import type { PlaylistPanelData } from '../components/playlist-panel'
import type { LiveChatEmoji, RelatedVideosQuery } from '../generated/graphql'

import type { VideoCardData } from '../components/video-card'

import { css } from '@emotion/react'
import { Bookmark, Download, Ellipsis, Flag, FolderPlus, Share2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useClient, useQuery } from 'urql'
import { Link, useSearch } from 'wouter'

import { useDocumentTitle, useMediaQuery } from '../app'
import { AvatarStack, BylineNames, CollaboratorsButton } from '../components/byline'
import { ChatReplay, ChatReplayTeaser } from '../components/chat-replay'
import Comments from '../components/comments'
import { DataFailure } from '../components/data-failure'
import DescriptionBox from '../components/description-box'
import { isDismissedVideo, useDismissed } from '../components/dismissed-videos'
import { matchesGlobalFeedRules } from '../feeds/filter'
import { useFeedViewSettings } from '../feeds/settings'
import { parseStartSeconds } from '../components/format'
import { GroupsDialog } from '../components/groups-button'
import { actionTooltipStyle, LikePill } from '../components/like-pill'
import LiveChat, { LiveChatTeaser } from '../components/live-chat'
import { useOverScreenSettings } from '../components/over-screen-messages'
import { openDownloadDialog } from '../downloads/store'
import PlaylistPanel from '../components/playlist-panel'
import { QueuePanel } from '../components/queue-panel'
import { Rail } from '../components/rail'
import { MembersOnly } from '../components/row-marks'
import SaveMenu, { SaveDialog } from '../components/save-menu'
import ShareDialog from '../components/share-dialog'
import SubscribeButton, { subscribeStyle } from '../components/subscribe-button'
import { computeVisibleWatchActions } from '../components/watch-actions-layout'
import { FeedSentinel } from '../components/use-infinite-feed'
import { VerifiedBadge } from '../components/verified-badge'
import { VideoCard, VideoCardSkeleton } from '../components/video-card'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { watchPanel } from '../components/watch-panel'
import { gql } from '../generated'
import { cardParamsIn } from '../player/card-params'
import { prefetchPlayback } from '../player/prefetch'
import { useQueue } from '../player/queue'
import {
  claimPlayer, closePlayer, getPlayerSession, openPlayer, setPanel, usePlayerSession,
} from '../player/session'
import { isTheaterActive } from '../player/theater'
import { descriptionOf, WATCH_META_QUERY } from '../player/watch-query'
import { Menu, MenuItem } from '../components/ui/menu'
import { useSetting } from '../settings'

// youtube.com's one column, from 999 px down, which also opens the chat replay and chapters under the player
const ONE_COLUMN = '(max-width: 999px)'

const style = css`
  display: grid;
  /* youtube.com's own proportions, measured at 1000 to 2560 px wide on
     2026-11-10: a 16 px margin and gap, 12 px above the player, the sidebar
     27.5% of the window held between 320 px and 35% of the window or 700 px,
     and the player takes the rest, never under 640 px, up to the width whose
     16:9 frame still fits under the header with room below it. A short window
     gives the width the player cannot take to the sidebar, up to that maximum,
     and only what is left past both centers the two. From 1000 to 1007 px wide
     the two keep the left margin and run into the right one (theater centers
     them instead). */
  --player-max: max(64rem, calc((100vh - var(--header-height) - 6rem) * 16 / 9));
  --sidebar: clamp(32rem, max(27.5vw, 100% - 1.6rem - var(--player-max)), min(35vw, 70rem));
  grid-template-columns: minmax(64rem, var(--player-max)) var(--sidebar);
  justify-content: safe center;
  /* The sidebar spans BOTH rows, and an auto-sized row absorbs a share of a
     spanning item that is taller than its own content. So a long sidebar
     inflated row 1 and pushed the title and description far below the player:
     measured at 590px below it with 40 related videos, and 1610px once paging
     had loaded more.

     min-content pins row 1 to the player it actually holds, and the FLEXIBLE
     second row is what makes it stick: a spanning item's excess height is
     shared out across intrinsic rows, so a min-content plus auto pair still
     inflated row 1 (measured: a 2007px gap). A flexible track absorbs that
     excess instead. */
  grid-template-rows: min-content min-content 1fr;
  align-items: start;
  gap: 0 1.6rem;
  padding: 1.2rem 1.6rem 2.4rem;
  overflow-x: clip;
  isolation: isolate;

  .stage {
    grid-column: 1;
    grid-row: 1;
  }

  /* Reserves the player's box. The player is moved in as a child rather than
     rendered here, so without a size of its own this slot would collapse and
     the page would jump as the video arrives. */
  .player-slot,
  .player-slot > .player-host {
    position: relative;
    display: block;
    width: 100%;
  }

  .primary {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
  }

  .comments-slot {
    grid-column: 1;
    grid-row: 3;
    min-width: 0;
  }

  .panel-slot {
    grid-column: 1;
    margin-top: 1.2rem;
  }

  .secondary {
    grid-column: 2;
    grid-row: 1 / span 3;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
    /* youtube.com's 62.5% of the row at every width: 200 of 320, 220 of 352, 330 of 528 */
    --compact-thumb-width: 62.5%;
  }

  .related-chips {
    min-width: 0;
    margin-bottom: 0.4rem;
    --rail-gap: 0.8rem;
  }

  .related-chip {
    flex: none;
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .related-chip:hover {
    background: var(--bg-chip-hover);
  }

  .related-chip.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .related-chip.active:hover {
    background: var(--bg-inverse-hover);
  }

  .related-notice {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    margin: 1.2rem 0;
    color: var(--text-secondary);
    font-size: 1.4rem;
  }

  .related-retry {
    height: 3.2rem;
    padding: 0 1.4rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.6rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
  }

  .related-retry:hover {
    background: var(--bg-hover);
  }

  /* One-column related cards matching youtube.com (measured 2026-11-11):
     999 px -> 3 cards (311.66 px), 800 px -> 2 cards (376 px), 600 px -> 1 card (568 px). */
  .related-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 31rem), 1fr));
    column-gap: 1.6rem;
    row-gap: 2.4rem;
  }

  .show-more-related {
    width: 100%;
    height: 3.6rem;
    margin-top: 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .show-more-related:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .show-more-related:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* The columns join this grid in the default view. youtube.com's theater, measured 2026-11-10, runs the player edge
     to edge and keeps the default view's column widths and centering under it, so there they take a grid of their
     own. From 1000 to 1007 px wide the two overflow the margins evenly there. */
  .columns {
    display: contents;
  }

  &.theater {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    padding: 0 0 2.4rem;
  }

  &.theater .stage {
    background: transparent;
  }

  &.theater .columns {
    display: grid;
    grid-template-columns: minmax(64rem, var(--player-max)) var(--sidebar);
    grid-template-rows: min-content 1fr;
    justify-content: center;
    align-items: start;
    gap: 0 1.6rem;
    padding: 0 1.6rem;
  }

  &.theater .primary {
    grid-row: 1;
  }

  &.theater .comments-slot {
    grid-row: 2;
  }

  /* youtube.com's default theater caps height at window height minus 169px
     (never under 480px); fullscreen theater expands to fill below the header.
     Excluded in :fullscreen so native fullscreen keeps full viewport height.
     Matched on the player's own attribute rather than on a direct child: the
     player is moved in through a slot and a host node, two levels down. */
  &.theater .stage [data-player-root]:not(:fullscreen) {
    max-height: calc(100vh - 169px);
    min-height: 480px;
    border-radius: 0;
  }

  &.theater-fullscreen .stage [data-player-root]:not(:fullscreen) {
    width: 100%;
    height: calc(100vh - var(--header-height, 5.6rem));
    height: calc(100dvh - var(--header-height, 5.6rem));
    max-height: none;
    min-height: 24rem;
    aspect-ratio: auto;
    border-radius: 0;
  }

  &.theater .secondary {
    grid-row: 1 / span 2;
    padding-top: 2.4rem;
  }

  &.theater.theater-chat {
    --theater-chat-width: clamp(32rem, 27vw, 40rem);
    padding-right: var(--theater-chat-width);
  }

  &.theater.theater-chat .columns {
    grid-template-columns: minmax(0, var(--player-max)) clamp(26rem, 25vw, 38rem);
    max-width: 100%;
  }

  .theater-chat-rail {
    position: fixed;
    top: var(--header-height, 5.6rem);
    right: 0;
    bottom: 0;
    width: var(--theater-chat-width);
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--bg-subtle);
    border-left: 1px solid var(--border);
  }

  .live-chat-slot {
    min-width: 0;
  }

  .theater-chat-rail > .live-chat-slot {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .theater-chat-rail > .live-chat,
  .theater-chat-rail > .live-chat-slot > .live-chat,
  .theater-chat-rail > .chat-replay {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;
  }

  .primary > .chat-replay,
  .primary > .live-chat,
  .primary > .live-chat-teaser,
  .primary > .live-chat-slot {
    margin-top: 1.2rem;
  }

  .about {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    column-gap: 1.2rem;
  }

  .about > * {
    flex: 1 1 30rem;
    min-width: 0;
  }

  /* an opened description takes the whole row, as youtube.com's does, and the chat replay card moves under it */
  .about > div:not(.collapsed) {
    flex-basis: 100%;
  }

  .title {
    margin: 1.2rem 0 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .owner-row {
    --action-height: 4rem;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 1.2rem;
    margin-top: 1.2rem;
  }

  .owner-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }

  .avatars {
    --avatar-size: 2.8rem;
    flex: none;
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

  .owner-text {
    flex: 0 1 auto;
    min-width: 0;
  }

  .channel-name {
    display: flex;
    align-items: center;
    width: fit-content;
    max-width: 100%;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  /* the badge stays after the ellipsis, as on youtube.com */
  .channel-name .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub-count {
    font-size: 1.2rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    flex-wrap: nowrap;
    flex: none;
    align-items: center;
    gap: 0.8rem;
    margin-left: auto;
  }

  .action-slot {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  ${actionTooltipStyle}

  .action-slot-end > .action-tooltip {
    right: 0;
    left: auto;
    transform: none;
  }

  .action-slot:not(:has([data-open='true'])):hover > .action-tooltip,
  .action-slot:not(:has([data-open='true'])):has(:focus-visible) > .action-tooltip {
    opacity: 1;
    visibility: visible;
  }

  @media (max-width: 600px) {
    .owner-row {
      flex-direction: column;
      align-items: stretch;
      gap: 1rem;
    }

    .owner-info {
      flex: none;
      width: 100%;
    }

    .actions {
      width: 100%;
      margin-left: 0;
    }
  }

  .round {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--action-height, 3.6rem);
    height: var(--action-height, 3.6rem);
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

  /* youtube.com's one column in the default view, measured 2026-11-11 from 999 to 360 px
     wide: the player runs edge to edge right under the header with square corners, at most the window height less
     169 px and never under 240 px. In theater mode it fills the viewport under the header. */
  @media ${ONE_COLUMN} {
    --margin: 1.6rem;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;

    &,
    &.theater,
    &.theater.theater-chat {
      padding: 0 var(--margin) 2.4rem;
    }

    .stage,
    .primary,
    &.theater .primary,
    .secondary,
    &.theater .secondary,
    .comments-slot,
    &.theater .comments-slot {
      grid-column: 1;
      grid-row: auto;
    }

    &.theater .columns {
      display: contents;
    }

    .secondary,
    &.theater .secondary {
      margin-top: 2.4rem;
      padding-top: 0;
    }

    .stage {
      margin: 0 calc(-1 * var(--margin));
    }

    .stage [data-player-root]:not(:fullscreen),
    &.theater .stage [data-player-root]:not(:fullscreen) {
      max-height: calc(100vh - 169px);
      min-height: 240px;
      border-radius: 0;
    }

    &.theater-fullscreen .stage [data-player-root]:not(:fullscreen) {
      width: 100%;
      height: calc(100vh - var(--header-height, 5.6rem));
      height: calc(100dvh - var(--header-height, 5.6rem));
      max-height: none;
      min-height: 24rem;
      aspect-ratio: auto;
      border-radius: 0;
    }
  }

  /* youtube.com's title column never goes under 426.667 px, a 240 px tall
     16:9 player, so below 459 px its margins shrink and its page scrolls
     sideways. A phone keeps 12 px margins here and no sideways scroll. */
  @media (max-width: 458px) {
    --margin: 1.2rem;
  }
`

const RELATED_MORE_QUERY = gql(`
  query RelatedVideos($cursor: String!) {
    relatedVideos(cursor: $cursor) {
      items {
        id
        title
        thumbnail
        thumbnailSrcset
        animatedThumbnail
        thumbnailBadge
        durationSeconds
        isMusic
        viewCount
        viewCountIcon
        publishedText
        metaDelimiter
        isLive
        isMembersOnly
        isShort
        channel { id name isVerified isVerifiedArtist }
        byline { text isVerified isVerifiedArtist }
        collaborators { id name avatar handle subscriberCountText isVerified isVerifiedArtist }
        notInterestedToken
        dontRecommendToken
      }
      cursor
    }
  }
`)

type RelatedPage = RelatedVideosQuery['relatedVideos']

/* youtube.com's page for a video that no longer exists, measured at 1280 px on 2026-11-10: its heading sits 32.5rem
   under the masthead at any height, below a 16.1rem picture this page leaves out, since www.youtube.com serves it */
const unavailableStyle = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32.5rem 2.4rem 2.4rem;
  text-align: center;

  h1 {
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3.2rem;
    color: var(--text-primary);
  }

  .home {
    display: flex;
    align-items: center;
    height: 4rem;
    margin-top: 3.2rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    text-decoration: none;
  }

  .home:hover {
    background: var(--accent-hover);
  }
`

const RELATED_SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const MAX_OWNER_TEXT_RESERVE = 160
const OWNER_ROW_GAP = 12
const ACTION_ROW_GAP = 8

const WatchPage = () => {
  const params = new URLSearchParams(useSearch())
  const videoId = params.get('v') ?? ''
  // each video's page mounts anew, and a card's link carries its params in the history entry it opens
  const [playerParams] = useState(() => cardParamsIn(history.state))
  prefetchPlayback(videoId, playerParams)
  // `index` is 1-BASED in the URL, matching youtube.com, while the schema takes a 0-based `playlistIndex`
  const listId = params.get('list') ?? undefined
  // app.tsx keeps `t` out of the route identity, so changing it does NOT remount the player
  const startAt = parseStartSeconds(params.get('t'))
  const indexParam = Number(params.get('index'))
  const playlistIndex = Number.isInteger(indexParam) && indexParam > 0 ? indexParam - 1 : undefined
  const [{ data: watchData, error: watchError, fetching: watchFetching }, reexecuteWatch] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: videoId, playlistId: listId, playlistIndex },
    // load-bearing: WatchMeta is keyed by video id and WatchPlaylist is embedded in it, so every argument set for one video shares a single `playlist` slot (a plain ?v= read writes null over it, a read from another queue writes that queue's panel), and cache-first would serve the stale slot straight back
    requestPolicy: 'cache-and-network',
    pause: videoId === ''
  })
  const playerSession = usePlayerSession()
  const theater = playerSession.theater
  const inTheater = isTheaterActive(theater)

  const client = useClient()
  const relatedRequestRef = useRef({ seq: 0, videoId })
  const [activeChipId, setActiveChipId] = useState('')
  const [relatedPages, setRelatedPages] = useState<RelatedPage[]>([])
  const [filteredPages, setFilteredPages] = useState<RelatedPage[]>()
  const [chipLoading, setChipLoading] = useState(false)
  const [chipError, setChipError] = useState<string>()
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreFailedCursor, setMoreFailedCursor] = useState<string>()

  useEffect(() => {
    relatedRequestRef.current.seq += 1
    relatedRequestRef.current.videoId = videoId
    setActiveChipId('')
    setRelatedPages([])
    setFilteredPages(undefined)
    setChipLoading(false)
    setChipError(undefined)
    setMoreLoading(false)
    setMoreFailedCursor(undefined)
    return () => {
      relatedRequestRef.current.seq += 1
    }
  }, [videoId])
  useEffect(() => {
    setSharing(false)
    setSaving(false)
    setGrouping(false)
  }, [videoId])

  const watch = watchData?.watch
  useDocumentTitle(watch?.title ?? undefined)
  const channel = watch?.channel
  const unavailable = watch?.unavailableText ?? undefined

  useLayoutEffect(() => {
    if (videoId === '') return
    if (unavailable) {
      if (getPlayerSession().videoId === videoId) closePlayer()
      return
    }
    openPlayer({ videoId, startAt, title: watch?.title ?? undefined, list: listId, index: playlistIndex, playerParams })
  }, [videoId, startAt, watch?.title, listId, playlistIndex, unavailable, playerParams])
  // the sidebar pages from its own cursor: re-running /next would restart the whole watch
  const relatedChips = watch?.relatedChips ?? []
  const relatedCursor = activeChipId !== ''
    ? filteredPages?.[filteredPages.length - 1]?.cursor
    : (relatedPages[relatedPages.length - 1]?.cursor ?? watch?.relatedCursor)
  const hideShorts = useSetting('hideShorts')
  const feedSettings = useFeedViewSettings()
  const dismissed = useDismissed()
  const queue = useQueue()
  const rawRelated = activeChipId !== ''
    ? (chipLoading ? undefined : (filteredPages ?? []).flatMap(entry => entry.items))
    : (watch?.related ? [...watch.related, ...relatedPages.flatMap(entry => entry.items)] : undefined)
  const related: VideoCardData[] | undefined = rawRelated
    ? rawRelated
      .filter((video, index, all) => all.findIndex(other => other.id === video.id) === index)
      .filter(video => matchesGlobalFeedRules(video, feedSettings, hideShorts, { ignoreWatched: true }) && !isDismissedVideo(dismissed, video))
    : undefined

  const selectChip = useCallback(async (chipId: string) => {
    if (chipId === activeChipId && !chipError) return
    const retryError = chipId === activeChipId && Boolean(chipError)
    const seq = ++relatedRequestRef.current.seq
    const targetVideo = videoId
    setActiveChipId(chipId)
    setChipError(undefined)
    setMoreLoading(false)
    setMoreFailedCursor(undefined)
    if (chipId === '') {
      setFilteredPages(undefined)
      setChipLoading(false)
      return
    }
    setFilteredPages([])
    setChipLoading(true)
    const result = await client.query(
      RELATED_MORE_QUERY,
      { cursor: chipId },
      { requestPolicy: retryError ? 'network-only' : 'cache-first' },
    ).toPromise()
    if (relatedRequestRef.current.seq !== seq || relatedRequestRef.current.videoId !== targetVideo) return
    setChipLoading(false)
    if (result.error || !result.data?.relatedVideos) {
      setChipError(result.error?.message ?? 'Could not load related videos.')
      return
    }
    setFilteredPages([result.data.relatedVideos])
  }, [activeChipId, chipError, client, videoId])

  const loadMoreRelated = useCallback(async () => {
    if (!relatedCursor || moreLoading || chipLoading) return
    const seq = relatedRequestRef.current.seq
    const targetVideo = videoId
    const targetChip = activeChipId
    const cursor = relatedCursor
    const retryError = moreFailedCursor === cursor
    setMoreLoading(true)
    setMoreFailedCursor(undefined)
    const result = await client.query(
      RELATED_MORE_QUERY,
      { cursor },
      { requestPolicy: retryError ? 'network-only' : 'cache-first' },
    ).toPromise()
    if (relatedRequestRef.current.seq !== seq || relatedRequestRef.current.videoId !== targetVideo) return
    setMoreLoading(false)
    if (result.error || !result.data?.relatedVideos) {
      setMoreFailedCursor(cursor)
      return
    }
    const page = result.data.relatedVideos
    if (targetChip === '') {
      setRelatedPages(pages => pages[pages.length - 1] === page ? pages : [...pages, page])
    } else {
      setFilteredPages(pages => {
        const existing = pages ?? []
        return existing[existing.length - 1] === page ? existing : [...existing, page]
      })
    }
  }, [activeChipId, chipLoading, client, moreFailedCursor, moreLoading, relatedCursor, videoId])
  // gated on the URL: WatchMeta is keyed by video id, so its one `playlist` slot can hold another queue's panel
  const playlist: PlaylistPanelData | undefined =
    listId === undefined || watch?.playlist?.id !== listId ? undefined : watch.playlist

  const [sharing, setSharing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const isLiveWatch = watch?.isLive === true
  const enabledActions = useMemo<readonly WatchActionId[]>(
    () => (isLiveWatch ? ['share', 'save'] : ['share', 'save', 'download']),
    [isLiveWatch],
  )
  const [actionsLayout, setActionsLayout] = useState<{ inline: WatchActionId[], overflow: WatchActionId[] }>(
    () => ({ inline: ['share', 'save', 'download'], overflow: [] }),
  )
  const ownerRowRef = useRef<HTMLDivElement>(null)
  const ownerInfoRef = useRef<HTMLDivElement>(null)
  const likeWrapRef = useRef<HTMLDivElement>(null)
  const moreWrapRef = useRef<HTMLDivElement>(null)
  const actionElsRef = useRef<Partial<Record<WatchActionId, HTMLElement | null>>>({})
  const cachedActionWidths = useRef<Partial<Record<WatchActionId, number>>>({})
  const setActionRef = useCallback((id: WatchActionId) => (el: HTMLElement | null) => {
    actionElsRef.current[id] = el
  }, [])

  useLayoutEffect(() => {
    const ownerRow = ownerRowRef.current
    if (!ownerRow) return

    const measure = () => {
      for (const id of enabledActions) {
        const el = actionElsRef.current[id]
        if (el && el.offsetWidth > 0) cachedActionWidths.current[id] = el.offsetWidth
      }
      const rowWidth = ownerRow.clientWidth
      const stacked = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches
      let availableWidth = rowWidth
      if (!stacked) {
        const ownerInfo = ownerInfoRef.current
        const children = ownerInfo ? [...ownerInfo.children] as HTMLElement[] : []
        const ownerReserve = children.reduce((sum, child, index) => {
          const w = child.classList.contains('owner-text')
            ? Math.min(child.scrollWidth, MAX_OWNER_TEXT_RESERVE)
            : child.offsetWidth
          return sum + w + (index > 0 ? OWNER_ROW_GAP : 0)
        }, 0)
        availableWidth = Math.max(0, rowWidth - ownerReserve - (ownerInfo ? OWNER_ROW_GAP : 0))
      }
      const next = computeVisibleWatchActions({
        availableWidth,
        likeWidth: likeWrapRef.current?.offsetWidth || 150,
        moreWidth: moreWrapRef.current?.offsetWidth || 40,
        actionWidths: cachedActionWidths.current,
        enabled: enabledActions,
        gap: ACTION_ROW_GAP,
      })
      setActionsLayout(prev =>
        prev.inline.join(',') === next.inline.join(',') && prev.overflow.join(',') === next.overflow.join(',')
          ? prev
          : next,
      )
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    observer?.observe(ownerRow)
    if (ownerInfoRef.current) observer?.observe(ownerInfoRef.current)
    if (likeWrapRef.current) observer?.observe(likeWrapRef.current)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [watch?.id, enabledActions, channel?.isSubscribed, watch?.likeCountText])
  const [chatHiddenFor, setChatHiddenFor] = useState<string | undefined>(undefined)
  const [chatEmojis, setChatEmojis] = useState<{ videoId: string, items: readonly LiveChatEmoji[] }>({
    videoId: '',
    items: [],
  })
  const handleChatEmojis = useCallback(
    (items: readonly LiveChatEmoji[]) => setChatEmojis({ videoId, items }),
    [videoId],
  )
  // held as the video it was opened on, so the next video starts with the panel closed
  const [replayFor, setReplayFor] = useState<string | undefined>(undefined)
  const replayOpen = watch?.hasChatReplay === true && replayFor === videoId
  const oneColumn = useMediaQuery(ONE_COLUMN)
  const replay = replayOpen
    ? <ChatReplay key={`replay:${videoId}`} videoId={videoId} onClose={() => setReplayFor(undefined)} />
    : undefined
  const overScreen = useOverScreenSettings()
  const chatHidden = chatHiddenFor === videoId
  const keepChatMounted = !chatHidden || overScreen.enabled
  const theaterChatDocked = inTheater && !oneColumn && ((watch?.isLive === true && !chatHidden) || replayOpen)
  const [chatSlot, setChatSlot] = useState<HTMLDivElement | null>(null)
  const bindChatSlot = useCallback((el: HTMLDivElement | null) => {
    setChatSlot((current) => {
      if (el) return el
      return current && !current.isConnected ? null : current
    })
  }, [])
  const liveChatSlot = watch?.isLive
    ? keepChatMounted
      ? <div className='live-chat-slot' ref={bindChatSlot} />
      : <LiveChatTeaser onShow={() => setChatHiddenFor(undefined)} />
    : undefined

  const chapters = watch?.chapters ?? []
  const playingHere = playerSession.videoId === videoId
  const chapter = playingHere ? playerSession.chapter : -1
  const stageRef = useRef<HTMLDivElement>(null)
  const transcript = watch?.transcriptPanel ?? undefined
  const videoPanel = playingHere
    ? watchPanel({
      videoId,
      open: playerSession.panel,
      chapters,
      chapter,
      transcript,
      fit: oneColumn || inTheater ? undefined : stageRef,
    })
    : undefined

  if (unavailable) {
    return (
      <main css={unavailableStyle}>
        <h1>{unavailable}</h1>
        <Link href='/' className='home'>GO TO HOME</Link>
      </main>
    )
  }

  return (
    <main
      css={style}
      className={inTheater
        ? ['theater', theater === 'fullscreen' ? 'theater-fullscreen' : '', theaterChatDocked ? 'theater-chat' : ''].filter(Boolean).join(' ')
        : undefined}
    >
      <div className='stage' ref={stageRef}>
        {/* The player is NOT mounted here: it lives above the router, so leaving the page docks it rather than destroying its SABR session */}
        <div className='player-slot' ref={claimPlayer} />
      </div>
      {oneColumn && videoPanel ? <div className='panel-slot'>{videoPanel}</div> : undefined}
      <div className='columns'>
        <div className='primary'>
          {oneColumn ? (replay ?? liveChatSlot) : undefined}
          {watch?.title ? <h1 className='title'>{watch.title}</h1> : undefined}
          {watch?.isMembersOnly ? <MembersOnly /> : undefined}
          {watchError && !watch && !watchFetching ? <DataFailure error={watchError} reexecute={reexecuteWatch} /> : undefined}
          {watch
            ? (
              <div className='owner-row' ref={ownerRowRef}>
                {/* youtube.com opens the choice of a collaboration's channels from its avatars, its names and its Subscribe */}
                {watch.byline?.length && watch.collaborators?.length
                  ? (
                    <div className='owner-info' ref={ownerInfoRef}>
                      <CollaboratorsButton channels={watch.collaborators} subscribe className='avatars' label='Collaboration channels'>
                        <AvatarStack channels={watch.collaborators} />
                      </CollaboratorsButton>
                      <div className='owner-text'>
                        <CollaboratorsButton channels={watch.collaborators} subscribe className='channel-name'>
                          <span className='name'><BylineNames parts={watch.byline} /></span>
                        </CollaboratorsButton>
                      </div>
                      <div css={subscribeStyle}>
                        <CollaboratorsButton channels={watch.collaborators} subscribe className='subscribe'>Subscribe</CollaboratorsButton>
                      </div>
                    </div>
                  )
                  : channel
                  ? (
                    <div className='owner-info' ref={ownerInfoRef}>
                      <Link
                        href={`/channel/${channel.id}`}
                        className={channel.avatar ? 'avatar' : 'avatar fallback'}
                        aria-label={channel.name}
                      >
                        {channel.avatar
                          ? <img src={channel.avatar} alt='' loading='lazy' />
                          : channel.name.slice(0, 1).toUpperCase()}
                      </Link>
                      <div className='owner-text'>
                        <Link href={`/channel/${channel.id}`} className='channel-name'>
                          <span className='name'>{channel.name}</span>
                          <VerifiedBadge channel={channel} />
                        </Link>
                        {channel.subscriberCountText
                          ? <div className='sub-count'>{channel.subscriberCountText}</div>
                          : undefined}
                      </div>
                      <SubscribeButton
                        channelId={channel.id}
                        subscribed={channel.isSubscribed}
                        notificationLevel={channel.notificationLevel}
                        compact
                      />
                    </div>
                  )
                  : undefined}
                <div className='actions'>
                  <div className='action-slot' ref={likeWrapRef}>
                    <LikePill videoId={videoId} likeStatus={watch?.likeStatus} likeCountText={watch?.likeCountText} />
                  </div>
                  {actionsLayout.inline.map((id) => {
                    if (id === 'share') {
                      return (
                        <div key='share' className='action-slot' ref={setActionRef('share')}>
                          <button
                            type='button'
                            className='round'
                            aria-label='Share'
                            onClick={() => setSharing(true)}
                          >
                            <Share2 size={20} strokeWidth={1.5} aria-hidden='true' />
                          </button>
                          <span className='action-tooltip' role='tooltip'>Share</span>
                        </div>
                      )
                    }
                    if (id === 'save') {
                      return (
                        <div key='save' className='action-slot' ref={setActionRef('save')}>
                          <SaveMenu
                            videoId={videoId}
                            trigger={(
                              <button type='button' className='round' aria-label='Save'>
                                <Bookmark size={20} strokeWidth={1.5} aria-hidden='true' />
                              </button>
                            )}
                          />
                          <span className='action-tooltip' role='tooltip'>Save</span>
                        </div>
                      )
                    }
                    return (
                      <div key='download' className='action-slot' ref={setActionRef('download')}>
                        <button
                          type='button'
                          className='round'
                          aria-label='Download'
                          onClick={() => openDownloadDialog({
                            videoId,
                            title: watch.title ?? 'Video',
                            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                            channelName: channel?.name ?? watch.byline?.map(part => part.text).join(' '),
                          })}
                        >
                          <Download size={20} strokeWidth={1.5} aria-hidden='true' />
                        </button>
                        <span className='action-tooltip' role='tooltip'>Download</span>
                      </div>
                    )
                  })}
                  <div className='action-slot action-slot-end' ref={moreWrapRef}>
                    <Menu
                      label='More actions'
                      trigger={
                        <button type='button' className='round' aria-label='More actions'>
                          <Ellipsis size={20} strokeWidth={1.5} />
                        </button>
                      }
                    >
                      {actionsLayout.overflow.includes('save')
                        ? <MenuItem icon={Bookmark} label='Save' onSelect={() => setSaving(true)} />
                        : undefined}
                      {actionsLayout.overflow.includes('download')
                        ? (
                          <MenuItem
                            icon={Download}
                            label='Download'
                            onSelect={() => openDownloadDialog({
                              videoId,
                              title: watch.title ?? 'Video',
                              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                              channelName: channel?.name ?? watch.byline?.map(part => part.text).join(' '),
                            })}
                          />
                        )
                        : undefined}
                      {channel
                        ? <MenuItem icon={FolderPlus} label='Groups' onSelect={() => setGrouping(true)} />
                        : undefined}
                      <MenuItem
                        icon={Flag}
                        label='Report'
                        onSelect={() => {
                          window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, '_blank', 'noopener,noreferrer')
                        }}
                      />
                    </Menu>
                    <span className='action-tooltip' role='tooltip'>More actions</span>
                  </div>
                </div>
              </div>
            )
            : undefined}
          <div className='about'>
            {watch?.description || watch?.viewCountText || watch?.publishedDateText
              ? (
                <DescriptionBox
                  key={`description:${videoId}`}
                  {...descriptionOf(watch)}
                  videoId={videoId}
                  thumbnail={videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : undefined}
                  chapters={chapters}
                  currentChapter={chapter}
                  onViewChapters={() => setPanel('chapters')}
                  onShowTranscript={transcript ? () => setPanel('transcript') : undefined}
                />
              )
              : undefined}
            {watch?.hasChatReplay ? <ChatReplayTeaser open={replayOpen} onOpen={() => setReplayFor(videoId)} /> : undefined}
          </div>
        </div>
        {watchFetching || playlist || queue.items.length > 0 || (watch?.isLive && !oneColumn && !theaterChatDocked) || (replayOpen && !theaterChatDocked) || (related && related.length > 0) || relatedChips.length > 0 || chipLoading || Boolean(chipError) || (!oneColumn && videoPanel)
          ? (
            <aside className='secondary'>
              {oneColumn || theaterChatDocked ? undefined : replay}
              {oneColumn || theaterChatDocked ? undefined : liveChatSlot}
              {oneColumn ? undefined : videoPanel}
              {playlist ? <PlaylistPanel playlist={playlist} /> : queue.items.length > 0 ? <QueuePanel /> : undefined}
              {relatedChips.length > 0
                ? (
                  <div className='related-chips' role='region' aria-label='Related video filters'>
                    <Rail label='filters' count={relatedChips.length} variant='edge' resetKey={videoId}>
                      {relatedChips.map(chip => {
                        const active = chip.id === activeChipId
                        return (
                          <button
                            key={`${chip.id}:${chip.label}`}
                            type='button'
                            className={active ? 'related-chip active' : 'related-chip'}
                            aria-pressed={active}
                            onClick={() => void selectChip(chip.id)}
                          >
                            {chip.label}
                          </button>
                        )
                      })}
                    </Rail>
                  </div>
                )
                : undefined}
              {chipError
                ? (
                  <p className='related-notice'>
                    <span>{chipError}</span>
                    <button type='button' className='related-retry' onClick={() => void selectChip(activeChipId)}>
                      Retry
                    </button>
                  </p>
                )
                : !chipLoading && activeChipId !== '' && related?.length === 0
                ? <p className='related-notice'>No videos under this filter.</p>
                : oneColumn
                ? (
                  <div className='related-grid'>
                    {related
                      ? related.map(item => (
                        <VideoCard
                          key={item.id}
                          video={item.isShort ? { ...item, isShort: undefined } : item}
                          variant='shelf'
                          recommendable
                        />
                      ))
                      : RELATED_SKELETON_KEYS.map(key => <VideoCardSkeleton key={key} />)}
                  </div>
                )
                : related
                ? related.map(item => <VideoCardCompact key={item.id} video={item} recommendable />)
                : RELATED_SKELETON_KEYS.map(key => <VideoCardCompactSkeleton key={key} />)}
              {relatedCursor && !chipError
                ? oneColumn
                  ? (
                    <button
                      type='button'
                      className='show-more-related'
                      disabled={moreLoading || chipLoading}
                      onClick={() => void loadMoreRelated()}
                    >
                      {moreLoading ? 'Loading…' : moreFailedCursor === relatedCursor ? 'Retry' : 'Show more'}
                    </button>
                  )
                  : moreFailedCursor === relatedCursor
                  ? (
                    <button
                      type='button'
                      className='show-more-related'
                      disabled={moreLoading || chipLoading}
                      onClick={() => void loadMoreRelated()}
                    >
                      Retry
                    </button>
                  )
                  : (
                    <FeedSentinel
                      onVisible={() => void loadMoreRelated()}
                      disabled={moreLoading || chipLoading}
                    />
                  )
                : undefined}
            </aside>
          )
          : undefined}
        <div className='comments-slot'>
          {!watchFetching && watch && !watch.commentsHidden
            ? (
              <Comments
                key={`comments:${videoId}`}
                videoId={videoId}
                commentCountText={watch.commentCountText}
                extraCustomEmojis={chatEmojis.videoId === videoId ? chatEmojis.items : undefined}
              />
            )
            : undefined}
        </div>
      </div>
      {theaterChatDocked
        ? <aside className='theater-chat-rail' aria-label='Live chat rail'>{replay ?? liveChatSlot}</aside>
        : undefined}
      {watch?.isLive && keepChatMounted
        ? (
          <LiveChat
            key={`chat:${videoId}`}
            videoId={videoId}
            subscribed={channel?.isSubscribed ?? undefined}
            hidden={chatHidden}
            panelContainer={chatSlot}
            onHide={() => setChatHiddenFor(videoId)}
            onShow={() => setChatHiddenFor(undefined)}
            onCustomEmojis={handleChatEmojis}
          />
        )
        : undefined}
      {sharing ? <ShareDialog videoId={videoId} title={watch?.title ?? undefined} list={listId} onClose={() => setSharing(false)} /> : undefined}
      {saving ? <SaveDialog videoId={videoId} onClose={() => setSaving(false)} /> : undefined}
      {grouping && channel
        ? (
          <GroupsDialog
            channel={{ id: channel.id, name: channel.name, avatar: channel.avatar ?? undefined }}
            hints={{ handle: channel.handle, isVerifiedArtist: channel.isVerifiedArtist }}
            onClose={() => setGrouping(false)}
          />
        )
        : undefined}
    </main>
  )
}

export default WatchPage
