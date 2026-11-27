import type { FilterableVideo } from '../feeds/filter'
import type { FeedViewSettings } from '../feeds/settings'

import {
  isMostRelevantShelfTitle,
  matchesBlockedChannels,
  matchesBlockedKeywords,
  matchesGlobalFeedRules,
} from '../feeds/filter'
import { filterOutShorts, isShortVideo } from '../shorts-filter'

type SearchVideoLike = FilterableVideo & {
  __typename?: 'Video'
  isShort?: boolean | null
}

type SearchShelfLike = {
  __typename?: 'SearchShelf'
  title?: string | null
  videos: readonly (FilterableVideo & { isShort?: boolean | null })[]
  shorts: readonly FilterableVideo[]
}

type SearchCardLike = {
  __typename?: 'SearchCard'
  cardChannel?: { id?: string | null, name?: string | null, handle?: string | null } | null
  videos: readonly (FilterableVideo & { isShort?: boolean | null })[]
}

type SearchChannelLike = {
  __typename?: 'Channel'
  id?: string | null
  name?: string | null
  handle?: string | null
}

export type FilterableSearchRow = SearchVideoLike | SearchShelfLike | SearchCardLike | SearchChannelLike | { __typename?: string }

const isSearchVideo = (row: FilterableSearchRow): row is SearchVideoLike => row.__typename === 'Video'
const isSearchShelf = (row: FilterableSearchRow): row is SearchShelfLike => row.__typename === 'SearchShelf'
const isSearchCard = (row: FilterableSearchRow): row is SearchCardLike => row.__typename === 'SearchCard'
const isSearchChannel = (row: FilterableSearchRow): row is SearchChannelLike => row.__typename === 'Channel'

/** Removes Shorts and hidden/blocked videos, channels, cards, and shelves from search results. */
export const visibleSearchRows = <Row extends FilterableSearchRow>(
  rows: readonly Row[],
  hideShorts: boolean,
  feedSettings?: FeedViewSettings,
): Row[] => {
  if (!hideShorts && !feedSettings) return [...rows]
  const kept: Row[] = []
  for (const row of rows) {
    if (isSearchVideo(row)) {
      const ok = feedSettings
        ? matchesGlobalFeedRules(row, feedSettings, hideShorts)
        : !isShortVideo(row)
      if (ok) kept.push(row)
      continue
    }
    if (isSearchChannel(row)) {
      if (feedSettings && matchesBlockedChannels({ channel: row }, feedSettings.blockedChannels)) continue
      kept.push(row)
      continue
    }
    if (isSearchShelf(row)) {
      if (feedSettings?.hide.mostRelevant && isMostRelevantShelfTitle(row.title)) continue
      if (hideShorts && row.shorts.length > 0) continue
      const shorts = feedSettings
        ? row.shorts.filter(short =>
          !matchesBlockedKeywords(short, feedSettings.blockedKeywords)
          && !matchesBlockedChannels(short, feedSettings.blockedChannels))
        : row.shorts
      const videos = feedSettings
        ? row.videos.filter(video => matchesGlobalFeedRules(video, feedSettings, hideShorts))
        : filterOutShorts(row.videos, hideShorts)
      if (videos.length > 0 || shorts.length > 0) {
        kept.push({ ...row, shorts, videos } as Row)
      }
      continue
    }
    if (isSearchCard(row)) {
      if (feedSettings && row.cardChannel && matchesBlockedChannels({ channel: row.cardChannel }, feedSettings.blockedChannels)) {
        continue
      }
      const videos = feedSettings
        ? row.videos.filter(video => matchesGlobalFeedRules(video, feedSettings, hideShorts))
        : filterOutShorts(row.videos, hideShorts)
      kept.push({ ...row, videos } as Row)
      continue
    }
    kept.push(row)
  }
  return kept
}
