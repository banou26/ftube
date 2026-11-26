import { filterOutShorts, isShortVideo } from '../shorts-filter'

type SearchVideoLike = {
  __typename?: 'Video'
  isShort?: boolean | null
}

type SearchShelfLike = {
  __typename?: 'SearchShelf'
  videos: readonly { isShort?: boolean | null }[]
  shorts: readonly unknown[]
}

type SearchCardLike = {
  __typename?: 'SearchCard'
  videos: readonly { isShort?: boolean | null }[]
}

export type FilterableSearchRow = SearchVideoLike | SearchShelfLike | SearchCardLike | { __typename?: string }

const isSearchVideo = (row: FilterableSearchRow): row is SearchVideoLike => row.__typename === 'Video'
const isSearchShelf = (row: FilterableSearchRow): row is SearchShelfLike => row.__typename === 'SearchShelf'
const isSearchCard = (row: FilterableSearchRow): row is SearchCardLike => row.__typename === 'SearchCard'

/** Removes Shorts rows, Shorts shelves, and Short cards from search results when `hideShorts` is enabled. */
export const visibleSearchRows = <Row extends FilterableSearchRow>(rows: readonly Row[], hideShorts: boolean): Row[] => {
  if (!hideShorts) return [...rows]
  const kept: Row[] = []
  for (const row of rows) {
    if (isSearchVideo(row)) {
      if (!isShortVideo(row)) kept.push(row)
      continue
    }
    if (isSearchShelf(row)) {
      if (row.shorts.length > 0) continue
      const videos = filterOutShorts(row.videos, hideShorts)
      if (videos.length > 0) kept.push({ ...row, videos } as Row)
      continue
    }
    if (isSearchCard(row)) {
      kept.push({ ...row, videos: filterOutShorts(row.videos, hideShorts) } as Row)
      continue
    }
    kept.push(row)
  }
  return kept
}
