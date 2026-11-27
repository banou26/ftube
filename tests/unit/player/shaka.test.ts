import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { FrameApi } from '../../../src/frame/protocol'
import { STREAM_REFUSED } from '../../../src/frame/protocol'
import { startShakaPlayback } from '../../../src/player/shaka'

// Shaka as startShakaPlayback reaches it: a player that loads anything and reports errors as events
const fake = vi.hoisted(() => {
  class ShakaError extends Error {
    static Severity = { RECOVERABLE: 1, CRITICAL: 2 }
    static Category = { NETWORK: 1 }
    static Code = { HTTP_ERROR: 1002, OPERATION_ABORTED: 7001 }
    data: unknown[]
    constructor(readonly severity: number, readonly category: number, readonly code: number, ...data: unknown[]) {
      super(`shaka error ${code}`)
      this.data = data
    }
  }
  const players: Player[] = []
  let scheme: ((...args: unknown[]) => unknown) | undefined
  class Player extends EventTarget {
    static isBrowserSupported = () => true
    destroyed = false
    requestFilter: ((type: number, request: { uris: string[], headers: Record<string, string> }, context?: { segment?: unknown }) => void) | undefined
    networking = {
      registerRequestFilter: (fn: (type: number, request: { uris: string[], headers: Record<string, string> }, context?: { segment?: unknown }) => void) => {
        this.requestFilter = fn
      },
      unregisterRequestFilter: () => { this.requestFilter = undefined },
    }
    abrEnabled = true
    configs: Record<string, unknown>[] = []
    variants: Record<string, unknown>[] = []
    audioTracks: Record<string, unknown>[] = []
    selectedVariantCalls: unknown[][] = []
    selectedAudioCalls: unknown[][] = []
    constructor() {
      super()
      players.push(this)
    }
    getNetworkingEngine = () => this.networking
    getStats = () => ({ estimatedBandwidth: 10_000_000 })
    configure = (config: Record<string, unknown>) => {
      this.configs.push(config)
      const abr = config.abr as { enabled?: boolean } | undefined
      if (typeof abr?.enabled === 'boolean') this.abrEnabled = abr.enabled
    }
    getConfiguration = () => ({ abr: { enabled: this.abrEnabled } })
    getVariantTracks = () => this.variants
    getAudioTracks = () => this.audioTracks
    selectVariantTrack = (...args: unknown[]) => { this.selectedVariantCalls.push(args) }
    selectAudioTrack = (...args: unknown[]) => { this.selectedAudioCalls.push(args) }
    attach = async () => {}
    load = async () => {}
    destroy = async () => { this.destroyed = true }
  }
  const shaka = {
    polyfill: { installAll: () => {} },
    Player,
    util: {
      Error: ShakaError,
      AbortableOperation: class {
        constructor(readonly promise: Promise<unknown>, readonly abort: () => Promise<void>) {}
      },
    },
    net: {
      NetworkingEngine: {
        registerScheme: (_name: string, fn: (...args: unknown[]) => unknown) => { scheme = fn },
        RequestType: { MANIFEST: 0, SEGMENT: 1 },
        PluginPriority: { PREFERRED: 3 },
      },
    },
  }
  return { shaka, players, ShakaError, getScheme: () => scheme }
})

vi.mock('shaka-player', () => ({ default: fake.shaka }))

const { RECOVERABLE, CRITICAL } = fake.ShakaError.Severity

const failure = (severity: number, cause: Error) => Object.assign(new Event('error'), {
  detail: new fake.ShakaError(severity, fake.ShakaError.Category.NETWORK, fake.ShakaError.Code.HTTP_ERROR, 'sabr://video', cause),
})

const PLAIN_END = [{ style: 'VIDEO', videoId: 'video-2' }]
const CARD_END = [{ style: 'VIDEO', videoId: 'video-3' }, { style: 'CHANNEL', channelId: 'channel-1' }]

const start = async (
  session: Record<string, unknown> = {},
  endScreen = async () => CARD_END,
  stableVolume?: boolean,
  options?: {
    autoPlay?: boolean
    bufferingGoal?: number
    play?: () => Promise<void>
    muted?: boolean
    signal?: AbortSignal
    onAutoplayMuted?: () => void
  },
) => {
  const api = {
    openPlayback: vi.fn(async () => ({
      id: 'playback:1', isLive: false, manifest: '<MPD/>', videoFormats: [], audioFormats: [], storyboards: [], captionTracks: [], translationLanguages: [], endScreen: [],
      ...session,
    })),
    closePlayback: vi.fn(async () => {}),
    selectVideoFormat: vi.fn(async () => {}),
    selectAudioFormat: vi.fn(async () => {}),
    endScreen: vi.fn(endScreen),
  }
  const video = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ height: 720 }),
    play: vi.fn(options?.play ?? (async () => {})),
    currentTime: 0,
    paused: false,
    muted: options?.muted ?? false,
    videoHeight: 720,
    buffered: { length: 1, start: () => 0, end: () => 10 },
  })
  const onError = vi.fn()
  const onEndScreen = vi.fn()
  const onAutoplayMuted = options?.onAutoplayMuted ?? vi.fn()
  const controller = await startShakaPlayback({
    api: api as unknown as FrameApi,
    video: video as unknown as HTMLVideoElement,
    videoId: 'video-1',
    playerParams: (session.playerParams as string | undefined) ?? 'params-1',
    stableVolume,
    startTime: 0,
    autoPlay: options?.autoPlay,
    bufferingGoal: options?.bufferingGoal,
    signal: options?.signal ?? new AbortController().signal,
    onError,
    onEndScreen,
    onAutoplayMuted,
  })
  return { api, video, onError, onEndScreen, onAutoplayMuted, controller, player: fake.players.at(-1)! }
}

describe('a Shaka player whose stream the frame refused', () => {
  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Shaka takes the refusal for one variant's failure and moves to the next, which the frame refuses at once too
  it('ends on the first recoverable refusal and reports it once, for the shorts player and the hover preview as well', async () => {
    const { api, onError, player } = await start()
    const refusal = new Error(`${STREAM_REFUSED} (SABR stream status 2 after 3 attempts)`)
    player.dispatchEvent(failure(RECOVERABLE, refusal))
    expect(onError).toHaveBeenCalledExactlyOnceWith(refusal)
    await vi.waitFor(() => expect(api.closePlayback).toHaveBeenCalledWith('playback:1'))
    expect(player.destroyed).toBe(true)
    player.dispatchEvent(failure(RECOVERABLE, refusal))
    expect(onError).toHaveBeenCalledOnce()
  })

  it('leaves any other recoverable error to Shaka\'s own retries, and reports a critical one without ending', async () => {
    const { api, onError, player } = await start()
    player.dispatchEvent(failure(RECOVERABLE, new Error('youtube: SABR stream status 2 after 3 attempts')))
    expect(onError).not.toHaveBeenCalled()
    const critical = new Error('youtube: segment returned 500')
    player.dispatchEvent(failure(CRITICAL, critical))
    expect(onError).toHaveBeenCalledExactlyOnceWith(critical)
    expect(player.destroyed).toBe(false)
    expect(api.closePlayback).not.toHaveBeenCalled()
  })
})

describe('the end screen a Shaka player shows', () => {
  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // the answer to a card's params leaves the end screen out
  it('comes from the plain watch page for a page read with a card\'s params', async () => {
    const { api, onEndScreen } = await start({ playerParams: 'params-1' })
    await vi.waitFor(() => expect(onEndScreen).toHaveBeenCalledExactlyOnceWith(CARD_END))
    expect(api.endScreen).toHaveBeenCalledExactlyOnceWith('video-1')
  })

  // as after params whose answer did not play, which the frame read again as the plain page
  it('is the session\'s own for a plain read, with nothing more asked', async () => {
    const { api, onEndScreen } = await start({ endScreen: PLAIN_END })
    expect(onEndScreen).toHaveBeenCalledExactlyOnceWith(PLAIN_END)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.endScreen).not.toHaveBeenCalled()
  })

  it('is dropped when the plain page answers after the player ended', async () => {
    let answer: (elements: typeof CARD_END) => void = () => {}
    const pending = new Promise<typeof CARD_END>((resolve) => { answer = resolve })
    const { api, onEndScreen, controller } = await start({ playerParams: 'params-1' }, () => pending)
    expect(api.endScreen).toHaveBeenCalledOnce()
    await controller.destroy()
    answer(CARD_END)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onEndScreen).not.toHaveBeenCalled()
  })
})

describe('audio track and Stable Volume selection in Shaka', () => {
  const audioFormats = [
    { key: '251:es', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
    { key: '251:en-drc', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true, isDrc: true },
    { key: '251:en', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
  ]
  const videoFormats = [
    { key: '399:', itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1_920, height: 1_080 },
  ]

  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pins initial Shaka audio preferences to the session audio format and switches audio tracks without losing quality', async () => {
    const { api, controller, player } = await start({
      videoFormats,
      audioFormats,
      selectedVideoKey: '399:',
      selectedAudioKey: '251:en',
    }, undefined, false)

    expect(api.openPlayback).toHaveBeenCalledWith('video-1', 720, 'params-1', false)
    expect(player.configs).toContainEqual(expect.objectContaining({
      preferredAudioLanguage: 'en-US',
      preferredAudioRole: 'main',
      preferredAudioLabel: 'English (US) original',
    }))
    expect(controller.audioTracks.map((track) => track.id)).toEqual(['en-US.4', 'es.3'])
    expect(controller.audioTrackId).toBe('en-US.4')
    expect(controller.hasDrc('en-US.4')).toBe(true)
    expect(controller.hasDrc('es.3')).toBe(false)

    const enTrack = { language: 'en-US', label: 'English (US) original', codecs: 'opus', roles: ['main'], active: true }
    const enDrcTrack = { language: 'en-US', label: 'English (US) original (Stable Volume)', codecs: 'opus', roles: ['main', 'enhanced-audio-intelligibility'], active: false }
    const esTrack = { language: 'es', label: 'Spanish', codecs: 'opus', roles: ['alternate', 'dub'], active: false }
    player.audioTracks = [enTrack, enDrcTrack, esTrack]
    player.variants = [
      { id: 1, height: 1_080, bandwidth: 2_130_000, audioId: 10, originalAudioId: '251-en-US.4', originalVideoId: '399', language: 'en-US', label: 'English (US) original', audioCodec: 'opus', audioRoles: ['main'], active: false },
      { id: 2, height: 1_080, bandwidth: 2_131_000, audioId: 11, originalAudioId: '251-en-US.4-drc', originalVideoId: '399', language: 'en-US', label: 'English (US) original (Stable Volume)', audioCodec: 'opus', audioRoles: ['main', 'enhanced-audio-intelligibility'], active: false },
      { id: 3, height: 1_080, bandwidth: 2_130_000, audioId: 12, originalAudioId: '251-es.3', originalVideoId: '399', language: 'es', label: 'Spanish', audioCodec: 'opus', audioRoles: ['alternate', 'dub'], active: true },
    ]

    await controller.selectAudio('en-US.4', true)
    expect(api.selectAudioFormat).toHaveBeenCalledWith('playback:1', '251:en-drc')
    expect(player.selectedAudioCalls.at(-1)).toEqual([enDrcTrack, 1])

    await controller.selectAudio('es.3', true)
    expect(api.selectAudioFormat).toHaveBeenCalledWith('playback:1', '251:es')
    expect(player.selectedAudioCalls.at(-1)).toEqual([esTrack, 1])

    // Manual quality change keeps the active Spanish audio stream (audioId 12) rather than highest-bandwidth English DRC
    await controller.selectQuality(1_080)
    expect(player.selectedVariantCalls.at(-1)?.[0]).toMatchObject({ id: 3, audioId: 12 })

    // Switching back to English DRC under manual quality selects the exact 251-en-US.4-drc variant on the same video
    await controller.selectAudio('en-US.4', true)
    expect(api.selectAudioFormat).toHaveBeenLastCalledWith('playback:1', '251:en-drc')
    expect(player.selectedVariantCalls.at(-1)?.[0]).toMatchObject({ id: 2, originalAudioId: '251-en-US.4-drc', originalVideoId: '399' })
  })

  it('waits for in-flight init/index fetches to settle before switching audio tracks in Shaka', async () => {
    let resolveInit: (value: unknown) => void = () => {}
    const initPromise = new Promise((resolve) => { resolveInit = resolve })
    const { api, controller, player } = await start({
      videoFormats,
      audioFormats,
      selectedVideoKey: '399:',
      selectedAudioKey: '251:en',
    }, undefined, false)
    ;(api as unknown as { requestSegment: ReturnType<typeof vi.fn> }).requestSegment = vi.fn(() => initPromise)

    const enDrcTrack = { language: 'en-US', label: 'English (US) original (Stable Volume)', codecs: 'opus', roles: ['main', 'enhanced-audio-intelligibility'], active: false }
    const esTrack = { language: 'es', label: 'Spanish', codecs: 'opus', roles: ['alternate', 'dub'], active: false }
    player.audioTracks = [enDrcTrack, esTrack]
    player.variants = [
      { id: 2, height: 1_080, bandwidth: 2_131_000, audioId: 11, originalAudioId: '251-en-US.4-drc', originalVideoId: '399', language: 'en-US', label: 'English (US) original (Stable Volume)', audioCodec: 'opus', audioRoles: ['main', 'enhanced-audio-intelligibility'], active: true },
      { id: 3, height: 1_080, bandwidth: 2_130_000, audioId: 12, originalAudioId: '251-es.3', originalVideoId: '399', language: 'es', label: 'Spanish', audioCodec: 'opus', audioRoles: ['alternate', 'dub'], active: false },
    ]

    // Start an in-flight audio init fetch (simulating Shaka's createSegmentIndex() during an audio switch or seek)
    const req = { uris: ['sabr://audio?key=251%3Aen-drc'], headers: { Range: 'bytes=0-255' } }
    player.requestFilter!(fake.shaka.net.NetworkingEngine.RequestType.SEGMENT, req, {})
    const scheme = fake.getScheme()!
    const op = scheme(req.uris[0], req, fake.shaka.net.NetworkingEngine.RequestType.SEGMENT, () => {}, () => {}) as { promise: Promise<unknown> }

    const switching = controller.selectAudio('es.3', true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Must not call selectAudioTrack while createSegmentIndex() init is still in flight
    expect(player.selectedAudioCalls).toEqual([])
    expect(api.selectAudioFormat).not.toHaveBeenCalled()

    resolveInit({
      generation: 0,
      track: 'audio',
      kind: 'init',
      formatKey: '251:en-drc',
      mimeType: 'audio/webm; codecs="opus"',
      elapsedMs: 1,
      end: false,
      data: new Uint8Array([1, 2, 3, 4]).buffer,
    })
    await op.promise
    await switching

    expect(api.selectAudioFormat).toHaveBeenCalledExactlyOnceWith('playback:1', '251:es')
    expect(player.selectedAudioCalls).toEqual([[esTrack, 1]])
  })

  it('filters supported audio tracks using ManagedMediaSource when MediaSource is absent (iOS WebKit)', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('ManagedMediaSource', { isTypeSupported: (mime: string) => mime.includes('mp4') })

    const iosAudioFormats = [
      { key: '251:fr', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'fr.3', audioTrackName: 'French', language: 'fr' },
      { key: '251:en-drc', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true, isDrc: true },
      { key: '140:es', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
      { key: '140:en', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
    ]
    const { api, controller, player } = await start({
      videoFormats,
      audioFormats: iosAudioFormats,
      selectedVideoKey: '399:',
      selectedAudioKey: '140:en',
    }, undefined, false)

    expect(controller.audioTracks.map((track) => track.id)).toEqual(['en-US.4', 'es.3'])
    expect(controller.hasDrc('en-US.4')).toBe(false)

    const esTrack = { language: 'es', label: 'Spanish', codecs: 'mp4a.40.2', roles: ['alternate', 'dub'], active: false }
    player.audioTracks = [
      { language: 'en-US', label: 'English (US) original', codecs: 'mp4a.40.2', roles: ['main'], active: true },
      esTrack,
    ]
    await controller.selectAudio('es.3', false)
    expect(api.selectAudioFormat).toHaveBeenCalledWith('playback:1', '140:es')
  })
})

describe('preloading without autoplay in Shaka', () => {
  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('buffers with the requested bufferingGoal without calling video.play until controller.play runs', async () => {
    const { video, controller, player } = await start({}, undefined, undefined, { autoPlay: false, bufferingGoal: 4 })
    expect(player.configs[0]).toMatchObject({ streaming: { bufferingGoal: 4 } })
    expect(video.play).not.toHaveBeenCalled()

    await controller.play()
    expect(video.play).toHaveBeenCalledOnce()
  })

  it('falls back to muted playback when play is blocked, but ignores AbortError from pause', async () => {
    let calls = 0
    const blocked = await start({}, undefined, undefined, {
      autoPlay: false,
      bufferingGoal: 4,
      play: async () => {
        calls += 1
        if (calls === 1) throw new DOMException('blocked', 'NotAllowedError')
      },
    })
    await blocked.controller.play()
    expect(blocked.video.muted).toBe(true)
    expect(blocked.onAutoplayMuted).toHaveBeenCalledOnce()
    expect(blocked.video.play).toHaveBeenCalledTimes(2)

    const aborted = await start({}, undefined, undefined, {
      autoPlay: false,
      bufferingGoal: 4,
      play: async () => {
        throw new DOMException('interrupted by pause', 'AbortError')
      },
    })
    await aborted.controller.play()
    expect(aborted.video.muted).toBe(false)
    expect(aborted.onAutoplayMuted).not.toHaveBeenCalled()
    expect(aborted.video.play).toHaveBeenCalledOnce()
  })

  it('does not start playback if controller.play is called after destroy', async () => {
    const { video, controller } = await start({}, undefined, undefined, { autoPlay: false, bufferingGoal: 4 })
    await controller.destroy()
    await controller.play()
    expect(video.play).not.toHaveBeenCalled()
  })
})

describe('unmuted autoplay fallback in Shaka', () => {
  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mutes the video, invokes onAutoplayMuted, and retries play on VOD NotAllowedError', async () => {
    let calls = 0
    const play = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' })
    })
    const { video, onAutoplayMuted, controller } = await start({}, undefined, undefined, { play })
    expect(video.muted).toBe(true)
    expect(onAutoplayMuted).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledTimes(2)
    await controller.destroy()
  })

  it('mutes the video and invokes onAutoplayMuted for live streams when unmuted play is blocked', async () => {
    let calls = 0
    const play = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' })
    })
    const { video, onAutoplayMuted, controller } = await start({ isLive: true }, undefined, undefined, { play })
    await vi.waitFor(() => expect(onAutoplayMuted).toHaveBeenCalledOnce())
    expect(video.muted).toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
    await controller.destroy()
  })

  it('does not invoke onAutoplayMuted when unmuted play succeeds', async () => {
    const play = vi.fn(async () => {})
    const { video, onAutoplayMuted, controller } = await start({}, undefined, undefined, { play })
    expect(video.muted).toBe(false)
    expect(onAutoplayMuted).not.toHaveBeenCalled()
    expect(play).toHaveBeenCalledOnce()
    await controller.destroy()
  })

  it('does not invoke onAutoplayMuted when the video started muted', async () => {
    const play = vi.fn(async () => {
      throw Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' })
    })
    const { video, onAutoplayMuted, controller } = await start({}, undefined, undefined, { play, muted: true })
    expect(video.muted).toBe(true)
    expect(onAutoplayMuted).not.toHaveBeenCalled()
    expect(play).toHaveBeenCalledOnce()
    await controller.destroy()
  })

  it('ignores AbortError from play() without muting or invoking onAutoplayMuted', async () => {
    const play = vi.fn(async () => {
      throw Object.assign(new Error('play interrupted'), { name: 'AbortError' })
    })
    const { video, onAutoplayMuted, controller } = await start({}, undefined, undefined, { play })
    expect(video.muted).toBe(false)
    expect(onAutoplayMuted).not.toHaveBeenCalled()
    expect(play).toHaveBeenCalledOnce()
    await controller.destroy()
  })
})

describe('startup ABR alignment and cache reporting in Shaka', () => {
  const videoFormats = [
    { key: '398:', itag: 398, mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 800_000, width: 1_280, height: 720 },
    { key: '399:', itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1_920, height: 1_080 },
  ]
  const audioFormats = [
    { key: '251:', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000 },
  ]

  beforeEach(() => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible' })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks 0 ms cached segments fromCache without poisoning ABR bandwidth, and reports real media downloads', async () => {
    const { api, controller, player } = await start({
      videoFormats,
      audioFormats,
      selectedVideoKey: '398:',
      selectedAudioKey: '251:',
    })
    const requestSegment = vi.fn()
      .mockResolvedValueOnce({ generation: 0, track: 'video', kind: 'init', formatKey: '398:', mimeType: 'video/mp4', elapsedMs: 0, end: false, data: new Uint8Array(64).buffer })
      .mockResolvedValueOnce({ generation: 0, track: 'video', kind: 'media', formatKey: '398:', mimeType: 'video/mp4', elapsedMs: 0, end: false, data: new Uint8Array(1024).buffer })
      .mockResolvedValueOnce({ generation: 0, track: 'video', kind: 'media', formatKey: '398:', mimeType: 'video/mp4', elapsedMs: 120, end: false, data: new Uint8Array(2048).buffer })
    ;(api as unknown as { requestSegment: typeof requestSegment }).requestSegment = requestSegment

    const scheme = fake.getScheme()!
    const run = async (media: boolean) => {
      const req = { uris: ['sabr://video?key=398%3A'], headers: {} }
      player.requestFilter!(fake.shaka.net.NetworkingEngine.RequestType.SEGMENT, req, media ? { segment: { getStartTime: () => 0 } } : {})
      const progress = vi.fn()
      const op = scheme(req.uris[0], req, fake.shaka.net.NetworkingEngine.RequestType.SEGMENT, progress, () => {}) as { promise: Promise<{ fromCache: boolean, timeMs: number }> }
      return { res: await op.promise, progress }
    }

    const initHit = await run(false)
    expect(initHit.res.fromCache).toBe(true)
    expect(initHit.progress).not.toHaveBeenCalled()

    const cachedMedia = await run(true)
    expect(cachedMedia.res.fromCache).toBe(true)
    expect(cachedMedia.progress).not.toHaveBeenCalled()

    const liveMedia = await run(true)
    expect(liveMedia.res.fromCache).toBe(false)
    expect(liveMedia.res.timeMs).toBe(120)
    expect(liveMedia.progress).toHaveBeenCalledExactlyOnceWith(120, 2048, 0)
    await controller.destroy()
  })

  it('aligns opening VOD format with prewarmStart and unlocks ABR once loadeddata fires', async () => {
    const { video, controller, player } = await start({
      videoFormats,
      audioFormats,
      selectedVideoKey: '398:',
      selectedAudioKey: '251:',
    })
    expect(player.configs).toContainEqual(expect.objectContaining({
      preferredVideoCodecs: ['av01'],
      abr: expect.objectContaining({
        restrictToElementSize: false,
        restrictions: { minHeight: 720, maxHeight: 720 },
      }),
    }))
    video.dispatchEvent(new Event('loadeddata'))
    expect(player.configs.at(-1)).toEqual({
      abr: { restrictToElementSize: true, restrictions: { minHeight: 0, maxHeight: Infinity } },
    })
    await controller.destroy()
  })

  it('keeps ABR enabled during load for pinned portrait Shorts using Shaka short-side height restrictions, then disables ABR after load', async () => {
    const portraitFormats = [
      { key: '399:', itag: 399, mimeType: 'video/mp4; codecs="av01.0.09M.08"', bitrate: 2_000_000, width: 1_080, height: 1_350 },
    ]
    const api = {
      openPlayback: vi.fn(async () => ({
        id: 'playback:1',
        isLive: false,
        manifest: '<MPD/>',
        videoFormats: portraitFormats,
        audioFormats,
        selectedVideoKey: '399:',
        selectedAudioKey: '251:',
        storyboards: [],
        captionTracks: [],
        translationLanguages: [],
        endScreen: [],
      })),
      closePlayback: vi.fn(async () => {}),
      selectVideoFormat: vi.fn(async () => {}),
      selectAudioFormat: vi.fn(async () => {}),
      endScreen: vi.fn(async () => []),
    }
    const video = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ height: 720 }),
      play: vi.fn(async () => {}),
      currentTime: 0,
      paused: false,
      muted: false,
      videoHeight: 1_350,
      buffered: { length: 1, start: () => 0, end: () => 10 },
    })
    const controller = await startShakaPlayback({
      api: api as unknown as FrameApi,
      video: video as unknown as HTMLVideoElement,
      videoId: 'short-1',
      startTime: 0,
      autoPlay: false,
      pinVideoFormat: true,
      signal: new AbortController().signal,
      onError: vi.fn(),
    })
    const player = fake.players.at(-1)!
    const openingConfig = player.configs.find((config) => 'preferredVideoCodecs' in config)
    expect(openingConfig).toMatchObject({
      preferredVideoCodecs: ['av01'],
      abr: { enabled: true, restrictToElementSize: false, restrictions: { minHeight: 1_080, maxHeight: 1_080 } },
    })
    expect(player.configs.at(-1)).toEqual({
      abr: { enabled: false, restrictToElementSize: false, restrictions: { minHeight: 0, maxHeight: Infinity } },
    })
    await controller.destroy()
  })

  it('falls back to the highest available tier when selectQuality receives an unavailable preference', async () => {
    const formats = [
      { key: '299:', itag: 299, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4_000_000, width: 1_920, height: 1_080 },
      { key: '136:', itag: 136, mimeType: 'video/mp4; codecs="avc1.4d401f"', bitrate: 2_000_000, width: 1_280, height: 720 },
    ]
    const { api, controller, player } = await start({
      videoFormats: formats,
      audioFormats,
      selectedVideoKey: '136:',
      selectedAudioKey: '251:',
    })
    player.variants = [
      { active: true, audioId: 1, height: 720, bandwidth: 2_000_000 },
      { active: false, audioId: 1, height: 1_080, bandwidth: 4_000_000 },
    ]

    expect(controller.heights).toEqual([1_080, 720])
    await controller.selectQuality(2_160)

    expect(api.selectVideoFormat).toHaveBeenCalledWith('playback:1', '299:')
    expect(player.abrEnabled).toBe(false)
    expect(player.selectedVariantCalls).toContainEqual([
      expect.objectContaining({ height: 1_080 }),
      true,
      1,
    ])
    await controller.destroy()
  })

  it('clears buffer with safe margin when manually downgrading quality so videoHeight updates promptly', async () => {
    const formats = [
      { key: '313:', itag: 313, mimeType: 'video/mp4; codecs="vp09.00.51.08"', bitrate: 18_000_000, width: 3_840, height: 2_160 },
      { key: '136:', itag: 136, mimeType: 'video/mp4; codecs="avc1.4d401f"', bitrate: 2_000_000, width: 1_280, height: 720 },
    ]
    const { api, controller, player, video } = await start({
      videoFormats: formats,
      audioFormats,
      selectedVideoKey: '313:',
      selectedAudioKey: '251:',
    })
    ;(video as { videoHeight: number }).videoHeight = 2_160
    player.variants = [
      { active: true, audioId: 1, height: 2_160, bandwidth: 18_000_000 },
      { active: false, audioId: 1, height: 720, bandwidth: 2_000_000 },
    ]

    await controller.selectQuality(720)

    expect(api.selectVideoFormat).toHaveBeenCalledWith('playback:1', '136:')
    expect(player.abrEnabled).toBe(false)
    expect(player.selectedVariantCalls.at(-1)).toEqual([
      expect.objectContaining({ height: 720 }),
      true,
      1,
    ])
    await controller.destroy()
  })
})
