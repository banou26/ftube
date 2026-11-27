import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const load = async (stored?: unknown) => {
  vi.resetModules()
  const storage = new Map<string, string>()
  if (stored !== undefined) {
    storage.set('yt-client:seen-subscriptions', typeof stored === 'string' ? stored : JSON.stringify(stored))
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
  const seen = await import('../../../src/subscriptions/seen')
  return { storage, ...seen }
}

describe('seen subscriptions store', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks, persists, expires after TTL, and clears seen channel markers', async () => {
    const t0 = 1_700_000_000_000
    const {
      storage,
      SEEN_TTL_MS,
      markSubscriptionSeen,
      isSubscriptionSeen,
      clearSeenSubscriptions,
    } = await load()

    expect(isSubscriptionSeen('UC02', t0)).toBe(false)
    markSubscriptionSeen('UC02', t0)
    expect(isSubscriptionSeen('UC02', t0 + 1_000)).toBe(true)
    expect(storage.has('yt-client:seen-subscriptions')).toBe(true)

    expect(isSubscriptionSeen('UC02', t0 + SEEN_TTL_MS - 1)).toBe(true)
    expect(isSubscriptionSeen('UC02', t0 + SEEN_TTL_MS)).toBe(false)

    clearSeenSubscriptions()
    expect(storage.has('yt-client:seen-subscriptions')).toBe(false)
    expect(isSubscriptionSeen('UC02', t0 + 1_000)).toBe(false)
  })

  it('reconciles channels once hasNewContent resets to false and extracts valid channel paths', async () => {
    const t0 = 1_700_000_000_000
    const {
      markSubscriptionSeen,
      reconcileSeenSubscriptions,
      isSubscriptionSeen,
      channelIdFromPath,
    } = await load('{bad json')

    expect(isSubscriptionSeen('UC02', t0)).toBe(false)
    markSubscriptionSeen('UC02', t0)
    markSubscriptionSeen('UC05', t0)

    reconcileSeenSubscriptions([
      { id: 'UC02', hasNewContent: false },
      { id: 'UC05', hasNewContent: true },
    ], t0 + 5_000)

    expect(isSubscriptionSeen('UC02', t0 + 5_000)).toBe(false)
    expect(isSubscriptionSeen('UC05', t0 + 5_000)).toBe(true)

    expect(channelIdFromPath('/channel/UC02')).toBe('UC02')
    expect(channelIdFromPath('/channel/UC02/videos')).toBe('UC02')
    expect(channelIdFromPath('/channel/@viewer')).toBeUndefined()
    expect(channelIdFromPath('/@handle')).toBeUndefined()
  })
})
