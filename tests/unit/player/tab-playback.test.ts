import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const createStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
  }
}

describe('tab-scoped playback overrides', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createStorage())
    vi.stubGlobal('sessionStorage', createStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores player quality and speed overrides in sessionStorage without mutating persistent settings', async () => {
    const settingsMod = await import('../../../src/settings')
    const tabMod = await import('../../../src/player/tab-playback')

    expect(tabMod.getEffectiveQuality()).toBe('auto')
    expect(tabMod.getEffectivePlaybackRate()).toBe(1)

    const seen: Array<{ quality?: 'auto' | number, playbackRate?: number }> = []
    const unsubscribe = tabMod.subscribeTabPlayback((next) => seen.push(next))

    tabMod.updateTabPlayback({ quality: 720, playbackRate: 1.5 })

    expect(tabMod.getEffectiveQuality()).toBe(720)
    expect(tabMod.getEffectivePlaybackRate()).toBe(1.5)
    expect(JSON.parse(sessionStorage.getItem('yt-client:tab-playback') ?? '{}')).toEqual({
      quality: 720,
      playbackRate: 1.5,
    })
    expect(settingsMod.getSettings().quality).toBe('auto')
    expect(settingsMod.getSettings().playbackRate).toBe(1)
    expect(localStorage.getItem('yt-client:settings')).toBeNull()
    expect(seen).toEqual([{ quality: 720, playbackRate: 1.5 }])
    unsubscribe()

    vi.resetModules()
    const reloadedTab = await import('../../../src/player/tab-playback')
    expect(reloadedTab.getEffectiveQuality()).toBe(720)
    expect(reloadedTab.getEffectivePlaybackRate()).toBe(1.5)
  })

  it('clears matching tab overrides when explicit persistent Settings update quality or speed', async () => {
    const settingsMod = await import('../../../src/settings')
    const tabMod = await import('../../../src/player/tab-playback')

    tabMod.updateTabPlayback({ quality: 720, playbackRate: 1.5 })
    settingsMod.updateSettings({ quality: 480 })
    expect(tabMod.getTabPlayback()).toEqual({ playbackRate: 1.5 })
    expect(tabMod.getEffectiveQuality()).toBe(480)
    expect(tabMod.getEffectivePlaybackRate()).toBe(1.5)

    settingsMod.updateSettings({ playbackRate: 1.25 })
    expect(tabMod.getTabPlayback()).toEqual({})
    expect(sessionStorage.getItem('yt-client:tab-playback')).toBeNull()
    expect(tabMod.getEffectivePlaybackRate()).toBe(1.25)
  })
})
