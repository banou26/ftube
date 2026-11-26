import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { bindNativeTransitionResume } from '../../../src/player/ios-playback'

class Emitter {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener (type: string, listener: EventListener) {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener (type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  emit (type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type } as Event)
  }

  listenerCount () {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}

const createHarness = (initialPaused = false) => {
  const videoEmitter = new Emitter()
  const docEmitter = new Emitter()
  const play = vi.fn().mockResolvedValue(undefined)
  const video = {
    paused: initialPaused,
    ended: false,
    play,
    addEventListener: videoEmitter.addEventListener.bind(videoEmitter),
    removeEventListener: videoEmitter.removeEventListener.bind(videoEmitter),
    emit: videoEmitter.emit.bind(videoEmitter),
  }
  const doc = {
    hidden: false,
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: docEmitter.addEventListener.bind(docEmitter),
    removeEventListener: docEmitter.removeEventListener.bind(docEmitter),
    emit: docEmitter.emit.bind(docEmitter),
  }
  return { video, doc, play, videoEmitter, docEmitter }
}

describe('bindNativeTransitionResume', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    'webkitpresentationmodechanged',
    'webkitbeginfullscreen',
    'webkitendfullscreen',
    'enterpictureinpicture',
  ] as const)('resumes involuntary pause within 600ms of %s and retries once after 100ms', (event) => {
    const { video, doc, play } = createHarness()
    const controller = bindNativeTransitionResume({ video, doc })

    video.emit(event)
    vi.advanceTimersByTime(599)
    video.paused = true
    video.emit('pause')

    expect(play).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(play).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(500)
    expect(play).toHaveBeenCalledTimes(2)

    controller.destroy()
  })

  it('resumes involuntary pause within 600ms of visibilitychange(hidden) and ignores visible changes', () => {
    const { video, doc, play } = createHarness()
    const controller = bindNativeTransitionResume({ video, doc })

    doc.emit('visibilitychange')
    video.paused = true
    video.emit('pause')
    expect(play).not.toHaveBeenCalled()

    video.paused = false
    video.emit('playing')

    doc.hidden = true
    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange')
    vi.advanceTimersByTime(200)
    video.paused = true
    video.emit('pause')
    expect(play).toHaveBeenCalledTimes(1)

    controller.destroy()
  })

  it('skips resume for markExplicitPause, steady-state pauses outside 600ms, and ended video', () => {
    const { video, doc, play } = createHarness()
    const controller = bindNativeTransitionResume({ video, doc })

    // Steady-state pause without a recent transition
    video.paused = true
    video.emit('pause')
    expect(play).not.toHaveBeenCalled()

    // Pause outside the 600ms transition window
    video.paused = false
    video.emit('playing')
    video.emit('webkitendfullscreen')
    vi.advanceTimersByTime(601)
    video.paused = true
    video.emit('pause')
    expect(play).not.toHaveBeenCalled()

    // Explicit pause even when followed by a transition
    video.paused = false
    video.emit('playing')
    controller.markExplicitPause()
    video.emit('webkitpresentationmodechanged')
    video.paused = true
    video.emit('pause')
    expect(play).not.toHaveBeenCalled()

    // Ended video during transition
    video.paused = false
    video.emit('playing')
    video.emit('webkitendfullscreen')
    video.ended = true
    video.paused = true
    video.emit('pause')
    expect(play).not.toHaveBeenCalled()

    controller.destroy()
  })

  it('cancels the pending retry timer on playing, markExplicitPause, and destroy, and detaches listeners', () => {
    for (const stop of ['playing', 'explicit', 'destroy'] as const) {
      const { video, doc, play, videoEmitter, docEmitter } = createHarness()
      const controller = bindNativeTransitionResume({ video, doc })

      video.emit('webkitendfullscreen')
      video.paused = true
      video.emit('pause')
      expect(play).toHaveBeenCalledTimes(1)

      if (stop === 'playing') {
        video.paused = false
        video.emit('playing')
      } else if (stop === 'explicit') {
        controller.markExplicitPause()
      } else {
        controller.destroy()
        expect(videoEmitter.listenerCount()).toBe(0)
        expect(docEmitter.listenerCount()).toBe(0)
      }

      vi.advanceTimersByTime(500)
      expect(play).toHaveBeenCalledTimes(1)

      if (stop === 'destroy') {
        video.paused = false
        video.emit('playing')
        video.emit('webkitendfullscreen')
        video.paused = true
        video.emit('pause')
        expect(play).toHaveBeenCalledTimes(1)
      } else {
        controller.destroy()
        expect(videoEmitter.listenerCount()).toBe(0)
        expect(docEmitter.listenerCount()).toBe(0)
      }
    }
  })

  it('does not auto-start a video that was already paused at bind time', () => {
    const { video, doc, play } = createHarness(true)
    const controller = bindNativeTransitionResume({ video, doc })

    video.emit('webkitendfullscreen')
    video.emit('pause')
    vi.advanceTimersByTime(200)
    expect(play).not.toHaveBeenCalled()

    controller.destroy()
  })

  it('skips the retry timer when playback unpauses or ends before retryMs elapses', () => {
    const first = createHarness()
    const firstController = bindNativeTransitionResume({ video: first.video, doc: first.doc })
    first.video.emit('webkitendfullscreen')
    first.video.paused = true
    first.video.emit('pause')
    expect(first.play).toHaveBeenCalledTimes(1)
    first.video.paused = false
    vi.advanceTimersByTime(200)
    expect(first.play).toHaveBeenCalledTimes(1)
    firstController.destroy()

    const second = createHarness()
    const secondController = bindNativeTransitionResume({ video: second.video, doc: second.doc })
    second.video.emit('webkitendfullscreen')
    second.video.paused = true
    second.video.emit('pause')
    expect(second.play).toHaveBeenCalledTimes(1)
    second.video.ended = true
    vi.advanceTimersByTime(200)
    expect(second.play).toHaveBeenCalledTimes(1)
    secondController.destroy()
  })
})
