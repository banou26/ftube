import type { Group } from '../../../src/groups/store'
import type { SubscribedChannelItem } from '../../../src/routes/feed-channels-filter'

import { describe, expect, it } from 'vite-plus/test'

import { filterAndSortChannels, parseSubscribers } from '../../../src/routes/feed-channels-filter'

const NOW = Date.parse('2026-11-22T00:00:00Z')
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

const channels: SubscribedChannelItem[] = [
  { id: 'UC1', name: 'Zeta Coding', handle: '@zetacode', subscriberCountText: '85K subscribers', description: 'Systems programming' },
  { id: 'UC2', name: 'Alpha Art', handle: '@alphaart', subscriberCountText: '1.2M subscribers', description: 'Digital painting' },
  { id: 'UC3', name: 'Middle Music', handle: '@middlemusic', subscriberCountText: '420 subscribers', description: 'Piano covers' },
  { id: 'UC4', name: 'Dormant Channel', handle: '@dormant', subscriberCountText: '12.5K subscribers', description: 'Old archive' },
]

const groups: Group[] = [
  {
    id: 'g1',
    name: 'Tech',
    emoji: '💻',
    channels: [{ id: 'UC1', name: 'Zeta Coding' }],
    updatedAt: 1,
  },
]

const lastUploadAt: Record<string, string | null | undefined> = {
  UC1: daysAgo(2),
  UC2: daysAgo(20),
  UC3: daysAgo(120),
  UC4: daysAgo(400),
}

describe('parseSubscribers', () => {
  it('parses plain counts and K/M/B suffixes', () => {
    expect(parseSubscribers('420 subscribers')).toBe(420)
    expect(parseSubscribers('1,234 subscribers')).toBe(1234)
    expect(parseSubscribers('12.5K subscribers')).toBe(12_500)
    expect(parseSubscribers('1.2M subscribers')).toBe(1_200_000)
    expect(parseSubscribers('2.5B subscribers')).toBe(2_500_000_000)
    expect(parseSubscribers(undefined)).toBeUndefined()
    expect(parseSubscribers('No subscribers')).toBeUndefined()
  })
})

describe('filterAndSortChannels', () => {
  const base = { query: '', groupId: 'all', groups, activity: 'all' as const, sort: 'default' as const, lastUploadAt, now: NOW }

  it('matches query against name, handle, and description', () => {
    expect(filterAndSortChannels(channels, { ...base, query: 'alpha' }).map(c => c.id)).toEqual(['UC2'])
    expect(filterAndSortChannels(channels, { ...base, query: '@middle' }).map(c => c.id)).toEqual(['UC3'])
    expect(filterAndSortChannels(channels, { ...base, query: 'systems' }).map(c => c.id)).toEqual(['UC1'])
  })

  it('filters by group membership or ungrouped', () => {
    expect(filterAndSortChannels(channels, { ...base, groupId: 'g1' }).map(c => c.id)).toEqual(['UC1'])
    expect(filterAndSortChannels(channels, { ...base, groupId: 'ungrouped' }).map(c => c.id)).toEqual(['UC2', 'UC3', 'UC4'])
  })

  it('filters by last video posted window and inactivity', () => {
    expect(filterAndSortChannels(channels, { ...base, activity: '7d' }).map(c => c.id)).toEqual(['UC1'])
    expect(filterAndSortChannels(channels, { ...base, activity: '30d' }).map(c => c.id)).toEqual(['UC1', 'UC2'])
    expect(filterAndSortChannels(channels, { ...base, activity: '365d' }).map(c => c.id)).toEqual(['UC1', 'UC2', 'UC3'])
    expect(filterAndSortChannels(channels, { ...base, activity: 'inactive-365d' }).map(c => c.id)).toEqual(['UC4'])
  })

  it('excludes channels whose upload dates are not loaded yet from activity filters and treats null as inactive', () => {
    const partial = { UC1: daysAgo(2), UC4: null }
    expect(filterAndSortChannels(channels, { ...base, activity: '7d', lastUploadAt: partial }).map(c => c.id)).toEqual(['UC1'])
    expect(filterAndSortChannels(channels, { ...base, activity: 'inactive-365d', lastUploadAt: partial }).map(c => c.id)).toEqual(['UC4'])
  })

  it('sorts by name, subscribers, and upload date', () => {
    expect(filterAndSortChannels(channels, { ...base, sort: 'name-asc' }).map(c => c.id)).toEqual(['UC2', 'UC4', 'UC3', 'UC1'])
    expect(filterAndSortChannels(channels, { ...base, sort: 'name-desc' }).map(c => c.id)).toEqual(['UC1', 'UC3', 'UC4', 'UC2'])
    expect(filterAndSortChannels(channels, { ...base, sort: 'subscribers' }).map(c => c.id)).toEqual(['UC2', 'UC1', 'UC4', 'UC3'])
    expect(filterAndSortChannels(channels, { ...base, sort: 'latest-upload' }).map(c => c.id)).toEqual(['UC1', 'UC2', 'UC3', 'UC4'])
    expect(filterAndSortChannels(channels, { ...base, sort: 'oldest-upload' }).map(c => c.id)).toEqual(['UC4', 'UC3', 'UC2', 'UC1'])
  })
})
