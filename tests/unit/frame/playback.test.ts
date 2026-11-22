import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { LiveMetadata, MediaHeader, StreamProtectionStatus, UMPPartId, VideoPlaybackAbrRequest } from 'googlevideo/protos'
import type { SabrSource } from '../../../src/frame/innertube'
import type { SegmentRequest } from '../../../src/frame/protocol'
import { egressFetch } from '../../../src/frame/egress'
import { getSabrSource } from '../../../src/frame/innertube'
import { closePlaybackEntry, openPlaybackEntry, requestPlaybackSegment } from '../../../src/frame/playback'
import { STREAM_REFUSED } from '../../../src/frame/protocol'
import { createSabrSession } from '../../../src/frame/sabr'
import { createRestartBudget, isStreamRefusal } from '../../../src/player/restart'

vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))
vi.mock('../../../src/frame/innertube', () => ({ GVS_ORIGIN_KEY: 'gvs-origin', getSabrSource: vi.fn() }))
vi.mock('../../../src/frame/sabr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/frame/sabr')>()
  return { ...actual, createSabrSession: vi.fn(actual.createSabrSession) }
})

const { createSabrSession: realSession } = await vi.importActual<typeof import('../../../src/frame/sabr')>('../../../src/frame/sabr')

const video = { itag: 399, lastModified: '1', width: 1_920, height: 1_080, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1, approxDurationMs: 213_000 }
const audio = { itag: 251, lastModified: '1', mimeType: 'audio/webm; codecs="opus"', bitrate: 1, approxDurationMs: 213_000 }
const recoverMint = vi.fn(async () => {})
const source: SabrSource = {
  videoId: 'video-1',
  isLive: false,
  durationMs: 213_000,
  manifest: '<MPD/>',
  streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1',
  ustreamerConfig: 'AA==',
  formats: [video, audio],
  playbackFormats: [
    { key: '399:', itag: 399, mimeType: video.mimeType, bitrate: 1, width: 1_920, height: 1_080 },
    { key: '251:', itag: 251, mimeType: audio.mimeType, bitrate: 1 },
  ],
  storyboards: [],
  captions: [],
  translations: [],
  endScreen: [],
  clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
  mint: async () => 'AAAA',
  recoverMint,
}
const segment = (requestId: string): SegmentRequest => ({
  requestId,
  sessionId: 'playback:1',
  generation: 0,
  track: 'video',
  kind: 'media',
  startTimeMs: 60_000,
  snapshot: { currentTimeMs: 60_000, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 },
})

// every SABR answer is status 2 with no media, the way YouTube answers a session it will not serve; one UMP part, whose
// type and size both fit a one-byte varint
const refuseEverySession = () => vi.mocked(egressFetch).mockImplementation(async () => {
  const status = StreamProtectionStatus.encode({ status: 2 }).finish()
  return new Response(new Uint8Array([UMPPartId.STREAM_PROTECTION_STATUS, status.byteLength, ...status]))
})

const failureOf = (request: Promise<unknown>) => request.then(() => 'delivered', (error: Error) => error.message)

const init = (requestId: string): SegmentRequest => ({ ...segment(requestId), kind: 'init', range: { start: 0, end: 700 } })

// the requests `served` picks (by the session's number, the first being 1) get a few bytes, the rest the SABR answers
const serve = (served: (request: SegmentRequest, session: number) => boolean) => {
  let sessions = 0
  vi.mocked(createSabrSession).mockImplementation((...args) => {
    const session = realSession(...args)
    const number = ++sessions
    const requestSegment: typeof session.requestSegment = (request, progress, signal) => served(request, number)
      ? Promise.resolve({ generation: request.generation, track: request.track, kind: request.kind, formatKey: '399:', mimeType: video.mimeType, elapsedMs: 1, end: false, data: new ArrayBuffer(8) })
      : session.requestSegment(request, progress, signal)
    return Object.create(session, { requestSegment: { value: requestSegment } }) as typeof session
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/* The player's side of the loop, as video-player.tsx and Shaka drive the frame: Shaka asks again a second after a
   failed segment; a refusal ends the playback, and the player opens the video again after the restart budget's wait,
   until the budget has none left. */
const watchRefusedVideo = async () => {
  const budget = createRestartBudget()
  let request = 0
  for (;;) {
    const { entry } = await openPlaybackEntry('video-1')
    for (;;) {
      const failure = await requestPlaybackSegment(entry, segment(`r${++request}`), () => {}).then(() => undefined, (error: Error) => error)
      if (!failure || isStreamRefusal(failure)) break
      await sleep(1_000)
    }
    closePlaybackEntry(entry)
    const wait = budget.refused()
    if (wait === undefined) return 'stopped'
    await sleep(wait)
  }
}

describe('a playback YouTube keeps refusing', () => {
  const reads: number[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    reads.length = 0
    recoverMint.mockClear()
    vi.mocked(egressFetch).mockReset()
    // a read with params that play reports them, as getSabrSource's does
    vi.mocked(getSabrSource).mockReset().mockImplementation(async (_videoId, playerParams) => {
      reads.push(Date.now())
      return { ...source, playerParams }
    })
    refuseEverySession()
  })

  afterEach(() => {
    vi.mocked(createSabrSession).mockImplementation(realSession)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const perMinute = (from: number, minutes: number) => Array.from({ length: minutes }, (_, minute) =>
    reads.filter((at) => at >= from + minute * 60_000 && at < from + (minute + 1) * 60_000).length)

  it('reads the watch page again at once, then backs off 5, 15 and 45 s, then stops', async () => {
    const start = Date.now()
    let outcome: string | undefined
    void watchRefusedVideo().then((result) => { outcome = result })
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(perMinute(start, 10)).toEqual([6, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(outcome).toBe('stopped')
    // the first recovery: the refresh follows the first refused request with no wait of its own
    expect(reads[1]! - reads[0]!).toBeLessThan(1_000)
    // each try is one open and one refresh, the tries 5, 15 and 45 s after the one before ended
    expect(reads).toHaveLength(8)
    const tries = [reads[2]! - reads[1]!, reads[4]! - reads[3]!, reads[6]! - reads[5]!]
    expect(tries.map((gap) => Math.round(gap / 5_000) * 5_000)).toEqual([5_000, 15_000, 45_000])
    // one new BotGuard session per SABR session, never one per request
    expect(recoverMint).toHaveBeenCalledTimes(8)
  })

  it('reads a preview\'s watch page with its card\'s params on the refresh as on the open', async () => {
    const { entry } = await openPlaybackEntry('video-1', 360, 'params-1')
    const first = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await first).toMatch(STREAM_REFUSED)
    expect(vi.mocked(getSabrSource).mock.calls).toEqual([['video-1', 'params-1'], ['video-1', 'params-1']])
    closePlaybackEntry(entry)
  })

  it('answers every later request at once, with no read, once refused', async () => {
    const { entry } = await openPlaybackEntry('video-1')
    const first = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await first).toBe(`${STREAM_REFUSED} (SABR stream status 2 after 3 attempts)`)
    const fetches = vi.mocked(egressFetch).mock.calls.length
    const later = await Promise.all(['b', 'c', 'd'].map((id) =>
      failureOf(requestPlaybackSegment(entry, { ...segment(id), track: id === 'c' ? 'audio' : 'video' }, () => {}))))
    expect(later).toEqual(Array(3).fill(`${STREAM_REFUSED} (SABR stream status 2 after 3 attempts)`))
    expect(vi.mocked(egressFetch).mock.calls.length).toBe(fetches)
    expect(reads).toHaveLength(2)
    closePlaybackEntry(entry)
  })

  it('refreshes once for requests that fail together', async () => {
    const { entry } = await openPlaybackEntry('video-1')
    const both = Promise.all([
      failureOf(requestPlaybackSegment(entry, segment('v'), () => {})),
      failureOf(requestPlaybackSegment(entry, { ...segment('a'), track: 'audio', kind: 'init', range: { start: 0, end: 700 } }, () => {})),
    ])
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await both).every((message) => message.startsWith(STREAM_REFUSED))).toBe(true)
    expect(reads).toHaveLength(2)
    closePlaybackEntry(entry)
  })

  it('counts only media as served: an init the new session answers does not buy it a second refresh', async () => {
    serve((request) => request.kind === 'init')
    const { entry } = await openPlaybackEntry('video-1')
    let release: () => void = () => {}
    vi.mocked(getSabrSource).mockImplementationOnce(async () => {
      reads.push(Date.now())
      await new Promise<void>((resolve) => { release = resolve })
      return source
    })
    const first = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reads).toHaveLength(2)
    // a seek while the new session opens drops the old request, and the new position asks for its init first
    const initAnswer = failureOf(requestPlaybackSegment(entry, { ...init('b'), generation: 1 }, () => {}))
    const media = failureOf(requestPlaybackSegment(entry, { ...segment('c'), generation: 1 }, () => {}))
    release()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await first).toBe('youtube: segment request cancelled')
    expect(await initAnswer).toBe('delivered')
    expect(await media).toMatch(STREAM_REFUSED)
    expect(reads).toHaveLength(2)
    closePlaybackEntry(entry)
  })

  it('replaces a session again on a later refusal once it delivered media', async () => {
    let delivered = 0
    serve((request, session) => request.kind === 'media' && session === 2 && ++delivered === 1)
    const { entry } = await openPlaybackEntry('video-1')
    const recovered = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await recovered).toBe('delivered')
    expect(reads).toHaveLength(2)
    const refused = failureOf(requestPlaybackSegment(entry, segment('b'), () => {}))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await refused).toMatch(STREAM_REFUSED)
    expect(reads).toHaveLength(3)
    closePlaybackEntry(entry)
  })

  it('reads nothing more once the playback is closed during its refresh', async () => {
    let release: () => void = () => {}
    const { entry } = await openPlaybackEntry('video-1')
    vi.mocked(getSabrSource).mockImplementation(async () => {
      reads.push(Date.now())
      await new Promise<void>((resolve) => { release = resolve })
      return source
    })
    const request = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toHaveLength(2)
    closePlaybackEntry(entry)
    release()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(await request).toBe('youtube: segment request cancelled')
    expect(reads).toHaveLength(2)
  })

  it('preserves a switched dubbed or DRC audio format across a session refresh', async () => {
    const audioEs = { itag: 251, lastModified: '1', xtags: 'es', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'es.3', approxDurationMs: 213_000 }
    const audioEnDrc = { itag: 251, lastModified: '1', xtags: 'en-drc', mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioTrackId: 'en-US.4', isOriginal: true, isDrc: true, approxDurationMs: 213_000 }
    const audioEn = { itag: 251, lastModified: '1', xtags: 'en', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'en-US.4', isOriginal: true, approxDurationMs: 213_000 }
    const multi: SabrSource = {
      ...source,
      formats: [video, audioEs, audioEnDrc, audioEn],
      playbackFormats: [
        { key: '399:', itag: 399, mimeType: video.mimeType, bitrate: 1, width: 1_920, height: 1_080 },
        { key: '251:es', itag: 251, mimeType: audioEs.mimeType, bitrate: 130_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
        { key: '251:en-drc', itag: 251, mimeType: audioEnDrc.mimeType, bitrate: 131_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true, isDrc: true },
        { key: '251:en', itag: 251, mimeType: audioEn.mimeType, bitrate: 130_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
      ],
    }
    vi.mocked(getSabrSource).mockImplementation(async () => {
      reads.push(Date.now())
      return multi
    })
    serve((request, sessionNumber) => request.kind === 'media' && sessionNumber === 2)
    const { entry } = await openPlaybackEntry('video-1')
    entry.player.selectAudioFormat('251:es')
    const recovered = failureOf(requestPlaybackSegment(entry, segment('a'), () => {}))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await recovered).toBe('delivered')
    expect(reads).toHaveLength(2)
    expect(entry.player.audioFormat.key).toBe('251:es')
    closePlaybackEntry(entry)
  })
})

describe('proactive background live session refresh', () => {
  const HEAD = 1_000
  const startMsOf = (sequence: number) => sequence * 5_000
  const liveVideo = { itag: 134, lastModified: '1', width: 640, height: 360, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 1, approxDurationMs: 0 }
  const liveAudio = { itag: 140, lastModified: '1', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 1, approxDurationMs: 0 }
  const liveRecoverMint = vi.fn(async () => {})
  const liveSource = (sessionTag: string): SabrSource => ({
    videoId: 'live-1',
    isLive: true,
    durationMs: 0,
    manifest: '',
    streamingUrl: `https://rr1---sn-test.googlevideo.com/videoplayback?id=${sessionTag}`,
    ustreamerConfig: 'AA==',
    formats: [liveVideo, liveAudio],
    playbackFormats: [
      { key: '134:', itag: 134, mimeType: liveVideo.mimeType, bitrate: 1, width: 640, height: 360, targetDurationMs: 5_000 },
      { key: '140:', itag: 140, mimeType: liveAudio.mimeType, bitrate: 1, targetDurationMs: 5_000 },
    ],
    storyboards: [],
    captions: [],
    translations: [],
    endScreen: [],
    clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
    mint: async () => 'AAAA',
    recoverMint: liveRecoverMint,
  })

  const varInt = (value: number) => value < 128 ? [value] : [(value & 0x3f) | 0x80, value >> 6]
  const umpPart = (type: number, payload: Uint8Array | number[]) => new Uint8Array([...varInt(type), ...varInt(payload.length), ...payload])
  const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, item) => sum + item.byteLength, 0))
    let offset = 0
    for (const item of parts) {
      out.set(item, offset)
      offset += item.byteLength
    }
    return out
  }
  const liveSegmentResponse = (sequence: number, headSeq = sequence + 1) => {
    const videoData = [134, sequence & 0xff, (sequence >> 8) & 0xff, 1]
    const audioData = [140, sequence & 0xff, (sequence >> 8) & 0xff, 1]
    return new Response(concat([
      umpPart(UMPPartId.LIVE_METADATA, LiveMetadata.encode({
        headSequenceNumber: String(headSeq),
        headTimeMs: String(startMsOf(headSeq)),
        minSeekableTimeTicks: String(startMsOf(headSeq - 100) * 1_000),
        minSeekableTimescale: 1_000_000,
      }).finish()),
      umpPart(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
        headerId: 0,
        itag: 134,
        formatId: { itag: 134, lastModified: '1' },
        sequenceNumber: sequence,
        startMs: String(startMsOf(sequence)),
        durationMs: '5000',
        contentLength: String(videoData.length),
      }).finish()),
      umpPart(UMPPartId.MEDIA, [0, ...videoData]),
      umpPart(UMPPartId.MEDIA_END, [0]),
      umpPart(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
        headerId: 1,
        itag: 140,
        formatId: { itag: 140, lastModified: '1' },
        sequenceNumber: sequence,
        startMs: String(startMsOf(sequence)),
        durationMs: '5000',
        contentLength: String(audioData.length),
      }).finish()),
      umpPart(UMPPartId.MEDIA, [1, ...audioData]),
      umpPart(UMPPartId.MEDIA_END, [1]),
    ]))
  }
  const status3Response = () => {
    const payload = StreamProtectionStatus.encode({ status: 3 }).finish()
    return new Response(umpPart(UMPPartId.STREAM_PROTECTION_STATUS, payload))
  }
  const liveRequest = (requestId: string, sequenceNumber: number): SegmentRequest => ({
    requestId,
    sessionId: 'playback:1',
    generation: 0,
    track: 'video',
    kind: 'media',
    formatKey: '134:',
    sequenceNumber,
    startTimeMs: startMsOf(sequenceNumber),
    snapshot: { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 },
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    liveRecoverMint.mockClear()
    vi.mocked(egressFetch).mockReset()
    vi.mocked(getSabrSource).mockReset()
    vi.mocked(createSabrSession).mockImplementation(realSession)
  })

  afterEach(() => {
    vi.mocked(createSabrSession).mockImplementation(realSession)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('refreshes seamlessly in the background on live pump status 3, keeps previous cached reads alive during handoff, and allows later refreshes after media', async () => {
    let sourceReads = 0
    let releaseSecondWatch: (() => void) | undefined
    vi.mocked(getSabrSource).mockImplementation(async () => {
      sourceReads += 1
      if (sourceReads === 2) {
        await new Promise<void>((resolve) => { releaseSecondWatch = resolve })
      }
      return liveSource(`s${sourceReads}`)
    })

    const sessionCalls = new Map<string, number>()
    vi.mocked(egressFetch).mockImplementation(async (url, init) => {
      const tag = new URL(url).searchParams.get('id') ?? 's1'
      const count = (sessionCalls.get(tag) ?? 0) + 1
      sessionCalls.set(tag, count)
      const decoded = VideoPlaybackAbrRequest.decode(new Uint8Array(init?.body as ArrayBuffer))
      const askedMs = Number(decoded.clientAbrState?.playerTimeMs ?? 0)
      if (tag === 's1') {
        if (count === 1) return liveSegmentResponse(HEAD, HEAD + 2)
        return status3Response()
      }
      if (tag === 's2') {
        if (count === 1) {
          // Next session continues right from previous.liveEndMs (HEAD + 1)
          expect(askedMs).toBe(startMsOf(HEAD + 1) + 2_500)
          return liveSegmentResponse(HEAD + 1, HEAD + 3)
        }
        // Later refusal on s2 after it delivered real media must trigger a 3rd session
        return status3Response()
      }
      if (tag === 's3' && count === 1) {
        expect(askedMs).toBe(startMsOf(HEAD + 2) + 2_500)
        return liveSegmentResponse(HEAD + 2, HEAD + 4)
      }
      return new Promise(() => {})
    })

    const { entry } = await openPlaybackEntry('live-1', 360)
    const firstPlayer = entry.player
    firstPlayer.startLivePump()
    await vi.advanceTimersByTimeAsync(100)

    // Watch page 2 is in flight, previous player stays active so cached segment HEAD is still readable
    expect(sourceReads).toBe(2)
    expect(entry.player).toBe(firstPlayer)
    expect(document.documentElement.dataset.segmentRecovery).toBe('SABR stream status 3')
    const cached = await requestPlaybackSegment(entry, liveRequest('cached-head', HEAD), () => {})
    expect(cached.sequenceNumber).toBe(HEAD)

    // Completing watch page 2 swaps to s2, delivers HEAD + 1 (clearing entry.recovered), then s2 hits status 3 and refreshes to s3
    releaseSecondWatch?.()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(sourceReads).toBe(3)
    expect(entry.player).not.toBe(firstPlayer)
    expect(entry.refused).toBeUndefined()
    expect(entry.recovered).toBeUndefined()
    expect(entry.player.liveSegments.map((seg) => seg.sequenceNumber)).toEqual([HEAD + 2])
    closePlaybackEntry(entry)
  })

  it('refuses to refresh-loop when the refreshed live session fails before delivering any live segment', async () => {
    let sourceReads = 0
    vi.mocked(getSabrSource).mockImplementation(async () => {
      sourceReads += 1
      return liveSource(`s${sourceReads}`)
    })

    let s1Calls = 0
    vi.mocked(egressFetch).mockImplementation(async (url) => {
      const tag = new URL(url).searchParams.get('id') ?? 's1'
      if (tag === 's1') {
        s1Calls += 1
        if (s1Calls === 1) return liveSegmentResponse(HEAD, HEAD + 2)
      }
      return status3Response()
    })

    const { entry } = await openPlaybackEntry('live-1', 360)
    entry.player.startLivePump()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(sourceReads).toBe(2)
    expect(entry.refused?.message).toBe(`${STREAM_REFUSED} (SABR stream status 3)`)
    const fetchesBefore = vi.mocked(egressFetch).mock.calls.length
    const result = await failureOf(requestPlaybackSegment(entry, liveRequest('after-refused', HEAD + 1), () => {}))
    expect(result).toBe(`${STREAM_REFUSED} (SABR stream status 3)`)
    expect(vi.mocked(egressFetch).mock.calls.length).toBe(fetchesBefore)
    closePlaybackEntry(entry)
  })

  it('retries an in-flight live segment request on the replacement session when background handoff swaps players', async () => {
    let sourceReads = 0
    let releaseNextMedia: (() => void) | undefined
    vi.mocked(getSabrSource).mockImplementation(async () => {
      sourceReads += 1
      return liveSource(`s${sourceReads}`)
    })

    let s1Calls = 0
    vi.mocked(egressFetch).mockImplementation(async (url) => {
      const tag = new URL(url).searchParams.get('id') ?? 's1'
      if (tag === 's1') {
        s1Calls += 1
        if (s1Calls === 1) return liveSegmentResponse(HEAD, HEAD + 2)
        return status3Response()
      }
      await new Promise<void>((resolve) => { releaseNextMedia = resolve })
      return liveSegmentResponse(HEAD + 1, HEAD + 3)
    })

    const { entry } = await openPlaybackEntry('live-1', 360)
    entry.player.startLivePump()
    await vi.advanceTimersByTimeAsync(100)
    expect(sourceReads).toBe(2)

    // Request HEAD + 1 while s1 is still current and s2 is still warming up
    const pending = requestPlaybackSegment(entry, liveRequest('wait-next', HEAD + 1), () => {})
    await vi.advanceTimersByTimeAsync(50)
    releaseNextMedia?.()
    await vi.advanceTimersByTimeAsync(100)

    const delivered = await pending
    expect(delivered.sequenceNumber).toBe(HEAD + 1)
    closePlaybackEntry(entry)
  })

  it('aborts the live handoff wait and closes the replacement session when closed mid-refresh', async () => {
    let sourceReads = 0
    vi.mocked(getSabrSource).mockImplementation(async () => {
      sourceReads += 1
      return liveSource(`s${sourceReads}`)
    })

    let s1Calls = 0
    let s2Aborted = false
    vi.mocked(egressFetch).mockImplementation(async (url, _init, signal) => {
      const tag = new URL(url).searchParams.get('id') ?? 's1'
      if (tag === 's1') {
        s1Calls += 1
        if (s1Calls === 1) return liveSegmentResponse(HEAD, HEAD + 2)
        return status3Response()
      }
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          s2Aborted = true
          reject(signal.reason)
        }, { once: true })
      })
    })

    const { entry } = await openPlaybackEntry('live-1', 360)
    entry.player.startLivePump()
    await vi.advanceTimersByTimeAsync(100)
    expect(sourceReads).toBe(2)
    expect(s2Aborted).toBe(false)

    closePlaybackEntry(entry)
    await vi.advanceTimersByTimeAsync(0)
    expect(s2Aborted).toBe(true)
    expect(entry.refreshing).toBeUndefined()
  })
})
