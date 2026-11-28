import { describe, expect, it } from 'vite-plus/test'

import {
  descriptionHoverDetails,
  descriptionMeta,
  formatAgo,
  formatCompact,
  formatCount,
  parseStartSeconds,
  videoDetailsOf,
} from '../../../src/components/format'

describe('start offsets', () => {
  it('accepts both forms upstream mints for `t`', () => {
    expect(parseStartSeconds('90')).toBe(90)
    expect(parseStartSeconds('90s')).toBe(90)
    expect(parseStartSeconds('1h2m3s')).toBe(3723)
    expect(parseStartSeconds('1m30s')).toBe(90)
    expect(parseStartSeconds('2h')).toBe(7200)
    expect(parseStartSeconds('0')).toBe(0)
  })

  it('refuses anything that is not a position', () => {
    // Every group in the compound pattern is optional, so letters match it with all groups empty
    expect(parseStartSeconds('abc')).toBeUndefined()
    expect(parseStartSeconds('')).toBeUndefined()
    expect(parseStartSeconds(null)).toBeUndefined()
    expect(parseStartSeconds(undefined)).toBeUndefined()
    expect(parseStartSeconds('1x2')).toBeUndefined()
  })
})

describe('relative times', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')

  it('words a time the way a card does', () => {
    expect(formatAgo('2026-11-01T11:59:30Z', now)).toBe('30 seconds ago')
    expect(formatAgo('2026-11-01T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatAgo('2026-10-29T12:00:00Z', now)).toBe('3 days ago')
    expect(formatAgo('2026-10-11T12:00:00Z', now)).toBe('3 weeks ago')
    expect(formatAgo('2026-07-01T12:00:00Z', now)).toBe('4 months ago')
    expect(formatAgo('2024-10-01T12:00:00Z', now)).toBe('2 years ago')
  })

  it('reads a time in the future as now, and anything else as no time', () => {
    expect(formatAgo('2026-11-01T12:05:00Z', now)).toBe('0 seconds ago')
    expect(formatAgo('soon', now)).toBeUndefined()
    expect(formatAgo(undefined, now)).toBeUndefined()
  })

  it('counts in the singular only for one', () => {
    expect(formatCount(0, 'channel')).toBe('0 channels')
    expect(formatCount(1, 'channel')).toBe('1 channel')
    expect(formatCount(12, 'channel')).toBe('12 channels')
  })
})

describe('the description line', () => {
  const texts = {
    viewCountText: '1,832,711,164 views',
    shortViewCountText: '1.8B views',
    publishedDateText: 'Oct 25, 2009',
    relativeDateText: '17y ago',
  }

  it('shows the rounded count and the relative date while collapsed', () => {
    expect(descriptionMeta({ expanded: false, ...texts })).toBe('1.8B views  17y ago')
  })

  it('shows the exact count and date once expanded', () => {
    expect(descriptionMeta({ expanded: true, ...texts })).toBe('1,832,711,164 views  Oct 25, 2009')
  })

  it('falls back to whichever form upstream sent', () => {
    expect(descriptionMeta({ expanded: false, viewCountText: '12 views', publishedDateText: 'Oct 25, 2009' })).toBe('12 views  Oct 25, 2009')
    expect(descriptionMeta({ expanded: true, shortViewCountText: '1.8B views' })).toBe('1.8B views')
    expect(descriptionMeta({ expanded: true })).toBe('')
  })

  it('builds an exact hover tooltip only while collapsed and when exact text adds detail', () => {
    expect(descriptionHoverDetails({ expanded: false, ...texts })).toBe('1,832,711,164 views • Oct 25, 2009')
    expect(descriptionHoverDetails({ expanded: true, ...texts })).toBeUndefined()
    expect(descriptionHoverDetails({
      expanded: false,
      viewCountText: '12 views',
      shortViewCountText: '12 views',
      publishedDateText: 'Oct 25, 2009',
      relativeDateText: 'Oct 25, 2009',
    })).toBeUndefined()
    expect(descriptionHoverDetails({
      expanded: false,
      viewCountText: '42,258 views',
      shortViewCountText: '42K views',
      publishedDateText: 'Nov 26, 2026',
    })).toBe('42,258 views • Nov 26, 2026')
    expect(descriptionHoverDetails({ expanded: false })).toBeUndefined()
  })
})

describe('compact counts', () => {
  it('rounds a count the way the like button shows one', () => {
    expect(formatCompact(521680)).toBe('522K')
    expect(formatCompact(19496469)).toBe('19M')
    expect(formatCompact(1234)).toBe('1.2K')
    expect(formatCompact(0)).toBe('0')
  })
})

describe('video details', () => {
  it('formats exact Date, Views, and integer Likes rows in order', () => {
    expect(videoDetailsOf({
      publishedDateText: 'Nov 26, 2026',
      viewCountText: '99,962 views',
      shortViewCountText: '100K views',
      likeCount: 3746,
      likeCountText: '3.7K',
    })).toEqual([
      { key: 'date', label: 'Date', value: 'Nov 26, 2026' },
      { key: 'views', label: 'Views', value: '99,962' },
      { key: 'likes', label: 'Likes', value: '3,746' },
    ])
  })

  it('falls back to compact counts and omits missing rows', () => {
    expect(videoDetailsOf({
      shortViewCountText: '1 view',
      likeCountText: '1.2K',
    })).toEqual([
      { key: 'views', label: 'Views', value: '1' },
      { key: 'likes', label: 'Likes', value: '1.2K' },
    ])

    expect(videoDetailsOf({
      viewCountText: 'No views',
    })).toEqual([
      { key: 'views', label: 'Views', value: '0' },
    ])

    expect(videoDetailsOf({
      publishedDateText: 'Nov 26, 2026',
      viewCountText: '99,962 views',
      likeCount: undefined,
      likeCountText: 'Like',
    })).toEqual([
      { key: 'date', label: 'Date', value: 'Nov 26, 2026' },
      { key: 'views', label: 'Views', value: '99,962' },
    ])

    expect(videoDetailsOf({
      publishedDateText: '   ',
      viewCountText: null,
      likeCount: -1,
      likeCountText: undefined,
    })).toEqual([])
  })
})
