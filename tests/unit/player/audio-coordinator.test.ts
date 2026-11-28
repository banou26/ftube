import type { AudioMediaLike } from '../../../src/player/audio-coordinator'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createAudioCoordinator, isMediaAudible } from '../../../src/player/audio-coordinator'

type MockVideo = AudioMediaLike & {
  paused: boolean
  ended: boolean
  muted: boolean
  volume: number
  playCalls: number
  pauseCalls: number
}

const makeVideo = (overrides?: Partial<Pick<MockVideo, 'paused' | 'ended' | 'muted' | 'volume'>>): MockVideo => {
  const state: MockVideo = {
    paused: overrides?.paused ?? false,
    ended: overrides?.ended ?? false,
    muted: overrides?.muted ?? false,
    volume: overrides?.volume ?? 0.8,
    playCalls: 0,
    pauseCalls: 0,
    play: () => {
      state.playCalls += 1
      state.paused = false
    },
    pause: () => {
      state.pauseCalls += 1
      state.paused = true
    },
  }
  return state
}

afterEach(() => {
  vi.useRealTimers()
})

describe('isMediaAudible', () => {
  it('requires unpaused, unended, unmuted media with nonzero volume', () => {
    expect(isMediaAudible({ paused: false, ended: false, muted: false, volume: 0.5 })).toBe(true)
    expect(isMediaAudible({ paused: true, ended: false, muted: false, volume: 0.5 })).toBe(false)
    expect(isMediaAudible({ paused: false, ended: true, muted: false, volume: 0.5 })).toBe(false)
    expect(isMediaAudible({ paused: false, ended: false, muted: true, volume: 0.5 })).toBe(false)
    expect(isMediaAudible({ paused: false, ended: false, muted: false, volume: 0 })).toBe(false)
  })
})

describe('createAudioCoordinator', () => {
  it('pauses audible docked player on preview unmute and restores it on preview release', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dock = makeVideo()
    let previewMuted = false

    const unregister = coordinator.registerPrimaryPlayer({ id: 'v1', video: dock, docked: true })
    coordinator.claimPreviewAudio(1, () => {
      previewMuted = true
    })

    expect(dock.paused).toBe(true)
    expect(dock.pauseCalls).toBe(1)
    expect(previewMuted).toBe(false)

    coordinator.releasePreviewAudio(1)
    vi.runAllTimers()

    expect(dock.paused).toBe(false)
    expect(dock.playCalls).toBe(1)
    unregister()
  })

  it('never resumes a docked player that was already paused or muted before preview claimed audio', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()

    const pausedDock = makeVideo({ paused: true })
    const unregisterPaused = coordinator.registerPrimaryPlayer({ id: 'v1', video: pausedDock, docked: true })
    coordinator.claimPreviewAudio(1, () => {})
    expect(pausedDock.pauseCalls).toBe(0)
    coordinator.releasePreviewAudio(1)
    vi.runAllTimers()
    expect(pausedDock.paused).toBe(true)
    expect(pausedDock.playCalls).toBe(0)
    coordinator.setPrimaryDocked(pausedDock, false)
    expect(pausedDock.paused).toBe(true)
    expect(pausedDock.playCalls).toBe(0)
    unregisterPaused()

    const mutedDock = makeVideo({ muted: true })
    const unregisterMuted = coordinator.registerPrimaryPlayer({ id: 'v2', video: mutedDock, docked: true })
    coordinator.claimPreviewAudio(2, () => {})
    expect(mutedDock.pauseCalls).toBe(0)
    coordinator.releasePreviewAudio(2)
    vi.runAllTimers()
    expect(mutedDock.paused).toBe(false)
    expect(mutedDock.playCalls).toBe(0)
    expect(mutedDock.muted).toBe(true)
    unregisterMuted()
  })

  it('hands off seamlessly between preview cards and ignores stale card release', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dock = makeVideo()
    let preview1Muted = false
    let preview2Muted = false

    const unregister = coordinator.registerPrimaryPlayer({ id: 'v1', video: dock, docked: true })
    coordinator.claimPreviewAudio(1, () => {
      preview1Muted = true
    })
    expect(dock.paused).toBe(true)

    coordinator.claimPreviewAudio(2, () => {
      preview2Muted = true
    })
    expect(preview1Muted).toBe(true)
    expect(preview2Muted).toBe(false)
    expect(dock.paused).toBe(true)

    coordinator.releasePreviewAudio(1)
    vi.runAllTimers()
    expect(dock.paused).toBe(true)
    expect(dock.playCalls).toBe(0)

    coordinator.releasePreviewAudio(2)
    vi.runAllTimers()
    expect(dock.paused).toBe(false)
    expect(dock.playCalls).toBe(1)
    unregister()
  })

  it('clears suspended dock when closing miniplayer so leaving preview does not resume audio', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dock = makeVideo()

    const unregister = coordinator.registerPrimaryPlayer({ id: 'v1', video: dock, docked: true })
    coordinator.claimPreviewAudio(1, () => {})
    expect(dock.paused).toBe(true)

    unregister()
    coordinator.releasePreviewAudio(1)
    vi.runAllTimers()
    expect(dock.playCalls).toBe(0)
  })

  it('mutes active preview and restores suspended dock when returning to Watch', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dock = makeVideo()
    let previewMuted = false

    const unregister = coordinator.registerPrimaryPlayer({ id: 'v1', video: dock, docked: true })
    coordinator.claimPreviewAudio(1, () => {
      previewMuted = true
    })
    expect(dock.paused).toBe(true)

    coordinator.setPrimaryDocked(dock, false)
    expect(previewMuted).toBe(true)
    expect(dock.paused).toBe(false)
    expect(dock.playCalls).toBe(1)
    unregister()
  })

  it('cancels deferred restore when primary switches to a new video', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dockV1 = makeVideo()
    const watchV2 = makeVideo()

    const unregisterV1 = coordinator.registerPrimaryPlayer({ id: 'v1', video: dockV1, docked: true })
    coordinator.claimPreviewAudio(1, () => {})
    expect(dockV1.paused).toBe(true)

    // Preview unmounts on navigation and primary transitions from v1 to v2 before timer flushes.
    coordinator.releasePreviewAudio(1)
    unregisterV1()
    const unregisterV2 = coordinator.registerPrimaryPlayer({ id: 'v2', video: watchV2, docked: false })
    vi.runAllTimers()

    expect(dockV1.playCalls).toBe(0)
    expect(watchV2.playCalls).toBe(0)
    unregisterV2()
  })

  it('mutes active preview and forgets suspension if user resumes or mutes dock directly', () => {
    vi.useFakeTimers()
    const coordinator = createAudioCoordinator()
    const dock = makeVideo()
    let preview1Muted = false

    const unregister = coordinator.registerPrimaryPlayer({ id: 'v1', video: dock, docked: true })
    coordinator.claimPreviewAudio(1, () => {
      preview1Muted = true
    })
    expect(dock.paused).toBe(true)

    // User clicks Play on the docked miniplayer.
    dock.paused = false
    coordinator.notifyPrimaryAudible(dock)
    expect(preview1Muted).toBe(true)

    // Now pause dock explicitly and unmute preview 2, then user mutes dock while paused.
    dock.pause()
    coordinator.claimPreviewAudio(2, () => {})
    dock.paused = false
    dock.muted = true
    coordinator.notifyPrimaryAudible(dock)
    // Preview stays unmuted since dock is muted; suspension cleared so release does not unpause.
    dock.paused = true
    coordinator.releasePreviewAudio(2)
    vi.runAllTimers()
    expect(dock.playCalls).toBe(0)
    unregister()
  })
})
