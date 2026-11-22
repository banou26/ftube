import { describe, expect, it } from 'vite-plus/test'

import { linkifyRuns, linkifyText } from '../../../src/components/linkify'

describe('linkifyText', () => {
  it('linkifies external http and https URLs and routes YouTube video URLs in-app', () => {
    const input = 'Part 1: https://youtu.be/5nLWTVTwOhY\n\nMerch: http://shop.MKBHD.com'
    expect(linkifyText(input)).toEqual([
      { text: 'Part 1: ' },
      { text: 'https://youtu.be/5nLWTVTwOhY', videoId: '5nLWTVTwOhY' },
      { text: '\n\nMerch: ' },
      { text: 'http://shop.MKBHD.com', url: 'http://shop.mkbhd.com/' },
    ])
  })

  it('routes plain youtube.com/watch links in-app and keeps playlist links external', () => {
    expect(linkifyText('Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ now')).toEqual([
      { text: 'Watch ' },
      { text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' },
      { text: ' now' },
    ])
    expect(linkifyText('Queue https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toEqual([
      { text: 'Queue ' },
      {
        text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
      },
    ])
  })

  it('keeps trailing sentence punctuation and unmatched brackets outside links while preserving balanced parens', () => {
    expect(linkifyText('See (https://example.com/path), and https://en.wikipedia.org/wiki/Foo_(bar)!')).toEqual([
      { text: 'See (' },
      { text: 'https://example.com/path', url: 'https://example.com/path' },
      { text: '), and ' },
      { text: 'https://en.wikipedia.org/wiki/Foo_(bar)', url: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { text: '!' },
    ])
  })

  it('leaves non-http schemes and malformed URLs as plain text', () => {
    expect(linkifyText('javascript:alert(1) ftp://example.com http:// plain')).toEqual([
      { text: 'javascript:alert(1) ftp://example.com http:// plain' },
    ])
    expect(linkifyText('')).toEqual([])
  })
})

describe('linkifyRuns', () => {
  it('preserves upstream linked runs and linkifies plain runs while trimming edge blank lines', () => {
    const runs = [
      { text: '\n\nCheck ' },
      { text: 'https://example.com/trunc...', url: 'https://example.com/truncated-full-path' },
      { text: '\nAlso https://youtu.be/5nLWTVTwOhY\n\n' },
    ]
    expect(linkifyRuns('ignored fallback', runs)).toEqual([
      { text: 'Check ' },
      { text: 'https://example.com/trunc...', url: 'https://example.com/truncated-full-path' },
      { text: '\nAlso ' },
      { text: 'https://youtu.be/5nLWTVTwOhY', videoId: '5nLWTVTwOhY' },
    ])
  })

  it('falls back to linkifying the plain description when no upstream runs are given', () => {
    expect(linkifyRuns('\nVisit https://shop.example.com\n', null)).toEqual([
      { text: 'Visit ' },
      { text: 'https://shop.example.com', url: 'https://shop.example.com/' },
    ])
  })
})
