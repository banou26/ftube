import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  clampContainedOverlayPosition,
  classifyChatMessage,
  coerceOverScreenSettings,
  DEFAULT_OVER_SCREEN_SETTINGS,
  getOverScreenSettings,
  OVERLAY_FONT_STACKS,
  OVERLAY_TYPE_ANIMATION_FIELDS,
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
      capsAnimation: 'shake',
      questionAnimation: 'invalid' as never,
      exclamationAnimation: 'bounce',
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
      capsAnimation: 'shake',
      questionAnimation: DEFAULT_OVER_SCREEN_SETTINGS.questionAnimation,
      exclamationAnimation: 'bounce',
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

    expect(coerceOverScreenSettings({ showAuthor: false })).toMatchObject({
      showAuthor: false,
      showAvatar: false,
    })
    expect(coerceOverScreenSettings({ showAuthor: true })).toMatchObject({
      showAuthor: true,
      showAvatar: true,
    })
    expect(coerceOverScreenSettings({ showAuthor: false, showAvatar: true })).toMatchObject({
      showAuthor: false,
      showAvatar: true,
    })
    expect(coerceOverScreenSettings({ showAuthor: true, showAvatar: false })).toMatchObject({
      showAuthor: true,
      showAvatar: false,
    })
    expect(OVERLAY_TYPE_ANIMATION_FIELDS.map((field) => field.kind)).toEqual(['caps', 'question', 'exclamation'])
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
      textAnimation: 'fade',
      emojiAnimation: 'burst',
      styleByType: true,
    })).toBe('pop')

    expect(resolveOverlayAnimation('question', {
      textAnimation: 'fade',
      emojiAnimation: 'burst',
      styleByType: true,
    })).toBe('bounce')

    expect(resolveOverlayAnimation('exclamation', {
      textAnimation: 'fade',
      emojiAnimation: 'burst',
      styleByType: true,
    })).toBe('pop')

    expect(resolveOverlayAnimation('normal', {
      textAnimation: 'fade',
      emojiAnimation: 'burst',
      styleByType: true,
    })).toBe('fade')

    expect(resolveOverlayAnimation('question', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      capsAnimation: 'shake',
      questionAnimation: 'fade',
      exclamationAnimation: 'bounce',
      styleByType: true,
    })).toBe('fade')

    expect(resolveOverlayAnimation('caps', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      capsAnimation: 'shake',
      questionAnimation: 'fade',
      exclamationAnimation: 'bounce',
      styleByType: true,
    })).toBe('shake')

    expect(resolveOverlayAnimation('exclamation', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      capsAnimation: 'shake',
      questionAnimation: 'fade',
      exclamationAnimation: 'bounce',
      styleByType: true,
    })).toBe('bounce')

    expect(resolveOverlayAnimation('question', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      questionAnimation: 'fade',
      styleByType: false,
    })).toBe('scroll')

    expect(resolveOverlayAnimation('caps', {
      textAnimation: 'scroll',
      emojiAnimation: 'burst',
      styleByType: false,
    })).toBe('scroll')
  })

  it('clamps contained overlay items inside narrow and desktop bounds with gutter', () => {
    // 390x219 player with wide wrapped bubble at right-edge leftPct 71 clamps inside 12px gutter
    expect(clampContainedOverlayPosition({
      containerWidth: 390,
      containerHeight: 219,
      itemWidth: 366,
      itemHeight: 148,
      leftPct: 71,
      topPct: 60,
    })).toEqual({ leftPx: 12, topPx: 59 })

    // Short bubble near right edge on 390px clamps right edge cleanly inside container
    expect(clampContainedOverlayPosition({
      containerWidth: 390,
      containerHeight: 219,
      itemWidth: 160,
      itemHeight: 46,
      leftPct: 71,
      topPct: 68,
    })).toEqual({ leftPx: 218, topPx: 149 })

    // Desktop 800x450 mid-frame preserves percentage while right-edge bubbles clamp inward
    expect(clampContainedOverlayPosition({
      containerWidth: 800,
      containerHeight: 450,
      itemWidth: 200,
      itemHeight: 48,
      leftPct: 37,
      topPct: 27,
    })).toEqual({ leftPx: 296, topPx: 122 })

    expect(clampContainedOverlayPosition({
      containerWidth: 800,
      containerHeight: 450,
      itemWidth: 320,
      itemHeight: 72,
      leftPct: 71,
      topPct: 60,
    })).toEqual({ leftPx: 468, topPx: 270 })

    // Oversized tall bubble centers within symmetric vertical slack
    expect(clampContainedOverlayPosition({
      containerWidth: 390,
      containerHeight: 219,
      itemWidth: 370,
      itemHeight: 205,
      leftPct: 71,
      topPct: 80,
    })).toEqual({ leftPx: 10, topPx: 7 })
  })
})
