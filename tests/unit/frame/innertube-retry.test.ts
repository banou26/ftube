import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { PageRequest, PageResponse } from '../../../src/engine/agent-protocol'

import { streamed, watchPage } from './watch-page-fakes'

// youtubei.js as the frame sees it: a catalog build, then a player build that fetches /iframe_api and base.js
const youtube = vi.hoisted(() => ({
  builds: [] as ('catalog' | 'player')[],
  failCatalog: 0,
  failPlayer: 0,
  pagePlayers: [] as string[],
  failPagePlayer: 0,
  playerSession: undefined as { cache?: unknown, fetch?: unknown } | undefined,
  pagePlayerFrom: [] as { cache: unknown, fetch: unknown }[],
}))

vi.mock('youtubei.js/web', () => {
  // a player marks what it deciphered, so a test can read which one did
  const player = (id: string) => ({ player_id: id, signature_timestamp: 20774, decipher: async (url: string) => `${url}&player=${id}` })
  const context = {
    client: { visitorData: 'visitor', clientVersion: '2.20261008.00.00', clientName: 'WEB', osName: 'X11', osVersion: '', userAgent: 'agent' },
  }
  const info = {
    playability_status: { status: 'OK' },
    basic_info: { is_live: false, duration: 213 },
    streaming_data: { server_abr_streaming_url: 'https://rr1.googlevideo.com/videoplayback?id=1', adaptive_formats: [] },
    player_config: { media_common_config: { media_ustreamer_request_config: { video_playback_ustreamer_config: 'config' } } },
    toDash: async () => '<MPD/>',
  }
  return {
    Constants: { CLIENTS: { WEB: { VERSION: '' } }, CLIENT_NAME_IDS: { WEB: '1' } },
    Platform: { shim: {} },
    Player: {
      create: async (cache: unknown, fetch: unknown, _token: unknown, id: string) => {
        youtube.pagePlayers.push(id)
        youtube.pagePlayerFrom.push({ cache, fetch })
        if (youtube.failPagePlayer-- > 0) throw new Error('Failed to get player data: 404')
        return player(id)
      },
    },
    UniversalCache: class {},
    Utils: { generateRandomString: () => 'nonce' },
    YT: { VideoInfo: class { constructor() { return info } } },
    Innertube: {
      create: async (options: { retrieve_player: boolean, cache?: unknown, fetch?: typeof fetch }) => {
        const kind = options.retrieve_player ? 'player' : 'catalog'
        youtube.builds.push(kind)
        if (kind === 'catalog' && youtube.failCatalog-- > 0) throw new TypeError('Failed to fetch')
        if (kind === 'player' && youtube.failPlayer-- > 0) throw new TypeError('Failed to fetch')
        if (kind === 'player') youtube.playerSession = options
        // youtubei.js's Actions.execute: a JSON POST to /youtubei/v1<endpoint> through the client's fetch, answered as `data`
        const execute = async (endpoint: string, args: object) => {
          const response = await options.fetch!(`https://www.youtube.com/youtubei/v1${endpoint}?prettyPrint=false&alt=json`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-visitor-id': context.client.visitorData },
            body: JSON.stringify(args),
          })
          return { success: response.ok, status_code: response.status, data: await response.json() }
        }
        // the session keeps the cache and the fetch it was built with, as youtubei.js's Session and HTTPClient do
        return { session: { context, cache: options.cache, http: { fetch_function: options.fetch }, player: player('ef321720') }, actions: { execute } }
      },
    },
  }
})

vi.mock('../../../src/frame/botguard', () => ({
  mintPoToken: vi.fn(),
  recoverPoTokenSession: vi.fn(),
  warmPoTokenSession: vi.fn(),
  clearStoredTokens: vi.fn(),
  resetPoTokenSession: vi.fn(),
}))

vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))

const VIDEO = 'dQw4w9WgXcQ'

// lets the builds the module starts on load settle, failures included
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const loadFrame = async () => {
  const module = await import('../../../src/frame/innertube')
  await settle()
  return module
}

describe('the frame Innertube sessions', () => {
  beforeEach(() => {
    vi.resetModules()
    youtube.builds = []
    youtube.failCatalog = 0
    youtube.failPlayer = 0
    youtube.pagePlayers = []
    youtube.failPagePlayer = 0
    youtube.playerSession = undefined
    youtube.pagePlayerFrom = []
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    vi.stubGlobal('fetch', async () => new Response('<script>var ytInitialPlayerResponse = {"videoDetails":{}};</script>'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds the fallback player session again after one build failed, in the same frame', async () => {
    youtube.failPlayer = 1
    const { getSabrSource } = await loadFrame()
    expect(youtube.builds).toEqual(['catalog'])
    await expect(getSabrSource(VIDEO)).rejects.toThrow('Failed to fetch')
    const source = await getSabrSource(VIDEO)
    expect(source.streamingUrl).toContain('rr1.googlevideo.com/videoplayback')
    expect(youtube.builds).toEqual(['catalog', 'player', 'player'])
  })

  it('builds the catalog and the player sessions again after the catalog build failed', async () => {
    youtube.failCatalog = 1
    const { getSabrSource } = await loadFrame()
    expect(youtube.builds).toEqual(['catalog'])
    const source = await getSabrSource(VIDEO)
    expect(source.videoId).toBe(VIDEO)
    expect(youtube.builds).toEqual(['catalog', 'catalog', 'player'])
  })

  it("a playback's watch read keeps the page's challenge for the BotGuard session, with no second read", async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return streamed([watchPage()])
    })
    const { getSabrSource } = await loadFrame()
    const { takePageChallenge } = await import('../../../src/frame/watch-page')
    await getSabrSource(VIDEO)
    const taken = await Promise.race([takePageChallenge(), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 100))])
    expect(taken).toMatchObject({ config: { EVENT_ID: 'event-1' } })
    expect(fetched).toEqual([`https://www.youtube.com/watch?v=${VIDEO}`])
  })

  it('omits X-Goog-Visitor-Id on plain watch reads while keeping it on card reads and playback registrations, and sends no other report', async () => {
    const sent: { url: string, method: string, visitor: string | null }[] = []
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      sent.push({ url, method: init?.method ?? 'GET', visitor: new Headers(init?.headers).get('x-goog-visitor-id') })
      if (url.includes('/api/stats/')) return new Response(null, { status: 204 })
      return streamed([watchPage({
        playbackUrl: `https://s.youtube.com/api/stats/playback?docid=${VIDEO}&ei=event-1`,
      })])
    })
    const { getSabrSource } = await loadFrame()
    await getSabrSource(VIDEO)
    await settle()
    expect(sent).toEqual([
      { url: `https://www.youtube.com/watch?v=${VIDEO}`, method: 'GET', visitor: null },
      { url: expect.stringMatching(/^https:\/\/s\.youtube\.com\/api\/stats\/playback\?/), method: 'POST', visitor: 'visitor' },
    ])
    const registration = new URL(sent[1]!.url).searchParams
    expect(Object.fromEntries(registration)).toEqual({ docid: VIDEO, ei: 'event-1', ver: '2', cpn: 'nonce' })

    sent.length = 0
    const cardPage = JSON.stringify({
      playabilityStatus: { status: 'OK' },
      streamingData: { serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=1' },
      playbackTracking: { videostatsPlaybackUrl: { baseUrl: `https://s.youtube.com/api/stats/playback?docid=${VIDEO}&ei=event-2` } },
    })
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      sent.push({ url, method: init?.method ?? 'GET', visitor: new Headers(init?.headers).get('x-goog-visitor-id') })
      if (url.includes('/api/stats/')) return new Response(null, { status: 204 })
      return new Response(`<script>var ytInitialPlayerResponse = ${cardPage};</script>`)
    })
    await getSabrSource(VIDEO, 'card-params')
    await settle()
    expect(sent).toEqual([
      { url: `https://www.youtube.com/watch?v=${VIDEO}&pp=card-params`, method: 'GET', visitor: 'visitor' },
      { url: expect.stringMatching(/^https:\/\/s\.youtube\.com\/api\/stats\/playback\?/), method: 'POST', visitor: 'visitor' },
    ])
  })

  describe('the playback registration, signed in', () => {
    const PAGE_ID = '112233445566778899001'
    const ping = (event: string) => `https://s.youtube.com/api/stats/playback?docid=${VIDEO}&ei=${event}`
    let sent: { url: string, method: string, headers: Record<string, string> }[]

    // the FKN page as YouTube answered it on 2026-11-20: the watch page as the account's own channel whatever
    // X-Goog-PageId says, a /player read as the channel the header names
    const fknPage = async (url: string, { method = 'GET', headers = {} }: PageRequest): Promise<PageResponse> => {
      sent.push({ url, method, headers })
      const answer = (status: number, body: string) => ({ status, statusText: '', headers: [], body: new TextEncoder().encode(body).buffer as ArrayBuffer })
      if (url.includes('/api/stats/')) return answer(204, '')
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player')) {
        const event = headers['x-goog-pageid'] === PAGE_ID ? 'channel-event' : 'account-event'
        return answer(200, JSON.stringify({ playabilityStatus: { status: 'OK' }, playbackTracking: { videostatsPlaybackUrl: { baseUrl: ping(event) } } }))
      }
      return answer(200, watchPage({ playbackUrl: ping('account-event') }))
    }

    const signIn = async (channel?: string) => {
      sent = []
      if (channel) localStorage.setItem('yt-client:channel', channel)
      const { realm } = await import('../../../src/frame/realm')
      const { createSessionLane, createYoutubeFetch } = await import('../../../src/frame/lanes')
      const refuse = async () => { throw new Error('signed in, only the session lane may answer') }
      realm.cookie = 'SAPISID=sapisid'
      realm.fetch = createYoutubeFetch({
        signedIn: true,
        direct: undefined,
        catalog: refuse,
        session: createSessionLane(fknPage, () => {}, channel),
        media: refuse,
        report: () => {},
      })
    }

    const registration = () => vi.waitFor(() => {
      const found = sent.find(({ url }) => url.includes('/api/stats/playback'))
      if (!found) throw new Error('no registration yet')
      return found
    })

    it('registers a brand channel\'s playback from a player answer read as that channel, sent as it through the FKN page', async () => {
      await signIn(PAGE_ID)
      const { getSabrSource } = await loadFrame()
      await getSabrSource(VIDEO)
      const { url, method, headers } = await registration()
      expect(url).toMatch(/^https:\/\/www\.youtube\.com\/api\/stats\/playback\?/)
      expect(method).toBe('POST')
      expect(headers['x-goog-pageid']).toBe(PAGE_ID)
      expect(new URL(url).searchParams.get('ei')).toBe('channel-event')
      const read = sent.find(({ url }) => url.startsWith('https://www.youtube.com/youtubei/v1/player'))
      expect(read?.headers['x-goog-pageid']).toBe(PAGE_ID)
    })

    it('registers the account\'s own channel\'s playback from its watch page, with no player read', async () => {
      await signIn()
      const { getSabrSource } = await loadFrame()
      await getSabrSource(VIDEO)
      const { url, headers } = await registration()
      expect(url).toMatch(/^https:\/\/www\.youtube\.com\/api\/stats\/playback\?/)
      expect(headers['x-goog-pageid']).toBeUndefined()
      expect(new URL(url).searchParams.get('ei')).toBe('account-event')
      expect(sent.map(({ url }) => new URL(url).pathname)).not.toContain('/youtubei/v1/player')
    })
  })

  describe('deciphering the stream URL', () => {
    const decipheredBy = async (getSabrSource: (videoId: string) => Promise<{ streamingUrl: string }>) =>
      new URL((await getSabrSource(VIDEO)).streamingUrl).searchParams.get('player')

    const servePage = (playerId?: string) => vi.stubGlobal('fetch', async () => streamed([watchPage({
      playerJsUrl: playerId && `\\/s\\/player\\/${playerId}\\/player_ias.vflset\\/en_US\\/base.js`,
    })]))

    it("uses the watch page's player directly without building an unused /iframe_api session, built once with persistent cache and fetch", async () => {
      servePage('a5c2aafe')
      const { getSabrSource } = await loadFrame()
      expect(await decipheredBy(getSabrSource)).toBe('a5c2aafe')
      expect(await decipheredBy(getSabrSource)).toBe('a5c2aafe')
      expect(youtube.pagePlayers).toEqual(['a5c2aafe'])
      expect(youtube.builds).toEqual(['catalog'])
      const [from] = youtube.pagePlayerFrom
      expect(from?.fetch).toBeTypeOf('function')
      expect(from?.cache).toBeTypeOf('object')
    })

    it("falls back to the session's player when a watch page names no PLAYER_JS_URL", async () => {
      servePage(undefined)
      const { getSabrSource } = await loadFrame()
      expect(await decipheredBy(getSabrSource)).toBe('ef321720')
      expect(youtube.pagePlayers).toEqual([])
      expect(youtube.builds).toEqual(['catalog', 'player'])
    })

    it("uses the fallback session's player when the page's fails to build, and builds it again for the next playback", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      youtube.failPagePlayer = 1
      servePage('a5c2aafe')
      const { getSabrSource } = await loadFrame()
      expect(await decipheredBy(getSabrSource)).toBe('ef321720')
      expect(await decipheredBy(getSabrSource)).toBe('a5c2aafe')
      expect(youtube.pagePlayers).toEqual(['a5c2aafe', 'a5c2aafe'])
    })

    it('warms the page player and attestation challenge from youtube.com before the first watch read', async () => {
      const fetched: { url: string, visitor: string | null }[] = []
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        fetched.push({ url, visitor: new Headers(init?.headers).get('x-goog-visitor-id') })
        return streamed([watchPage({
          playerJsUrl: '\\/s\\/player\\/a5c2aafe\\/player_ias.vflset\\/en_US\\/base.js',
        })])
      })
      const { getSabrSource, warmPlaybackResources } = await loadFrame()
      const { takePageChallenge } = await import('../../../src/frame/watch-page')
      warmPlaybackResources()
      const taken = await takePageChallenge()
      expect(taken).toMatchObject({ config: { EVENT_ID: 'event-1' } })
      await settle()
      expect(youtube.pagePlayers).toEqual(['a5c2aafe'])
      expect(youtube.builds).toEqual(['catalog'])
      expect(fetched).toEqual([{ url: 'https://www.youtube.com/', visitor: 'visitor' }])
      // subsequent video with the same player id reuses the warmed player without rebuilding
      expect(await decipheredBy(getSabrSource)).toBe('a5c2aafe')
      expect(youtube.pagePlayers).toEqual(['a5c2aafe'])
      expect(fetched[1]).toEqual({ url: `https://www.youtube.com/watch?v=${VIDEO}`, visitor: null })
    })
  })

  it('keeps a built session for every later playback', async () => {
    const { getSabrSource } = await loadFrame()
    await getSabrSource(VIDEO)
    await getSabrSource(VIDEO)
    expect(youtube.builds).toEqual(['catalog', 'player'])
  })
})
