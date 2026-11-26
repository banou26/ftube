import type { Source, SourceChannel, SourceChannelHome, SourceChannelPage, SourceChannelTab, SourceChatReplayView, SourceCommentPage, SourceCommentSort, SourceHashtagPage, SourceHashtagTab, SourceLikeStatus, SourceLiveChatEmoji, SourceLiveChatInputState, SourceLiveChatLeaderboardEntryPoint, SourceLiveChatMessage, SourceLiveChatPage, SourceLiveChatPinnedMessage, SourceLiveChatPoll, SourceLiveChatTickerItem, SourceNotificationLevel, SourcePlaylist, SourcePlaylistItem, SourcePlaylistListPage, SourcePlaylistPage, SourcePlaylistPrivacy, SourceSearchFeature, SourceSearchFilters, SourceSearchPage, SourceSearchResult, SourceHomePage, SourceNotificationPage, SourcePostPage, SourceSectionedVideoPage, SourceShort, SourceShortsPage, SourceVideo, SourceVideoPage } from '../types'
import type { EntityMutation } from './normalize'

import { Innertube, Utils, YTNodes } from 'youtubei.js/web'

import { CHANNEL_NOT_FOUND, CHANNEL_UNAVAILABLE, PLAYLIST_UNAVAILABLE } from '../types'
import { channelFeedUrl, createPacer, isChannelId, parseChannelFeed, timeFromAgo } from './channel-feed'
import { applyPollPatch, liveChatToken, nextLiveChatDelayMs, parseLiveChatLeaderboard, parseLiveChatResponse, parseSendLiveChatResult } from './live-chat'
import { approximateCount, chatReplayToken, normalizeChannel, normalizeChannelShelf, normalizeChannelTags, normalizeCommentThread, normalizeCommentView, normalizeFeedChannel, normalizeFeedVideo, normalizeGridPlaylist, normalizeGridShow, normalizeLiveChatMessage, normalizeLockupVideo, normalizeNotification, normalizePlaylistDetails, normalizePlaylistItem, normalizePlaylistLockup, normalizePlaylistLockupItem, normalizeChannelAbout, normalizeCommunityPost, normalizeFeaturedVideo, normalizeSearchCard, normalizeSearchChannel, normalizeSearchShelf, normalizeSearchTopic, normalizeSession, normalizeShortsLockup, normalizeStoreShelf, normalizeTranscript, normalizeVideoDetails, normalizeWatchMeta } from './normalize'
import { base64Bytes, encodeHashtagParams, encodeLiveMessageParams, protoField } from './protobuf'
import { readSearchSuggestions, searchSuggestionsUrl } from './suggestions'

type Feed = {
  videos: Iterable<unknown>
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<Feed>
}

type ChipEndpoint = { payload?: { token?: string, params?: string } }

// a ChipCloudChip or ChipView carries `text` and `endpoint`, a ListItemView out of a dropdown `title` and `renderer_context.command_context.on_tap`
type FilterChip = {
  text?: unknown
  title?: unknown
  is_selected?: boolean
  selected?: boolean
  endpoint?: ChipEndpoint
  renderer_context?: { command_context?: { on_tap?: ChipEndpoint } }
}

type HomeFeedResponse = Feed & {
  filter_nodes?: { primary_filters?: FilterChip[] }
  applyFilter?: (chip: FilterChip) => Promise<HomeFeedResponse>
}

type SectionedFeed = Feed & {
  sections?: { header?: { title?: unknown }, contents?: Iterable<unknown> }[]
  search?: (query: string) => Promise<SectionedFeed>
  clearWatchHistory?: () => Promise<boolean>
  removeVideo?: (videoId: string, pagesToLoad?: number) => Promise<unknown>
}

type ChannelsFeed = {
  channels?: Iterable<unknown>
  has_continuation?: boolean
  getContinuation?(): Promise<ChannelsFeed>
}

export type YoutubeSearchFilters = {
  upload_date?: string
  type?: string
  duration?: string
  prioritize?: string
  features?: string[]
}

type SearchFeed = Feed & {
  results?: Iterable<unknown>
  refinements?: string[]
  estimated_results?: number
  watch_card?: unknown
  page?: { entity_mutations?: EntityMutation[] }
  header?: { chip_bar?: { chips?: SearchChip[] } }
  applyRefinement?: (chip: SearchChip) => Promise<SearchFeed>
}

type ChannelFeed = Feed & {
  metadata?: unknown
  has_home?: boolean
  has_videos?: boolean
  has_shorts?: boolean
  has_live_streams?: boolean
  has_releases?: boolean
  has_podcasts?: boolean
  has_courses?: boolean
  has_shows?: boolean
  has_playlists?: boolean
  has_community?: boolean
  has_search?: boolean
  sort_filters?: string[]
  getVideos?: () => Promise<ChannelFeed>
  getShorts?: () => Promise<ChannelFeed>
  getLiveStreams?: () => Promise<ChannelFeed>
  getReleases?: () => Promise<ChannelFeed>
  getPodcasts?: () => Promise<ChannelFeed>
  getCourses?: () => Promise<ChannelFeed>
  getShows?: () => Promise<ChannelFeed>
  getPlaylists?: () => Promise<ChannelFeed>
  getCommunity?: () => Promise<ChannelFeed>
  getAbout?: () => Promise<unknown>
  has_about?: boolean
  applySort?: (sort: string) => Promise<ChannelFeed>
  // a dropdown's sort goes by its label, and the chip after it as the second argument
  applyFilter?: (filter: SortChip | string, secondary?: string) => Promise<ChannelFeed>
  filter_nodes?: { primary_filters?: DropdownRow[] }
  search?: (query: string) => Promise<ChannelFeed>
  hasTabWithURL?: (word: string) => boolean
  getTabByURL?: (word: string) => Promise<ChannelFeed>
  current_tab?: {
    endpoint?: { metadata?: { url?: string } }
    content?: { contents?: Iterable<{ contents?: Iterable<unknown>, content?: unknown }> }
  }
}

// youtubei.js 18 adds `selected`; 17 leaves the chip's state unparsed
type SortChip = { text?: string, display_type?: string, selected?: boolean }

type DropdownRow = { title?: { toString(): string }, is_selected?: boolean }

type PostsFeed = Feed & {
  posts?: Iterable<unknown>
}

type ContinuationNode = {
  endpoint?: { call(actions: unknown, args: { parse: true }): Promise<unknown> }
  button?: { endpoint?: { call(actions: unknown, args: { parse: true }): Promise<unknown> } }
}

type CommentThreadNode = {
  comment_replies_data?: { contents?: Iterable<unknown>, sub_threads?: Iterable<unknown> } | null
}

type EndpointNode = {
  call(actions: unknown, args?: Record<string, unknown>): Promise<unknown>
}

type CommentActionNode = {
  like_command?: EndpointNode
  dislike_command?: EndpointNode
  unlike_command?: EndpointNode
  undislike_command?: EndpointNode
  reply_command?: { dialog?: { reply_button?: { endpoint?: EndpointNode } } }
}

type WatchNextContainer = {
  contents_memo?: { get(type: string): unknown[] | undefined }
}

// A ContinuationItem hangs its next page off its own endpoint on the first hop and off a "Load more" button afterwards.
const findContinuation = (nodes: Iterable<unknown>): EndpointNode | undefined => {
  for (const node of nodes) {
    const item = node as ContinuationNode
    const endpoint = item?.button?.endpoint ?? item?.endpoint
    if (endpoint) return endpoint
  }
  return undefined
}

type ContinuationResponse = {
  on_response_received_actions_memo?: Map<string, unknown[]>
  on_response_received_endpoints_memo?: Map<string, unknown[]>
}

type ReelEntry = {
  payload?: {
    videoId?: string
    thumbnail?: { thumbnails?: { url?: string, width?: number, height?: number }[] }
    unserializedPrefetchData?: {
      playerResponse?: { videoDetails?: { title?: string } }
    }
  }
}

type ShortsSequence = {
  basic_info?: unknown
  watch_next_feed?: ReelEntry[]
  wn_has_continuation: boolean
  getWatchNextContinuation(): Promise<ShortsSequence>
}

const normalizeReelEntry = (entry: ReelEntry): SourceShort | undefined => {
  const id = entry?.payload?.videoId
  if (!id) return undefined
  const poster = [...(entry.payload?.thumbnail?.thumbnails ?? [])]
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
  return {
    id,
    poster,
    title: entry.payload?.unserializedPrefetchData?.playerResponse?.videoDetails?.title,
  }
}

type NotificationsFeed = {
  contents?: Iterable<unknown>
  getContinuation(): Promise<NotificationsFeed>
}

type CommentsFeed = {
  contents: Iterable<unknown>
  header?: {
    comments_count?: unknown
    count?: unknown
    create_renderer?: {
      submit_button?: { endpoint?: EndpointNode, on_tap?: EndpointNode } | null
    } | null
  }
  has_continuation: boolean
  getContinuation(): Promise<CommentsFeed>
}

type PlaylistsFeed = {
  playlists?: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistsFeed>
}

type LiveChatReplayResponse = {
  continuation_contents?: {
    actions?: { video_offset_time_msec?: string, actions?: { type?: string, item?: unknown }[] }[]
    header?: { view_selector?: { sub_menu_items?: { continuation?: string }[] } }
    continuation?: { token?: string }
  }
}

type PlaylistFeed = {
  info?: unknown
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistFeed>
}

// `browse/edit_playlist` forwards the array verbatim, so an action it does not know is silently ignored rather than rejected.
type PlaylistEditAction = {
  action: string
  addedVideoId?: string
  setVideoId?: string
  movedSetVideoIdPredecessor?: string
  playlistName?: string
  playlistDescription?: string
  playlistPrivacy?: SourcePlaylistPrivacy
}

type ApiResponse = {
  success?: boolean
  data?: { playlistId?: string }
}

type SeedlessReelResponse = {
  data?: { replacementEndpoint?: { reelWatchEndpoint?: { videoId?: string } } }
}

export type YoutubeClient = {
  getHomeFeed(): Promise<HomeFeedResponse>
  getSubscriptionsFeed(): Promise<SectionedFeed>
  getHistory(): Promise<SectionedFeed>
  getChannelsFeed(): Promise<ChannelsFeed>
  search(query: string, filters?: YoutubeSearchFilters): Promise<SearchFeed>
  getBasicInfo(id: string): Promise<{ basic_info?: unknown }>
  // `sequenceParams` is patched in: youtubei.js 18.3.0 always builds its own, which reads the general Shorts feed
  getShortsVideoInfo(id: string, client?: undefined, sequenceParams?: string): Promise<ShortsSequence>
  getChannel(id: string): Promise<ChannelFeed>
  resolveURL(url: string): Promise<{ payload?: { browseId?: string, params?: string } }>
  getComments(videoId: string, sortBy?: 'TOP_COMMENTS' | 'NEWEST_FIRST'): Promise<CommentsFeed>
  getPostComments(postId: string, channelId: string, sortBy?: 'TOP_COMMENTS' | 'NEWEST_FIRST'): Promise<CommentsFeed>
  getNotifications(): Promise<NotificationsFeed>
  getUnseenNotificationsCount(): Promise<number>
  getPlaylists(): Promise<PlaylistsFeed>
  getPlaylist(id: string): Promise<PlaylistFeed>
  interact: {
    comment(videoId: string, text: string): Promise<unknown>
    subscribe(channelId: string): Promise<unknown>
    unsubscribe(channelId: string): Promise<unknown>
    setNotificationPreferences(channelId: string, type: SourceNotificationLevel): Promise<unknown>
  }
  session: {
    logged_in: boolean
    context: { client: { hl: string, gl: string } }
  }
  actions: {
    // `playlistId` and `playlistIndex` are the keys /next actually reads: a raw `index` key would go out untouched and be ignored.
    execute(endpoint: '/next', args: { videoId: string, racyCheckOk: boolean, contentCheckOk: boolean, playlistId?: string, playlistIndex?: number, parse: true }): Promise<unknown>
    execute(endpoint: '/like/like' | '/like/dislike' | '/like/removelike', args: { target: { videoId: string } }): Promise<unknown>
    execute(endpoint: 'browse/edit_playlist', args: { playlistId: string, actions: PlaylistEditAction[] }): Promise<ApiResponse>
    execute(endpoint: 'playlist/create', args: { title: string, videoIds: string[], privacyStatus?: SourcePlaylistPrivacy, description?: string }): Promise<ApiResponse>
    execute(endpoint: 'playlist/delete', args: { playlistId: string }): Promise<ApiResponse>
    execute(endpoint: '/reel/reel_item_watch', args: { params: string, inputType: string }): Promise<SeedlessReelResponse>
    execute(endpoint: '/account/accounts_list', args: { client: 'WEB', parse: true }): Promise<{ actions_memo?: { get(type: string): unknown[] | undefined } }>
    execute(endpoint: '/browse', args: { browseId: string, params?: string, parse: true }): Promise<{ header?: { item?: () => unknown }, contents_memo?: Map<string, unknown[]> }>
    execute(endpoint: 'live_chat/get_live_chat', args: { continuation: string, parse: false }): Promise<{ data: unknown }>
    execute(endpoint: '/live_chat/send_message', args: { richMessage: { textSegments: { text: string }[] }, clientMessageId: string, client: 'WEB', params: string, parse: false }): Promise<{ data: unknown }>
    execute(endpoint: 'live_chat/get_live_chat_replay', args: { continuation: string, currentPlayerState: { playerOffsetMs: string }, parse: true }): Promise<unknown>
    // unparsed: youtubei.js 18.3.0 has no parser for the view models of youtube.com's transcript panel
    execute(endpoint: '/get_panel', args: { panelId: string, params: string, parse?: boolean } | { continuation: string, formData: { searchInputFormData: { query: string } } }): Promise<{ data: unknown }>
    execute(endpoint: '/feedback', args: { feedbackTokens: string[], shouldMerge: boolean, isFeedbackTokenUnencrypted: boolean, parse: false }): Promise<unknown>
    execute(endpoint: string, args: { params: string, parse: false }): Promise<{ data: unknown }>
  }
}

// the guide's Shorts entry, read off youtube.com signed out (2026-11-01): params `CA8%3D`, decoded
const SEEDLESS_REEL = { params: 'CA8=', inputType: 'REEL_WATCH_INPUT_TYPE_SEEDLESS' }

// a channel's Videos tab in one /browse call (long uploads newest first, with durations)
const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA'

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
  signedIn?: () => boolean
  onShortsSeed?: (videoId: string) => void
}

const shortsItems = (feed: Pick<Feed, 'memo'>) => {
  const seen = new Set<string>()
  const items: SourceVideo[] = []
  for (const node of feed.memo?.get('ShortsLockupView') ?? []) {
    const short = normalizeShortsLockup(node)
    if (short && !seen.has(short.id)) {
      seen.add(short.id)
      items.push(short)
    }
  }
  return items
}

/**
 * The videos on a page.
 *
 * `includeShorts` is false for a feed that renders its own Shorts shelf: the
 * home grid puts them in a carousel row, so leaving them in the flat list too
 * would show every short twice. A channel's Shorts TAB is the opposite case,
 * where the shorts are the grid.
 */
const pageItems = (feed: Pick<Feed, 'videos' | 'memo'>, { includeShorts = true, own = false }: { includeShorts?: boolean, own?: boolean } = {}) => {
  // normalizeFeedVideo reads the legacy Video/GridVideo nodes of the `videos` getter but not a LockupView, and a modern feed MIXES the two: merging rather than either/or is essential.
  const seen = new Set<string>()
  const items: SourceVideo[] = []
  const add = (video: SourceVideo | undefined) => {
    if (video && !seen.has(video.id)) {
      seen.add(video.id)
      items.push(video)
    }
  }
  for (const node of feed.videos) add(normalizeFeedVideo(node))
  for (const node of feed.memo?.get('LockupView') ?? []) add(normalizeLockupVideo(node, { own }))
  if (includeShorts) for (const short of shortsItems(feed)) add(short)
  return items
}

const pagePlaylists = (feed: Feed, { own = false }: { own?: boolean } = {}) => {
  const seen = new Set<string>()
  const playlists: SourcePlaylist[] = []
  const add = (playlist: SourcePlaylist | undefined) => {
    if (playlist && !seen.has(playlist.id)) {
      seen.add(playlist.id)
      playlists.push(playlist)
    }
  }
  for (const node of feed.memo?.get('LockupView') ?? []) add(normalizePlaylistLockup(node, { own }))
  for (const node of feed.memo?.get('GridPlaylist') ?? []) add(normalizeGridPlaylist(node))
  // Releases and Podcasts serve the legacy `Playlist` renderer, which declares the same fields as GridPlaylist and so needs no normalizer of its own.
  for (const node of feed.memo?.get('Playlist') ?? []) add(normalizeGridPlaylist(node))
  for (const node of feed.memo?.get('GridShow') ?? []) add(normalizeGridShow(node))
  return playlists
}

const CONTINUATION_LIMIT = 64

const createContinuations = <Page>() => {
  type Entry = { kind: string, load: () => Promise<Page>, result?: Promise<Page> }
  const entries = new Map<string, Entry>()
  // an engine a reset replaced counted from 1 too, and the chat panel asks again only when a page names a cursor it has not seen (urql also keeps the old pages under those strings)
  const instance = Math.random().toString(36).slice(2, 8)
  let cursorId = 0

  const register = (kind: string, load: () => Promise<Page>) => {
    const cursor = `youtube:${kind}:${instance}.${++cursorId}`
    entries.set(cursor, { kind, load })
    // Insertion order is eviction order, and `resolve` re-inserts on read, so the cursors a user is actually paging through stay live.
    while (entries.size > CONTINUATION_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return cursor
  }

  const resolve = (kind: string, cursor: string) => {
    const entry = entries.get(cursor)
    if (!entry) throw new Error(`youtube: unknown continuation ${cursor}`)
    if (entry.kind !== kind) throw new Error(`youtube: continuation ${cursor} belongs to ${entry.kind}, not ${kind}`)
    if (!entry.result) {
      const result = entry.load()
      entry.result = result
      void result.catch(() => {
        if (entry.result === result) entry.result = undefined
      })
    }
    entries.delete(cursor)
    entries.set(cursor, entry)
    return entry.result
  }

  const kindOf = (cursor: string) => entries.get(cursor)?.kind

  return { register, resolve, kindOf }
}

// Comment actions are opaque protobuf endpoints minted per comment per session: there is no id or token that can be rebuilt from the comment id.
const ACTION_LIMIT = 256

type CommentActions = {
  like?: EndpointNode
  dislike?: EndpointNode
  unlike?: EndpointNode
  undislike?: EndpointNode
  reply?: EndpointNode
}

const createActionRegistry = () => {
  const entries = new Map<string, { commentId: string, actions: CommentActions }>()
  let actionId = 0

  const register = (commentId: string, actions: CommentActions) => {
    const token = `youtube:comment:${++actionId}`
    entries.set(token, { commentId, actions })
    while (entries.size > ACTION_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return token
  }

  const resolve = (token: string) => {
    const entry = entries.get(token)
    if (!entry) {
      throw new Error('youtube: this comment is no longer available, reload the page and try again')
    }
    entries.delete(token)
    entries.set(token, entry)
    return entry
  }

  return { register, resolve }
}

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  const node = value as { text?: string, toString?: () => string } | undefined
  if (node?.text) return node.text
  const stringified = node?.toString?.()
  return stringified && stringified !== 'N/A' ? stringified : undefined
}

const chipId = (chip: FilterChip) => {
  const endpoint = chip.endpoint ?? chip.renderer_context?.command_context?.on_tap
  return endpoint?.payload?.token ?? endpoint?.payload?.params
}

// removeVideo defaults to scanning a single page, so anything the user has scrolled past would report 'Video not found in watch history'.
const HISTORY_REMOVAL_PAGES = 10

// filter_nodes THROWS when a feed carries more than one chip bar, so it cannot be read with optional chaining.
const filterChipsOf = (feed: HomeFeedResponse): FilterChip[] => {
  try {
    return feed.filter_nodes?.primary_filters ?? []
  } catch {
    return []
  }
}

const UPSTREAM_FEATURE = {
  HD: 'hd',
  SUBTITLES: 'subtitles',
  CREATIVE_COMMONS: 'creative_commons',
  THREE_D: '3d',
  LIVE: 'live',
  PURCHASED: 'purchased',
  FOUR_K: '4k',
  THREE_SIXTY: '360',
  LOCATION: 'location',
  HDR: 'hdr',
  VR180: 'vr180',
} as const satisfies Record<SourceSearchFeature, string>

const unlessAll = (value: string | undefined) =>
  value === undefined || value === 'ALL' ? undefined : value.toLowerCase()

const upstreamFilters = (filters: SourceSearchFilters | undefined): YoutubeSearchFilters | undefined => {
  if (!filters) return undefined
  const mapped: YoutubeSearchFilters = {
    upload_date: unlessAll(filters.uploadDate),
    type: unlessAll(filters.type),
    duration: unlessAll(filters.duration),
    prioritize: unlessAll(filters.sortBy),
    features: filters.features?.map((feature) => UPSTREAM_FEATURE[feature]),
  }
  return Object.values(mapped).some((value) => value !== undefined && value.length !== 0) ? mapped : undefined
}

const filterKey = (filters: SourceSearchFilters | undefined) =>
  [
    filters?.uploadDate ?? '',
    filters?.type ?? '',
    filters?.duration ?? '',
    filters?.sortBy ?? '',
    [...(filters?.features ?? [])].sort().join('+'),
    filters?.unwatched ? 'unwatched' : '',
  ].join('|')

type SearchChip = { endpoint?: { payload?: { token?: unknown } } }

// A search chip's token carries the search's params, base64 in its field 2.3, and their field 2.18.7 is the filter the
// chip applies. Unwatched's is {3: {3: 1}}, and no other chip's: measured 2026-11-10 on bars of 6 and 5 chips (with and
// without Shorts, which varies by query), in English, Japanese and French. Its label is localized and its place varies.
const isUnwatchedChip = (chip: SearchChip) => {
  const token = chip.endpoint?.payload?.token
  if (typeof token !== 'string') return false
  try {
    const params = protoField(base64Bytes(token), [2, 3])
    if (!(params instanceof Uint8Array)) return false
    return protoField(base64Bytes(new TextDecoder().decode(params)), [2, 18, 7, 3, 3]) === 1
  } catch {
    return false
  }
}

const findUnwatchedChip = (feed: SearchFeed) => feed.header?.chip_bar?.chips?.find(isUnwatchedChip)

// Upstream's display order, which is also the order the tab strip renders in. `path` is the last word of the tab's URL.
// Home has no opener: the browse lands on it.
const CHANNEL_TABS = [
  { tab: 'HOME', path: 'featured', has: 'has_home' },
  { tab: 'VIDEOS', path: 'videos', has: 'has_videos', open: 'getVideos' },
  { tab: 'SHORTS', path: 'shorts', has: 'has_shorts', open: 'getShorts' },
  { tab: 'LIVE', path: 'streams', has: 'has_live_streams', open: 'getLiveStreams' },
  { tab: 'RELEASES', path: 'releases', has: 'has_releases', open: 'getReleases' },
  { tab: 'PODCASTS', path: 'podcasts', has: 'has_podcasts', open: 'getPodcasts' },
  { tab: 'COURSES', path: 'courses', has: 'has_courses', open: 'getCourses' },
  { tab: 'SHOWS', path: 'shows', has: 'has_shows', open: 'getShows' },
  { tab: 'PLAYLISTS', path: 'playlists', has: 'has_playlists', open: 'getPlaylists' },
  { tab: 'COMMUNITY', path: 'posts', has: 'has_community', open: 'getCommunity' },
] as const satisfies readonly { tab: SourceChannelTab, path: string, has: keyof ChannelFeed, open?: keyof ChannelFeed }[]

const availableChannelTabs = (feed: ChannelFeed): SourceChannelTab[] => {
  // Annotated rather than inferred: CHANNEL_TABS is narrower than the tab union, so an inferred element type rejects the two appended tabs. Do not drop the annotation.
  const tabs: SourceChannelTab[] = CHANNEL_TABS
    .filter((entry) => feed[entry.has] === true)
    .map((entry) => entry.tab)
  // youtubei.js has no getter for the Store tab, which comes last in upstream's order
  if (feed.hasTabWithURL?.('store') === true) tabs.push('STORE')
  if (feed.has_about === true) tabs.push('ABOUT')
  if (feed.has_search === true) tabs.push('SEARCH')
  return tabs
}

const defaultChannelTab = (available: SourceChannelTab[]): SourceChannelTab =>
  available.find((tab) => tab === 'HOME') ?? available.find((tab) => tab === 'VIDEOS') ?? available[0] ?? 'HOME'

// The tab the browse landed on, which is the one youtube.com opens the channel on. A topic channel's Home has no URL
// (News's is /feed/news_destination, a game's /home), so youtubei.js cannot open it by the word 'featured' as it does a
// channel's: an unknown landing is the Home.
const landedTab = (feed: ChannelFeed): SourceChannelTab | undefined => {
  if (!feed.current_tab) return undefined
  const path = feed.current_tab.endpoint?.metadata?.url?.split('/').pop()
  return CHANNEL_TABS.find((entry) => entry.path === path)?.tab ?? 'HOME'
}

// youtube.com's addresses for a channel other than /channel/<UC id>, which have to be resolved to it first
const CHANNEL_PATH = /^(?:@|c\/|user\/)/

const HOME_SHELVES = new Set(['Shelf', 'ReelShelf', 'RichShelf', 'HorizontalCardList'])

// Walked rather than read off the memo, which files shelves and Shorts shelves under separate keys and so loses their order.
// A section list holds its rows in item sections, a topic channel's rich grid one row per rich section.
const channelHome = (feed: ChannelFeed): SourceChannelHome => {
  const home: SourceChannelHome = { shelves: [] }
  for (const section of feed.current_tab?.content?.contents ?? []) {
    for (const node of section.contents ?? [section.content]) {
      const type = (node as { type?: string } | undefined)?.type
      if (type === 'ChannelVideoPlayer') home.featured ??= normalizeFeaturedVideo(node)
      if (type === 'BackgroundPromo') home.message ??= (node as { body_text?: { text?: string } }).body_text?.text
      const shelf = type && HOME_SHELVES.has(type) ? normalizeChannelShelf(node) : undefined
      if (shelf) home.shelves.push(shelf)
    }
  }
  // ChannelVideoPlayer carries no length or still of its own; borrow both when the same video sits in a Home row
  if (home.featured) {
    const match = home.shelves.flatMap((shelf) => shelf.videos).find((video) => video.id === home.featured!.id)
    if (match) {
      home.featured = {
        ...home.featured,
        durationSeconds: home.featured.durationSeconds ?? match.durationSeconds,
        thumbnail: match.thumbnail ?? home.featured.thumbnail,
        thumbnailSrcset: home.featured.thumbnailSrcset ?? match.thumbnailSrcset,
        isLive: home.featured.isLive ?? match.isLive,
        isMusic: home.featured.isMusic ?? match.isMusic,
        isUpcoming: home.featured.isUpcoming ?? match.isUpcoming,
      }
    }
  }
  return home
}

// The Videos, Shorts and Live tabs sort by a chip bar rather than the sort menu youtubei.js reads. A bar led by a dropdown
// (the Live tab's) holds the sorts inside the dropdown and filters with the chips after it (Members only, Public).
const tabChips = (feed: ChannelFeed) => {
  const chips = ((feed.memo?.get('ChipView') ?? []) as SortChip[])
    .filter((chip): chip is SortChip & { text: string } => Boolean(chip.text))
  if (!chips[0]?.display_type?.includes('DROP_DOWN')) return { sorts: chips, filters: [], menu: false }
  const sorts = (feed.filter_nodes?.primary_filters ?? []).flatMap((item) => {
    const text = item.title?.toString()
    return text ? [{ text, selected: item.is_selected === true }] : []
  })
  return { sorts, filters: chips.slice(1), menu: sorts.length > 0 }
}

const openChannelTab = async (
  feed: ChannelFeed,
  tab: SourceChannelTab,
  query: string | undefined,
): Promise<ChannelFeed> => {
  if (tab === 'ABOUT') return feed
  if (tab === 'STORE') return feed.getTabByURL?.('store') ?? feed
  if (tab === 'SEARCH') {
    if (!query || !feed.search) return feed
    return feed.search(query)
  }
  const entry = CHANNEL_TABS.find((candidate) => candidate.tab === tab)
  const open = entry && 'open' in entry ? feed[entry.open] : undefined
  if (typeof open !== 'function') return feed
  // `.call(feed)` rather than `open()`: every one of these is a prototype method that reaches for `this.getTabByURL`.
  return (open as (this: ChannelFeed) => Promise<ChannelFeed>).call(feed)
}

const LIKE_ENDPOINT = {
  LIKE: '/like/like',
  DISLIKE: '/like/dislike',
  INDIFFERENT: '/like/removelike',
} as const satisfies Record<SourceLikeStatus, string>

// a group page reads one feed per channel, and two browses more for each feed that fails; the relay refuses more than
// 20 requests a second from one address
const FEED_INTERVAL_MS = 100

const SUBSCRIPTION_PAGES = 20

const upstreamCommentSort = (sort: SourceCommentSort | undefined) => sort === 'NEWEST' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'

const requireSignIn = (client: YoutubeClient, action: string) => {
  if (!client.session.logged_in) throw new Error(`youtube: sign in to ${action}`)
}

export const createYoutubeSource = ({ fetch, createClient, signedIn, onShortsSeed }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as unknown as Promise<YoutubeClient>
  const videoContinuations = createContinuations<SourceVideoPage>()
  const sectionContinuations = createContinuations<SourceSectionedVideoPage>()
  const commentContinuations = createContinuations<SourceCommentPage>()
  const playlistContinuations = createContinuations<SourcePlaylistPage>()
  const playlistListContinuations = createContinuations<SourcePlaylistListPage>()
  const searchContinuations = createContinuations<SourceSearchPage>()
  const hashtagContinuations = createContinuations<SourceHashtagPage>()
  const homeContinuations = createContinuations<SourceHomePage>()
  const shortsContinuations = createContinuations<SourceShortsPage>()
  const postContinuations = createContinuations<SourcePostPage>()
  const commentActions = createActionRegistry()
  const notificationContinuations = createContinuations<SourceNotificationPage>()
  const liveChatContinuations = createContinuations<SourceLiveChatPage>()
  const paceFeed = createPacer(FEED_INTERVAL_MS)

  type LiveChatSession = {
    view: SourceChatReplayView
    stopped: boolean
    timer?: ReturnType<typeof setTimeout>
    cancelSleep?: () => void
    buffer: SourceLiveChatMessage[]
    removed: string[]
    removedAuthors: string[]
    pinned?: SourceLiveChatPinnedMessage
    pinnedDirty: boolean
    pinnedCleared: boolean
    customEmojis?: SourceLiveChatEmoji[]
    emojisDirty: boolean
    inputState?: SourceLiveChatInputState
    inputStateDirty: boolean
    slowModeSeconds?: number
    sendParams?: string
    channelId?: string
    leaderboard?: SourceLiveChatLeaderboardEntryPoint
    leaderboardDirty: boolean
    poll?: SourceLiveChatPoll
    pollDirty: boolean
    pollCleared: boolean
    tickerItems: SourceLiveChatTickerItem[]
    tickerDirty: boolean
    reactionBurst: number
    ended: boolean
    failure?: Error
    lastReadAt: number
    waiters: (() => void)[]
  }
  const liveChatSessions = new Map<string, LiveChatSession>()
  const liveChatViewTokens = new Map<string, { TOP?: string, ALL?: string }>()
  const liveChatChannels = new Map<string, string>()

  // A ceiling so the request never looks hung upstream and the UI gets a heartbeat.
  const LIVE_CHAT_WAIT_MS = 4_000
  // The FIRST call waits long enough for the first get_live_chat round trip to arrive immediately instead of returning a blank frame at 400 ms.
  const LIVE_CHAT_OPEN_GRACE_MS = 2_500
  const LIVE_CHAT_IDLE_MS = 60_000
  const LIVE_CHAT_BUFFER_LIMIT = 300
  const LIVE_CHAT_TICKER_LIMIT = 12
  const LIVE_CHAT_MAX_RETRIES = 10

  const safeDecodeParam = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  const wakeSession = (session: LiveChatSession) => {
    for (const done of session.waiters.splice(0, session.waiters.length)) done()
  }

  const waitForLiveChat = (session: LiveChatSession, timeoutMs: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        session.waiters = session.waiters.filter((entry) => entry !== done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      session.waiters.push(done)
    })

  const closeLiveChat = (videoId: string) => {
    const session = liveChatSessions.get(videoId)
    if (!session) return
    liveChatSessions.delete(videoId)
    session.stopped = true
    session.ended = true
    session.cancelSleep?.()
    if (session.timer) clearTimeout(session.timer)
    wakeSession(session)
  }

  const sleepLiveChat = (session: LiveChatSession, ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        session.cancelSleep = undefined
        session.timer = undefined
        resolve()
      }
      session.timer = setTimeout(finish, ms)
      session.cancelSleep = () => {
        if (session.timer) clearTimeout(session.timer)
        finish()
      }
    })

  const hasLiveChatPending = (session: LiveChatSession) =>
    session.buffer.length > 0
    || session.removed.length > 0
    || session.removedAuthors.length > 0
    || session.pinnedDirty
    || session.pinnedCleared
    || session.emojisDirty
    || session.inputStateDirty
    || session.leaderboardDirty
    || session.pollDirty
    || session.pollCleared
    || session.tickerDirty
    || session.reactionBurst > 0
    || session.ended

  const openLiveChat = async (videoId: string, view: SourceChatReplayView = 'TOP', forceReopen = false) => {
    const existing = liveChatSessions.get(videoId)
    if (existing) {
      if (!forceReopen && existing.view === view) return existing
      if (forceReopen && existing.inputState?.status === 'RESTRICTED') liveChatViewTokens.delete(videoId)
      closeLiveChat(videoId)
    }
    const active = await client
    let continuation = liveChatViewTokens.get(videoId)?.[view] ?? liveChatViewTokens.get(videoId)?.TOP
    let channelId = liveChatChannels.get(videoId)
    if (!continuation) {
      const next = await active.actions.execute('/next', { videoId, racyCheckOk: true, contentCheckOk: true, parse: true })
      continuation = liveChatToken(next)
      const meta = normalizeWatchMeta(next, videoId)
      if (meta?.channel?.id) {
        channelId = meta.channel.id
        liveChatChannels.set(videoId, channelId)
      }
      if (continuation) {
        const previous = liveChatViewTokens.get(videoId)
        liveChatViewTokens.set(videoId, { TOP: continuation, ALL: previous?.ALL })
      }
    }
    if (!continuation) return undefined

    const concurrent = liveChatSessions.get(videoId)
    if (concurrent) {
      if (!forceReopen && concurrent.view === view) return concurrent
      closeLiveChat(videoId)
    }

    const session: LiveChatSession = {
      view,
      stopped: false,
      buffer: [],
      removed: [],
      removedAuthors: [],
      pinnedDirty: false,
      pinnedCleared: false,
      emojisDirty: false,
      inputStateDirty: false,
      channelId,
      leaderboardDirty: false,
      pollDirty: false,
      pollCleared: false,
      tickerItems: [],
      tickerDirty: false,
      reactionBurst: 0,
      ended: false,
      lastReadAt: Date.now(),
      waiters: [],
    }
    liveChatSessions.set(videoId, session)

    void (async () => {
      let currentToken = continuation
      let filterPending = view === 'ALL' && !liveChatViewTokens.get(videoId)?.ALL
      let retryCount = 0
      let quietStreak = 0

      while (!session.stopped) {
        try {
          const response = await active.actions.execute('live_chat/get_live_chat', {
            continuation: currentToken,
            parse: false,
          })
          if (session.stopped) break
          retryCount = 0
          const parsed = parseLiveChatResponse(response.data)

          if (parsed.viewTokens) {
            const previous = liveChatViewTokens.get(videoId)
            liveChatViewTokens.set(videoId, {
              TOP: parsed.viewTokens.TOP ?? previous?.TOP,
              ALL: parsed.viewTokens.ALL ?? previous?.ALL,
            })
          }

          if (filterPending) {
            filterPending = false
            const allToken = parsed.viewTokens?.ALL
            if (parsed.selectedView !== 'ALL' && allToken && allToken !== currentToken) {
              currentToken = allToken
              continue
            }
          }

          if (parsed.slowModeUpdate !== undefined) session.slowModeSeconds = parsed.slowModeUpdate
          if (parsed.sendParams) session.sendParams = parsed.sendParams
          else if (parsed.clearSendParams) session.sendParams = undefined

          let nextInput = parsed.inputState
          if (nextInput) {
            if (nextInput.status === 'ENABLED' && nextInput.slowModeSeconds === undefined && session.slowModeSeconds !== undefined) {
              nextInput = { ...nextInput, slowModeSeconds: session.slowModeSeconds }
            }
          } else if (parsed.slowModeUpdate !== undefined && session.inputState?.status === 'ENABLED') {
            nextInput = { ...session.inputState, slowModeSeconds: parsed.slowModeUpdate }
          }
          if (nextInput && JSON.stringify(nextInput) !== JSON.stringify(session.inputState)) {
            session.inputState = nextInput
            session.inputStateDirty = true
          }

          if (parsed.leaderboard && JSON.stringify(parsed.leaderboard) !== JSON.stringify(session.leaderboard)) {
            session.leaderboard = parsed.leaderboard
            session.leaderboardDirty = true
          }

          if (parsed.customEmojis.length > 0) {
            session.customEmojis = parsed.customEmojis
            session.emojisDirty = true
          }

          if (parsed.pinned) {
            session.pinned = parsed.pinned
            session.pinnedDirty = true
            session.pinnedCleared = false
          } else if (session.pinned && parsed.removedBannerIds.includes(session.pinned.id)) {
            session.pinned = undefined
            session.pinnedDirty = false
            session.pinnedCleared = true
          }

          if (parsed.poll) {
            session.poll = parsed.poll
            session.pollDirty = true
            session.pollCleared = false
          } else if (parsed.pollCleared && session.poll) {
            session.poll = undefined
            session.pollDirty = false
            session.pollCleared = true
          } else if (parsed.pollPatch && session.poll) {
            session.poll = applyPollPatch(session.poll, parsed.pollPatch)
            session.pollDirty = true
          }

          if (parsed.tickerItems.length > 0) {
            const seenTicker = new Set(parsed.tickerItems.map((item) => item.id))
            const kept = session.tickerItems.filter((item) => !seenTicker.has(item.id))
            session.tickerItems = [...kept, ...parsed.tickerItems].slice(-LIVE_CHAT_TICKER_LIMIT)
            session.tickerDirty = true
          }

          if (parsed.removedIds.length > 0) session.removed.push(...parsed.removedIds)
          if (parsed.removedAuthorIds.length > 0) session.removedAuthors.push(...parsed.removedAuthorIds)
          if (parsed.reactionBurst > 0) session.reactionBurst = Math.min(6, session.reactionBurst + parsed.reactionBurst)
          if (parsed.items.length > 0) {
            session.buffer.push(...parsed.items)
            if (session.buffer.length > LIVE_CHAT_BUFFER_LIMIT) {
              session.buffer.splice(0, session.buffer.length - LIVE_CHAT_BUFFER_LIMIT)
            }
          }

          if (parsed.ended || !parsed.continuation?.token) {
            session.ended = true
            wakeSession(session)
            break
          }

          currentToken = parsed.continuation.token
          quietStreak = parsed.items.length > 0 ? 0 : quietStreak + 1
          if (hasLiveChatPending(session)) wakeSession(session)

          const delayMs = nextLiveChatDelayMs({
            continuationType: parsed.continuation.type,
            timeoutMs: parsed.continuation.timeoutMs,
            gotItems: parsed.items.length > 0,
            quietStreak,
          })
          await sleepLiveChat(session, delayMs)
        } catch (error) {
          if (session.stopped) break
          session.failure = error instanceof Error ? error : new Error(String(error))
          wakeSession(session)
          retryCount += 1
          if (retryCount >= LIVE_CHAT_MAX_RETRIES) {
            session.ended = true
            wakeSession(session)
            break
          }
          await sleepLiveChat(session, Math.min(4_000, 500 * retryCount))
        }
      }
    })()

    return session
  }

  const drainLiveChat = (videoId: string, session: LiveChatSession): SourceLiveChatPage => {
    session.lastReadAt = Date.now()
    const items = session.buffer.splice(0, session.buffer.length)
    const removedIds = session.removed.splice(0, session.removed.length)
    const removedAuthorIds = session.removedAuthors.splice(0, session.removedAuthors.length)
    const page: SourceLiveChatPage = { items }
    if (removedIds.length) page.removedIds = removedIds
    if (removedAuthorIds.length) page.removedAuthorIds = removedAuthorIds
    if (session.pinnedDirty && session.pinned) {
      page.pinned = session.pinned
      session.pinnedDirty = false
    } else if (session.pinnedCleared) {
      page.pinnedCleared = true
      session.pinnedCleared = false
    }
    if (session.emojisDirty && session.customEmojis) {
      page.customEmojis = session.customEmojis
      session.emojisDirty = false
    }
    if (session.inputStateDirty && session.inputState) {
      page.inputState = session.inputState
      session.inputStateDirty = false
    }
    if (session.leaderboardDirty && session.leaderboard) {
      page.leaderboard = session.leaderboard
      session.leaderboardDirty = false
    }
    if (session.pollDirty && session.poll) {
      page.poll = session.poll
      session.pollDirty = false
    } else if (session.pollCleared) {
      page.pollCleared = true
      session.pollCleared = false
    }
    if (session.tickerDirty) {
      page.tickerItems = [...session.tickerItems]
      session.tickerDirty = false
    }
    if (session.reactionBurst > 0) {
      page.reactionBurst = session.reactionBurst
      session.reactionBurst = 0
    }
    // No cursor once the stream is over: that is what stops the client polling.
    if (session.ended) {
      if (liveChatSessions.get(videoId) === session) closeLiveChat(videoId)
      return page
    }
    const kind = `livechat:${videoId}`
    const view = session.view
    page.cursor = liveChatContinuations.register(kind, async () => {
      const current = liveChatSessions.get(videoId)
      if (!current || current.view !== view) {
        const reopened = await openLiveChat(videoId, view)
        if (!reopened) return { items: [], disabled: true }
        if (!hasLiveChatPending(reopened) && !reopened.failure) {
          await waitForLiveChat(reopened, LIVE_CHAT_OPEN_GRACE_MS)
        }
        return drainLiveChat(videoId, reopened)
      }
      if (!hasLiveChatPending(current) && !current.failure) {
        await waitForLiveChat(current, LIVE_CHAT_WAIT_MS)
      }
      if (current.failure) {
        const failure = current.failure
        current.failure = undefined
        throw failure
      }
      return drainLiveChat(videoId, current)
    })
    return page
  }

  // the token that starts each view of a video's replay at any point: /next names TOP's, and every first page's header both
  const chatReplayViews = new Map<string, { TOP: string, ALL?: string }>()
  const chatReplayContinuations = createContinuations<SourceLiveChatPage>()

  const chatReplayPage = async (videoId: string, token: string, offsetMs: number): Promise<SourceLiveChatPage> => {
    const response = await (await client).actions.execute('live_chat/get_live_chat_replay', {
      continuation: token,
      currentPlayerState: { playerOffsetMs: String(Math.max(0, Math.round(offsetMs))) },
      parse: true,
    }) as LiveChatReplayResponse
    const contents = response.continuation_contents
    // in youtube.com's order, which is also how youtubei.js's own applyFilter tells them apart
    const [top, all] = (contents?.header?.view_selector?.sub_menu_items ?? []).map((item) => item.continuation)
    if (top) chatReplayViews.set(videoId, { TOP: top, ALL: all })
    const items = (contents?.actions ?? []).flatMap((replay) => {
      const at = Number(replay.video_offset_time_msec)
      return (replay.actions ?? []).flatMap((action) => {
        const message = action.type === 'AddChatItemAction' ? normalizeLiveChatMessage(action.item) : undefined
        // the opening notice and the placeholders of removed lines carry no author
        return message?.author && Number.isFinite(at) ? [{ ...message, offsetMs: at }] : []
      })
    })
    const page: SourceLiveChatPage = { items }
    const next = contents?.continuation?.token
    if (next) {
      const reached = items.at(-1)?.offsetMs ?? offsetMs
      page.cursor = chatReplayContinuations.register(`replay:${videoId}`, () => chatReplayPage(videoId, next, reached))
    }
    return page
  }

  const reapIdleLiveChats = (keep: string) => {
    const now = Date.now()
    for (const [videoId, session] of liveChatSessions) {
      if (videoId !== keep && now - session.lastReadAt > LIVE_CHAT_IDLE_MS) closeLiveChat(videoId)
    }
  }
  // Short-lived rather than permanent, and dropped on a subscription write: the header carries subscribe state, and a kept browse would serve the pre-write value.
  // Memoizes one browse per channel: every tab switch used to re-browse it, with About and Community each browsing a SECOND time, and that burst of overlapping POSTs to /browse is what surfaced as an intermittent 405 from the endpoint.
  const CHANNEL_TTL_MS = 60_000
  const channelFetches = new Map<string, { at: number, result: Promise<ChannelFeed> }>()

  const resolveChannelPath = async (path: string) => {
    const endpoint = await (await client)
      .resolveURL(`https://www.youtube.com/${path}`)
      .catch((error: unknown) => {
        // youtubei.js names only the status of a failed request
        throw error instanceof Error && error.message.endsWith('status code 404') ? new Error(CHANNEL_NOT_FOUND, { cause: error }) : error
      })
    const browseId = (endpoint as { payload?: { browseId?: string } }).payload?.browseId
    if (!browseId) throw new Error(`youtube: /${path} does not resolve to a channel`)
    return browseId
  }

  const fetchChannel = async (id: string) => {
    const cached = channelFetches.get(id)
    if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached.result
    const result = CHANNEL_PATH.test(id)
      ? resolveChannelPath(id).then((browseId) => (client).then((active) => active.getChannel(browseId)))
      : (await client).getChannel(id)
    channelFetches.set(id, { at: Date.now(), result })
    void result.catch(() => {
      if (channelFetches.get(id)?.result === result) channelFetches.delete(id)
    })
    return result
  }

  const browseVideosTab = async (channelId: string): Promise<SourceVideo[]> => {
    const response = await paceFeed(async () => (await client).actions.execute('/browse', {
      browseId: channelId,
      params: VIDEOS_TAB_PARAMS,
      parse: true,
    }))
    const memo = response.contents_memo
    return [
      ...(memo?.get('Video') ?? []).map(normalizeFeedVideo),
      ...(memo?.get('GridVideo') ?? []).map(normalizeFeedVideo),
      ...(memo?.get('LockupView') ?? []).map((node) => normalizeLockupVideo(node, { own: true })),
    ].filter((video) => video !== undefined)
  }

  // YouTube's feed server answers 404 to every feed for hours at a time (public reports since 2025-12), so the Videos
  // tab stands in, dated only as finely as its '6d ago'
  const tabUploads = async (channelId: string): Promise<SourceVideo[]> => {
    const result = await paceFeed(() => fetchChannel(channelId))
    if (result.has_videos !== true) return []
    const tab = await paceFeed(() => openChannelTab(result, 'VIDEOS', undefined))
    const now = Date.now()
    return pageItems(tab, { own: true }).map((video) => {
      const views = approximateCount(video.viewCount)
      return { ...video, viewCount: views === undefined ? undefined : String(views), publishedAt: timeFromAgo(video.publishedText, now) }
    })
  }

  const channels = new Map<string, {
    channel: SourceChannel
    page: Omit<SourceChannelPage, 'channel' | 'videos'>
  }>()
  // keyed by what the page was opened with, so one channel can sit under its UC id and a handle at once
  const updateChannel = (channelId: string, change: Partial<SourceChannel>) => {
    for (const [key, entry] of channels) {
      if (entry.channel.id === channelId) channels.set(key, { ...entry, channel: { ...entry.channel, ...change } })
    }
  }
  const knownPlaylists = new Map<string, SourcePlaylist>()

  const homePage = (kind: string, feed: Feed): SourceHomePage => {
    const result: SourceHomePage = {
      items: pageItems(feed, { includeShorts: false }),
      shorts: shortsItems(feed),
    }
    if (feed.has_continuation) {
      result.cursor = homeContinuations.register(kind, async () => homePage(kind, await feed.getContinuation()))
    }
    return result
  }

  const page = (kind: string, feed: Feed, { own = false } = {}): SourceVideoPage => {
    const result: SourceVideoPage = { items: pageItems(feed, { own }), playlists: pagePlaylists(feed, { own }) }
    if (feed.has_continuation) {
      result.cursor = videoContinuations.register(kind, async () => page(kind, await feed.getContinuation(), { own }))
    }
    return result
  }

  // Search rows are read off `results` rather than the `videos` getter, which emits only videos and would drop channel and playlist hits.
  const searchPage = (kind: string, feed: SearchFeed, unwatchedChip: boolean): SourceSearchPage => {
    const results: SourceSearchResult[] = []
    const seen = new Set<string>()
    for (const node of feed.results ?? []) {
      const video = normalizeFeedVideo(node) ?? normalizeLockupVideo(node)
      if (video) {
        if (seen.has(`video:${video.id}`)) continue
        seen.add(`video:${video.id}`)
        results.push({ ...video, kind: 'video' })
        continue
      }
      const playlist = normalizePlaylistLockup(node) ?? normalizeGridPlaylist(node)
      if (playlist) {
        if (seen.has(`playlist:${playlist.id}`)) continue
        seen.add(`playlist:${playlist.id}`)
        results.push({ ...playlist, kind: 'playlist' })
        continue
      }
      const channel = normalizeSearchChannel(node)
      if (channel) {
        if (seen.has(`channel:${channel.id}`)) continue
        seen.add(`channel:${channel.id}`)
        results.push({ ...channel, kind: 'channel' })
        continue
      }
      const card = normalizeSearchCard(node, feed.page?.entity_mutations)
      if (card) {
        results.push({ ...card, kind: 'card' })
        continue
      }
      const shelf = normalizeSearchShelf(node)
      if (shelf) results.push({ ...shelf, kind: 'shelf' })
    }
    const result: SourceSearchPage = {
      results,
      topic: normalizeSearchTopic(feed.watch_card),
      refinements: feed.refinements ?? [],
      estimatedResults: feed.estimated_results,
      unwatchedChip,
    }
    if (feed.has_continuation) {
      result.cursor = searchContinuations.register(
        kind,
        async () => searchPage(kind, await feed.getContinuation() as SearchFeed, unwatchedChip),
      )
    }
    return result
  }

  const hashtagHeader = (headerNode: unknown, fallbackTag: string) => {
    const item = (headerNode as { item?: () => unknown } | undefined)?.item?.() as {
      type?: string
      page_title?: string
      hashtag?: unknown
      hashtag_info?: unknown
      content?: {
        title?: { text?: unknown }
        metadata?: { metadata_rows?: { metadata_parts?: { text?: unknown }[] }[] }
      }
    } | undefined
    if (!item) return { title: `#${fallbackTag}` }
    if (item.type === 'HashtagHeader') {
      return {
        title: text(item.hashtag) ?? `#${fallbackTag}`,
        stats: text(item.hashtag_info),
      }
    }
    const stats = (item.content?.metadata?.metadata_rows ?? [])
      .flatMap((row) => (row.metadata_parts ?? []).map((part) => text(part.text)).filter((value): value is string => Boolean(value)))
      .join(' • ')
    return {
      title: item.page_title ?? text(item.content?.title?.text) ?? `#${fallbackTag}`,
      stats: stats || undefined,
    }
  }

  const continuationMemo = (response: ContinuationResponse) =>
    (response.on_response_received_actions_memo?.size ? response.on_response_received_actions_memo : undefined)
    ?? response.on_response_received_endpoints_memo

  const hashtagPage = (
    kind: string,
    meta: { tag: string, title: string, stats?: string, tab: SourceHashtagTab, availableTabs: SourceHashtagTab[] },
    memo: Map<string, unknown[]> | undefined,
  ): SourceHashtagPage => {
    const feed = { videos: memo?.get('Video') ?? [], memo }
    const result: SourceHashtagPage = {
      ...meta,
      items: meta.tab === 'SHORTS' ? shortsItems(feed) : pageItems(feed),
    }
    const next = findContinuation(memo?.get('ContinuationItem') ?? [])
    if (next) {
      result.cursor = hashtagContinuations.register(kind, async () => {
        const continuation = await next.call((await client).actions, { parse: true }) as ContinuationResponse
        return hashtagPage(kind, meta, continuationMemo(continuation))
      })
    }
    return result
  }

  const notificationClicks = new Map<string, EndpointNode>()

  const notificationPage = (feed: NotificationsFeed): SourceNotificationPage => {
    const items = [...(feed.contents ?? [])].flatMap((node) => {
      const notification = normalizeNotification(node)
      if (!notification) return []
      const click = (node as { record_click_endpoint?: EndpointNode }).record_click_endpoint
      if (click) notificationClicks.set(notification.id, click)
      return [notification]
    })
    const result: SourceNotificationPage = { items }
    // No has_continuation on this menu, so the cursor is minted unconditionally and an exhausted one simply comes back empty.
    if (items.length > 0) {
      result.cursor = notificationContinuations.register(
        'notifications',
        async () => notificationPage(await feed.getContinuation()),
      )
    }
    return result
  }

  const relatedPage = (kind: string, memo: Map<string, unknown[]> | undefined): SourceVideoPage => {
    const seen = new Set<string>()
    const items: SourceVideo[] = []
    const add = (video: SourceVideo | undefined) => {
      if (video && !seen.has(video.id)) {
        seen.add(video.id)
        items.push(video)
      }
    }
    for (const node of memo?.get('CompactVideo') ?? []) add(normalizeFeedVideo(node))
    for (const node of memo?.get('LockupView') ?? []) add(normalizeLockupVideo(node))
    const result: SourceVideoPage = { items, playlists: [] }
    const next = findContinuation(memo?.get('ContinuationItem') ?? [])
    if (next) result.cursor = registerRelated(kind.replace(/^related:/, ''), next)
    return result
  }

  // The reel sequence PAGES BY MUTATION: getWatchNextContinuation() overwrites watch_next_feed on the same object and returns `this`.
  const shortsPage = (info: ShortsSequence, seed?: SourceShort): SourceShortsPage => {
    const seen = new Set<string>()
    const items: SourceShort[] = []
    const add = (short: SourceShort | undefined) => {
      if (short && !seen.has(short.id)) {
        seen.add(short.id)
        items.push(short)
      }
    }
    // The seed's still comes off basic_info, the 16:9 letterboxed frame; when the sequence also lists the seed it carries the true portrait frame.
    const own = (info.watch_next_feed ?? []).find((entry) => entry.payload?.videoId === seed?.id)
    add(seed && { ...seed, poster: normalizeReelEntry(own ?? {})?.poster ?? seed.poster })
    for (const entry of info.watch_next_feed ?? []) add(normalizeReelEntry(entry))
    const result: SourceShortsPage = { items }
    if (info.wn_has_continuation) {
      result.cursor = shortsContinuations.register('shorts', async () => {
        return shortsPage(await info.getWatchNextContinuation())
      })
    }
    return result
  }

  // An anonymous home carries no shorts, so a signed-out pager starts where youtube.com's own guide entry does: a reel watch with no video, which upstream answers with one.
  const seedShort = async (active: YoutubeClient) => {
    if (active.session.logged_in) {
      const seed = shortsItems(await active.getHomeFeed())[0]?.id
      if (seed) return seed
    }
    const reel = await active.actions.execute('/reel/reel_item_watch', SEEDLESS_REEL)
    return reel.data?.replacementEndpoint?.reelWatchEndpoint?.videoId
  }

  const registerRelated = (videoId: string, endpoint: EndpointNode): string => {
    const kind = `related:${videoId}`
    return videoContinuations.register(kind, async () => {
      const response = await endpoint.call((await client).actions, { parse: true }) as ContinuationResponse
      return relatedPage(kind, response.on_response_received_endpoints_memo)
    })
  }

  const postPage = (kind: string, feed: PostsFeed): SourcePostPage => {
    const result: SourcePostPage = {
      items: [...(feed.posts ?? [])].map(normalizeCommunityPost).filter((post) => post !== undefined),
    }
    if (feed.has_continuation) {
      result.cursor = postContinuations.register(
        kind,
        async () => postPage(kind, await feed.getContinuation() as PostsFeed),
      )
    }
    return result
  }

  const sectionedPage = (kind: string, feed: SectionedFeed): SourceSectionedVideoPage => {
    const sections = (feed.sections ?? []).flatMap((section) => {
      const items = [...(section.contents ?? [])]
        .map((node) => normalizeFeedVideo(node) ?? normalizeLockupVideo(node))
        .filter((video) => video !== undefined)
      if (items.length === 0) return []
      return [{ title: text(section.header?.title), items }]
    })
    const result: SourceSectionedVideoPage = {
      sections: sections.length > 0 ? sections : [{ items: pageItems(feed) }],
    }
    if (feed.has_continuation) {
      result.cursor = sectionContinuations.register(
        kind,
        async () => sectionedPage(kind, await feed.getContinuation() as SectionedFeed),
      )
    }
    return result
  }

  const actionsToken = (node: unknown, commentId: string) => {
    const commands = node as CommentActionNode | undefined
    const actions: CommentActions = {
      like: commands?.like_command,
      dislike: commands?.dislike_command,
      unlike: commands?.unlike_command,
      undislike: commands?.undislike_command,
      // Resolved through the reply command's DIALOG, mirroring CommentView.reply(): the command endpoint alone opens a dialog instead of posting.
      reply: commands?.reply_command?.dialog?.reply_button?.endpoint,
    }
    if (!actions.like && !actions.dislike && !actions.reply) return undefined
    return commentActions.register(commentId, actions)
  }

  const repliesPage = (kind: string, memo: Map<string, unknown[]> | undefined): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: (memo?.get('CommentView') ?? []).flatMap((node) => {
        const comment = normalizeCommentView(node)
        return comment ? [{ ...comment, actionsToken: actionsToken(node, comment.id) }] : []
      }),
    }
    const next = (memo?.get('ContinuationItem') ?? [])[0] as ContinuationNode | undefined
    const button = next?.button?.endpoint ?? next?.endpoint
    if (button) {
      result.cursor = commentContinuations.register(kind, async () => {
        const response = await button.call((await client).actions, { parse: true }) as ContinuationResponse
        return repliesPage(kind, response.on_response_received_endpoints_memo)
      })
    }
    return result
  }

  const commentPage = (kind: string, comments: CommentsFeed): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: [...comments.contents].flatMap((node) => {
        const comment = normalizeCommentThread(node)
        if (!comment) return []
        const replies = (node as CommentThreadNode).comment_replies_data
        // youtubei.js 18 parses a threaded comment's replies continuation into `sub_threads`, apart from `contents`
        const continuation = [...(replies?.contents ?? []), ...(replies?.sub_threads ?? [])]
          .find((item) => (item as ContinuationNode).endpoint !== undefined) as ContinuationNode | undefined
        const token = actionsToken((node as { comment?: unknown }).comment, comment.id)
        if (!continuation?.endpoint) return [{ ...comment, actionsToken: token }]
        const repliesKind = `replies:${comment.id}`
        const endpoint = continuation.endpoint
        return [{
          ...comment,
          actionsToken: token,
          repliesCursor: commentContinuations.register(repliesKind, async () => {
            const response = await endpoint.call((await client).actions, { parse: true }) as ContinuationResponse
            return repliesPage(repliesKind, response.on_response_received_endpoints_memo)
          }),
        }]
      }),
      // `count` is the full '2,461,151 Comments' youtube.com heads the list with, `comments_count` only the rounded '2.4M'
      countText: text(comments.header?.count) ?? text(comments.header?.comments_count),
    }
    if (comments.has_continuation) {
      result.cursor = commentContinuations.register(
        kind,
        async () => commentPage(kind, await comments.getContinuation()),
      )
    }
    return result
  }

  const postCommentEndpoints = new Map<string, EndpointNode>()

  // A post's createCommentParams are minted by upstream inside the post's comments header, unlike a video comment whose params youtubei.js builds from the video id.
  const rememberPostCommentEndpoint = (postId: string, channelId: string, feed: CommentsFeed) => {
    const button = feed.header?.create_renderer?.submit_button
    const endpoint = button?.endpoint ?? button?.on_tap
    if (!endpoint) return
    const key = `${postId}:${channelId}`
    postCommentEndpoints.delete(key)
    postCommentEndpoints.set(key, endpoint)
    while (postCommentEndpoints.size > 64) {
      const oldest = postCommentEndpoints.keys().next().value
      if (oldest === undefined) break
      postCommentEndpoints.delete(oldest)
    }
  }

  const firstCommentPage = async (kind: string, read: () => Promise<CommentsFeed>): Promise<SourceCommentPage> => {
    try {
      return commentPage(kind, await read())
    } catch (error) {
      if (error instanceof Error && /did not have any content/i.test(error.message)) {
        return { items: [], disabled: true }
      }
      throw error
    }
  }

  // Read off the memo rather than the `items` getter, which throws on any node outside its union. YouTube serves the rows as LockupView now; PlaylistVideo is the older renderer.
  const playlistItems = (id: string, feed: PlaylistFeed) => [
    ...(feed.memo?.get('PlaylistVideo') ?? []).map(normalizePlaylistItem),
    ...(feed.memo?.get('LockupView') ?? []).map((node) => normalizePlaylistLockupItem(node, id)),
  ].filter((item) => item !== undefined)

  // The playlist entity is threaded through every page rather than re-read: a continuation response carries no header and no sidebar.
  const playlistPage = (id: string, playlist: SourcePlaylist, feed: PlaylistFeed, items: SourcePlaylistItem[]): SourcePlaylistPage => {
    const result: SourcePlaylistPage = { playlist, items }
    if (feed.has_continuation) {
      result.cursor = playlistContinuations.register(`playlist:${id}`, async () => {
        const next = await feed.getContinuation()
        return playlistPage(id, playlist, next, playlistItems(id, next))
      })
    }
    return result
  }

  const rememberPlaylist = (playlist: SourcePlaylist) => {
    knownPlaylists.set(playlist.id, playlist)
    return playlist
  }

  // Only the changed fields are real; none of the edit endpoints hands back a parseable playlist.
  const writtenPlaylist = (id: string, changed: Partial<SourcePlaylist>): SourcePlaylist => {
    const known = knownPlaylists.get(id)
    // `title: known?.title ?? ''` mirrors how setSubscribed fills Channel.name: the schema forbids null there, and the mutation document is not supposed to select it unless the write set it.
    const next: SourcePlaylist = { ...known, id, title: known?.title ?? '', ...changed }
    // Guarded deliberately: a write must not mint a stub that a later read of the library would then be merged into.
    if (known) knownPlaylists.set(id, next)
    return next
  }

  // youtubei.js's PlaylistManager wrappers pay a browse to translate video ids into set video ids, and one of them ships a broken body, so the endpoint is called directly.
  const editPlaylist = async (id: string, reason: string, actions: PlaylistEditAction[]) => {
    const active = await client
    requireSignIn(active, reason)
    await active.actions.execute('browse/edit_playlist', { playlistId: id, actions })
  }

  const playlistListPage = (feed: PlaylistsFeed): SourcePlaylistListPage => {
    const result: SourcePlaylistListPage = {
      items: [...(feed.playlists ?? [])]
        .map((node) => normalizePlaylistLockup(node) ?? normalizeGridPlaylist(node))
        .filter((playlist) => playlist !== undefined)
        .map(rememberPlaylist),
    }
    if (feed.has_continuation) {
      result.cursor = playlistListContinuations.register(
        'playlists',
        async () => playlistListPage(await feed.getContinuation()),
      )
    }
    return result
  }

  return {
    id: 'youtube',
    home: async (chip, cursor) => {
      const kind = chip ? `home:${chip}` : 'home'
      if (cursor) {
        const next = await homeContinuations.resolve(kind, cursor)
        return { items: next.items, shorts: next.shorts, chips: [], cursor: next.cursor }
      }
      const feed = await (await client).getHomeFeed()
      const chips = filterChipsOf(feed)
      const filter = chip ? chips.find((candidate) => chipId(candidate) === chip) : undefined
      const filtered = filter && feed.applyFilter ? await feed.applyFilter(filter) : feed
      const result = homePage(kind, filtered)
      return {
        items: result.items,
        shorts: result.shorts,
        // Chips come from the unfiltered response: the filtered one echoes back a reduced set that would make the rail collapse after one click.
        chips: chips.flatMap((candidate) => {
          const id = chipId(candidate)
          const label = text(candidate.text ?? candidate.title)
          if (!id || !label) return []
          return [{ id, label, selected: candidate.is_selected === true || candidate.selected === true || id === chip }]
        }),
        cursor: result.cursor,
      }
    },
    // Playback is deliberately NOT taken from the sequence even though it prefetches a player response: that would trade a proven path for a preview-tier one.
    shorts: async (seed, cursor, sequence) => {
      if (cursor) return shortsContinuations.resolve('shorts', cursor)
      const active = await client
      const from = seed ?? await seedShort(active)
      if (!from) return { items: [] }
      if (!seed) onShortsSeed?.(from)
      const info = await active.getShortsVideoInfo(from, undefined, sequence)
      const details = (info.basic_info ?? {}) as { id?: string, title?: string, thumbnail?: { url?: string, width?: number }[] }
      const seeded: SourceShort | undefined = details.id
        ? {
            id: details.id,
            title: details.title,
            poster: [...(details.thumbnail ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
          }
        : undefined
      return shortsPage(info, seeded)
    },
    subscriptions: async (cursor) => {
      if (cursor) return videoContinuations.resolve('subscriptions', cursor)
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      return page('subscriptions', await active.getSubscriptionsFeed())
    },
    history: async (cursor, query) => {
      const term = query?.trim() || undefined
      const kind = term ? `history:${term}` : 'history'
      if (cursor) return sectionContinuations.resolve(kind, cursor)
      const active = await client
      requireSignIn(active, 'see your history')
      const feed = await active.getHistory()
      if (term && !feed.search) throw new Error('youtube: this history feed cannot be searched')
      return sectionedPage(kind, term ? await feed.search!(term) : feed)
    },
    subscribedChannels: async (all) => {
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      let feed = await active.getChannelsFeed()
      const nodes = [...(feed.channels ?? [])]
      for (let pages = 1; all && pages < SUBSCRIPTION_PAGES && feed.has_continuation && feed.getContinuation; pages++) {
        feed = await feed.getContinuation()
        nodes.push(...(feed.channels ?? []))
      }
      const channels = new Map<string, SourceChannel>()
      for (const node of nodes) {
        const channel = normalizeFeedChannel(node)
        if (channel && !channels.has(channel.id)) channels.set(channel.id, channel)
      }
      return [...channels.values()]
    },
    channelUploads: async (channelId) => {
      if (!isChannelId(channelId)) throw new Error(`youtube: ${channelId} is not a channel id`)
      const response = await paceFeed(() => fetch(channelFeedUrl(channelId, Date.now())))
      if (response.ok) {
        const feedVideos = parseChannelFeed(await response.text())
        if (feedVideos.length === 0) return feedVideos
        // The XML feed carries exact timestamps and view counts, never durations. One direct Videos-tab browse fills
        // in each video's duration without losing that exact ordering; if it fails, the feed still stands on its own.
        const tabbed = await browseVideosTab(channelId).catch(() => [])
        const durations = new Map<string, number>()
        for (const video of tabbed) if (video.durationSeconds !== undefined) durations.set(video.id, video.durationSeconds)
        return durations.size === 0
          ? feedVideos
          : feedVideos.map((video) => {
              const durationSeconds = durations.get(video.id)
              return durationSeconds === undefined ? video : { ...video, durationSeconds }
            })
      }
      void response.body?.cancel().catch(() => {})
      return tabUploads(channelId)
    },
    search: async (query, filters, cursor) => {
      const kind = `search:${query}:${filterKey(filters)}`
      if (cursor) return searchContinuations.resolve(kind, cursor)
      const feed = await (await client).search(query, upstreamFilters(filters))
      const chip = findUnwatchedChip(feed)
      const shown = filters?.unwatched && chip && feed.applyRefinement ? await feed.applyRefinement(chip) : feed
      return searchPage(kind, shown, chip !== undefined)
    },
    hashtag: async (rawTag, tab = 'ALL', cursor) => {
      const normalized = rawTag.trim().replace(/^#/, '').toLowerCase()
      const kind = `hashtag:${normalized}:${tab}`
      if (cursor) return hashtagContinuations.resolve(kind, cursor)
      if (!normalized) return { tag: '', title: '#', tab, availableTabs: ['ALL'], items: [] }
      const response = await (await client).actions.execute('/browse', {
        browseId: 'FEhashtag',
        params: encodeHashtagParams(normalized, tab),
        parse: true,
      })
      const header = hashtagHeader(response.header, normalized)
      const tabs = (response.contents_memo?.get('Tab') ?? []) as { endpoint?: { metadata?: { url?: string } } }[]
      const availableTabs: SourceHashtagTab[] = ['ALL']
      if (tab === 'SHORTS' || tabs.some((entry) => entry.endpoint?.metadata?.url?.endsWith('/shorts'))) {
        availableTabs.push('SHORTS')
      }
      return hashtagPage(
        kind,
        { tag: normalized, title: header.title, stats: header.stats, tab, availableTabs },
        response.contents_memo,
      )
    },
    searchSuggestions: async (query, previousQuery) => {
      if (query.trim() === '') return []
      try {
        const { session } = await client
        return await readSearchSuggestions(await fetch(searchSuggestionsUrl(query, previousQuery, session.context.client)))
      } catch {
        return []
      }
    },
    video: async (id) => normalizeVideoDetails((await (await client).getBasicInfo(id)).basic_info),
    channel: async (id, tab, sort, query, cursor, filter) => {
      const kind = `channel:${id}:${tab ?? 'DEFAULT'}:${sort ?? ''}:${query ?? ''}:${filter ?? ''}`
      const known = channels.get(id)
      if (cursor) {
        if (!known) throw new Error(`youtube: channel ${id} is not loaded`)
        return {
          ...known.page,
          channel: known.channel,
          videos: await videoContinuations.resolve(kind, cursor),
        }
      }
      // youtubei.js throws upstream's alert as a ChannelError
      const result = await fetchChannel(id).catch((error: unknown) => {
        throw error instanceof Utils.ChannelError ? new Error(`${CHANNEL_UNAVAILABLE}${error.message}`, { cause: error }) : error
      })
      const channel = normalizeChannel(result, id)
      const availableTabs = availableChannelTabs(result)
      const selected = tab && availableTabs.includes(tab) ? tab : landedTab(result) ?? defaultChannelTab(availableTabs)
      let feed = await openChannelTab(result, selected, query)
      const chips = tabChips(feed)
      const sortOptions = feed.sort_filters?.length ? feed.sort_filters : chips.sorts.map((chip) => chip.text)
      const appliedSort = sort && sortOptions.includes(sort) ? sort : undefined
      const filterOptions = chips.filters.map((chip) => chip.text)
      const appliedFilter = filter && filterOptions.includes(filter) ? filter : undefined
      const chip = chips.sorts.find((candidate) => candidate.text === appliedSort)
      const filterChip = chips.filters.find((candidate) => candidate.text === appliedFilter)
      if (chip && !chip.selected && feed.applyFilter) {
        // a dropdown's sort goes by its label, then the filter chip of the answer it brings, as youtube.com sends them
        feed = await (chips.menu ? feed.applyFilter(chip.text, appliedFilter) : feed.applyFilter(chip))
      } else if (filterChip && !filterChip.selected && feed.applyFilter) {
        feed = await feed.applyFilter(filterChip)
      } else if (!chip && appliedSort && feed.applySort) {
        feed = await feed.applySort(appliedSort)
      }
      const rest = { availableTabs, tab: selected, sortOptions, appliedSort, sortMenu: chips.menu, filterOptions, appliedFilter }
      channels.set(id, { channel, page: rest })
      if (selected === 'HOME') return { ...rest, channel, videos: { items: [], playlists: [] }, home: channelHome(feed) }
      if (selected === 'STORE') {
        const store = (feed.memo?.get('Shelf') ?? []).flatMap((shelf) => normalizeStoreShelf(shelf) ?? [])
        return { ...rest, channel, videos: { items: [], playlists: [] }, store }
      }
      if (selected === 'COMMUNITY') {
        return { ...rest, channel, videos: { items: [], playlists: [] }, posts: postPage(`community:${id}`, feed as PostsFeed) }
      }
      return { ...rest, channel, videos: page(kind, feed, { own: true }) }
    },
    channelAbout: async (id) => {
      const result = await fetchChannel(id)
      if (result.has_about !== true || !result.getAbout) return undefined
      return normalizeChannelAbout(await result.getAbout.call(result))
    },
    channelTags: async (id) => normalizeChannelTags(await fetchChannel(id)),
    communityPosts: async (channelId, cursor) => {
      const kind = `community:${channelId}`
      if (cursor) return postContinuations.resolve(kind, cursor)
      const result = await fetchChannel(channelId)
      if (result.has_community !== true || !result.getCommunity) return { items: [] }
      return postPage(kind, await result.getCommunity.call(result) as PostsFeed)
    },
    post: async (id) => {
      const active = await client
      // a post's browse is keyed by its channel too, which only youtube.com's own address for it resolves
      const endpoint = await active.resolveURL(`https://www.youtube.com/post/${encodeURIComponent(id)}`).catch((error: unknown) => {
        if (String(error).includes('status code 404')) return undefined
        throw error
      })
      const { browseId, params } = endpoint?.payload ?? {}
      if (!browseId) return undefined
      const memo = (await active.actions.execute('/browse', { browseId, params, parse: true })).contents_memo
      const nodes = [...(memo?.get('BackstagePost') ?? []), ...(memo?.get('Post') ?? [])] as { id?: string }[]
      return normalizeCommunityPost(nodes.find((node) => node.id === id))
    },
    watch: async (id, playlistId, playlistIndex) => {
      const response = await (await client).actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        // Omitted rather than sent as undefined: a 0 index is meaningful and must survive.
        ...(playlistId ? { playlistId } : {}),
        ...(playlistIndex === undefined ? {} : { playlistIndex }),
        parse: true,
      })
      const meta = normalizeWatchMeta(response, id)
      if (!meta) return undefined
      if (meta.channel?.id) liveChatChannels.set(id, meta.channel.id)
      const liveToken = liveChatToken(response)
      if (liveToken && !liveChatViewTokens.get(id)?.TOP) {
        const prev = liveChatViewTokens.get(id)
        liveChatViewTokens.set(id, { ...prev, TOP: liveToken })
      }
      const replay = chatReplayToken(response)
      if (replay && !chatReplayViews.has(id)) chatReplayViews.set(id, { TOP: replay })
      // Read off secondary_results rather than the memo, which also holds the comments entry's ContinuationItem.
      const watchNext = (response as WatchNextContainer).contents_memo?.get('TwoColumnWatchNextResults')?.[0]
      const secondary = (watchNext as { secondary_results?: unknown[] } | undefined)?.secondary_results ?? []
      const nested = secondary.flatMap((node) => [...((node as { contents?: unknown[] })?.contents ?? [])])
      const continuation = findContinuation([...secondary, ...nested])
      if (!continuation) return meta
      return { ...meta, relatedCursor: registerRelated(id, continuation) }
    },
    transcript: async (panelId, params) =>
      normalizeTranscript((await (await client).actions.execute('/get_panel', { panelId, params })).data),
    transcriptSearch: async (token, query) => normalizeTranscript((await (await client).actions.execute('/get_panel', {
      continuation: token,
      formData: { searchInputFormData: { query } },
    })).data),
    relatedVideos: async (cursor) => {
      const kind = videoContinuations.kindOf(cursor)
      if (kind !== undefined && !kind.startsWith('related:')) {
        throw new Error(`youtube: continuation ${cursor} belongs to ${kind}, not a watch sidebar`)
      }
      return videoContinuations.resolve(kind ?? 'related:unknown', cursor)
    },
    commentReplies: async (cursor) => {
      const kind = commentContinuations.kindOf(cursor)
      if (kind !== undefined && !kind.startsWith('replies:')) {
        throw new Error(`youtube: continuation ${cursor} belongs to ${kind}, not a reply thread`)
      }
      return commentContinuations.resolve(kind ?? 'replies:unknown', cursor)
    },
    comments: async (videoId, sort, cursor) => {
      const kind = `comments:${videoId}:${sort ?? 'TOP'}`
      if (cursor) return commentContinuations.resolve(kind, cursor)
      return firstCommentPage(kind, async () => (await client).getComments(videoId, upstreamCommentSort(sort)))
    },
    postComments: async (postId, channelId, sort, cursor) => {
      const kind = `post-comments:${postId}:${sort ?? 'TOP'}`
      if (cursor) return commentContinuations.resolve(kind, cursor)
      return firstCommentPage(kind, async () => {
        const feed = await (await client).getPostComments(postId, channelId, upstreamCommentSort(sort))
        rememberPostCommentEndpoint(postId, channelId, feed)
        return feed
      })
    },
    playlists: async (cursor) => {
      if (cursor) return playlistListContinuations.resolve('playlists', cursor)
      const active = await client
      requireSignIn(active, 'see your playlists')
      return playlistListPage(await active.getPlaylists())
    },
    // Deliberately not sign-in gated: a public playlist opens signed out.
    playlist: async (id, cursor) => {
      if (cursor) return playlistContinuations.resolve(`playlist:${id}`, cursor)
      // youtubei.js throws upstream's alert as an InnertubeError carrying it
      const feed = await (await client).getPlaylist(id).catch((error: unknown) => {
        throw error instanceof Utils.InnertubeError && error.info instanceof YTNodes.Alert
          ? new Error(`${PLAYLIST_UNAVAILABLE}${error.message}`, { cause: error })
          : error
      })
      const items = playlistItems(id, feed)
      const details = normalizePlaylistDetails(feed, id)
      // The cover has to be resolved before the continuation closure captures the playlist: page two would otherwise hand back the same entity with its cover cleared.
      const playlist = rememberPlaylist({ ...details, thumbnail: details.thumbnail ?? items[0]?.video.thumbnail })
      return playlistPage(id, playlist, feed, items)
    },
    // youtubei.js's InteractionManager issues like/dislike with client: 'TV', but this frame pins a WEB session, and a context swap mid-session produces FAILED_PRECONDITION.
    rateVideo: async (id, status) => {
      const active = await client
      requireSignIn(active, 'rate a video')
      await active.actions.execute(LIKE_ENDPOINT[status], { target: { videoId: id } })
      return { id, likeStatus: status, related: [], descriptionRuns: [], hashtags: [], chapters: [], cardTeasers: [] }
    },
    removeFromHistory: async (videoId) => {
      const active = await client
      requireSignIn(active, 'change your history')
      const history = await active.getHistory()
      if (!history.removeVideo) throw new Error('youtube: this history feed cannot be edited')
      // youtubei.js 18 answers a removal YouTube did not process with false rather than a throw
      if (await history.removeVideo(videoId, HISTORY_REMOVAL_PAGES) === false) throw new Error('youtube: the video was not removed from your history')
      return videoId
    },
    clearHistory: async () => {
      const active = await client
      requireSignIn(active, 'change your history')
      const history = await active.getHistory()
      if (!history.clearWatchHistory) throw new Error('youtube: this history feed cannot be cleared')
      if (await history.clearWatchHistory() === false) throw new Error('youtube: watch history was not cleared')
      return true
    },
    submitFeedback: async (token) => {
      const active = await client
      requireSignIn(active, 'update your recommendations')
      const response = await active.actions.execute('/feedback', {
        feedbackTokens: [token],
        shouldMerge: false,
        isFeedbackTokenUnencrypted: false,
        parse: false,
      }) as { data?: { feedbackResponses?: { isProcessed?: boolean }[] } }
      if (response.data?.feedbackResponses?.[0]?.isProcessed === false) {
        throw new Error('youtube: could not update your recommendations')
      }
      return true
    },
    liveChat: async (videoId, cursor, view = 'TOP') => {
      reapIdleLiveChats(videoId)
      // this video's cursor from an engine a reset replaced is unknown here: the chat opens again rather than failing every poll
      const replaced = cursor?.startsWith(`youtube:livechat:${videoId}:`) && !liveChatContinuations.kindOf(cursor)
      if (cursor && !replaced) {
        const current = liveChatSessions.get(videoId)
        if (!current || current.view === view) return liveChatContinuations.resolve(`livechat:${videoId}`, cursor)
      }
      const session = await openLiveChat(videoId, view, !cursor)
      if (!session) return { items: [], disabled: true }
      if (!hasLiveChatPending(session) && !session.failure) {
        await waitForLiveChat(session, LIVE_CHAT_OPEN_GRACE_MS)
      }
      if (session.failure && !hasLiveChatPending(session)) {
        const failure = session.failure
        session.failure = undefined
        throw failure
      }
      return drainLiveChat(videoId, session)
    },

    liveChatLeaderboard: async (panelId, params) => {
      const response = await (await client).actions.execute('/get_panel', {
        panelId,
        params: safeDecodeParam(params),
        parse: false,
      })
      return parseLiveChatLeaderboard(response.data)
    },

    liveChatReplay: async (videoId, offsetMs, view = 'TOP', cursor) => {
      if (cursor) return chatReplayContinuations.resolve(`replay:${videoId}`, cursor)
      if (!chatReplayViews.has(videoId)) {
        const token = chatReplayToken(await (await client).actions.execute('/next', { videoId, racyCheckOk: true, contentCheckOk: true, parse: true }))
        if (!token) return { items: [], disabled: true }
        chatReplayViews.set(videoId, { TOP: token })
      }
      const views = chatReplayViews.get(videoId)!
      // ALL's token comes only in a first page's header, so an engine that has not asked TOP yet asks it first
      if (!views[view]) await chatReplayPage(videoId, views.TOP, offsetMs)
      const token = chatReplayViews.get(videoId)?.[view]
      if (!token) return { items: [], disabled: true }
      return chatReplayPage(videoId, token, offsetMs)
    },

    sendLiveChatMessage: async (videoId, textBody) => {
      const active = await client
      requireSignIn(active, 'send a live chat message')
      const session = liveChatSessions.get(videoId)
      if (!session) throw new Error('youtube: live chat is not open for this video')
      if (session.inputState?.status === 'RESTRICTED') {
        throw new Error(session.inputState.restrictionMessage || 'youtube: live chat participation is restricted')
      }
      const params = session.sendParams
        ?? (session.channelId || liveChatChannels.get(videoId)
          ? encodeLiveMessageParams(videoId, session.channelId ?? liveChatChannels.get(videoId))
          : encodeLiveMessageParams(videoId))
      const response = await active.actions.execute('/live_chat/send_message', {
        richMessage: { textSegments: [{ text: textBody }] },
        clientMessageId: crypto.randomUUID(),
        client: 'WEB',
        params,
        parse: false,
      })
      const parsed = parseSendLiveChatResult(response.data)
      if (parsed.errorMessage) throw new Error(parsed.errorMessage)
      if (parsed.addedMessages.length > 0) {
        session.buffer.push(...parsed.addedMessages)
        if (session.buffer.length > LIVE_CHAT_BUFFER_LIMIT) {
          session.buffer.splice(0, session.buffer.length - LIVE_CHAT_BUFFER_LIMIT)
        }
        wakeSession(session)
      }
      return true
    },

    voteLiveChatPoll: async (videoId, pollId, voteParams) => {
      const active = await client
      requireSignIn(active, 'vote in a live poll')
      let parsed: { endpoint?: string, params?: string }
      try {
        parsed = JSON.parse(voteParams) as { endpoint?: string, params?: string }
      } catch {
        throw new Error('youtube: invalid live poll vote parameters')
      }
      if (
        typeof parsed.endpoint !== 'string'
        || !/^\/live_chat\/[a-z_]+$/.test(parsed.endpoint)
        || typeof parsed.params !== 'string'
        || !parsed.params
      ) {
        throw new Error('youtube: invalid live poll vote parameters')
      }
      await active.actions.execute(parsed.endpoint, { params: parsed.params, parse: false })
      const session = liveChatSessions.get(videoId)
      if (session?.poll && session.poll.id === pollId) {
        session.poll = {
          ...session.poll,
          choices: session.poll.choices.map((choice) => ({
            ...choice,
            selected: choice.voteParams === voteParams ? true : undefined,
          })),
        }
        session.pollDirty = true
        wakeSession(session)
      }
      return true
    },

    postComment: async (videoId, textBody) => {
      const active = await client
      requireSignIn(active, 'post a comment')
      await active.interact.comment(videoId, textBody)
      return true
    },
    commentOnPost: async (postId, channelId, textBody) => {
      const active = await client
      requireSignIn(active, 'post a comment')
      const key = `${postId}:${channelId}`
      let endpoint = postCommentEndpoints.get(key)
      if (!endpoint) {
        const feed = await active.getPostComments(postId, channelId)
        rememberPostCommentEndpoint(postId, channelId, feed)
        endpoint = postCommentEndpoints.get(key)
      }
      if (!endpoint) throw new Error('youtube: comments are turned off for this post')
      // `commentText` is the key the create-comment button's endpoint reads.
      await endpoint.call(active.actions, { commentText: textBody })
      return true
    },
    replyToComment: async (token, textBody) => {
      const active = await client
      requireSignIn(active, 'reply to a comment')
      const { actions } = commentActions.resolve(token)
      if (!actions.reply) throw new Error('youtube: replies are turned off for this comment')
      // `commentText` is the key the reply button's endpoint reads.
      await actions.reply.call(active.actions, { commentText: textBody })
      return true
    },
    rateComment: async (token, status) => {
      const active = await client
      requireSignIn(active, 'rate a comment')
      const { commentId, actions } = commentActions.resolve(token)
      const endpoint = status === 'LIKE'
        ? actions.like
        : status === 'DISLIKE'
          ? actions.dislike
          : actions.unlike ?? actions.undislike
      if (!endpoint) throw new Error('youtube: this comment cannot be rated')
      await endpoint.call(active.actions)
      return {
        id: commentId,
        text: '',
        runs: [],
        isLiked: status === 'LIKE' ? true : undefined,
        isDisliked: status === 'DISLIKE' ? true : undefined,
      }
    },
    setSubscribed: async (channelId, subscribed) => {
      const active = await client
      requireSignIn(active, 'change a subscription')
      await (subscribed ? active.interact.subscribe(channelId) : active.interact.unsubscribe(channelId))
      // the memo is keyed by what the page was opened with, a handle included, so all of it goes
      channelFetches.clear()
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known?.channel, id: channelId, name: known?.channel.name ?? '', isSubscribed: subscribed }
      updateChannel(channelId, { isSubscribed: subscribed })
      return next
    },
    setNotificationLevel: async (channelId, level) => {
      const active = await client
      requireSignIn(active, 'change notifications')
      await active.interact.setNotificationPreferences(channelId, level)
      channelFetches.clear()
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known?.channel, id: channelId, name: known?.channel.name ?? '', notificationLevel: level }
      updateChannel(channelId, { notificationLevel: level })
      return next
    },
    addToPlaylist: async (playlistId, videoIds) => {
      if (videoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'save to a playlist', videoIds.map((videoId) => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: videoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // Takes setVideoIds rather than video ids because youtubei.js's removeVideos translates video ids by browsing and paging until it has matched as many rows as ids given: an id not in the playlist makes it walk every page then throw, and a single Shorts lockup on any page throws a ParsingError before the edit is attempted (core/managers/PlaylistManager.js:129).
    removeFromPlaylist: async (playlistId, setVideoIds) => {
      if (setVideoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'change a playlist', setVideoIds.map((setVideoId) => ({
        action: 'ACTION_REMOVE_VIDEO',
        setVideoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // youtubei.js's create() refuses a call with no video ids, which an empty playlist is.
    createPlaylist: async (title, videoIds, privacy, description) => {
      const active = await client
      requireSignIn(active, 'create a playlist')
      const response = await active.actions.execute('playlist/create', {
        title,
        videoIds: videoIds ?? [],
        ...(privacy ? { privacyStatus: privacy } : {}),
        ...(description ? { description } : {}),
      })
      if (response.success === false) throw new Error('youtube: creating the playlist failed')
      const id = response.data?.playlistId
      if (!id) throw new Error('youtube: the playlist was created but its id did not come back')
      return rememberPlaylist({ id, title, description, privacy })
    },
    // Calls the endpoint path directly, and must not switch back to the manager: youtubei.js's delete() throws before the network, building the raw key `deletePlaylistServiceEndpoint` (core/managers/PlaylistManager.js:45) that parser/nodes.js registers no class for, while the registered DeletePlaylistEndpoint guards on `playlistId` but assigns from `sourcePlaylistId` (parser/classes/endpoints/DeletePlaylistEndpoint.js:15) and so emits a body only when both keys are passed.
    deletePlaylist: async (id) => {
      const active = await client
      requireSignIn(active, 'delete a playlist')
      await active.actions.execute('playlist/delete', { playlistId: id })
      knownPlaylists.delete(id)
      return id
    },
    // Goes through browse/edit_playlist directly because youtubei.js's setName builds `{ playlist_id, actions }` in snake_case (core/managers/PlaylistManager.js:204, the only snake_case payload in that manager) while PlaylistEditEndpoint copies only `actions`, `playlistId` and `params` (parser/classes/endpoints/PlaylistEditEndpoint.js:13), so the id is dropped and the POST says which name to set but not on what.
    renamePlaylist: async (id, title) => {
      await editPlaylist(id, 'rename a playlist', [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: title }])
      return writtenPlaylist(id, { title })
    },
    setPlaylistDescription: async (id, description) => {
      await editPlaylist(id, 'change a playlist description', [{
        action: 'ACTION_SET_PLAYLIST_DESCRIPTION',
        playlistDescription: description,
      }])
      return writtenPlaylist(id, { description })
    },
    // The one action name here that youtubei.js 18.3.0 does not attest: the package has no privacy edit path at all.
    setPlaylistPrivacy: async (id, privacy) => {
      await editPlaylist(id, 'change a playlist privacy', [{
        action: 'ACTION_SET_PLAYLIST_PRIVACY',
        playlistPrivacy: privacy,
      }])
      return writtenPlaylist(id, { privacy })
    },
    // The destination is a predecessor, not an index: the moved entry lands immediately AFTER `afterSetVideoId`, and omitting it asks for the first position.
    movePlaylistItem: async (playlistId, setVideoId, afterSetVideoId) => {
      await editPlaylist(playlistId, 'reorder a playlist', [{
        action: 'ACTION_MOVE_VIDEO_AFTER',
        setVideoId,
        ...(afterSetVideoId ? { movedSetVideoIdPredecessor: afterSetVideoId } : {}),
      }])
      return writtenPlaylist(playlistId, {})
    },
    notifications: async (cursor) => {
      if (cursor) return notificationContinuations.resolve('notifications', cursor)
      const active = await client
      requireSignIn(active, 'see your notifications')
      return notificationPage(await active.getNotifications())
    },
    unseenNotificationCount: async () => {
      const active = await client
      if (!active.session.logged_in) return 0
      try {
        return await active.getUnseenNotificationsCount()
      } catch {
        return 0
      }
    },
    markNotificationRead: async (id) => {
      const active = await client
      requireSignIn(active, 'update a notification')
      const endpoint = notificationClicks.get(id)
      if (endpoint) await endpoint.call(active.actions)
      return id
    },
    // Signed-in state comes from the session the engine booted with; the accounts_list call only decorates it, so its failure
    // must not read back as signed out, but an answer that says the session ended (`signedIn` turns false) does.
    session: async () => {
      if (!signedIn?.()) return { signedIn: false, accounts: [] }
      try {
        // WEB's list holds every channel of the Google account; TV's, which account.getInfo() reads, only the current one (measured 2026-11-06)
        const list = await (await client).actions.execute('/account/accounts_list', { client: 'WEB', parse: true })
        return signedIn() ? normalizeSession(list.actions_memo?.get('AccountItem')) : { signedIn: false, accounts: [] }
      } catch {
        return { signedIn: signedIn(), accounts: [] }
      }
    },
  }
}
