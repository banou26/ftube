import { describe, expect, it } from 'vite-plus/test'

import { resolveShortsFocusMove } from '../../../src/player/shorts-focus'

describe('resolveShortsFocusMove', () => {
  it('moves focus to the new active slide when focus was in an outgoing slide', () => {
    expect(resolveShortsFocusMove({
      trackedRegion: 'slide',
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 1,
      itemCount: 3,
    })).toBe('active-slide')

    expect(resolveShortsFocusMove({
      trackedRegion: 'slide',
      slideChanged: true,
      focusLostToDocument: false,
      focusInsideActiveSlide: false,
      activeIndex: 2,
      itemCount: 3,
    })).toBe('active-slide')
  })

  it('keeps focus on Next short while more slides remain, and falls back to Previous short at the end of the feed', () => {
    expect(resolveShortsFocusMove({
      trackedRegion: 'next-button',
      slideChanged: true,
      focusLostToDocument: false,
      focusInsideActiveSlide: false,
      activeIndex: 1,
      itemCount: 3,
    })).toBe('none')

    expect(resolveShortsFocusMove({
      trackedRegion: 'next-button',
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 2,
      itemCount: 3,
    })).toBe('prev-button')
  })

  it('keeps focus on Previous short while earlier slides remain, and moves to Next short at index 0', () => {
    expect(resolveShortsFocusMove({
      trackedRegion: 'prev-button',
      slideChanged: true,
      focusLostToDocument: false,
      focusInsideActiveSlide: false,
      activeIndex: 1,
      itemCount: 3,
    })).toBe('none')

    expect(resolveShortsFocusMove({
      trackedRegion: 'prev-button',
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 0,
      itemCount: 3,
    })).toBe('next-button')
  })

  it('falls back to active-slide on single-item feeds and ignores unrelated focus', () => {
    expect(resolveShortsFocusMove({
      trackedRegion: 'next-button',
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 0,
      itemCount: 1,
    })).toBe('active-slide')

    expect(resolveShortsFocusMove({
      trackedRegion: 'prev-button',
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 0,
      itemCount: 1,
    })).toBe('active-slide')

    expect(resolveShortsFocusMove({
      trackedRegion: null,
      slideChanged: true,
      focusLostToDocument: false,
      focusInsideActiveSlide: false,
      activeIndex: 1,
      itemCount: 3,
    })).toBe('none')

    expect(resolveShortsFocusMove({
      trackedRegion: null,
      slideChanged: true,
      focusLostToDocument: true,
      focusInsideActiveSlide: false,
      activeIndex: 1,
      itemCount: 3,
    })).toBe('none')

    expect(resolveShortsFocusMove({
      trackedRegion: 'slide',
      slideChanged: false,
      focusLostToDocument: false,
      focusInsideActiveSlide: true,
      activeIndex: 0,
      itemCount: 3,
    })).toBe('none')
  })
})
