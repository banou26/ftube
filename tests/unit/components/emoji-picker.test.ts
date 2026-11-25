import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => undefined }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: () => null }))
vi.mock('lucide-react', () => ({ Smile: () => null }))
vi.mock('preact/compat', () => ({ createPortal: () => null }))
vi.mock('preact/hooks', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useId: () => 'emoji-grid-test',
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [false, () => {}],
}))

const { EMOJI_CATEGORIES, filterCustomEmojis, filterEmojis, insertAtCursor } = await import('../../../src/components/emoji-picker')

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
})
