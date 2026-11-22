import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'

// the real youtubei.js parses the player response, so a renamed Format field shows here; only the sessions are faked
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
  }
})

vi.mock('../../../src/frame/botguard', () => ({
  mintPoToken: vi.fn(),
  recoverPoTokenSession: vi.fn(),
  warmPoTokenSession: vi.fn(),
  clearStoredTokens: vi.fn(),
  resetPoTokenSession: vi.fn(),
}))

vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn(async () => new Response(null)) }))

const VIDEO = 'jfKfPfyJRdk'

const livePlayerResponse = {
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

beforeEach(() => {
  vi.resetModules()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  vi.stubGlobal('fetch', async () => new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(livePlayerResponse)};</script>`))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// the SABR loop paces live segment requests off this, and without it falls back to 5 s for every stream
it("hands a live format's target duration to the SABR session", async () => {
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const source = await getSabrSource(VIDEO)
  expect(source.isLive).toBe(true)
  expect(source.playbackFormats.map((format) => [format.itag, format.targetDurationMs])).toEqual([[299, 2_000], [140, 2_000]])
})

it('keeps dubbed and DRC audio formats while dropping vb=1, and aligns playbackFormats with the DASH manifest', async () => {
  const vodResponse = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'vod-multi', title: 'Multi-track VOD', lengthSeconds: '120', isLive: false },
    streamingData: {
      serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=2',
      adaptiveFormats: [
        { itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1920, height: 1080, qualityLabel: '1080p', approxDurationMs: '120000', initRange: { start: '0', end: '700' }, indexRange: { start: '701', end: '1400' } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' }, xtags: 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZXM', audioTrack: { id: 'es.3', displayName: 'Spanish', audioIsDefault: false } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' }, isDrc: true, xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM', audioTrack: { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: true } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' }, xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw', audioTrack: { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: true } },
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 129_000, audioQuality: 'AUDIO_QUALITY_MEDIUM', approxDurationMs: '120000', initRange: { start: '0', end: '265' }, indexRange: { start: '266', end: '900' }, isVb: true, xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUwoHCgJ2YhIBMQ', audioTrack: { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: true } },
      ],
    },
    playerConfig: { mediaCommonConfig: { mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: 'config' } } },
  }
  vi.stubGlobal('fetch', async () => new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(vodResponse)};</script>`))
  const { getSabrSource } = await import('../../../src/frame/innertube')
  const source = await getSabrSource('vod-multi')
  const audio = source.playbackFormats.filter((format) => !format.width)
  expect(audio.map((format) => ({
    track: format.audioTrackId,
    name: format.audioTrackName,
    drc: Boolean(format.isDrc),
    orig: Boolean(format.isOriginal),
  }))).toEqual([
    { track: 'es.3', name: 'Spanish', drc: false, orig: false },
    { track: 'en-US.4', name: 'English (US) original', drc: true, orig: true },
    { track: 'en-US.4', name: 'English (US) original', drc: false, orig: true },
  ])
  expect(source.manifest).toContain('id="251-es.3"')
  expect(source.manifest).toContain('id="251-en-US.4-drc"')
  expect(source.manifest).toContain('id="251-en-US.4"')
  expect(source.manifest).not.toContain('-vb')
})
