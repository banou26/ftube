import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const load = async (initial?: Record<string, unknown>) => {
  vi.resetModules()
  const storage = new Map<string, string>()
  if (initial) storage.set('yt-client:settings', JSON.stringify(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  })
  const [settings, session] = await Promise.all([
    import('../../../src/settings'),
    import('../../../src/player/session'),
  ])
  return { storage, ...settings, ...session }
}

describe('player session theater persistence and sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists theater mode changes made from the player into settings and localStorage', async () => {
    const { storage, getSettings, getPlayerSession, openPlayer, setTheater, closePlayer } = await load()
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Test video' })

    setTheater('theater')
    expect(getPlayerSession().theater).toBe('theater')
    expect(getSettings().theater).toBe('theater')
    expect(JSON.parse(storage.get('yt-client:settings') ?? '{}').theater).toBe('theater')

    setTheater('fullscreen')
    expect(getPlayerSession().theater).toBe('fullscreen')
    expect(getSettings().theater).toBe('fullscreen')
    expect(JSON.parse(storage.get('yt-client:settings') ?? '{}').theater).toBe('fullscreen')

    // Closing the active player resets session state without clobbering stored theater preference.
    closePlayer()
    expect(getPlayerSession().theater).toBe('default')
    expect(getSettings().theater).toBe('fullscreen')
  })

  it('syncs external theater setting changes into an open player session', async () => {
    const { updateSettings, getPlayerSession, openPlayer } = await load({ theater: 'default' })
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Test video' })
    expect(getPlayerSession().theater).toBe('default')

    updateSettings({ theater: 'fullscreen' })
    expect(getPlayerSession().theater).toBe('fullscreen')

    updateSettings({ theater: 'theater' })
    expect(getPlayerSession().theater).toBe('theater')
  })

  it('tracks player pause state and resets it when opening a different video or closing playback', async () => {
    const { getPlayerSession, openPlayer, setPlayerPaused, closePlayer } = await load()
    openPlayer({ videoId: 'live-1', title: 'Live stream' })
    expect(getPlayerSession().paused).toBe(false)

    setPlayerPaused(true)
    expect(getPlayerSession().paused).toBe(true)

    // Metadata updates for the same video keep the active pause state intact.
    openPlayer({ videoId: 'live-1', title: 'Updated live stream' })
    expect(getPlayerSession().paused).toBe(true)

    openPlayer({ videoId: 'live-2', title: 'Next video' })
    expect(getPlayerSession().paused).toBe(false)

    setPlayerPaused(true)
    closePlayer()
    expect(getPlayerSession().paused).toBe(false)
  })

  it('tracks kind, poster, and channelName for docked Shorts and resets them cleanly', async () => {
    const { getPlayerSession, openPlayer, closePlayer } = await load()
    openPlayer({
      videoId: 'short-01',
      startAt: 4.5,
      title: 'Vertical Short',
      poster: 'data:image/png;base64,short',
      channelName: 'Short Creator',
      kind: 'short',
    })

    expect(getPlayerSession()).toMatchObject({
      videoId: 'short-01',
      startAt: 4.5,
      title: 'Vertical Short',
      poster: 'data:image/png;base64,short',
      channelName: 'Short Creator',
      kind: 'short',
    })

    // Re-opening the same id via Watch (default kind 'video') clears short mode without losing identity.
    openPlayer({ videoId: 'short-01', title: 'Vertical Short' })
    expect(getPlayerSession().kind).toBe('video')

    closePlayer()
    expect(getPlayerSession()).toMatchObject({
      videoId: undefined,
      kind: 'video',
      shortsFeed: undefined,
      channelName: undefined,
      poster: undefined,
    })
  })

  it('carries, updates, and clears docked Shorts feed state without dropping items on Short transitions', async () => {
    const { getPlayerSession, openPlayer, updateShortsFeed, closePlayer } = await load()
    const feed = {
      items: [
        { id: 's1', title: 'One', poster: 'p1' },
        { id: 's2', title: 'Two', poster: 'p2' },
      ],
      cursor: 'cursor-1',
      seed: 's1',
      sequence: 'seq-a',
    }
    openPlayer({ videoId: 's1', title: 'One', kind: 'short', shortsFeed: feed })
    expect(getPlayerSession().shortsFeed).toEqual(feed)

    // Stepping to another Short without re-passing shortsFeed preserves the active feed order.
    openPlayer({ videoId: 's2', startAt: 0, title: 'Two', kind: 'short' })
    expect(getPlayerSession().shortsFeed).toEqual(feed)

    const nextFeed = {
      ...feed,
      items: [...feed.items, { id: 's3', title: 'Three', poster: 'p3' }],
      cursor: null,
    }
    updateShortsFeed(nextFeed)
    expect(getPlayerSession().shortsFeed).toEqual(nextFeed)

    // Opening a standard Watch video clears the Shorts feed.
    openPlayer({ videoId: 's2', title: 'Two' })
    expect(getPlayerSession().shortsFeed).toBeUndefined()

    openPlayer({ videoId: 's1', title: 'One', kind: 'short', shortsFeed: feed })
    closePlayer()
    expect(getPlayerSession().shortsFeed).toBeUndefined()
  })
})
