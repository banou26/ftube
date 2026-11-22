import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { BinaryWriter, WireType } from '@bufbuild/protobuf/wire'
import { LiveMetadata, MediaHeader, NextRequestPolicy, ReloadPlaybackContext, StreamProtectionStatus, UMPPartId, VideoPlaybackAbrRequest } from 'googlevideo/protos'
import type { SabrSource } from '../../../src/frame/innertube'
import type { SegmentRequest } from '../../../src/frame/protocol'
import { egressFetch } from '../../../src/frame/egress'
import { createSabrSession, createUmpFramer, createUmpSegmentCollector, inspectUmpChunks, LIVE_HEAD_MS } from '../../../src/frame/sabr'

vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))
vi.mock('../../../src/frame/innertube', () => ({ GVS_ORIGIN_KEY: 'gvs-origin' }))

const encodeVarInt = (value: number) => {
  if (value < 128) return [value]
  if (value < 16_384) return [(value & 0x3f) | 0x80, value >> 6]
  throw new Error('test value is too large')
}

const part = (type: number, input: Iterable<number>) => {
  const data = [...input]
  return new Uint8Array([
    ...encodeVarInt(type),
    ...encodeVarInt(data.length),
    ...data,
  ])
}

const join = (parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((size, value) => size + value.byteLength, 0))
  let offset = 0
  for (const value of parts) {
    output.set(value, offset)
    offset += value.byteLength
  }
  return output
}

describe('inspectUmpChunks', () => {
  it('recognizes an end-of-track response', () => {
    expect(inspectUmpChunks([new Uint8Array([UMPPartId.END_OF_TRACK, 0])])).toEqual({
      endOfTrack: true,
      partial: false,
      partTypes: [UMPPartId.END_OF_TRACK],
    })
  })

  it('recognizes a truncated part', () => {
    expect(inspectUmpChunks([new Uint8Array([UMPPartId.MEDIA, 2, 1])])).toMatchObject({
      endOfTrack: false,
      partial: true,
      partTypes: [],
    })
  })

  it('preserves UMP parts across every network split', () => {
    const media = part(UMPPartId.MEDIA, Array.from({ length: 130 }, (_, index) => index))
    const end = part(UMPPartId.MEDIA_END, [1])
    const envelope = new Uint8Array(media.byteLength + end.byteLength)
    envelope.set(media)
    envelope.set(end, media.byteLength)

    for (let split = 1; split < envelope.byteLength; split += 1) {
      const framer = createUmpFramer()
      const frames = [
        ...framer.push(envelope.slice(0, split)),
        ...framer.push(envelope.slice(split)),
      ]
      expect(frames.map((frame) => frame.type), `split at byte ${split}`).toEqual([
        UMPPartId.MEDIA,
        UMPPartId.MEDIA_END,
      ])
      expect(framer.partial, `split at byte ${split}`).toBe(false)
    }
  })
})

describe('createUmpSegmentCollector', () => {
  it('harvests interleaved audio and video across every network split', () => {
    const audioHeader = MediaHeader.encode({
      headerId: 1,
      itag: 251,
      startMs: '0',
      durationMs: '5000',
      contentLength: '3',
    }).finish()
    const videoHeader = MediaHeader.encode({
      headerId: 2,
      itag: 399,
      startMs: '0',
      durationMs: '5005',
      contentLength: '3',
    }).finish()
    const envelope = join([
      part(UMPPartId.MEDIA_HEADER, audioHeader),
      part(UMPPartId.MEDIA_HEADER, videoHeader),
      part(UMPPartId.MEDIA, [1, 10, 11]),
      part(UMPPartId.MEDIA, [2, 20]),
      part(UMPPartId.MEDIA, [1, 12]),
      part(UMPPartId.MEDIA_END, [1]),
      part(UMPPartId.MEDIA, [2, 21, 22]),
      part(UMPPartId.MEDIA_END, [2]),
    ])

    for (let split = 1; split < envelope.byteLength; split += 1) {
      const framer = createUmpFramer()
      const collector = createUmpSegmentCollector()
      const segments = [
        ...framer.push(envelope.slice(0, split)),
        ...framer.push(envelope.slice(split)),
      ].flatMap((frame) => collector.push(frame) ?? [])

      expect(segments.map((segment) => ({
        key: segment.formatKey,
        data: [...segment.data],
      })), `split at byte ${split}`).toEqual([
        { key: '251:', data: [10, 11, 12] },
        { key: '399:', data: [20, 21, 22] },
      ])
    }
  })

  it('rejects a segment whose declared content is incomplete', () => {
    const framer = createUmpFramer()
    const collector = createUmpSegmentCollector()
    const envelope = join([
      part(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
        headerId: 1,
        itag: 251,
        contentLength: '3',
      }).finish()),
      part(UMPPartId.MEDIA, [1, 10, 11]),
      part(UMPPartId.MEDIA_END, [1]),
    ])

    expect(framer.push(envelope).flatMap((frame) => collector.push(frame) ?? [])).toEqual([])
  })
})

describe('a SABR session answered with no media', () => {
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
  const seek: SegmentRequest = {
    requestId: 'request-1',
    sessionId: 'session-1',
    generation: 1,
    track: 'video',
    kind: 'media',
    startTimeMs: 90_000,
    snapshot: { currentTimeMs: 90_000, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 },
  }
  const init: SegmentRequest = { ...seek, kind: 'init', range: { start: 0, end: 700 } }

  const answerWithStatus = (status: number) => vi.mocked(egressFetch).mockImplementation(async () =>
    new Response(part(UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status }).finish())))

  // a request through every retry and its waits
  const failure = async (session: ReturnType<typeof createSabrSession>, request = seek) => {
    const outcome = session.requestSegment(request).then(() => 'played', (error: Error) => error.message)
    await vi.runAllTimersAsync()
    return outcome
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    recoverMint.mockClear()
    vi.mocked(egressFetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([
    ['a seek', seek, seek],
    ['an init', init, init],
    ['an init, then a seek', init, seek],
  ])('replaces the BotGuard session on status 2 once per stream, not on every attempt: %s', async (_, first, then) => {
    answerWithStatus(2)
    const session = createSabrSession(source)
    expect(await failure(session, first)).toBe('youtube: SABR stream status 2 after 3 attempts')
    expect(recoverMint).toHaveBeenCalledTimes(1)
    expect(await failure(session, then)).toBe('youtube: SABR stream status 2 after 3 attempts')
    expect(recoverMint).toHaveBeenCalledTimes(1)
    expect(egressFetch).toHaveBeenCalledTimes(6)
    session.close()
    const next = createSabrSession(source)
    await failure(next, first)
    expect(recoverMint).toHaveBeenCalledTimes(2)
    next.close()
  })

  it('replaces it on status 3 before every retry', async () => {
    answerWithStatus(3)
    const session = createSabrSession(source)
    expect(await failure(session)).toBe('youtube: SABR stream status 3 after 3 attempts')
    expect(recoverMint).toHaveBeenCalledTimes(2)
    await failure(session)
    expect(recoverMint).toHaveBeenCalledTimes(4)
    session.close()
  })
})

describe('a multi-track and DRC SABR session', () => {
  const video = { itag: 399, lastModified: '1', width: 1_920, height: 1_080, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1_000_000, approxDurationMs: 213_000 }
  const audioEs = { itag: 251, lastModified: '1', xtags: 'es', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'es.3', isDubbed: true, approxDurationMs: 213_000 }
  const audioEnDrc = { itag: 251, lastModified: '1', xtags: 'en-drc', mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioTrackId: 'en-US.4', isOriginal: true, isDrc: true, approxDurationMs: 213_000 }
  const audioEn = { itag: 251, lastModified: '1', xtags: 'en', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'en-US.4', isOriginal: true, approxDurationMs: 213_000 }

  const multiSource: SabrSource = {
    videoId: 'video-multi',
    isLive: false,
    durationMs: 213_000,
    manifest: '<MPD/>',
    streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1',
    ustreamerConfig: 'AA==',
    formats: [video, audioEs, audioEnDrc, audioEn],
    playbackFormats: [
      { key: '399:', itag: 399, mimeType: video.mimeType, bitrate: 1_000_000, width: 1_920, height: 1_080 },
      { key: '251:es', itag: 251, mimeType: audioEs.mimeType, bitrate: 130_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
      { key: '251:en-drc', itag: 251, mimeType: audioEnDrc.mimeType, bitrate: 131_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true, isDrc: true },
      { key: '251:en', itag: 251, mimeType: audioEn.mimeType, bitrate: 130_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
    ],
    storyboards: [],
    captions: [],
    translations: [],
    endScreen: [],
    clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
    mint: async () => 'AAAA',
    recoverMint: vi.fn(async () => {}),
  }

  const snapshot = { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 }

  beforeEach(() => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.mocked(egressFetch).mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts on the original non-DRC track by default, and on DRC when stableVolume is enabled', () => {
    const plain = createSabrSession(multiSource, 1_080, undefined, false)
    expect(plain.audioFormat.key).toBe('251:en')
    plain.close()

    const drc = createSabrSession(multiSource, 1_080, undefined, true)
    expect(drc.audioFormat.key).toBe('251:en-drc')
    drc.close()
  })

  it('sends the active audioTrackId and drcEnabled on audio and video requests and clears stale buffer tracking on switch', async () => {
    const requests: ReturnType<typeof VideoPlaybackAbrRequest.decode>[] = []
    vi.mocked(egressFetch).mockImplementation(async (_url, init) => {
      const decoded = VideoPlaybackAbrRequest.decode(new Uint8Array(init?.body as ArrayBuffer))
      requests.push(decoded)
      const isVideo = decoded.clientAbrState?.enabledTrackTypesBitfield === 2
      const format = isVideo ? decoded.preferredVideoFormatIds[0]! : decoded.preferredAudioFormatIds[0]!
      const header = MediaHeader.encode({
        headerId: 1,
        itag: format.itag,
        xtags: format.xtags,
        formatId: format,
        sequenceNumber: 1,
        startMs: String(decoded.clientAbrState?.playerTimeMs ?? '0'),
        durationMs: '5000',
        contentLength: '3',
      }).finish()
      return new Response(join([
        part(UMPPartId.MEDIA_HEADER, header),
        part(UMPPartId.MEDIA, [1, 1, 2, 3]),
        part(UMPPartId.MEDIA_END, [1]),
      ]))
    })

    const session = createSabrSession(multiSource, 1_080, undefined, false)
    await session.requestSegment({ requestId: 'a1', sessionId: 's', generation: 0, track: 'audio', kind: 'media', formatKey: '251:en', startTimeMs: 0, snapshot })
    expect(requests[0]?.clientAbrState?.audioTrackId).toBe('en-US.4')
    expect(requests[0]?.clientAbrState?.drcEnabled).toBe(false)

    // Switch to Spanish dub: video request carries updated audioTrackId too
    session.selectAudioFormat('251:es')
    await session.requestSegment({ requestId: 'v1', sessionId: 's', generation: 0, track: 'video', kind: 'media', formatKey: '399:', startTimeMs: 5_000, snapshot })
    expect(requests[1]?.clientAbrState?.audioTrackId).toBe('es.3')
    expect(requests[1]?.clientAbrState?.drcEnabled).toBe(false)

    // Switch to DRC original: drcEnabled is true
    session.selectAudioFormat('251:en-drc')
    await session.requestSegment({ requestId: 'a2', sessionId: 's', generation: 0, track: 'audio', kind: 'media', formatKey: '251:en-drc', startTimeMs: 10_000, snapshot })
    expect(requests[2]?.clientAbrState?.audioTrackId).toBe('en-US.4')
    expect(requests[2]?.clientAbrState?.drcEnabled).toBe(true)

    // Switch back to plain original: stale bufferedRange from a1 was cleared so only the discarded video carries a bufferedRange
    session.selectAudioFormat('251:en')
    await session.requestSegment({ requestId: 'a3', sessionId: 's', generation: 0, track: 'audio', kind: 'media', formatKey: '251:en', startTimeMs: 20_000, snapshot })
    expect(requests[3]?.clientAbrState?.audioTrackId).toBe('en-US.4')
    expect(requests[3]?.clientAbrState?.drcEnabled).toBe(false)
    expect(requests[3]?.bufferedRanges.some((range) => range.formatId?.itag === 251)).toBe(false)
    session.close()
  })
})

describe('live pump refresh detection and backfill buffer tracking', () => {
  const HEAD = 1_000
  const startMsOf = (sequence: number) => sequence * 5_000
  const video134 = { itag: 134, lastModified: '1', width: 640, height: 360, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 1, approxDurationMs: 0 }
  const audio140 = { itag: 140, lastModified: '1', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 1, approxDurationMs: 0 }
  const recoverMint = vi.fn(async () => {})
  const liveSource: SabrSource = {
    videoId: 'live-refresh-1',
    isLive: true,
    durationMs: 0,
    manifest: '',
    streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1',
    ustreamerConfig: 'AA==',
    formats: [video134, audio140],
    playbackFormats: [
      { key: '134:', itag: 134, mimeType: video134.mimeType, bitrate: 1, width: 640, height: 360, targetDurationMs: 5_000 },
      { key: '140:', itag: 140, mimeType: audio140.mimeType, bitrate: 1, targetDurationMs: 5_000 },
    ],
    storyboards: [],
    captions: [],
    translations: [],
    endScreen: [],
    clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
    mint: async () => 'AAAA',
    recoverMint,
  }
  const snapshot = { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 }

  const liveMediaResponse = (sequence: number, itags: number[] = [134, 140], headSeq = Math.max(HEAD, sequence)) => {
    const parts: Uint8Array[] = [
      part(UMPPartId.LIVE_METADATA, LiveMetadata.encode({
        headSequenceNumber: String(headSeq),
        headTimeMs: String(startMsOf(headSeq)),
        minSeekableTimeTicks: String(startMsOf(headSeq - 100) * 1_000),
        minSeekableTimescale: 1_000_000,
      }).finish()),
    ]
    itags.forEach((itag, headerId) => {
      const payload = [itag & 0xff, sequence & 0xff, (sequence >> 8) & 0xff, 1]
      parts.push(part(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
        headerId,
        itag,
        formatId: { itag, lastModified: '1' },
        sequenceNumber: sequence,
        startMs: String(startMsOf(sequence)),
        durationMs: '5000',
        contentLength: String(payload.length),
      }).finish()))
      parts.push(part(UMPPartId.MEDIA, [headerId, ...payload]))
      parts.push(part(UMPPartId.MEDIA_END, [headerId]))
    })
    return new Response(join(parts))
  }

  const statusResponse = (status: number) =>
    new Response(part(UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status }).finish()))

  const cuepointListPayload = (id: string, sequence: number) => new BinaryWriter()
    .tag(1, WireType.LengthDelimited).fork()
    .tag(1, WireType.LengthDelimited).fork()
    .tag(1, WireType.Varint).int32(1)
    .tag(2, WireType.Varint).int32(1)
    .tag(3, WireType.Bit64).double(60)
    .tag(4, WireType.Bit64).double(0)
    .tag(6, WireType.LengthDelimited).string(id)
    .join()
    .tag(2, WireType.Varint).int32(2)
    .tag(3, WireType.Varint).int32(sequence)
    .tag(4, WireType.LengthDelimited).fork()
    .tag(1, WireType.Varint).int64(startMsOf(sequence) * 90)
    .tag(3, WireType.Varint).int32(90_000)
    .join()
    .join()
    .finish()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    recoverMint.mockClear()
    vi.mocked(egressFetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls onLiveRefresh after consecutive status 3 refusals without skipping liveStartMs or looping BotGuard', async () => {
    const onLiveRefresh = vi.fn()
    const onLiveMedia = vi.fn()
    let calls = 0
    vi.mocked(egressFetch).mockImplementation(async () => {
      calls += 1
      if (calls === 1) return liveMediaResponse(HEAD)
      return statusResponse(3)
    })

    const session = createSabrSession(liveSource, 360, startMsOf(HEAD), false, { onLiveMedia, onLiveRefresh })
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(onLiveMedia).toHaveBeenCalled()
    expect(recoverMint).toHaveBeenCalledTimes(1)
    expect(onLiveRefresh).toHaveBeenCalledExactlyOnceWith('SABR stream status 3')
    expect(session.liveEndMs).toBe(startMsOf(HEAD + 1))
    expect(calls).toBe(3)

    // Calling startLivePump again after a session-level refusal must not restart the dead pump
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(3)
    session.close()
  })

  it('calls onLiveRefresh immediately on reloadPlaybackContext and HTTP refresh errors', async () => {
    for (const [label, failResponse, expected] of [
      [
        'reloadPlaybackContext',
        () => new Response(part(UMPPartId.RELOAD_PLAYER_RESPONSE, ReloadPlaybackContext.encode({ reloadPlaybackParams: { token: 'reload-1' } }).finish())),
        'SABR player reload requested',
      ],
      [
        'HTTP 503',
        () => new Response('', { status: 503 }),
        'youtube: segment returned 503',
      ],
      [
        'persistent HTTP 403',
        () => new Response('', { status: 403 }),
        'youtube: segment returned 403',
      ],
    ] as const) {
      recoverMint.mockClear()
      const onLiveRefresh = vi.fn()
      let calls = 0
      vi.mocked(egressFetch).mockReset().mockImplementation(async () => {
        calls += 1
        if (calls === 1) return liveMediaResponse(HEAD)
        return failResponse()
      })
      const session = createSabrSession(liveSource, 360, startMsOf(HEAD), false, { onLiveRefresh })
      session.startLivePump()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onLiveRefresh, label).toHaveBeenCalledExactlyOnceWith(expected)
      session.close()
    }
  })

  it('recovers from a single status 3 without calling onLiveRefresh and resets the counter after media', async () => {
    const onLiveRefresh = vi.fn()
    let calls = 0
    vi.mocked(egressFetch).mockImplementation(async () => {
      calls += 1
      if (calls === 1) return liveMediaResponse(HEAD, [134, 140], HEAD + 3)
      if (calls === 2) return statusResponse(3)
      if (calls === 3) return liveMediaResponse(HEAD + 1, [134, 140], HEAD + 3)
      if (calls === 4) return statusResponse(3)
      if (calls === 5) return liveMediaResponse(HEAD + 2, [134, 140], HEAD + 3)
      return new Promise(() => {})
    })

    const session = createSabrSession(liveSource, 360, startMsOf(HEAD), false, { onLiveRefresh })
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(recoverMint).toHaveBeenCalledTimes(2)
    expect(onLiveRefresh).not.toHaveBeenCalled()
    expect(session.liveSegments.map((segment) => segment.sequenceNumber)).toEqual([HEAD, HEAD + 1, HEAD + 2])
    session.close()
  })

  it('calls onLiveRefresh on a later status 2 after replacedOnStatus2 already ran', async () => {
    const onLiveRefresh = vi.fn()
    let calls = 0
    vi.mocked(egressFetch).mockImplementation(async () => {
      calls += 1
      if (calls === 1) return liveMediaResponse(HEAD, [134, 140], HEAD + 2)
      if (calls === 2) return statusResponse(2)
      if (calls === 3) return liveMediaResponse(HEAD + 1, [134, 140], HEAD + 2)
      return statusResponse(2)
    })

    const session = createSabrSession(liveSource, 360, startMsOf(HEAD), false, { onLiveRefresh })
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(recoverMint).toHaveBeenCalledTimes(1)
    expect(onLiveRefresh).toHaveBeenCalledExactlyOnceWith('SABR stream status 2')
    session.close()
  })

  it('does not call onLiveRefresh on an ad cuepoint refusal', async () => {
    const onLiveRefresh = vi.fn()
    let calls = 0
    vi.mocked(egressFetch).mockImplementation(async () => {
      calls += 1
      if (calls === 1) return liveMediaResponse(HEAD, [134, 140], HEAD + 2)
      if (calls === 2) {
        return new Response(join([
          part(UMPPartId.LIVE_METADATA, LiveMetadata.encode({
            headSequenceNumber: String(HEAD + 2),
            headTimeMs: String(startMsOf(HEAD + 2)),
            minSeekableTimeTicks: String(startMsOf(HEAD - 100) * 1_000),
            minSeekableTimescale: 1_000_000,
          }).finish()),
          part(UMPPartId.NEXT_REQUEST_POLICY, NextRequestPolicy.encode({ backoffTimeMs: 500 }).finish()),
          part(69, cuepointListPayload('cue-1', HEAD + 1)),
        ]))
      }
      if (calls === 3) return liveMediaResponse(HEAD + 1, [134, 140], HEAD + 2)
      return new Promise(() => {})
    })

    const session = createSabrSession(liveSource, 360, startMsOf(HEAD), false, { onLiveRefresh })
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(onLiveRefresh).not.toHaveBeenCalled()
    expect(session.liveSegments.map((segment) => segment.sequenceNumber)).toEqual([HEAD, HEAD + 1])
    session.close()
  })

  it('clears stale buffer tracking before backfilling a missing live segment behind newest', async () => {
    const requests: ReturnType<typeof VideoPlaybackAbrRequest.decode>[] = []
    let pumpCalls = 0
    vi.mocked(egressFetch).mockImplementation(async (_url, init) => {
      const decoded = VideoPlaybackAbrRequest.decode(new Uint8Array(init?.body as ArrayBuffer))
      requests.push(decoded)
      const isAudio = decoded.clientAbrState?.enabledTrackTypesBitfield === 1
      const playerTimeMs = Number(decoded.clientAbrState?.playerTimeMs ?? 0)
      if (!isAudio && playerTimeMs === LIVE_HEAD_MS) {
        return liveMediaResponse(HEAD - 2, [134, 140], HEAD)
      }
      if (!isAudio) {
        pumpCalls += 1
        // Simulate a missing audio segment at HEAD - 1 while video + audio land for HEAD
        if (pumpCalls === 1) return liveMediaResponse(HEAD - 1, [134], HEAD)
        if (pumpCalls === 2) return liveMediaResponse(HEAD, [134, 140], HEAD)
        return new Promise(() => {})
      }
      // Backfill request for audio HEAD - 1: reject if client still advertises a bufferedRange for audio (140)
      const staleAudioRange = decoded.bufferedRanges.some((range) => range.formatId?.itag === 140)
      if (staleAudioRange) return new Response(new Uint8Array())
      return liveMediaResponse(HEAD - 1, [140], HEAD)
    })

    const session = createSabrSession(liveSource, 360)
    await session.requestSegment({
      requestId: 'open',
      sessionId: 's',
      generation: 0,
      track: 'video',
      kind: 'media',
      formatKey: '134:',
      startTimeMs: LIVE_HEAD_MS,
      snapshot,
    })
    session.startLivePump()
    await vi.advanceTimersByTimeAsync(500)
    expect(session.liveSegments.map((segment) => segment.sequenceNumber)).toEqual([HEAD - 2, HEAD - 1, HEAD])

    // Audio has HEAD - 2 and HEAD cached (newest = HEAD), so HEAD - 1 is behind newest and must backfill cleanly
    const audioBackfill = await session.requestSegment({
      requestId: 'backfill-audio',
      sessionId: 's',
      generation: 0,
      track: 'audio',
      kind: 'media',
      formatKey: '140:',
      sequenceNumber: HEAD - 1,
      startTimeMs: startMsOf(HEAD - 1),
      snapshot,
    })
    expect(audioBackfill.sequenceNumber).toBe(HEAD - 1)
    const audioReq = requests.find((request) => request.clientAbrState?.enabledTrackTypesBitfield === 1)
    expect(audioReq).toBeDefined()
    expect(audioReq?.bufferedRanges.some((range) => range.formatId?.itag === 140)).toBe(false)
    session.close()
  })
})

describe('preview startup optimization', () => {
  const snapshot = { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 640, viewportHeight: 360 }

  const initPart = (headerId: number, itag: number, bytes: Uint8Array) => join([
    part(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
      headerId,
      itag,
      isInitSeg: true,
      contentLength: String(bytes.byteLength),
    }).finish()),
    part(UMPPartId.MEDIA, Uint8Array.of(headerId, ...bytes)),
    part(UMPPartId.MEDIA_END, [headerId]),
  ])

  beforeEach(() => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.mocked(egressFetch).mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prewarmStart shares a single dual-track SABR POST across both video and audio init requests', async () => {
    const videoInit = new Uint8Array(64).fill(1)
    const audioInit = new Uint8Array(48).fill(2)
    vi.mocked(egressFetch).mockImplementation(async () => new Response(join([
      initPart(1, 396, videoInit),
      initPart(2, 251, audioInit),
    ])))

    const vodSource: SabrSource = {
      videoId: 'preview-vod',
      isLive: false,
      durationMs: 120_000,
      manifest: '<MPD/>',
      streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1',
      ustreamerConfig: 'AA==',
      formats: [
        { itag: 396, lastModified: '1', width: 640, height: 360, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, approxDurationMs: 120_000 },
        { itag: 134, lastModified: '1', width: 640, height: 360, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 500_000, approxDurationMs: 120_000 },
        { itag: 251, lastModified: '1', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, approxDurationMs: 120_000 },
      ],
      playbackFormats: [
        { key: '134:', itag: 134, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 500_000, width: 640, height: 360, initRange: { start: 0, end: 31 }, indexRange: { start: 32, end: 63 } },
        { key: '396:', itag: 396, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, width: 640, height: 360, initRange: { start: 0, end: 31 }, indexRange: { start: 32, end: 63 } },
        { key: '251:', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, initRange: { start: 0, end: 23 }, indexRange: { start: 24, end: 47 } },
      ],
      storyboards: [],
      captions: [],
      translations: [],
      endScreen: [],
      clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
      mint: async () => 'AAAA',
      recoverMint: vi.fn(async () => {}),
    }

    const session = createSabrSession(vodSource, 360)
    expect(session.videoFormat.key).toBe('396:')
    session.prewarmStart()
    const [vInit, vIdx, aInit, aIdx] = await Promise.all([
      session.requestSegment({ requestId: 'v0', sessionId: 's', generation: 0, track: 'video', kind: 'init', formatKey: '396:', range: { start: 0, end: 31 }, startTimeMs: 0, snapshot }),
      session.requestSegment({ requestId: 'v1', sessionId: 's', generation: 0, track: 'video', kind: 'init', formatKey: '396:', range: { start: 32, end: 63 }, startTimeMs: 0, snapshot }),
      session.requestSegment({ requestId: 'a0', sessionId: 's', generation: 0, track: 'audio', kind: 'init', formatKey: '251:', range: { start: 0, end: 23 }, startTimeMs: 0, snapshot }),
      session.requestSegment({ requestId: 'a1', sessionId: 's', generation: 0, track: 'audio', kind: 'init', formatKey: '251:', range: { start: 24, end: 47 }, startTimeMs: 0, snapshot }),
    ])
    expect(vi.mocked(egressFetch)).toHaveBeenCalledTimes(1)
    expect(vInit.end ? 0 : vInit.data.byteLength).toBe(32)
    expect(vIdx.end ? 0 : vIdx.data.byteLength).toBe(32)
    expect(aInit.end ? 0 : aInit.data.byteLength).toBe(24)
    expect(aIdx.end ? 0 : aIdx.data.byteLength).toBe(24)
    session.close()
  })

  it('caps portrait videos by their short side rather than downgrading to 144p', () => {
    const portraitSource: SabrSource = {
      videoId: 'portrait',
      isLive: false,
      durationMs: 60_000,
      manifest: '<MPD/>',
      streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1',
      ustreamerConfig: 'AA==',
      formats: [
        { itag: 394, lastModified: '1', width: 144, height: 256, mimeType: 'video/mp4; codecs="av01.0.00M.08"', bitrate: 60_000, approxDurationMs: 60_000 },
        { itag: 396, lastModified: '1', width: 360, height: 640, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, approxDurationMs: 60_000 },
        { itag: 398, lastModified: '1', width: 720, height: 1_280, mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 800_000, approxDurationMs: 60_000 },
        { itag: 251, lastModified: '1', mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, approxDurationMs: 60_000 },
      ],
      playbackFormats: [
        { key: '394:', itag: 394, mimeType: 'video/mp4; codecs="av01.0.00M.08"', bitrate: 60_000, width: 144, height: 256 },
        { key: '396:', itag: 396, mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, width: 360, height: 640 },
        { key: '398:', itag: 398, mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 800_000, width: 720, height: 1_280 },
        { key: '251:', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000 },
      ],
      storyboards: [],
      captions: [],
      translations: [],
      endScreen: [],
      clientInfo: { clientName: 1, clientVersion: '2.20261008.00.00' },
      mint: async () => 'AAAA',
      recoverMint: vi.fn(async () => {}),
    }
    const session = createSabrSession(portraitSource, 360)
    expect(session.videoFormat.key).toBe('396:')
    session.close()
  })
})
