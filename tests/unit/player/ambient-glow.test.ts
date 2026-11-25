import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => '' }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))

import { ambientOpacity } from '../../../src/player/ambient-glow'

describe('ambientOpacity', () => {
  it('returns zero when ambient mode is disabled, fullscreen, docked, or reduced motion is preferred', () => {
    expect(ambientOpacity({ enabled: false, fullscreen: false, docked: false, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: true, docked: false, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: true, reducedMotion: false })).toBe(0)
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: false, reducedMotion: true })).toBe(0)
  })

  it('returns positive opacity when active on the watch stage', () => {
    expect(ambientOpacity({ enabled: true, fullscreen: false, docked: false, reducedMotion: false })).toBeGreaterThan(0)
  })
})
