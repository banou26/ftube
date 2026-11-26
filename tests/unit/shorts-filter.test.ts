import { describe, expect, it } from 'vite-plus/test'

import { filterOutShorts, isAllowedWithHideShorts, isShortVideo } from '../../src/shorts-filter'

describe('shorts filter helpers', () => {
  it('identifies shorts strictly on isShort === true', () => {
    expect(isShortVideo({ isShort: true })).toBe(true)
    expect(isShortVideo({ isShort: false })).toBe(false)
    expect(isShortVideo({ isShort: null })).toBe(false)
    expect(isShortVideo({})).toBe(false)
  })

  it('checks hideShorts gating consistently across nullish values', () => {
    expect(isAllowedWithHideShorts({ isShort: true }, true)).toBe(false)
    expect(isAllowedWithHideShorts({ isShort: false }, true)).toBe(true)
    expect(isAllowedWithHideShorts({ isShort: null }, true)).toBe(true)
    expect(isAllowedWithHideShorts({}, true)).toBe(true)

    expect(isAllowedWithHideShorts({ isShort: true }, false)).toBe(true)
    expect(isAllowedWithHideShorts({ isShort: true }, undefined)).toBe(true)
  })

  it('filters out only Short entries when hideShorts is true and clones otherwise', () => {
    const items = [
      { id: 'v1', isShort: false },
      { id: 's1', isShort: true },
      { id: 'v2', isShort: null },
      { id: 'v3' },
    ]
    expect(filterOutShorts(items, true).map(item => item.id)).toEqual(['v1', 'v2', 'v3'])

    const unfiltered = filterOutShorts(items, false)
    expect(unfiltered.map(item => item.id)).toEqual(['v1', 's1', 'v2', 'v3'])
    expect(unfiltered).not.toBe(items)
  })
})
