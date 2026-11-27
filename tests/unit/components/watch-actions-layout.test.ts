import { describe, expect, it } from 'vite-plus/test'

import { computeVisibleWatchActions, WATCH_ACTION_PRIORITY } from '../../../src/components/watch-actions-layout'

describe('computeVisibleWatchActions', () => {
  const actionWidths = { share: 96, save: 88, download: 120 }

  it('keeps all enabled actions inline when width is sufficient', () => {
    const result = computeVisibleWatchActions({
      availableWidth: 600,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
      gap: 8,
    })
    expect(result).toEqual({
      inline: ['share', 'save', 'download'],
      overflow: [],
    })
  })

  it('overflows download first, then save while keeping share inline without duplication', () => {
    // 150 + 8 + 40 + (8 + 96) + (8 + 88) = 398, + (8 + 120) = 526
    expect(computeVisibleWatchActions({
      availableWidth: 450,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
      gap: 8,
    })).toEqual({
      inline: ['share', 'save'],
      overflow: ['download'],
    })

    // 150 + 8 + 40 + (8 + 96) = 302
    expect(computeVisibleWatchActions({
      availableWidth: 340,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
      gap: 8,
    })).toEqual({
      inline: ['share'],
      overflow: ['save', 'download'],
    })

    expect(computeVisibleWatchActions({
      availableWidth: 220,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
      gap: 8,
    })).toEqual({
      inline: ['share'],
      overflow: ['save', 'download'],
    })
  })

  it('excludes disabled actions (such as download on live streams) from both inline and overflow', () => {
    expect(computeVisibleWatchActions({
      availableWidth: 320,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: ['share', 'save'],
      gap: 8,
    })).toEqual({
      inline: ['share'],
      overflow: ['save'],
    })
  })

  it('handles zero or non-finite availableWidth while keeping share inline and overflowing lower-priority actions', () => {
    expect(computeVisibleWatchActions({
      availableWidth: 0,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
    })).toEqual({
      inline: ['share'],
      overflow: ['save', 'download'],
    })
  })
})
