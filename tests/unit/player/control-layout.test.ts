import { describe, expect, it } from 'vite-plus/test'

import {
  cloneDefaultPlayerBarLayout,
  coercePlayerBarLayout,
  coercePlayerMenuHidden,
  DEFAULT_PLAYER_BAR_LAYOUT,
  isBarControlVisible,
  isPlayerBarLayoutDefault,
  isPlayerMenuHiddenDefault,
  moveBarControlByStep,
  moveBarControlToSide,
  PLAYER_SETTINGS_MENU_ITEMS,
  toggleBarControlVisibility,
  toggleSettingsMenuItem,
} from '../../../src/player/control-layout'

describe('player control layout', () => {
  it('returns a fresh default layout clone on invalid stored input', () => {
    const first = coercePlayerBarLayout(undefined)
    expect(first).toEqual(DEFAULT_PLAYER_BAR_LAYOUT)
    expect(first).not.toBe(DEFAULT_PLAYER_BAR_LAYOUT)
    first.left.push('fullscreen')
    expect(DEFAULT_PLAYER_BAR_LAYOUT.left).not.toContain('fullscreen')

    expect(coercePlayerBarLayout('bad')).toEqual(DEFAULT_PLAYER_BAR_LAYOUT)
    expect(coercePlayerBarLayout(null)).toEqual(DEFAULT_PLAYER_BAR_LAYOUT)
  })

  it('deduplicates across left and right sides and restores missing controls on default sides', () => {
    const coerced = coercePlayerBarLayout({
      left: ['time', 'time', 'bogus', 'fullscreen'],
      right: ['fullscreen', 'play'],
      hidden: ['autoplay', 'autoplay', 'nope'],
    })
    expect(coerced.left).toEqual(['time', 'fullscreen', 'next', 'volume', 'chapter'])
    expect(coerced.right).toEqual(['play', 'autoplay', 'captions', 'settings', 'pip', 'theater'])
    expect(coerced.hidden).toEqual(['autoplay'])
  })

  it('toggles visibility and reorders controls within a side without mutating inputs', () => {
    const base = cloneDefaultPlayerBarLayout()
    const hidden = toggleBarControlVisibility(base, 'theater')
    expect(isBarControlVisible(base, 'theater')).toBe(true)
    expect(isBarControlVisible(hidden, 'theater')).toBe(false)
    expect(toggleBarControlVisibility(hidden, 'theater').hidden).toEqual([])

    const movedRight = moveBarControlByStep(base, 'play', 1)
    expect(movedRight.left).toEqual(['next', 'play', 'volume', 'time', 'chapter'])
    expect(moveBarControlByStep(base, 'play', -1)).toEqual(base)
    expect(moveBarControlByStep(base, 'chapter', 1)).toEqual(base)
  })

  it('moves controls across sides and supports exact same-side index reordering', () => {
    const base = cloneDefaultPlayerBarLayout()
    const movedToLeft = moveBarControlToSide(base, 'settings', 'left', 1)
    expect(movedToLeft.left).toEqual(['play', 'settings', 'next', 'volume', 'time', 'chapter'])
    expect(movedToLeft.right).toEqual(['autoplay', 'captions', 'pip', 'theater', 'fullscreen'])

    // Same-side forward move shifts target index cleanly past removed item
    const movedLater = moveBarControlToSide(base, 'play', 'left', 3)
    expect(movedLater.left).toEqual(['next', 'volume', 'play', 'time', 'chapter'])

    const movedToEndOfRight = moveBarControlToSide(base, 'chapter', 'right')
    expect(movedToEndOfRight.right.at(-1)).toBe('chapter')
    expect(movedToEndOfRight.left).not.toContain('chapter')
  })

  it('coerces and toggles settings menu items cleanly', () => {
    expect(coercePlayerMenuHidden(null)).toEqual([])
    expect(coercePlayerMenuHidden(['quality', 'quality', 'unknown', 42])).toEqual(['quality'])
    expect(PLAYER_SETTINGS_MENU_ITEMS.length).toBe(10)

    const once = toggleSettingsMenuItem([], 'ambientMode')
    expect(once).toEqual(['ambientMode'])
    expect(isPlayerMenuHiddenDefault(once)).toBe(false)
    const twice = toggleSettingsMenuItem(once, 'ambientMode')
    expect(twice).toEqual([])
    expect(isPlayerMenuHiddenDefault(twice)).toBe(true)
    expect(isPlayerBarLayoutDefault(DEFAULT_PLAYER_BAR_LAYOUT)).toBe(true)
  })
})
