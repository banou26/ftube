import { describe, expect, it, vi } from 'vite-plus/test'

import type { MediaSessionLike, MediaSessionTarget } from '../../../src/player/media-session'

import {
  bindMediaSession,
  syncMediaSessionState,
  updateMediaSessionMetadata,
} from '../../../src/player/media-session'

describe('media session integration helpers', () => {
  it('updates metadata cleanly and handles missing navigator.mediaSession without throwing', () => {
    expect(() => updateMediaSessionMetadata({ videoId: 'dQw4w9WgXcQ', title: 'Test' })).not.toThrow()

    const session: MediaSessionLike = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn(),
    }

    updateMediaSessionMetadata(
      { videoId: 'dQw4w9WgXcQ', title: 'Video Title', artist: 'Channel' },
      {
        session,
        buildMetadata: input => ({
          title: input.title,
          artist: input.artist,
          artwork: [`https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg`],
        }),
      },
    )

    expect(session.metadata).toEqual({
      title: 'Video Title',
      artist: 'Channel',
      artwork: ['https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'],
    })
  })

  it('clamps position state and skips non-finite durations', () => {
    const setPositionState = vi.fn()
    const session: MediaSessionLike = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn(),
      setPositionState,
    }

    syncMediaSessionState({ paused: true, currentTime: 10, duration: Number.POSITIVE_INFINITY, playbackRate: 1 }, session)
    expect(session.playbackState).toBe('paused')
    expect(setPositionState).not.toHaveBeenCalled()

    syncMediaSessionState({ paused: false, currentTime: 25, duration: 3600, playbackRate: 1, isLive: true }, session)
    expect(session.playbackState).toBe('playing')
    expect(setPositionState).not.toHaveBeenCalled()

    syncMediaSessionState({ paused: false, currentTime: 150, duration: 120, playbackRate: 1.5 }, session)
    expect(session.playbackState).toBe('playing')
    expect(setPositionState).toHaveBeenCalledWith({ duration: 120, position: 120, playbackRate: 1.5 })
  })

  it('registers transport action handlers, seeks within range, and clears handlers on cleanup', () => {
    const handlers = new Map<string, ((details: MediaSessionActionDetails) => void) | null>()
    const setPositionState = vi.fn()
    const session: MediaSessionLike = {
      metadata: { title: 'Video Title' },
      playbackState: 'none',
      setActionHandler (action, handler) {
        handlers.set(action, handler)
      },
      setPositionState,
    }
    const target: MediaSessionTarget = {
      paused: false,
      currentTime: 30,
      duration: 100,
      playbackRate: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      fastSeek: vi.fn(),
      seekRange: () => ({ start: 0, end: 100 }),
    }
    const onNext = vi.fn()

    const cleanup = bindMediaSession(target, { onNext, session })

    expect(session.playbackState).toBe('playing')
    handlers.get('pause')?.({ action: 'pause' })
    expect(target.pause).toHaveBeenCalledTimes(1)

    handlers.get('play')?.({ action: 'play' })
    expect(target.play).toHaveBeenCalledTimes(1)

    handlers.get('seekforward')?.({ action: 'seekforward', seekOffset: 15 })
    expect(target.currentTime).toBe(45)

    handlers.get('seekbackward')?.({ action: 'seekbackward' })
    expect(target.currentTime).toBe(35)

    handlers.get('seekto')?.({ action: 'seekto', seekTime: 80, fastSeek: true })
    expect(target.fastSeek).toHaveBeenCalledWith(80)

    handlers.get('nexttrack')?.({ action: 'nexttrack' })
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(handlers.get('previoustrack')).toBeNull()

    cleanup()
    expect(session.metadata).toBeNull()
    expect(session.playbackState).toBe('none')
    expect(handlers.get('play')).toBeNull()
    expect(handlers.get('pause')).toBeNull()
    expect(handlers.get('nexttrack')).toBeNull()
  })
})
