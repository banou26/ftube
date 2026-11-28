import { describe, expect, it } from 'vitest'

import {
  findSpatialTarget,
  KEYBOARD_NAV_CHORDS,
  type NavCandidate,
  type NavRect,
} from '../../../src/navigation/spatial'

const box = (id: string, left: number, top: number, width = 100, height = 60): NavCandidate<string> => ({
  item: id,
  rect: { left, top, right: left + width, bottom: top + height },
})

const grid: NavCandidate<string>[] = [
  box('a1', 0, 0),
  box('a2', 140, 0),
  box('a3', 280, 0),
  box('b1', 0, 100),
  box('b2', 140, 100),
  box('b3', 280, 100),
]

const rectOf = (id: string): NavRect => grid.find(item => item.item === id)!.rect

describe('findSpatialTarget', () => {
  it('navigates across a 2D card grid in all four cardinal directions', () => {
    const others = (skip: string) => grid.filter(item => item.item !== skip)

    expect(findSpatialTarget(rectOf('a1'), others('a1'), 'right')).toBe('a2')
    expect(findSpatialTarget(rectOf('a2'), others('a2'), 'down')).toBe('b2')
    expect(findSpatialTarget(rectOf('b2'), others('b2'), 'left')).toBe('b1')
    expect(findSpatialTarget(rectOf('b3'), others('b3'), 'up')).toBe('a3')
  })

  it('prefers aligned column items over nearer unaligned neighbors', () => {
    const skewed: NavCandidate<string>[] = [
      box('header', 100, 0, 120, 40),
      box('offset-right', 210, 75, 100, 40),
      box('aligned-below', 100, 90, 120, 40),
    ]
    const current = skewed[0]!.rect
    expect(findSpatialTarget(current, skewed.slice(1), 'down')).toBe('aligned-below')
  })

  it('returns undefined at boundaries when no candidate sits in that half-plane', () => {
    expect(findSpatialTarget(rectOf('a1'), grid.filter(item => item.item !== 'a1'), 'up')).toBeUndefined()
    expect(findSpatialTarget(rectOf('a1'), grid.filter(item => item.item !== 'a1'), 'left')).toBeUndefined()
    expect(findSpatialTarget(rectOf('b3'), grid.filter(item => item.item !== 'b3'), 'down')).toBeUndefined()
    expect(findSpatialTarget(rectOf('b3'), grid.filter(item => item.item !== 'b3'), 'right')).toBeUndefined()
  })

  it('defines unique g chord keys for all navigation destinations and actions', () => {
    const keys = KEYBOARD_NAV_CHORDS.map(chord => chord.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(KEYBOARD_NAV_CHORDS.find(chord => chord.key === 'h')?.route).toBe('/')
    expect(KEYBOARD_NAV_CHORDS.find(chord => chord.key === 's')?.route).toBe('/feed/subscriptions')
    expect(KEYBOARD_NAV_CHORDS.find(chord => chord.key === 'r')?.route).toBe('/shorts')
    expect(KEYBOARD_NAV_CHORDS.find(chord => chord.key === ',')?.route).toBe('/settings')
  })
})
