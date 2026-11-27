import type { FilterableVideo } from '../feeds/filter'
import type { FeedViewSettings } from '../feeds/settings'

import {
  isMostRelevantShelfTitle,
  matchesBlockedChannels,
  matchesBlockedKeywords,
  matchesGlobalFeedRules,
} from '../feeds/filter'
import { filterOutShorts } from '../shorts-filter'

/**
 * Whether a channel Home row draws as youtube.com's grid of full-size cards that Show more opens. Only an expandable
 * row of videos, playlists or posts does: the grid has no card for a channel or a game, so a row of those keeps the rail.
 */
export const isRichRow = (row: { expandable?: boolean | null, videos: unknown[], playlists: unknown[], posts: unknown[] }) =>
  row.expandable === true && row.videos.length + row.playlists.length + row.posts.length > 0

/** Filters Shorts shelves, "Most relevant" shelves, and hidden/blocked cards out of channel Home shelves. */
export const visibleChannelShelves = <
  ShortItem extends FilterableVideo = FilterableVideo,
  Shelf extends {
    title?: string | null
    videos: readonly FilterableVideo[]
    shorts: readonly ShortItem[]
    playlists: readonly unknown[]
    channels: readonly unknown[]
    games: readonly unknown[]
    posts: readonly unknown[]
  } = {
    title?: string | null
    videos: readonly FilterableVideo[]
    shorts: readonly ShortItem[]
    playlists: readonly unknown[]
    channels: readonly unknown[]
    games: readonly unknown[]
    posts: readonly unknown[]
  },
>(
  shelves: readonly Shelf[],
  hideShorts: boolean,
  feedSettings?: FeedViewSettings,
  options: { ignoreBlockedChannels?: boolean } = {},
): Shelf[] => {
  if (!hideShorts && !feedSettings) return [...shelves]
  return shelves
    .filter(shelf => !(feedSettings?.hide.mostRelevant && isMostRelevantShelfTitle(shelf.title)))
    .map(shelf => ({
      ...shelf,
      shorts: hideShorts
        ? []
        : feedSettings
        ? shelf.shorts.filter(short =>
          !matchesBlockedKeywords(short, feedSettings.blockedKeywords)
          && (options.ignoreBlockedChannels || !matchesBlockedChannels(short, feedSettings.blockedChannels)))
        : shelf.shorts,
      videos: feedSettings
        ? shelf.videos.filter(video => matchesGlobalFeedRules(video, feedSettings, hideShorts, options))
        : filterOutShorts(shelf.videos, hideShorts),
    }))
    .filter(shelf =>
      shelf.videos.length + shelf.shorts.length + shelf.playlists.length + shelf.channels.length + shelf.games.length + shelf.posts.length > 0,
    )
}
