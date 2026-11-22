import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'

// the real youtubei.js parses the player response; only the sessions are faked
vi.mock('youtubei.js/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('youtubei.js/web')>()
  const context = {
    client: { visitorData: 'visitor', clientVersion: '2.20261008.00.00', clientName: 'WEB', osName: 'X11', osVersion: '', userAgent: 'agent' },
  }
  return {
    ...actual,
    Innertube: {
      create: async () => ({ session: { context, player: { decipher: async (url: string) => url } }, actions: {} }),
    },
  }
})

vi.mock('../../../src/frame/botguard', () => ({
  mintPoToken: vi.fn(),
  recoverPoTokenSession: vi.fn(),
  warmPoTokenSession: vi.fn(),
}))

vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn(async () => new Response(null)) }))

const VIDEO = 'jfKfPfyJRdk'
const PARAMS = 'YAHIAQGiBhUBqHapMykbq0UjDjSaUZvbMaJKQibS='

const playerResponse = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: VIDEO, title: 'lofi hip hop radio', lengthSeconds: '0', isLive: true, isLiveContent: true },
  streamingData: {
    serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=1',
    adaptiveFormats: [
      { itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', bitrate: 6_000_000, width: 1920, height: 1080, qualityLabel: '1080p60', targetDurationSec: 2 },
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', targetDurationSec: 2 },
    ],
  },
  playerConfig: { mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: 'config' } } },
}

const page = (answer: object) => new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(answer)};</script>`)

let fetched: { url: string, visitor: string | null }[]
let respond: (url: string) => Response | Promise<Response>

beforeEach(() => {
  vi.resetModules()
  fetched = []
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  respond = () => page(playerResponse)
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    fetched.push({ url: String(url), visitor: new Headers(init?.headers).get('x-goog-visitor-id') })
    return respond(String(url))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('reads a preview\'s watch page with its card\'s params and visitor, leaving the plain page without a visitor to the click', async () => {
  const { getSabrSource, prefetchInitialPlayerResponse } = await import('../../../src/frame/innertube')
  await prefetchInitialPlayerResponse(VIDEO)
  await getSabrSource(VIDEO, PARAMS)
  await getSabrSource(VIDEO)
  expect(fetched).toEqual([
    { url: `https://www.youtube.com/watch?v=${VIDEO}`, visitor: null },
    { url: `https://www.youtube.com/watch?v=${VIDEO}&pp=${encodeURIComponent(PARAMS)}`, visitor: 'visitor' },
  ])
})

it('reads the page afresh when a session opened on it is refreshed, with params or without', async () => {
  const { getSabrSource, prefetchInitialPlayerResponse } = await import('../../../src/frame/innertube')
  await getSabrSource(VIDEO, PARAMS)
  await getSabrSource(VIDEO, PARAMS)
  await prefetchInitialPlayerResponse(VIDEO)
  await getSabrSource(VIDEO)
  await getSabrSource(VIDEO)
  const preview = { url: `https://www.youtube.com/watch?v=${VIDEO}&pp=${encodeURIComponent(PARAMS)}`, visitor: 'visitor' }
  const plain = { url: `https://www.youtube.com/watch?v=${VIDEO}`, visitor: null }
  expect(fetched).toEqual([preview, preview, plain, plain])
})

const card = `https://www.youtube.com/watch?v=${VIDEO}&pp=${encodeURIComponent(PARAMS)}`
const plain = `https://www.youtube.com/watch?v=${VIDEO}`

it('a card\'s link opens its video with the card\'s params, and a shared link or a reload reads the page plain', async () => {
  const { cardParamsIn, cardState } = await import('../../../src/player/card-params')
  const { getSabrSource } = await import('../../../src/frame/innertube')
  // the browser keeps a history entry's state as a structured clone, across a reload too
  const entry = structuredClone(cardState(PARAMS))
  expect((await getSabrSource(VIDEO, cardParamsIn(entry))).playerParams).toBe(PARAMS)
  expect((await getSabrSource(VIDEO, cardParamsIn(null))).playerParams).toBeUndefined()
  vi.resetModules()
  const reloaded = await import('../../../src/player/card-params')
  await getSabrSource(VIDEO, reloaded.cardParamsIn(entry))
  expect(fetched).toEqual([
    { url: card, visitor: 'visitor' },
    { url: plain, visitor: null },
    { url: plain, visitor: null },
  ])
})

it('reads the plain page without a visitor when the answer to a card\'s params does not play, and registers that playback only', async () => {
  const tracking = (docid: string) => ({
    videostatsPlaybackUrl: { baseUrl: `https://s.youtube.com/api/stats/playback?docid=${docid}` },
    videostatsWatchtimeUrl: { baseUrl: `https://s.youtube.com/api/stats/watchtime?docid=${docid}` },
  })
  respond = (url) => url.includes('&pp=')
    ? page({ playabilityStatus: { status: 'UNPLAYABLE' }, playbackTracking: tracking('card') })
    : page({ ...playerResponse, playbackTracking: tracking('plain') })
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const source = await getSabrSource(VIDEO, PARAMS)
  expect(source.streamingUrl).toMatch(/^https:\/\/rr1\.googlevideo\.com\/videoplayback\?id=1&/)
  expect(source.playerParams).toBeUndefined()
  expect(fetched.filter(({ url }) => !url.includes('/api/stats/'))).toEqual([
    { url: card, visitor: 'visitor' },
    { url: plain, visitor: null },
  ])
  const stats = fetched.filter(({ url }) => url.includes('/api/stats/'))
  expect(stats.map(({ url, visitor }) => ({ docid: new URL(url).searchParams.get('docid'), visitor }))).toEqual([
    { docid: 'plain', visitor: 'visitor' },
  ])
})
