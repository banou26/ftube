import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { bindSmoothPlaybackLoop } from '../../../src/player/smooth-progress'

class FakeVideo extends EventTarget {
  paused = true
  ended = false
}

describe('bindSmoothPlaybackLoop', () => {
  let frames: { id: number, cb: FrameRequestCallback }[]
  let nextId: number
  let cancelled: number[]

  beforeEach(() => {
    frames = []
    nextId = 1
    cancelled = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++
      frames.push({ id, cb })
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id)
      frames = frames.filter(item => item.id !== id)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs a frame loop while playing and stops cleanly on pause, ended, or cleanup', () => {
    const video = new FakeVideo()
    const onFrame = vi.fn()
    const unbind = bindSmoothPlaybackLoop(video as unknown as HTMLVideoElement, onFrame)

    // Initial sync runs once; paused video schedules no rAF loop.
    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)

    // Paused seek still notifies once without scheduling an idle loop.
    video.dispatchEvent(new Event('seeked'))
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(frames).toHaveLength(0)

    // Play starts the rAF loop and steps on each animation frame.
    video.paused = false
    video.dispatchEvent(new Event('play'))
    expect(onFrame).toHaveBeenCalledTimes(3)
    expect(frames).toHaveLength(1)

    const frame1 = frames.shift()!
    frame1.cb(16)
    expect(onFrame).toHaveBeenCalledTimes(4)
    expect(frames).toHaveLength(1)

    // Pausing cancels pending rAF and emits one final sync.
    video.paused = true
    video.dispatchEvent(new Event('pause'))
    expect(cancelled).toContain(frame1.id + 1)
    expect(frames).toHaveLength(0)
    expect(onFrame).toHaveBeenCalledTimes(5)

    // Resuming and tearing down cleans up both listeners and pending frames.
    video.paused = false
    video.dispatchEvent(new Event('playing'))
    expect(frames).toHaveLength(1)
    unbind()
    expect(frames).toHaveLength(0)
    video.dispatchEvent(new Event('seeked'))
    expect(onFrame).toHaveBeenCalledTimes(6)
  })

  it('does not tick or schedule frames when isActive returns false', () => {
    const video = new FakeVideo()
    video.paused = false
    let active = false
    const onFrame = vi.fn()
    const unbind = bindSmoothPlaybackLoop(video as unknown as HTMLVideoElement, onFrame, () => active)

    expect(onFrame).toHaveBeenCalledTimes(0)
    expect(frames).toHaveLength(0)

    active = true
    video.dispatchEvent(new Event('play'))
    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(1)

    active = false
    const queued = frames.shift()!
    queued.cb(32)
    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(0)
    unbind()
  })
})
