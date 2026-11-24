/**
 * Whether a channel Home row draws as youtube.com's grid of full-size cards that Show more opens. Only an expandable
 * row of videos, playlists or posts does: the grid has no card for a channel or a game, so a row of those keeps the rail.
 */
export const isRichRow = (row: { expandable?: boolean | null, videos: unknown[], playlists: unknown[], posts: unknown[] }) =>
  row.expandable === true && row.videos.length + row.playlists.length + row.posts.length > 0

/** Filters Shorts shelves and Short cards out of channel Home shelves when `hideShorts` is enabled. */
export const visibleChannelShelves = <Shelf extends {
  videos: readonly { isShort?: boolean | null }[]
  shorts: readonly unknown[]
  playlists: readonly unknown[]
  channels: readonly unknown[]
  games: readonly unknown[]
  posts: readonly unknown[]
}>(shelves: readonly Shelf[], hideShorts: boolean): Shelf[] => {
  if (!hideShorts) return [...shelves]
  return shelves
    .map(shelf => ({
      ...shelf,
      shorts: [],
      videos: shelf.videos.filter(video => !video.isShort),
    }))
    .filter(shelf =>
      shelf.videos.length + shelf.playlists.length + shelf.channels.length + shelf.games.length + shelf.posts.length > 0,
    )
}
