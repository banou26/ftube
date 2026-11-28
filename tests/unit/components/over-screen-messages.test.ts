import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  classifyChatMessage,
  coerceOverScreenSettings,
  DEFAULT_OVER_SCREEN_SETTINGS,
  getOverScreenSettings,
  OVERLAY_FONT_STACKS,
  resetOverScreenSettings,
  resolveOverlayAnimation,
  shouldAcceptOverlayMessage,
  updateOverScreenSettings,
} from '../../../src/components/over-screen-messages'

const createStorage = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => { data.clear() },
  }
}

describe('over-screen live chat messages', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
    resetOverScreenSettings()
    updateOverScreenSettings({ enabled: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies Unicode and custom emoji-only messages separately from text categories', () => {
    expect(classifyChatMessage('🔥🔥🔥', [{ text: '🔥🔥🔥' }])).toEqual({
      kind: 'emoji-only',
      emojis: [
        { type: 'text', value: '🔥' },
        { type: 'text', value: '🔥' },
        { type: 'text', value: '🔥' },
      ],
    })

    expect(classifyChatMessage(':party:', [
      { text: ':party:', emojiUrl: 'https://cdn.example/party.png', emojiLabel: ':party:' },
    ])).toEqual({
      kind: 'emoji-only',
      emojis: [{ type: 'custom', url: 'https://cdn.example/party.png', label: ':party:' }],
    })

    expect(classifyChatMessage('LETS GOOOO').kind).toBe('caps')
    expect(classifyChatMessage('Wait what?').kind).toBe('question')
    expect(classifyChatMessage('Nice clip!').kind).toBe('exclamation')
    expect(classifyChatMessage('hello world 123').kind).toBe('normal')
    expect(classifyChatMessage('©').kind).toBe('normal')
    expect(classifyChatMessage('©️').kind).toBe('emoji-only')
  })

  it('coerces out-of-range settings and persists updates safely', () => {
    const coerced = coerceOverScreenSettings({
      enabled: true,
      textAnimation: 'invalid' as never,
      emojiAnimation: 'shatter',
      fontFamily: 'mono',
      fontSizePx: 200,
      speed: 0.1,
      opacity: 5,
      slowModeMs: -50,
      maxOnScreen: 99,
    })

    expect(coerced).toEqual({
      ...DEFAULT_OVER_SCREEN_SETTINGS,
      enabled: true,
      emojiAnimation: 'shatter',
      fontFamily: 'mono',
      fontSizePx: 56,
      speed: 0.5,
      opacity: 1,
      slowModeMs: 0,
      maxOnScreen: 40,
    })

    expect(OVERLAY_FONT_STACKS[coerced.fontFamily]).toContain('monospace')

    updateOverScreenSettings({ enabled: true, fontFamily: 'rounded', fontSizePx: 34 })
    expect(getOverScreenSettings().enabled).toBe(true)
    expect(getOverScreenSettings().fontFamily).toBe('rounded')
    expect(getOverScreenSettings().fontSizePx).toBe(34)

    resetOverScreenSettings()
    expect(getOverScreenSettings().fontSizePx).toBe(DEFAULT_OVER_SCREEN_SETTINGS.fontSizePx)
    expect(getOverScreenSettings().enabled).toBe(true)
  })

  it('enforces client slow-mode throttling and type-aware animation selection', () => {
    expect(shouldAcceptOverlayMessage(undefined, 1_000, 500)).toBe(true)
    expect(shouldAcceptOverlayMessage(1_000, 1_200, 500)).toBe(false)
    expect(shouldAcceptOverlayMessage(1_000, 1_500, 500)).toBe(true)
    expect(shouldAcceptOverlayMessage(1_000, 1_001, 0)).toBe(true)

    expect(resolveOverlayAnimation('emoji-only', {
      textAnimation: 'scroll',
      emojiAnimation: 'shatter',
      styleByType: true,
    })).toBe('shatter')

    expect(resolveOverlayAnimation('caps', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      styleByType: true,
    })).toBe('pop')

    expect(resolveOverlayAnimation('caps', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      styleByType: false,
    })).toBe('scroll')
  })
})
