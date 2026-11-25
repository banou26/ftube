import type { MockInstance } from 'vite-plus/test'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { SabrSource } from '../../../src/frame/innertube'
import type { FrameRequest, FrameResponse, PlaybackSession, SegmentRequest } from '../../../src/frame/protocol'
import { parseEndScreen } from '../../../src/frame/end-screen'
import { anonymousCueTracks, catalogInnertube, getSabrSource, prefetchInitialPlayerResponse, youtubeFetch } from '../../../src/frame/innertube'
import { STREAM_REFUSED } from '../../../src/frame/protocol'
import { createSabrSession } from '../../../src/frame/sabr'
import endScreens from '../fixtures/end-screens.json'

vi.mock('../../../src/frame/innertube', () => ({
  GVS_ORIGIN_KEY: 'gvs-origin',
  anonymousCueTracks: vi.fn(),
  catalogInnertube: vi.fn(),
  getSabrSource: vi.fn(),
  hasSessionCookie: () => false,
  prefetchInitialPlayerResponse: vi.fn(),
  warmPlaybackResources: vi.fn(),
  youtubeFetch: vi.fn(),
}))
vi.mock('../../../src/frame/sabr', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/frame/sabr')>(),
  createSabrSession: vi.fn(),
}))

type Session = ReturnType<typeof createSabrSession>
type Fetch = (request: SegmentRequest, progress: unknown, signal: AbortSignal) => Promise<never>

const video = { key: '399:', mimeType: 'video/mp4' }
const audio = { key: '251:', mimeType: 'audio/webm' }

// a SABR session whose every segment request ends as `fetch` says
const sessionOf = (fetch: Fetch) => ({
  manifest: '<MPD/>',
  durationMs: 213_000,
  videoFormats: [video],
  audioFormats: [audio],
  videoFormat: video,
  audioFormat: audio,
  selectVideoFormat: () => {},
  selectAudioFormat: () => {},
  startLivePump: () => {},
  close: () => {},
  requestSegment: fetch,
}) as unknown as Session

const untilCancelled: Fetch = (_request, _progress, signal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))

const failing = (error: () => unknown): Fetch => async () => { throw error() }

const refreshError = () => Object.assign(new Error('youtube: SABR stream status 2 after 3 attempts'), { name: 'SabrSessionRefreshError' })

const segment = (requestId: string, sessionId: string): SegmentRequest => ({
  requestId,
  sessionId,
  generation: 0,
  track: 'video',
  kind: 'media',
  startTimeMs: 0,
  snapshot: { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 },
})

let call: <Method extends FrameRequest['method']>(method: Method, ...args: Extract<FrameRequest, { method: Method }>['args']) => Promise<FrameResponse>
let disconnect: () => void
const portClosed = vi.fn()

// the frame as the app realm reaches it: its `connect`, handed a port
beforeAll(async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  const { connect } = await import('../../../src/frame/index')
  let deliver: (event: { data: FrameRequest }) => void = () => {}
  const answers = new Map<number, (response: FrameResponse) => void>()
  const port = {
    addEventListener: (_type: string, listener: typeof deliver) => { deliver = listener },
    start: () => {},
    close: portClosed,
    postMessage: (message: FrameResponse | { progress: string }) => {
      if ('id' in message && !('progress' in message)) answers.get(message.id)?.(message)
    },
  }
  disconnect = connect(port as unknown as MessagePort)
  let id = 0
  call = (method, ...args) => new Promise((resolve) => {
    answers.set(++id, resolve)
    deliver({ data: { id, method, args } as FrameRequest })
  })
})

const open = async (fetch: Fetch) => {
  vi.mocked(createSabrSession).mockImplementation(() => sessionOf(fetch))
  const response = await call('openPlayback', 'video-1')
  return (response.result as PlaybackSession).id
}

describe("the frame's log of failed calls", () => {
  let errors: MockInstance<typeof console.error>

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getSabrSource).mockResolvedValue({ isLive: false, captions: [], storyboards: [] } as unknown as SabrSource)
  })

  afterEach(() => {
    errors.mockRestore()
  })

  it('leaves out a segment request the app cancelled, as when a viewer leaves a playing video', async () => {
    const id = await open(untilCancelled)
    const request = call('requestSegment', segment('a', id))
    await call('cancelSegment', id, 'a')
    expect(await request).toMatchObject({ error: 'youtube: segment request cancelled' })
    const closed = call('requestSegment', segment('b', id))
    await call('closePlayback', id)
    expect(await closed).toMatchObject({ error: 'youtube: segment request cancelled' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('leaves out an abort', async () => {
    const id = await open(failing(() => new DOMException('The operation was aborted', 'AbortError')))
    expect(await call('requestSegment', segment('a', id))).toMatchObject({ error: 'The operation was aborted' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('logs every other failure', async () => {
    const id = await open(failing(() => new Error('youtube: SABR answered 500')))
    await call('requestSegment', segment('a', id))
    await call('requestSegment', segment('b', id))
    await call('captionCues', id, 'en')
    expect(errors.mock.calls.map(([line, error]) => `${line} ${(error as Error).message}`)).toEqual([
      'yt-client: requestSegment failed youtube: SABR answered 500',
      'yt-client: requestSegment failed youtube: SABR answered 500',
      'yt-client: captionCues failed youtube: unknown caption track en',
    ])
  })

  it('logs a refused stream once, though each later segment request fails with it', async () => {
    const id = await open(failing(refreshError))
    const failures = await Promise.all(['a', 'b', 'c'].map((requestId) => call('requestSegment', segment(requestId, id))))
    expect(failures.every((failure) => failure.error?.startsWith(STREAM_REFUSED))).toBe(true)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0]?.[1]).toMatchObject({ message: expect.stringMatching(STREAM_REFUSED) })
  })
})

it('opens a hover preview on a watch page read with its card\'s params, and a click\'s with none', async () => {
  vi.mocked(getSabrSource).mockReset().mockResolvedValue({ isLive: false, captions: [], storyboards: [] } as unknown as SabrSource)
  vi.mocked(createSabrSession).mockImplementation(() => sessionOf(untilCancelled))
  await call('openPlayback', 'video-1', 360, 'params-1')
  await call('openPlayback', 'video-2')
  expect(vi.mocked(getSabrSource).mock.calls).toEqual([['video-1', 'params-1'], ['video-2', undefined]])
})

it('keeps a live manifest\'s DVR window across a session refresh, before the new session names one', async () => {
  vi.mocked(getSabrSource).mockReset().mockResolvedValue({ isLive: true, captions: [], storyboards: [] } as unknown as SabrSource)
  const delivered = (from: number) => Array.from({ length: 4 }, (_, index) => ({ sequenceNumber: from + index, startMs: (from + index) * 5_000, durationMs: 5_000 }))
  const videoFormat = { ...video, mimeType: 'video/mp4; codecs="avc1.4d401f"', bitrate: 1, width: 640, height: 360 }
  const audioFormat = { ...audio, mimeType: 'audio/webm; codecs="opus"', bitrate: 1 }
  const liveSession = (fetch: Fetch, segments: ReturnType<typeof delivered>, liveWindowStartMs?: number) => ({
    ...sessionOf(fetch),
    videoFormats: [videoFormat],
    audioFormats: [audioFormat],
    videoFormat,
    audioFormat,
    targetDurationMs: 5_000,
    liveSegments: segments,
    liveEndMs: segments.at(-1)!.startMs + 5_000,
    liveWindowStartMs,
  }) as unknown as Session
  const first = liveSession(async (request) => {
    if (request.requestId.endsWith(':live-open')) return {} as never
    throw refreshError()
  }, delivered(1_000), 100 * 5_000)
  // the session a refresh opens has delivered its first segments but been told nothing of the window yet
  const next = liveSession(async () => ({}) as never, delivered(1_010))
  vi.mocked(createSabrSession).mockReset().mockReturnValueOnce(first).mockReturnValueOnce(next)
  const id = ((await call('openPlayback', 'live-1')).result as PlaybackSession).id
  const manifest = async () => (await call('liveManifest', id)).result as string
  const startNumber = (text: string) => text.match(/startNumber="(\d+)"/)?.[1]
  expect(startNumber(await manifest())).toBe('100')
  await call('requestSegment', { ...segment('a', id), sequenceNumber: 1_003 })
  expect(vi.mocked(createSabrSession)).toHaveBeenCalledTimes(2)
  const refreshed = await manifest()
  // the refreshed session's own newest segment, on the window the first session named
  expect(refreshed).toContain(`<S t="${1_013 * 5_000}" d="5000"/>`)
  expect(startNumber(refreshed)).toBe('100')
})

it('answers the end screen of the plain page an intent prefetch read, which a card\'s playback leaves out', async () => {
  vi.mocked(prefetchInitialPlayerResponse).mockReset().mockResolvedValue(endScreens.g6Die8gVFn0)
  const response = await call('endScreen', 'video-1')
  expect(response.result).toEqual(parseEndScreen(endScreens.g6Die8gVFn0))
  expect(response.result).toHaveLength(3)
  expect(vi.mocked(prefetchInitialPlayerResponse).mock.calls).toEqual([['video-1']])
})

it('reads a card\'s playback again with the params its open read played with, and plain after params that did not play', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(createSabrSession).mockImplementation(() => sessionOf(failing(refreshError)))
  for (const played of ['params-1', undefined]) {
    vi.mocked(getSabrSource).mockReset().mockResolvedValue({ isLive: false, captions: [], storyboards: [], playerParams: played } as unknown as SabrSource)
    const session = (await call('openPlayback', 'video-1', 360, 'params-1')).result as PlaybackSession
    expect(session.playerParams).toBe(played)
    await call('requestSegment', segment('a', session.id))
    expect(vi.mocked(getSabrSource).mock.calls).toEqual([['video-1', 'params-1'], ['video-1', played]])
  }
  errors.mockRestore()
})

it('ends a connection with its port and every playback open in the engine', async () => {
  vi.mocked(getSabrSource).mockReset().mockResolvedValue({ isLive: false, captions: [], storyboards: [] } as unknown as SabrSource)
  const closed = vi.fn()
  vi.mocked(createSabrSession).mockImplementation(() => ({ ...sessionOf(untilCancelled), close: closed }))
  const session = (await call('openPlayback', 'video-1')).result as PlaybackSession
  const request = call('requestSegment', segment('a', session.id))
  disconnect()
  expect(portClosed).toHaveBeenCalledTimes(1)
  expect(closed).toHaveBeenCalledTimes(1)
  expect(await request).toMatchObject({ error: 'youtube: segment request cancelled' })
  expect(await call('requestSegment', segment('b', session.id))).toHaveProperty('error')
})

describe('an Auto-translate of a caption track', () => {
  let errors: MockInstance<typeof console.error>
  let fetchMock: MockInstance<typeof globalThis.fetch>
  let mint: ReturnType<typeof vi.fn<() => Promise<string>>>

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock = vi.spyOn(globalThis, 'fetch')
    vi.mocked(youtubeFetch).mockReset()
    vi.mocked(catalogInnertube).mockReset().mockRejectedValue(new Error('signed-in catalogInnertube must not be used for ANDROID_VR captions'))
    vi.mocked(anonymousCueTracks).mockReset().mockResolvedValue([
      {
        id: '.en',
        languageCode: 'en',
        label: 'English',
        auto: false,
        translatable: true,
        url: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&signature=vr',
      },
    ])
    mint = vi.fn(async () => 'TOKEN')
    vi.mocked(getSabrSource).mockResolvedValue({
      isLive: false,
      storyboards: [],
      captions: [
        { id: '.en', languageCode: 'en', label: 'English', auto: false, translatable: true, url: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&exp=xpe&signature=web' },
        { id: '.raw', languageCode: 'en', label: 'Raw', auto: false, translatable: false, url: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&signature=raw' },
      ],
      translations: [{ languageCode: 'fr', label: 'French' }],
      endScreen: [],
      mint,
    } as unknown as SabrSource)
  })

  afterEach(() => {
    errors.mockRestore()
    fetchMock.mockRestore()
  })

  it('is offered with the tracks, in the languages the video lists', async () => {
    vi.mocked(createSabrSession).mockImplementation(() => sessionOf(untilCancelled))
    const session = (await call('openPlayback', 'video-1')).result as PlaybackSession
    expect(session.translationLanguages).toStrictEqual([{ languageCode: 'fr', label: 'French' }])
    expect(session.captionTracks[0]).toMatchObject({ id: '.en', translatable: true })
  })

  it('loads native and translated tracks via anonymousCueTracks without calling catalogInnertube', async () => {
    vi.mocked(youtubeFetch).mockResolvedValue(new Response(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: 'Bonjour' }] }],
    })))
    const id = await open(untilCancelled)
    const result = await call('captionCues', id, '.en', 'fr')
    expect(result.result).toContain('WEBVTT')
    expect(result.result).toContain('Bonjour')
    expect(vi.mocked(catalogInnertube)).not.toHaveBeenCalled()
    expect(vi.mocked(anonymousCueTracks)).toHaveBeenCalledWith('video-1')
    expect(vi.mocked(youtubeFetch)).toHaveBeenCalledTimes(1)
    const url = new URL(String(vi.mocked(youtubeFetch).mock.calls[0]![0]))
    expect(url.searchParams.get('signature')).toBe('vr')
    expect(url.searchParams.get('fmt')).toBe('json3')
    expect(url.searchParams.get('tlang')).toBe('fr')
    expect(mint).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back through youtubeFetch with a minted PO token when ANDROID_VR answers empty or rejects', async () => {
    vi.mocked(youtubeFetch)
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: 'Salut' }] }],
      })))
    const id = await open(untilCancelled)
    const translated = await call('captionCues', id, '.en', 'fr')
    expect(translated.result).toContain('Salut')
    expect(vi.mocked(youtubeFetch)).toHaveBeenCalledTimes(2)
    const fallbackUrl = new URL(String(vi.mocked(youtubeFetch).mock.calls[1]![0]))
    expect(fallbackUrl.searchParams.get('signature')).toBe('web')
    expect(fallbackUrl.searchParams.get('tlang')).toBe('fr')
    expect(fallbackUrl.searchParams.get('potc')).toBe('1')
    expect(fallbackUrl.searchParams.get('pot')).toBe('TOKEN')
    expect(fallbackUrl.searchParams.get('c')).toBe('WEB')
    expect(fetchMock).not.toHaveBeenCalled()

    vi.mocked(youtubeFetch).mockReset().mockResolvedValueOnce(new Response(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: 'Hello plain' }] }],
    })))
    const freshId = await open(untilCancelled)
    vi.mocked(anonymousCueTracks).mockRejectedValueOnce(new Error('ANDROID_VR unavailable'))
    const plain = await call('captionCues', freshId, '.en')
    expect(plain.result).toContain('Hello plain')
    const plainUrl = new URL(String(vi.mocked(youtubeFetch).mock.calls[0]![0]))
    expect(plainUrl.searchParams.get('signature')).toBe('web')
    expect(plainUrl.searchParams.get('potc')).toBe('1')
    expect(plainUrl.searchParams.get('pot')).toBe('TOKEN')
    expect(plainUrl.searchParams.get('c')).toBe('WEB')
    expect(plainUrl.searchParams.has('tlang')).toBe(false)
  })

  it('falls back for native tracks when ANDROID_VR timedtext returns an HTTP error', async () => {
    vi.mocked(youtubeFetch)
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1_500, segs: [{ utf8: 'Recovered' }] }],
      })))
    const id = await open(untilCancelled)
    const result = await call('captionCues', id, '.en')
    expect(result.result).toContain('Recovered')
    expect(vi.mocked(youtubeFetch)).toHaveBeenCalledTimes(2)
  })

  it('refuses a language the video does not offer or a non-translatable track', async () => {
    const id = await open(untilCancelled)
    expect(await call('captionCues', id, '.en', 'xx')).toMatchObject({ error: 'youtube: no Auto-translate into xx' })
    expect(await call('captionCues', id, '.raw', 'fr')).toMatchObject({ error: 'youtube: no Auto-translate into fr' })
    expect(vi.mocked(youtubeFetch)).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

it('forwards selectAudioFormat and stableVolume to the SABR session', async () => {
  vi.mocked(getSabrSource).mockReset().mockResolvedValue({ isLive: false, captions: [], storyboards: [] } as unknown as SabrSource)
  const selectAudioFormat = vi.fn()
  vi.mocked(createSabrSession).mockReset().mockImplementation(() => ({ ...sessionOf(untilCancelled), selectAudioFormat }))
  const session = (await call('openPlayback', 'video-1', 720, undefined, true)).result as PlaybackSession
  expect(vi.mocked(createSabrSession)).toHaveBeenCalledWith(expect.anything(), 720, undefined, true)
  await call('selectAudioFormat', session.id, '251:es')
  expect(selectAudioFormat).toHaveBeenCalledExactlyOnceWith('251:es')
})
