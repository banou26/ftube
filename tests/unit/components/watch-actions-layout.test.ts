import { describe, expect, it } from 'vite-plus/test'

import { computeVisibleWatchActions, WATCH_ACTION_PRIORITY } from '../../../src/components/watch-actions-layout'

describe('computeVisibleWatchActions', () => {
  const actionWidths = { share: 40, save: 40, download: 40 }

  it('keeps all enabled actions inline when width is sufficient', () => {
    const result = computeVisibleWatchActions({
      availableWidth: 420,
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
    // 150 + 8 + 40 + (8 + 40) + (8 + 40) = 294, + (8 + 40) = 342
    expect(computeVisibleWatchActions({
      availableWidth: 310,
      likeWidth: 150,
      moreWidth: 40,
      actionWidths,
      enabled: WATCH_ACTION_PRIORITY,
      gap: 8,
    })).toEqual({
      inline: ['share', 'save'],
      overflow: ['download'],
    })

    // 150 + 8 + 40 + (8 + 40) = 246
    expect(computeVisibleWatchActions({
      availableWidth: 260,
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
      availableWidth: 200,
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
      availableWidth: 260,
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
