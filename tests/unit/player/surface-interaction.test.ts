import { describe, expect, it } from 'vite-plus/test'

import { decideSurfaceClick, isTouchPointer, shouldAutoHideControlsOnLoad, shouldIgnoreHoverPointer } from '../../../src/player/surface-interaction'

describe('player surface interaction', () => {
  it('identifies touch pointers and suppresses hover wake/leave only on touch', () => {
    expect(isTouchPointer('touch')).toBe(true)
    expect(isTouchPointer('mouse')).toBe(false)
    expect(isTouchPointer('pen')).toBe(false)
    expect(isTouchPointer(undefined)).toBe(false)

    expect(shouldIgnoreHoverPointer('touch')).toBe(true)
    expect(shouldIgnoreHoverPointer('mouse')).toBe(false)
    expect(shouldIgnoreHoverPointer('pen')).toBe(false)

    expect(shouldAutoHideControlsOnLoad(query => ({ matches: query === '(pointer: coarse)' }))).toBe(true)
    expect(shouldAutoHideControlsOnLoad(query => ({ matches: query === '(hover: none)' }))).toBe(true)
    expect(shouldAutoHideControlsOnLoad(() => ({ matches: false }))).toBe(false)
    expect(shouldAutoHideControlsOnLoad(undefined)).toBe(false)
  })

  it('reveals or hides controls on touch taps without toggling playback', () => {
    expect(decideSurfaceClick({
      pointerType: 'touch',
      activeAtPress: false,
      paused: false,
      settingsOpen: false,
      menuAtPress: false,
    })).toBe('show-controls')

    expect(decideSurfaceClick({
      pointerType: 'touch',
      activeAtPress: true,
      paused: false,
      settingsOpen: false,
      menuAtPress: false,
    })).toBe('hide-controls')

    expect(decideSurfaceClick({
      pointerType: 'touch',
      activeAtPress: true,
      paused: true,
      settingsOpen: false,
      menuAtPress: false,
    })).toBe('show-controls')

    expect(decideSurfaceClick({
      pointerType: 'touch',
      activeAtPress: true,
      paused: false,
      settingsOpen: true,
      menuAtPress: false,
    })).toBe('show-controls')
  })

  it('toggles playback on mouse, pen, or synthetic keyboard clicks unless dismissing a menu', () => {
    for (const pointerType of ['mouse', 'pen', '', undefined]) {
      expect(decideSurfaceClick({
        pointerType,
        activeAtPress: false,
        paused: false,
        settingsOpen: false,
        menuAtPress: false,
      })).toBe('toggle-play')
    }

    expect(decideSurfaceClick({
      pointerType: 'mouse',
      activeAtPress: true,
      paused: false,
      settingsOpen: false,
      menuAtPress: true,
    })).toBe('ignore')

    expect(decideSurfaceClick({
      pointerType: 'touch',
      activeAtPress: false,
      paused: false,
      settingsOpen: false,
      menuAtPress: true,
    })).toBe('ignore')
  })
})
