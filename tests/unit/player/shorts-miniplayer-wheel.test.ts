import { describe, expect, it, vi } from 'vite-plus/test'

import { bindShortsMiniplayerWheel, createShortsWheelNavigator } from '../../../src/player/shorts-miniplayer-wheel'

describe('createShortsWheelNavigator', () => {
  it('accumulates small pixel deltas to step forward/backward once across threshold', () => {
    let nowMs = 1_000
    const nav = createShortsWheelNavigator({ now: () => nowMs })

    expect(nav.handle({ deltaY: 12 })).toBe(0)
    nowMs += 20
    expect(nav.handle({ deltaY: 12 })).toBe(0)
    nowMs += 20
    expect(nav.handle({ deltaY: 12 })).toBe(1)

    nowMs += 700
    expect(nav.handle({ deltaY: -40 })).toBe(-1)
  })

  it('collapses a long trackpad momentum tail into a single step', () => {
    let nowMs = 0
    const nav = createShortsWheelNavigator({ now: () => nowMs })

    const results: Array<number | null> = []
    // Continuous momentum events spaced every 35 ms for ~700 ms (past the 450 ms cooldown, never idle >= 180 ms).
    for (const deltaY of [70, 64, 56, 48, 42, 36, 30, 26, 22, 18, 15, 12, 10, 8, 6, 4, 3, 2, 2, 1]) {
      results.push(nav.handle({ deltaY }))
      nowMs += 35
    }
    expect(results).toEqual([1, ...Array(19).fill(0)])

    // Once the finger pauses longer than idleResetMs after cooldown, the next deliberate swipe advances again.
    nowMs += 250
    expect(nav.handle({ deltaY: 45 })).toBe(1)
  })

  it('unlocks opposite-direction gestures once cooldown passes and ignores zoom or horizontal scroll', () => {
    let nowMs = 500
    const nav = createShortsWheelNavigator({ now: () => nowMs })

    expect(nav.handle({ deltaY: 50 })).toBe(1)
    nowMs += 460
    expect(nav.handle({ deltaY: -50 })).toBe(-1)

    expect(nav.handle({ deltaY: 50, ctrlKey: true })).toBeNull()
    expect(nav.handle({ deltaY: 50, metaKey: true })).toBeNull()
    expect(nav.handle({ deltaY: 50, altKey: true })).toBeNull()
    expect(nav.handle({ deltaY: 10, deltaX: 40 })).toBeNull()
    expect(nav.handle({ deltaY: 0 })).toBeNull()
  })

  it('treats line-mode mouse wheel ticks as immediate single steps', () => {
    let nowMs = 100
    const nav = createShortsWheelNavigator({ now: () => nowMs })
    expect(nav.handle({ deltaY: 1, deltaMode: 1 })).toBe(1)
    expect(nav.handle({ deltaY: 1, deltaMode: 1 })).toBe(0)
    nowMs += 500
    expect(nav.handle({ deltaY: -1, deltaMode: 1 })).toBe(-1)
  })
})

describe('bindShortsMiniplayerWheel', () => {
  it('prevents page scroll on handled vertical wheel events while skipping ignored targets', () => {
    const listeners = new Map<string, (event: WheelEvent) => void>()
    const target = {
      addEventListener: (type: string, listener: (event: WheelEvent) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLElement

    const steps: number[] = []
    let nowMs = 1_000
    const unbind = bindShortsMiniplayerWheel(target, {
      onStep: step => steps.push(step),
      shouldIgnore: event => (event.target as { isVolume?: boolean } | null)?.isVolume === true,
      options: { now: () => nowMs },
    })
    const dispatch = (overrides: Record<string, unknown>) => {
      const preventDefault = vi.fn()
      listeners.get('wheel')!({
        deltaY: 45,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault,
        ...overrides,
      } as unknown as WheelEvent)
      return preventDefault
    }

    const volumePrevent = dispatch({ target: { isVolume: true }, deltaY: -120 })
    expect(volumePrevent).not.toHaveBeenCalled()
    expect(steps).toEqual([])

    const preHandled = dispatch({ defaultPrevented: true })
    expect(preHandled).not.toHaveBeenCalled()
    expect(steps).toEqual([])

    const first = dispatch({ deltaY: 15 })
    expect(first).toHaveBeenCalledTimes(1)
    expect(steps).toEqual([])

    nowMs += 20
    const second = dispatch({ deltaY: 30 })
    expect(second).toHaveBeenCalledTimes(1)
    expect(steps).toEqual([1])

    nowMs += 30
    const momentum = dispatch({ deltaY: 40 })
    expect(momentum).toHaveBeenCalledTimes(1)
    expect(steps).toEqual([1])

    unbind()
    expect(listeners.size).toBe(0)
  })
})
