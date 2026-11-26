import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => '' }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))
vi.mock('preact/compat', () => ({ createPortal: (value: unknown) => value }))
vi.mock('preact/hooks', () => ({
  useEffect: () => {},
  useState: (initial: unknown) => [initial, () => {}],
}))
vi.mock('../../../src/player/fullscreen', () => ({
  getFullscreenElement: () => null,
  subscribeFullscreen: () => () => {},
}))

const { dismissToast, showToast, TOAST_DISMISS_MS } = await import('../../../src/components/ui/toast')

describe('toast expiration lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onExpire once after TOAST_DISMISS_MS only when not dismissed manually', () => {
    let expiredA = 0
    const idA = showToast('Action A', { label: 'Undo', onAction: () => {} }, {
      onExpire: () => { expiredA += 1 },
    })
    dismissToast(idA)
    vi.advanceTimersByTime(TOAST_DISMISS_MS + 100)
    expect(expiredA).toBe(0)

    let expiredB = 0
    showToast('Action B', { label: 'Undo', onAction: () => {} }, {
      onExpire: () => { expiredB += 1 },
    })
    vi.advanceTimersByTime(TOAST_DISMISS_MS - 1)
    expect(expiredB).toBe(0)
    vi.advanceTimersByTime(1)
    expect(expiredB).toBe(1)
  })

  it('respects custom durationMs for toast expiry', () => {
    let expired = 0
    showToast('Custom TTL', { label: 'Undo', onAction: () => {} }, {
      durationMs: 1_200,
      onExpire: () => { expired += 1 },
    })
    vi.advanceTimersByTime(1_199)
    expect(expired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(expired).toBe(1)
  })
})
