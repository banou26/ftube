import { describe, expect, it } from 'vite-plus/test'

import { qualityBadgeLabel, resolveQualityBadgeHeight, resolveQualityDisplay, resolveQualityHeight } from '../../../src/player/quality'

const STANDARD_HEIGHTS = [1080, 720, 480, 360, 240, 144]

describe('resolveQualityHeight', () => {
  it('returns the exact tier when available', () => {
    expect(resolveQualityHeight(STANDARD_HEIGHTS, 720)).toBe(720)
  })

  it('falls back to the highest available tier at or below an unavailable preference', () => {
    expect(resolveQualityHeight(STANDARD_HEIGHTS, 2160)).toBe(1080)
    expect(resolveQualityHeight([1080, 480, 144], 720)).toBe(480)
  })

  it('falls back to the lowest available tier when the preference is lower than all tiers', () => {
    expect(resolveQualityHeight([1080, 720, 360], 144)).toBe(360)
  })

  it('returns undefined when no tiers are loaded', () => {
    expect(resolveQualityHeight([], 1080)).toBeUndefined()
  })
})

describe('resolveQualityDisplay', () => {
  it('shows active quality in Auto mode and bare Auto before a frame decodes', () => {
    expect(resolveQualityDisplay({
      preference: 'auto',
      heights: STANDARD_HEIGHTS,
      playingHeight: 1080,
    })).toEqual({
      selected: 'auto',
      detail: 'Auto (1080p)',
      activeLabel: '1080p',
    })

    expect(resolveQualityDisplay({
      preference: 'auto',
      heights: STANDARD_HEIGHTS,
      playingHeight: 0,
    })).toEqual({
      selected: 'auto',
      detail: 'Auto',
      activeLabel: undefined,
    })
  })

  it('shows actual playing tier and checks matching tier when saved preference (e.g. 2160p) is unavailable', () => {
    expect(resolveQualityDisplay({
      preference: 2160,
      heights: STANDARD_HEIGHTS,
      playingHeight: 1080,
    })).toEqual({
      selected: 1080,
      detail: '1080p',
      activeLabel: '1080p',
    })

    expect(resolveQualityDisplay({
      preference: 2160,
      heights: STANDARD_HEIGHTS,
      playingHeight: 720,
    })).toEqual({
      selected: 720,
      detail: '720p',
      activeLabel: '720p',
    })
  })

  it('falls back to resolveQualityHeight before the first decoded frame when preference is unavailable', () => {
    expect(resolveQualityDisplay({
      preference: 2160,
      heights: STANDARD_HEIGHTS,
      playingHeight: 0,
    })).toEqual({
      selected: 1080,
      detail: '1080p',
      activeLabel: undefined,
    })
  })

  it('uses actual portrait height when vertical tiers differ from landscape setting', () => {
    expect(resolveQualityDisplay({
      preference: 1080,
      heights: [1920, 1280, 854],
      playingHeight: 1920,
    })).toEqual({
      selected: 1920,
      detail: '1920p',
      activeLabel: '1920p',
    })
  })

  it('keeps manual pick immediately even while previously buffered resolution is draining', () => {
    expect(resolveQualityDisplay({
      preference: 720,
      heights: STANDARD_HEIGHTS,
      playingHeight: 1080,
    })).toEqual({
      selected: 720,
      detail: '720p',
      activeLabel: '1080p',
    })
  })

  it('handles preferences lower than the minimum available tier and empty heights while loading', () => {
    expect(resolveQualityDisplay({
      preference: 144,
      heights: [1080, 720, 360],
      playingHeight: 360,
    })).toEqual({
      selected: 360,
      detail: '360p',
      activeLabel: '360p',
    })

    expect(resolveQualityDisplay({
      preference: 2160,
      heights: [],
      playingHeight: 0,
    })).toEqual({
      selected: undefined,
      detail: undefined,
      activeLabel: undefined,
    })
  })
})

describe('qualityBadgeLabel', () => {
  it('returns 8K for 4320p+, 4K for 2160p+, 2K for 1440p+, HD for 1080p+, exact resolution below 1080p, and undefined for invalid heights', () => {
    expect(qualityBadgeLabel(4320)).toBe('8K')
    expect(qualityBadgeLabel(2160)).toBe('4K')
    expect(qualityBadgeLabel(1440)).toBe('2K')
    expect(qualityBadgeLabel(1080)).toBe('HD')
    expect(qualityBadgeLabel(720)).toBe('720p')
    expect(qualityBadgeLabel(480)).toBe('480p')
    expect(qualityBadgeLabel(360)).toBe('360p')
    expect(qualityBadgeLabel(240)).toBe('240p')
    expect(qualityBadgeLabel(144)).toBe('144p')
    expect(qualityBadgeLabel(0)).toBeUndefined()
    expect(qualityBadgeLabel(undefined)).toBeUndefined()
    expect(qualityBadgeLabel(Number.NaN)).toBeUndefined()
  })
})

describe('resolveQualityBadgeHeight', () => {
  it('immediately reflects manual quality selections even while stale decoded frames are still draining', () => {
    expect(resolveQualityBadgeHeight({ preference: 720, heights: [2160, 1440, 1080, 720, 480], playingHeight: 2160 })).toBe(720)
    expect(resolveQualityBadgeHeight({ preference: 480, heights: [2160, 1440, 1080, 720, 480], playingHeight: 2160 })).toBe(480)
    expect(resolveQualityBadgeHeight({ preference: 2160, heights: [2160, 1440, 1080, 720, 480], playingHeight: 720 })).toBe(2160)
  })

  it('tracks active playing height in Auto mode and resolves unavailable saved preferences cleanly', () => {
    expect(resolveQualityBadgeHeight({ preference: 'auto', heights: STANDARD_HEIGHTS, playingHeight: 1080 })).toBe(1080)
    expect(resolveQualityBadgeHeight({ preference: 'auto', heights: STANDARD_HEIGHTS, playingHeight: 480 })).toBe(480)
    expect(resolveQualityBadgeHeight({ preference: 'auto', heights: STANDARD_HEIGHTS, playingHeight: 0 })).toBeUndefined()
    expect(resolveQualityBadgeHeight({ preference: 2160, heights: STANDARD_HEIGHTS, playingHeight: 1080 })).toBe(1080)
    expect(resolveQualityBadgeHeight({ preference: 2160, heights: [], playingHeight: 720 })).toBe(720)
  })
})
