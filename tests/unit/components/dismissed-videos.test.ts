import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const loadWithStorage = async (initial?: unknown) => {
  vi.resetModules()
  const store = new Map<string, string>()
  if (initial !== undefined) store.set('yt-client:dismissed', JSON.stringify(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  })
  const mod = await import('../../../src/components/dismissed-videos')
  return { mod, store }
}

describe('dismissed videos store', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks dismissed videos and channels and supports undo across storage reload', async () => {
    const { mod, store } = await loadWithStorage()
    expect(mod.getDismissed().videos.size).toBe(0)
    expect(mod.getDismissed().channels.size).toBe(0)

    mod.dismissVideo('v1')
    mod.dismissChannel('UC1')
    expect(mod.isDismissedVideo(mod.getDismissed(), { id: 'v1' })).toBe(true)
    expect(mod.isDismissedVideo(mod.getDismissed(), { id: 'v2', channel: { id: 'UC1' } })).toBe(true)
    expect(mod.isDismissedVideo(mod.getDismissed(), { id: 'v2', channel: { id: 'UC2' } })).toBe(false)

    const saved = JSON.parse(store.get('yt-client:dismissed')!)
    expect(saved).toEqual({ videos: ['v1'], channels: ['UC1'] })

    const { mod: reloaded } = await loadWithStorage(saved)
    expect(reloaded.isDismissedVideo(reloaded.getDismissed(), { id: 'v1' })).toBe(true)
    reloaded.undismissVideo('v1')
    reloaded.undismissChannel('UC1')
    expect(reloaded.isDismissedVideo(reloaded.getDismissed(), { id: 'v1' })).toBe(false)
    expect(reloaded.isDismissedVideo(reloaded.getDismissed(), { id: 'v2', channel: { id: 'UC1' } })).toBe(false)
  })
})
