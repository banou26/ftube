import { describe, expect, it } from 'vite-plus/test'

import { visibleSearchRows } from '../../../src/routes/search-results'

describe('visibleSearchRows', () => {
  const rows = [
    { __typename: 'Video' as const, id: 'v1', isShort: null },
    { __typename: 'Video' as const, id: 's1', isShort: true },
    { __typename: 'Channel' as const, id: 'c1' },
    { __typename: 'Playlist' as const, id: 'p1' },
    {
      __typename: 'SearchShelf' as const,
      title: 'Shorts',
      videos: [],
      shorts: [{ id: 's2' }],
    },
    {
      __typename: 'SearchShelf' as const,
      title: 'Mixed shelf',
      videos: [
        { id: 'v2', isShort: null },
        { id: 's3', isShort: true },
      ],
      shorts: [],
    },
    {
      __typename: 'SearchShelf' as const,
      title: 'All Shorts videos',
      videos: [{ id: 's4', isShort: true }],
      shorts: [],
    },
    {
      __typename: 'SearchCard' as const,
      videos: [
        { id: 'v3', isShort: null },
        { id: 's5', isShort: true },
      ],
    },
  ]

  it('keeps every row unchanged when hideShorts is false', () => {
    expect(visibleSearchRows(rows, false)).toEqual(rows)
  })

  it('removes Short rows, Shorts shelves, and Short cards inside shelves and channel cards', () => {
    expect(visibleSearchRows(rows, true)).toEqual([
      { __typename: 'Video', id: 'v1', isShort: null },
      { __typename: 'Channel', id: 'c1' },
      { __typename: 'Playlist', id: 'p1' },
      {
        __typename: 'SearchShelf',
        title: 'Mixed shelf',
        videos: [{ id: 'v2', isShort: null }],
        shorts: [],
      },
      {
        __typename: 'SearchCard',
        videos: [{ id: 'v3', isShort: null }],
      },
    ])
  })
})
