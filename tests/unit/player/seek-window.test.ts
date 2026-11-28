import type shaka from 'shaka-player'

import { describe, expect, it } from 'vite-plus/test'

import { atLiveEdge, clampToWindow, liveBarClock, liveBarState, liveResumeTime, seekWindow, timeAtShare } from '../../../src/player/seek-window'
import { bufferedAhead } from '../../../src/player/use-player-state'

// rFZHOHl-L8A's window as Shaka gave it on 2026-11-11: 12 h of the stream's own clock, ending at the edge it plays at
const LIVE = { start: 7_160_913.1, end: 7_204_108.1 }

const videoOf = (duration: number) => ({ duration }) as HTMLVideoElement
const playerOf = (live: boolean) => ({ isLive: () => live, seekRange: () => LIVE }) as unknown as shaka.Player

describe('the seek window', () => {
  it('is a live stream\'s DVR window, as Shaka ranges it', () => {
    expect(seekWindow(videoOf(Number.POSITIVE_INFINITY), playerOf(true))).toEqual(LIVE)
  })

  it('is a video\'s whole length, and nothing before its length is known', () => {
    expect(seekWindow(videoOf(213), playerOf(false))).toEqual({ start: 0, end: 213 })
    expect(seekWindow(videoOf(Number.NaN), undefined)).toEqual({ start: 0, end: 0 })
  })

  it('holds a seek inside the window, so a key at the edge stays at the edge', () => {
    expect(clampToWindow(LIVE, LIVE.end + 5)).toBe(LIVE.end)
    expect(clampToWindow(LIVE, LIVE.start - 10)).toBe(LIVE.start)
    expect(clampToWindow(LIVE, LIVE.end - 10)).toBe(LIVE.end - 10)
  })

  it('puts a number key\'s share of the way through the window, not through the stream\'s clock', () => {
    expect(timeAtShare(LIVE, 0)).toBe(LIVE.start)
    expect(timeAtShare(LIVE, 0.5)).toBeCloseTo(7_182_510.6, 1)
    expect(timeAtShare({ start: 0, end: 213 }, 0.3)).toBeCloseTo(63.9, 5)
  })

  it('counts a playhead one 5 s step back as at the edge and two steps back as behind it, as youtube.com does', () => {
    // at the edge Shaka holds the playhead about 1 s behind its range's end (measured 2026-11-11)
    expect(atLiveEdge(LIVE, LIVE.end - 1)).toBe(true)
    expect(atLiveEdge(LIVE, LIVE.end - 6)).toBe(true)
    expect(atLiveEdge(LIVE, LIVE.end - 11)).toBe(false)
  })

  it('reopens a live stream at the edge after a restart there, and where it played when behind', () => {
    expect(liveResumeTime(LIVE, LIVE.end - 1)).toBe(0)
    expect(liveResumeTime(LIVE, LIVE.end - 3_600)).toBe(LIVE.end - 3_600)
  })

  it('pins the live progress bar at the edge, clamps behind-edge positions, and avoids -0:00', () => {
    const duration = LIVE.end - LIVE.start
    expect(liveBarState({
      isLive: true,
      liveWindow: LIVE,
      currentTime: LIVE.end - 3,
      duration: Number.POSITIVE_INFINITY,
      buffered: LIVE.end,
    })).toEqual({
      base: LIVE.start,
      duration,
      position: duration,
      behind: false,
      pinnedFull: true,
      buffered: duration,
    })

    // Non-DVR live stream with zero/empty seek range still pins full at live edge.
    expect(liveBarState({
      isLive: true,
      liveWindow: { start: 1000, end: 1000 },
      currentTime: 1000,
      duration: 0,
      buffered: 1000,
    })).toEqual({
      base: 1000,
      duration: 0,
      position: 0,
      behind: false,
      pinnedFull: true,
      buffered: 0,
    })

    // Paused behind live.start clamps position safely to 0.
    expect(liveBarState({
      isLive: true,
      liveWindow: LIVE,
      currentTime: LIVE.start - 30,
      duration: Number.POSITIVE_INFINITY,
      buffered: LIVE.start,
    })).toMatchObject({
      base: LIVE.start,
      position: 0,
      behind: true,
      pinnedFull: false,
    })

    // Scrubbing preview unpins even when currently at live edge.
    expect(liveBarState({
      isLive: true,
      liveWindow: LIVE,
      currentTime: LIVE.end - 1,
      duration: Number.POSITIVE_INFINITY,
      buffered: LIVE.end,
      preview: duration / 2,
    })).toMatchObject({
      position: duration / 2,
      behind: false,
      pinnedFull: false,
    })

    const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
    expect(liveBarClock(duration, duration, true, fmt)).toBe('Live')
    expect(liveBarClock(duration - 0.4, duration, true, fmt)).toBe('Live')
    expect(liveBarClock(0, 0, true, fmt)).toBe('Live')
    expect(liveBarClock(duration - 300, duration, true, fmt)).toBe('-5:00')

    const multiRange = {
      length: 2,
      start: (i: number) => (i === 0 ? 1490 : 1990),
      end: (i: number) => (i === 0 ? 1520 : 2000),
    }
    expect(bufferedAhead(multiRange, 1500)).toBe(1520)
    expect(bufferedAhead(multiRange, 1995)).toBe(2000)
    expect(bufferedAhead(multiRange, 1200)).toBe(1200)
  })
})
