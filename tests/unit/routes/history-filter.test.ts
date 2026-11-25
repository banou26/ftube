import { describe, expect, it } from 'vite-plus/test'

import { EMPTY_HISTORY_PAGES_LIMIT, emptyHistoryPagesInARow, matchesHistoryFilter } from '../../../src/routes/history-filter'

describe('matchesHistoryFilter', () => {
  const video = { title: 'Shader Tutorial', isShort: false, channel: { id: 'UC1', name: 'Graphics Lab' } }
  const short = { title: 'Quick Tip', isShort: true, channel: { id: 'UC2', name: 'Tips Daily' } }

  it('filters by videos and shorts type', () => {
    expect(matchesHistoryFilter(video, { type: 'all' })).toBe(true)
    expect(matchesHistoryFilter(short, { type: 'all' })).toBe(true)
    expect(matchesHistoryFilter(video, { type: 'videos' })).toBe(true)
    expect(matchesHistoryFilter(short, { type: 'videos' })).toBe(false)
    expect(matchesHistoryFilter(video, { type: 'shorts' })).toBe(false)
    expect(matchesHistoryFilter(short, { type: 'shorts' })).toBe(true)
  })

  it('respects hideShorts regardless of selected type', () => {
    expect(matchesHistoryFilter(short, { type: 'all', hideShorts: true })).toBe(false)
    expect(matchesHistoryFilter(short, { type: 'shorts', hideShorts: true })).toBe(false)
    expect(matchesHistoryFilter(video, { type: 'all', hideShorts: true })).toBe(true)
  })

  it('filters by channel group membership and case-insensitive search query', () => {
    const channelIds = new Set(['UC1'])
    expect(matchesHistoryFilter(video, { type: 'all', channelIds })).toBe(true)
    expect(matchesHistoryFilter(short, { type: 'all', channelIds })).toBe(false)
    expect(matchesHistoryFilter({ title: 'No Channel' }, { type: 'all', channelIds })).toBe(false)

    expect(matchesHistoryFilter(video, { type: 'all', query: 'shader' })).toBe(true)
    expect(matchesHistoryFilter(video, { type: 'all', query: 'GRAPHICS' })).toBe(true)
    expect(matchesHistoryFilter(video, { type: 'all', query: 'music' })).toBe(false)
  })
})

describe('emptyHistoryPagesInARow', () => {
  it('counts consecutive trailing empty pages up to EMPTY_HISTORY_PAGES_LIMIT', () => {
    const pages = [
      { sections: [{ items: [{ title: 'Keep', channel: { id: 'UC1', name: 'A' } }] }] },
      { sections: [{ items: [{ title: 'Skip 1', channel: { id: 'UC2', name: 'B' } }] }] },
      { sections: [{ items: [{ title: 'Skip 2', channel: { id: 'UC2', name: 'B' } }] }] },
    ]
    expect(emptyHistoryPagesInARow(pages, { type: 'all', channelIds: new Set(['UC1']) })).toBe(2)
    expect(EMPTY_HISTORY_PAGES_LIMIT).toBe(5)
  })
})
