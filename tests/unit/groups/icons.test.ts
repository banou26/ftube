import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const load = async (stored?: unknown) => {
  vi.resetModules()
  const storage = new Map<string, string>()
  if (stored !== undefined) {
    storage.set('yt-client:group-icons', typeof stored === 'string' ? stored : JSON.stringify(stored))
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  })
  const icons = await import('../../../src/groups/icons')
  return { storage, ...icons }
}

describe('group icon palette store', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with default icons and falls back cleanly on corrupt or empty storage', async () => {
    const clean = await load()
    expect(clean.getGroupIcons()).toEqual(clean.DEFAULT_GROUP_ICONS)

    const corrupt = await load('{not-json')
    expect(corrupt.getGroupIcons()).toEqual(corrupt.DEFAULT_GROUP_ICONS)

    const empty = await load([])
    expect(empty.getGroupIcons()).toEqual(empty.DEFAULT_GROUP_ICONS)
  })

  it('adds, dedupes, removes, and persists custom group icons', async () => {
    const { storage, getGroupIcons, addGroupIcon, removeGroupIcon, GROUP_ICONS_KEY } = await load()

    addGroupIcon('🚀')
    expect(getGroupIcons()[0]).toBe('🚀')
    addGroupIcon('🚀')
    expect(getGroupIcons().filter(icon => icon === '🚀')).toHaveLength(1)

    removeGroupIcon('⭐')
    expect(getGroupIcons()).not.toContain('⭐')

    const persisted = JSON.parse(storage.get(GROUP_ICONS_KEY)!) as string[]
    expect(persisted[0]).toBe('🚀')
    expect(persisted).not.toContain('⭐')
  })

  it('never removes the last remaining icon', async () => {
    const { getGroupIcons, removeGroupIcon, resetGroupIcons } = await load(['🎯'])
    expect(getGroupIcons()).toEqual(['🎯'])
    expect(removeGroupIcon('🎯')).toEqual(['🎯'])
    expect(getGroupIcons()).toEqual(['🎯'])

    const restored = resetGroupIcons()
    expect(restored).toEqual(getGroupIcons())
    expect(restored.length).toBeGreaterThan(1)
  })
})
