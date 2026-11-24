import { describe, expect, it } from 'vite-plus/test'

import { isRichRow, visibleChannelShelves } from '../../../src/routes/channel-rows'

const row = (items: { videos?: number, playlists?: number, posts?: number }, expandable = true) => ({
  expandable,
  videos: Array.from({ length: items.videos ?? 0 }, (_, index) => ({ id: `v${index}` })),
  playlists: Array.from({ length: items.playlists ?? 0 }, (_, index) => ({ id: `p${index}` })),
  posts: Array.from({ length: items.posts ?? 0 }, (_, index) => ({ id: `t${index}` })),
})

describe('channel Home rows', () => {
  it('draws an expandable row of videos, playlists or posts as the grid', () => {
    expect(isRichRow(row({ videos: 3 }))).toBe(true)
    expect(isRichRow(row({ playlists: 4 }))).toBe(true)
    expect(isRichRow(row({ posts: 2 }))).toBe(true)
  })

  // a rich row of channels or games would otherwise show its title over an empty grid
  it('keeps the rail for an expandable row of only channels or games, and for a row that does not expand', () => {
    expect(isRichRow(row({}))).toBe(false)
    expect(isRichRow(row({ videos: 3 }, false))).toBe(false)
  })

  it('removes Shorts shelves and Short videos from shelves when hideShorts is enabled', () => {
    const shelves = [
      {
        title: 'Shorts',
        videos: [],
        shorts: [{ id: 's1', isShort: true }],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
      {
        title: 'Videos',
        videos: [{ id: 'v1' }, { id: 's2', isShort: true }],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
      {
        title: 'Only Shorts videos',
        videos: [{ id: 's3', isShort: true }],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
    ]

    expect(visibleChannelShelves(shelves, false)).toEqual(shelves)
    expect(visibleChannelShelves(shelves, true)).toEqual([
      {
        title: 'Videos',
        videos: [{ id: 'v1' }],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
    ])
  })
})
