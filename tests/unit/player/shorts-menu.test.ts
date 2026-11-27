import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@emotion/react', () => ({ css: () => undefined }))
vi.mock('@emotion/react/jsx-runtime', () => ({ Fragment: 'Fragment', jsx: () => null, jsxs: () => null }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ Fragment: 'Fragment', jsxDEV: () => null }))
vi.mock('lucide-react', () => ({
  Ban: () => null,
  Bookmark: () => null,
  Captions: () => null,
  Check: () => null,
  ChevronLeft: () => null,
  CircleX: () => null,
  Gauge: () => null,
  Languages: () => null,
  Maximize: () => null,
  Minimize: () => null,
  MonitorPlay: () => null,
  TextAlignStart: () => null,
  Tv: () => null,
  X: () => null,
}))
vi.mock('preact', () => ({ cloneElement: () => null }))
vi.mock('preact/hooks', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => [initial, () => {}],
}))
vi.mock('wouter', () => ({ Link: () => null }))
vi.mock('../../../src/components/rich-text', () => ({
  hashtagHrefFor: (raw: string) => `/hashtag/${raw.replace(/^#/, '').toLowerCase()}`,
  RichText: () => null,
}))
vi.mock('../../../src/components/ui/popup', () => ({
  MenuDivider: () => null,
  MenuItem: () => null,
  Popup: () => null,
  useDismiss: () => {},
}))
vi.mock('../../../src/components/verified-badge', () => ({ VerifiedBadge: () => null }))
vi.mock('../../../src/player/speed-picker', () => ({ SpeedPicker: () => null }))

const { formatShortStatValue, splitShortPublishDate } = await import('../../../src/player/shorts-menu')

describe('shorts-menu helpers', () => {
  it('splits publish dates into primary date and optional year lines', () => {
    expect(splitShortPublishDate('Oct 23, 2026')).toEqual({ top: 'Oct 23', bottom: '2026' })
    expect(splitShortPublishDate('Premiered Oct 23, 2026')).toEqual({ top: 'Oct 23', bottom: '2026' })
    expect(splitShortPublishDate('Streamed live on 23 Oct 2026')).toEqual({ top: '23 Oct', bottom: '2026' })
    expect(splitShortPublishDate('23 Oct 2026')).toEqual({ top: '23 Oct', bottom: '2026' })
    expect(splitShortPublishDate(undefined, '3 days ago')).toEqual({ top: '3 days ago' })
    expect(splitShortPublishDate('', '1 month ago')).toEqual({ top: '1 month ago' })
    expect(splitShortPublishDate(null, null)).toBeUndefined()
  })

  it('strips trailing view/like nouns for compact Short stat tiles', () => {
    expect(formatShortStatValue('3M views')).toBe('3M')
    expect(formatShortStatValue('69K likes')).toBe('69K')
    expect(formatShortStatValue('1 view')).toBe('1')
    expect(formatShortStatValue('  447  ')).toBe('447')
    expect(formatShortStatValue('  ')).toBeUndefined()
    expect(formatShortStatValue(null)).toBeUndefined()
  })
})
