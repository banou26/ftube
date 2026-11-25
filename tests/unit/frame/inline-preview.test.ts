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
      create: async () => ({ session: { context, player: { decipher: async (url: string) => url } }, actions: { session: {} } }),
    },
    Player: {
      create: async () => ({ signature_timestamp: 20774, decipher: async (url: string) => url }),
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

it('uses /player over the media lane for hover previews once a player is warmed, and falls back to /watch if /player refuses', async () => {
  const { egressFetch } = await import('../../../src/frame/egress')
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const homePage = new Response('<script>ytcfg.set({"PLAYER_JS_URL":"/s/player/abc12345/base.js"});window.ytAtN({\'R\':\'{}\'});</script>')
  respond = (url) => url === 'https://www.youtube.com/' ? homePage : page(playerResponse)

  const { warmPlaybackResources } = await import('../../../src/frame/innertube')
  warmPlaybackResources()
  await vi.waitFor(() => expect(fetched.some(({ url }) => url === 'https://www.youtube.com/')).toBe(true))
  fetched.length = 0

  vi.mocked(egressFetch).mockImplementation(async (url) =>
    url.includes('/youtubei/v1/player') ? new Response(JSON.stringify(playerResponse), { status: 200 }) : new Response(null))

  const fast = await getSabrSource(VIDEO, PARAMS, true)
  expect(fast.streamingUrl).toMatch(/^https:\/\/rr1\.googlevideo\.com\/videoplayback\?id=1&/)
  expect(fetched.filter(({ url }) => url.includes('/watch'))).toEqual([])
  const playerCall = vi.mocked(egressFetch).mock.calls.find(([url]) => url.includes('/youtubei/v1/player'))
  expect(playerCall).toBeDefined()
  const sentBody = JSON.parse(new TextDecoder().decode(playerCall![1].body as ArrayBuffer)) as {
    videoId: string
    params: string
    playbackContext: { contentPlaybackContext: { signatureTimestamp: number } }
  }
  expect(sentBody.videoId).toBe(VIDEO)
  expect(sentBody.params).toBe(PARAMS)
  expect(sentBody.playbackContext.contentPlaybackContext.signatureTimestamp).toBe(20774)

  // If /player cannot serve the preview, it falls back cleanly to the watch page read.
  vi.mocked(egressFetch).mockImplementation(async (url) =>
    url.includes('/youtubei/v1/player')
      ? new Response(JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE' } }), { status: 200 })
      : new Response(null))
  const fallback = await getSabrSource(VIDEO, PARAMS, true)
  expect(fallback.streamingUrl).toMatch(/^https:\/\/rr1\.googlevideo\.com\/videoplayback\?id=1&/)
  expect(fetched.filter(({ url }) => url.includes('/watch'))).toEqual([{ url: card, visitor: 'visitor' }])
})

it('caches and evicts card-params prefetches separately from plain reads', async () => {
  const { getSabrSource, prefetchInitialPlayerResponse } = await import('../../../src/frame/innertube')
  await prefetchInitialPlayerResponse(VIDEO, PARAMS)
  await prefetchInitialPlayerResponse(VIDEO)
  await getSabrSource(VIDEO, PARAMS)
  await getSabrSource(VIDEO)
  await getSabrSource(VIDEO, PARAMS)
  expect(fetched).toEqual([
    { url: card, visitor: 'visitor' },
    { url: plain, visitor: null },
    { url: card, visitor: 'visitor' },
  ])
})

it('trims VOD hover preview manifests to the single selected video and audio format', async () => {
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  const vodResponse = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'vod-1', title: 'VOD', lengthSeconds: '120', isLive: false },
    streamingData: {
      serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=2',
      adaptiveFormats: [
        { itag: 396, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, width: 640, height: 360, qualityLabel: '360p', approxDurationMs: '120000', initRange: { start: '0', end: '700' }, indexRange: { start: '701', end: '1400' } },
        { itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1920, height: 1080, qualityLabel: '1080p', approxDurationMs: '120000', initRange: { start: '0', end: '700' }, indexRange: { start: '701', end: '1400' } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' } },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' } },
      ],
    },
    playerConfig: { mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: 'config' } } },
  }
  respond = () => page(vodResponse)
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const preview = await getSabrSource('vod-1', undefined, true, 360)
  expect(preview.manifest).toContain('id="396"')
  expect(preview.manifest).toContain('id="251"')
  expect(preview.manifest).not.toContain('id="399"')
  expect(preview.manifest).not.toContain('id="140"')
})

it('trims VOD hover preview manifests using ManagedMediaSource when MediaSource is absent', async () => {
  vi.stubGlobal('ManagedMediaSource', { isTypeSupported: (mime: string) => mime.includes('mp4') })
  const vodResponse = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'vod-ios', title: 'VOD', lengthSeconds: '120', isLive: false },
    streamingData: {
      serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=2',
      adaptiveFormats: [
        { itag: 396, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, width: 640, height: 360, qualityLabel: '360p', approxDurationMs: '120000', initRange: { start: '0', end: '700' }, indexRange: { start: '701', end: '1400' } },
        { itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1920, height: 1080, qualityLabel: '1080p', approxDurationMs: '120000', initRange: { start: '0', end: '700' }, indexRange: { start: '701', end: '1400' } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' } },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' } },
      ],
    },
    playerConfig: { mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: 'config' } } },
  }
  respond = () => page(vodResponse)
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const preview = await getSabrSource('vod-ios', undefined, true, 360)
  expect(preview.manifest).toContain('id="396"')
  expect(preview.manifest).toContain('id="140"')
  expect(preview.manifest).not.toContain('id="399"')
  expect(preview.manifest).not.toContain('id="251"')
})
