import { describe, expect, it, vi } from 'vite-plus/test'
import {
  MOBILE_SEARCH_MAX_WIDTH,
  focusHeaderSearch,
  getMobileSearchOpen,
  registerHeaderSearchFocus,
  setMobileSearchOpen,
  shouldCollapseMiniplayer,
  subscribeMobileSearchOpen,
} from '../../../src/components/mobile-search'

describe('mobile search state and miniplayer collapse helper', () => {
  it('routes focusHeaderSearch through the registered Header handler until unregistered', () => {
    const focusHandler = vi.fn(() => true)
    const unregister = registerHeaderSearchFocus(focusHandler)

    expect(focusHeaderSearch()).toBe(true)
    expect(focusHandler).toHaveBeenCalledTimes(1)

    unregister()
    expect(focusHeaderSearch()).toBe(false)
    expect(focusHandler).toHaveBeenCalledTimes(1)
  })

  it('tracks and notifies listeners only when mobile search state changes', () => {
    setMobileSearchOpen(false)
    expect(getMobileSearchOpen()).toBe(false)

    const listener = vi.fn()
    const unsubscribe = subscribeMobileSearchOpen(listener)

    setMobileSearchOpen(false)
    expect(listener).not.toHaveBeenCalled()

    setMobileSearchOpen(true)
    expect(getMobileSearchOpen()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    setMobileSearchOpen(false)
    expect(getMobileSearchOpen()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setMobileSearchOpen(true)
    expect(listener).toHaveBeenCalledTimes(2)
    setMobileSearchOpen(false)
  })

  it('collapses an active docked miniplayer only at mobile width while Search is open', () => {
    expect(MOBILE_SEARCH_MAX_WIDTH).toBe(656)
    expect(shouldCollapseMiniplayer({ docked: true, viewportWidth: 390, mobileSearchOpen: true })).toBe(true)
    expect(shouldCollapseMiniplayer({ docked: true, viewportWidth: 656, mobileSearchOpen: true })).toBe(true)
    expect(shouldCollapseMiniplayer({ docked: true, viewportWidth: 657, mobileSearchOpen: true })).toBe(false)
    expect(shouldCollapseMiniplayer({ docked: true, viewportWidth: 390, mobileSearchOpen: false })).toBe(false)
    expect(shouldCollapseMiniplayer({ docked: false, viewportWidth: 390, mobileSearchOpen: true })).toBe(false)
  })
})
