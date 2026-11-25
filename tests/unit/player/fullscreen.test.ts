import { requestFullscreen } from '@banou/ponyfill/fullscreen'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  getFullscreenElement,
  isPlayerFullscreen,
  isVideoFullscreen,
  subscribeFullscreen,
  togglePlayerFullscreen,
} from '../../../src/player/fullscreen'

type ListenerMap = Map<string, Set<EventListener>>

const makeTarget = () => {
  const listeners: ListenerMap = new Map()
  return {
    listeners,
    addEventListener (type: string, listener: EventListener) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    removeEventListener (type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
    emit (type: string) {
      for (const listener of listeners.get(type) ?? []) listener({ type } as Event)
    },
  }
}

describe('player fullscreen helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests fullscreen on container when element fullscreen is enabled', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    const doc = {
      fullscreenEnabled: true,
      fullscreenElement: null as Element | null,
      exitFullscreen: exit,
      querySelectorAll: () => [],
      ...makeTarget(),
    }
    const container = { ownerDocument: doc, requestFullscreen: request } as unknown as Element
    const video = { ownerDocument: doc, webkitEnterFullscreen: vi.fn() } as unknown as HTMLVideoElement

    await togglePlayerFullscreen(container, video, doc as unknown as Document)
    expect(request).toHaveBeenCalledTimes(1)
    expect((video as unknown as { webkitEnterFullscreen: ReturnType<typeof vi.fn> }).webkitEnterFullscreen).not.toHaveBeenCalled()

    doc.fullscreenElement = container
    await togglePlayerFullscreen(container, video, doc as unknown as Document)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('falls back synchronously to WebKit video fullscreen on iPhone Safari when element fullscreen is disabled', async () => {
    let mode: 'inline' | 'fullscreen' | 'picture-in-picture' = 'inline'
    const doc = {
      fullscreenEnabled: false,
      webkitFullscreenEnabled: false,
      fullscreenElement: null as Element | null,
      webkitFullscreenElement: null as Element | null,
      querySelectorAll: () => [video],
      ...makeTarget(),
    }
    const container = { ownerDocument: doc } as unknown as Element
    const setMode = vi.fn((next: 'inline' | 'fullscreen' | 'picture-in-picture') => {
      mode = next
    })
    const video = {
      ownerDocument: doc,
      get webkitPresentationMode () {
        return mode
      },
      webkitSupportsPresentationMode: vi.fn((candidate: string) => candidate === 'fullscreen' || candidate === 'inline'),
      webkitSetPresentationMode: setMode,
    } as unknown as HTMLVideoElement

    await expect(requestFullscreen(container)).rejects.toMatchObject({ name: 'NotSupportedError' })

    const pending = togglePlayerFullscreen(container, video, doc as unknown as Document)
    expect(setMode).toHaveBeenCalledWith('fullscreen')
    await pending

    expect(isVideoFullscreen(video)).toBe(true)
    expect(isPlayerFullscreen(video, doc as unknown as Document)).toBe(true)
    expect(getFullscreenElement(doc as unknown as Document)).toBeNull()

    await togglePlayerFullscreen(container, video, doc as unknown as Document)
    expect(setMode).toHaveBeenLastCalledWith('inline')
    expect(isVideoFullscreen(video)).toBe(false)
  })

  it('treats WebKit picture-in-picture mode as not fullscreen', () => {
    const video = {
      webkitPresentationMode: 'picture-in-picture',
      webkitDisplayingFullscreen: true,
    } as unknown as HTMLVideoElement

    expect(isVideoFullscreen(video)).toBe(false)
  })

  it('supports legacy webkitEnterFullscreen when presentation mode is absent', async () => {
    let displaying = false
    const doc = {
      fullscreenEnabled: false,
      fullscreenElement: null as Element | null,
      querySelectorAll: () => [video],
      ...makeTarget(),
    }
    const enter = vi.fn(() => {
      displaying = true
    })
    const exit = vi.fn(() => {
      displaying = false
    })
    const video = {
      ownerDocument: doc,
      get webkitDisplayingFullscreen () {
        return displaying
      },
      webkitEnterFullscreen: enter,
      webkitExitFullscreen: exit,
    } as unknown as HTMLVideoElement

    await togglePlayerFullscreen({} as Element, video, doc as unknown as Document)
    expect(enter).toHaveBeenCalledTimes(1)
    expect(isVideoFullscreen(video)).toBe(true)

    await togglePlayerFullscreen({} as Element, video, doc as unknown as Document)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(isVideoFullscreen(video)).toBe(false)
  })

  it('subscribes and unsubscribes document and WebKit video fullscreen events', () => {
    const doc = makeTarget()
    const video = makeTarget()
    const onChange = vi.fn()

    const unsubscribe = subscribeFullscreen(
      onChange,
      video as unknown as HTMLVideoElement,
      doc as unknown as Document,
    )

    doc.emit('fullscreenchange')
    doc.emit('webkitfullscreenchange')
    video.emit('webkitbeginfullscreen')
    video.emit('webkitendfullscreen')
    video.emit('webkitpresentationmodechanged')
    expect(onChange).toHaveBeenCalledTimes(5)

    unsubscribe()
    doc.emit('fullscreenchange')
    video.emit('webkitbeginfullscreen')
    expect(onChange).toHaveBeenCalledTimes(5)
  })
})
