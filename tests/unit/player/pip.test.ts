import { describe, expect, it, vi } from 'vite-plus/test'

import { isPipSupported, isVideoInPip, subscribeVideoPip, toggleVideoPip } from '../../../src/player/pip'

const makeTarget = () => {
  const listeners = new Map<string, Set<EventListener>>()
  return {
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

describe('player picture-in-picture helpers', () => {
  it('supports W3C Picture-in-Picture when enabled', async () => {
    const requestPictureInPicture = vi.fn().mockResolvedValue({})
    const exitPictureInPicture = vi.fn().mockResolvedValue(undefined)
    const doc = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null as Element | null,
      exitPictureInPicture,
    }
    const video = {
      disablePictureInPicture: false,
      requestPictureInPicture,
    } as unknown as HTMLVideoElement

    expect(isPipSupported(video, doc as unknown as Document)).toBe(true)
    expect(isVideoInPip(video, doc as unknown as Document)).toBe(false)

    await toggleVideoPip(video, doc as unknown as Document)
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1)

    doc.pictureInPictureElement = video
    expect(isVideoInPip(video, doc as unknown as Document)).toBe(true)

    await toggleVideoPip(video, doc as unknown as Document)
    expect(exitPictureInPicture).toHaveBeenCalledTimes(1)
  })

  it('supports synchronous WebKit presentation mode PiP on iOS Safari when W3C PiP is unavailable', async () => {
    let mode: 'inline' | 'fullscreen' | 'picture-in-picture' = 'inline'
    const setMode = vi.fn((next: 'inline' | 'fullscreen' | 'picture-in-picture') => {
      mode = next
    })
    const doc = {
      pictureInPictureEnabled: false,
      pictureInPictureElement: null,
    }
    const video = {
      disablePictureInPicture: false,
      get webkitPresentationMode () {
        return mode
      },
      webkitSupportsPresentationMode: vi.fn((candidate: string) => candidate === 'picture-in-picture'),
      webkitSetPresentationMode: setMode,
    } as unknown as HTMLVideoElement

    expect(isPipSupported(video, doc as unknown as Document)).toBe(true)

    const pending = toggleVideoPip(video, doc as unknown as Document)
    expect(setMode).toHaveBeenCalledWith('picture-in-picture')
    await pending

    expect(isVideoInPip(video, doc as unknown as Document)).toBe(true)

    await toggleVideoPip(video, doc as unknown as Document)
    expect(setMode).toHaveBeenLastCalledWith('inline')
    expect(isVideoInPip(video, doc as unknown as Document)).toBe(false)
  })

  it('respects disablePictureInPicture across W3C and WebKit APIs', async () => {
    const setMode = vi.fn()
    const doc = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
    }
    const video = {
      disablePictureInPicture: true,
      requestPictureInPicture: vi.fn(),
      webkitSupportsPresentationMode: () => true,
      webkitSetPresentationMode: setMode,
    } as unknown as HTMLVideoElement

    expect(isPipSupported(video, doc as unknown as Document)).toBe(false)
    await toggleVideoPip(video, doc as unknown as Document)
    expect(setMode).not.toHaveBeenCalled()
  })

  it('resolves cleanly if webkitSetPresentationMode throws synchronously', async () => {
    const doc = {
      pictureInPictureEnabled: false,
      pictureInPictureElement: null,
    }
    const video = {
      disablePictureInPicture: false,
      webkitPresentationMode: 'inline',
      webkitSupportsPresentationMode: () => true,
      webkitSetPresentationMode: () => {
        throw new Error('InvalidStateError')
      },
    } as unknown as HTMLVideoElement

    await expect(toggleVideoPip(video, doc as unknown as Document)).resolves.toBeUndefined()
  })

  it('subscribes to standard and WebKit PiP events plus metadata readiness', () => {
    const target = makeTarget()
    const onChange = vi.fn()
    const unsubscribe = subscribeVideoPip(target as unknown as HTMLVideoElement, onChange)

    target.emit('enterpictureinpicture')
    target.emit('leavepictureinpicture')
    target.emit('webkitpresentationmodechanged')
    target.emit('loadedmetadata')
    expect(onChange).toHaveBeenCalledTimes(4)

    unsubscribe()
    target.emit('webkitpresentationmodechanged')
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('prefers synchronous WebKit presentation mode PiP over W3C requestPictureInPicture and falls back on error', async () => {
    const requestPictureInPicture = vi.fn().mockResolvedValue({})
    let mode: 'inline' | 'fullscreen' | 'picture-in-picture' = 'inline'
    const setMode = vi.fn((next: 'inline' | 'fullscreen' | 'picture-in-picture') => {
      mode = next
    })
    const doc = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
    }
    const video = {
      disablePictureInPicture: false,
      get webkitPresentationMode () {
        return mode
      },
      webkitSupportsPresentationMode: (candidate: string) => candidate === 'picture-in-picture',
      webkitSetPresentationMode: setMode,
      requestPictureInPicture,
    } as unknown as HTMLVideoElement

    await toggleVideoPip(video, doc as unknown as Document)
    expect(setMode).toHaveBeenCalledWith('picture-in-picture')
    expect(requestPictureInPicture).not.toHaveBeenCalled()

    mode = 'inline'
    setMode.mockImplementationOnce(() => {
      throw new Error('InvalidStateError')
    })

    await toggleVideoPip(video, doc as unknown as Document)
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1)
  })
})
