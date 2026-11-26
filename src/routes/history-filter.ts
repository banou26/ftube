import { isAllowedWithHideShorts, isShortVideo } from '../shorts-filter'

export type HistoryTypeFilter = 'all' | 'videos' | 'shorts'

export type FilterableHistoryItem = {
  title: string
  isShort?: boolean | null
  channel?: { id: string, name: string } | null
}

export type HistoryFilter = {
  type: HistoryTypeFilter
  channelIds?: ReadonlySet<string>
  query?: string
  hideShorts?: boolean
}

/** Trailing empty page limit before auto-paging pauses on filtered history. */
export const EMPTY_HISTORY_PAGES_LIMIT = 5

/**
 * Checks whether a history item passes the type, group, query, and hideShorts filters.
 */
export const matchesHistoryFilter = (item: FilterableHistoryItem, filter: HistoryFilter): boolean => {
  if (!isAllowedWithHideShorts(item, filter.hideShorts)) return false
  if (filter.type === 'videos' && isShortVideo(item)) return false
  if (filter.type === 'shorts' && !isShortVideo(item)) return false
  if (filter.channelIds !== undefined) {
    if (!item.channel || !filter.channelIds.has(item.channel.id)) return false
  }
  const needle = filter.query?.trim().toLowerCase()
  if (needle) {
    const title = item.title.toLowerCase()
    const channel = item.channel?.name.toLowerCase() ?? ''
    if (!title.includes(needle) && !channel.includes(needle)) return false
  }
  return true
}

/**
 * Counts trailing fetched history pages that produced zero visible items under the active filter.
 */
export const emptyHistoryPagesInARow = (
  pages: readonly { sections: readonly { items: readonly FilterableHistoryItem[] }[] }[],
  filter: HistoryFilter,
) => {
  let trailing = 0
  for (let index = pages.length - 1; index >= 0; index--) {
    const hasMatch = pages[index]!.sections.some(section => section.items.some(item => matchesHistoryFilter(item, filter)))
    if (hasMatch) break
    trailing++
  }
  return trailing
}
