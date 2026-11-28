import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => undefined }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))
vi.mock('lucide-react', () => ({
  Cake: () => null,
  Car: () => null,
  Flower2: () => null,
  Hand: () => null,
  Heart: () => null,
  Lightbulb: () => null,
  Lock: () => null,
  Search: () => null,
  Smile: () => null,
  Sparkles: () => null,
  Trophy: () => null,
  Tv: () => null,
}))
vi.mock('preact/compat', () => ({ createPortal: () => null }))
vi.mock('preact/hooks', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useId: () => 'emoji-grid-test',
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [false, () => {}],
}))
vi.mock('wouter', () => ({ Link: () => null }))

const {
  EMOJI_CATEGORIES,
  EMOJIS,
  SKIN_TONES,
  applySkinTone,
  filterCustomEmojis,
  filterEmojis,
  insertAtCursor,
  splitCustomEmojis,
} = await import('../../../src/components/emoji-picker')

describe('insertAtCursor', () => {
  it('inserts an emoji at the start, middle, and end of a draft', () => {
    expect(insertAtCursor('hello world', 0, 0, '🔥')).toEqual({ value: '🔥hello world', cursor: 2 })
    expect(insertAtCursor('hello world', 5, 5, ' 👏')).toEqual({ value: 'hello 👏 world', cursor: 8 })
    expect(insertAtCursor('hello', 5, 5, '❤️')).toEqual({ value: 'hello❤️', cursor: 7 })
  })

  it('replaces a selected range and clamps out-of-range offsets', () => {
    expect(insertAtCursor('nice [bad] video', 5, 10, '🔥')).toEqual({ value: 'nice 🔥 video', cursor: 7 })
    expect(insertAtCursor('hi', -5, 99, '🎉')).toEqual({ value: '🎉', cursor: 2 })
    expect(insertAtCursor('', 0, 0, '🚀')).toEqual({ value: '🚀', cursor: 2 })
  })
})

describe('filterEmojis', () => {
  it('filters by category when query is empty', () => {
    const smileys = filterEmojis('', 'Smileys')
    expect(smileys.length).toBeGreaterThan(10)
    expect(smileys.every(entry => entry.category === 'Smileys')).toBe(true)
    expect(filterEmojis('')).toHaveLength(
      EMOJI_CATEGORIES.reduce((total, category) => total + filterEmojis('', category).length, 0),
    )
  })

  it('searches names and keywords across categories case-insensitively', () => {
    expect(filterEmojis('FIRE').map(entry => entry.emoji)).toContain('🔥')
    expect(filterEmojis('rofl').map(entry => entry.emoji)).toContain('🤣')
    expect(filterEmojis('definitely-not-an-emoji-name')).toEqual([])
  })

  it('filters channel custom emojis by shortcut case-insensitively', () => {
    const custom = [
      { id: 'c1', shortcut: ':hypers:', url: 'https://img/hypers.png' },
      { id: 'c2', shortcut: ':gg:', url: 'https://img/gg.png' },
    ]
    expect(filterCustomEmojis(custom, '')).toHaveLength(2)
    expect(filterCustomEmojis(custom, 'HYP')).toEqual([custom[0]])
    expect(filterCustomEmojis(custom, 'none')).toEqual([])
  })

  it('splits channel emojis from YouTube global emojis while preserving lock metadata', () => {
    const grouped = splitCustomEmojis([
      { id: 'UCch/1', shortcut: ':member:', url: 'https://img/m.png', group: 'channel', locked: true, lockReason: 'Members only' },
      { id: 'UCkszU2WH9gy1mb0dV-11UJg/1', shortcut: ':yt:', url: 'https://img/yt.png', group: 'youtube' },
      { id: 'legacy', shortcut: ':legacy:', url: 'https://img/l.png' },
    ])
    expect(grouped.channel.map(item => item.shortcut)).toEqual([':member:', ':legacy:'])
    expect(grouped.channel[0]?.locked).toBe(true)
    expect(grouped.youtube.map(item => item.shortcut)).toEqual([':yt:'])
  })
})

describe('categories and skin tones', () => {
  it('includes Travel and Activities categories and unique emoji keys', () => {
    expect(EMOJI_CATEGORIES).toContain('Travel')
    expect(EMOJI_CATEGORIES).toContain('Activities')
    expect(EMOJIS.filter(entry => entry.category === 'Travel').length).toBeGreaterThan(5)
    expect(EMOJIS.filter(entry => entry.category === 'Activities').length).toBeGreaterThan(5)
    const unique = new Set(EMOJIS.map(entry => entry.emoji))
    expect(unique.size).toBe(EMOJIS.length)
  })

  it('defines six skin tones and applies modifiers only to eligible entries', () => {
    expect(SKIN_TONES).toHaveLength(6)
    expect(SKIN_TONES.map(tone => tone.modifier)).toEqual([
      '',
      '\u{1F3FB}',
      '\u{1F3FC}',
      '\u{1F3FD}',
      '\u{1F3FE}',
      '\u{1F3FF}',
    ])

    const thumbsUp = EMOJIS.find(entry => entry.name === 'Thumbs up')!
    const victory = EMOJIS.find(entry => entry.name === 'Victory hand')!
    const grinning = EMOJIS.find(entry => entry.name === 'Grinning face')!
    const fire = EMOJIS.find(entry => entry.name === 'Fire')!

    expect(applySkinTone(thumbsUp, '')).toBe('👍')
    expect(applySkinTone(thumbsUp, '\u{1F3FD}')).toBe('👍🏽')
    expect(applySkinTone(victory, '\u{1F3FD}')).toBe('\u270C\u{1F3FD}')
    expect(applySkinTone(grinning, '\u{1F3FD}')).toBe('😀')
    expect(applySkinTone(fire, '\u{1F3FF}')).toBe('🔥')
  })
})
