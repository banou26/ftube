import {
  FormatInitializationMetadata,
  MediaHeader,
  NextRequestPolicy,
  StreamProtectionStatus,
  UMPPartId,
} from 'googlevideo/protos'
import { SabrStream } from 'googlevideo/sabr-stream'
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import { concatenateChunks, EnabledTrackTypes, FormatKeyUtils } from 'googlevideo/utils'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('../../../src/frame/innertube', () => ({ getSabrSource: vi.fn() }))
vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))

const { selectDownloadFormats } = await import('../../../src/frame/download')
const { runSabrDownload } = await import('../../../src/frame/sabr-download')

describe('selectDownloadFormats', () => {
  it('filters MP4 video formats and non-DRC M4A/WebM audio formats with estimates', () => {
    const sabrFormats = [
      { itag: 137, lastModified: '1', contentLength: 25_000_000, bitrate: 2_000_000, approxDurationMs: 60_000 },
      { itag: 399, lastModified: '1', bitrate: 1_200_000, approxDurationMs: 60_000 },
      { itag: 140, lastModified: '1', xtags: 'lang=en', bitrate: 128_000, approxDurationMs: 60_000 },
    ]
    const playbackFormats = [
      { key: '248:', itag: 248, mimeType: 'video/webm; codecs="vp9"', bitrate: 1_500_000, width: 1920, height: 1080, qualityLabel: '1080p' },
      { key: FormatKeyUtils.fromFormat(sabrFormats[0] as never)!, itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 2_000_000, width: 1920, height: 1080, qualityLabel: '1080p' },
      { key: FormatKeyUtils.fromFormat(sabrFormats[1] as never)!, itag: 399, mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1_200_000, width: 1920, height: 1080, qualityLabel: '1080p' },
      { key: '134:', itag: 134, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 600_000, width: 640, height: 360, qualityLabel: '360p' },
      { key: '140-drc', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, isDrc: true, isOriginal: true },
      { key: FormatKeyUtils.fromFormat(sabrFormats[2] as never)!, itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, isOriginal: true, audioTrackId: 'en.4', audioTrackName: 'English original' },
      { key: '251:', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, isOriginal: true, audioTrackId: 'en.4', audioTrackName: 'English original' },
      { key: '140-es', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, isAutoDubbed: true, audioTrackId: 'es.4', audioTrackName: 'Spanish (auto-dubbed)' },
    ]

    const { videoFormats, audioFormats, effectiveDurationMs } = selectDownloadFormats(
      playbackFormats,
      sabrFormats as never,
      0,
    )

    expect(effectiveDurationMs).toBe(60_000)
    expect(videoFormats.map((item) => [item.qualityLabel, item.codec])).toEqual([
      ['1080p', 'H.264'],
      ['1080p', 'AV1'],
      ['360p', 'H.264'],
    ])
    expect(videoFormats[0]!.estimatedBytes).toBe(25_000_000)
    expect(videoFormats[1]!.estimatedBytes).toBe(Math.round((1_200_000 * 60_000) / 8_000))

    expect(audioFormats.map((item) => [item.key, item.container, item.codec])).toEqual([
      ['251:', 'webm', 'Opus'],
      [FormatKeyUtils.fromFormat(sabrFormats[2] as never), 'm4a', 'AAC'],
      ['140-es', 'm4a', 'AAC'],
    ])
  })
})

const writeUmpResponse = (write: (writer: UmpWriter) => void) => {
  const buf = new CompositeBuffer()
  const writer = new UmpWriter(buf)
  write(writer)
  return new Response(Uint8Array.from(concatenateChunks(buf.chunks)), {
    status: 200,
    headers: { 'content-type': 'application/vnd.yt-ump' },
  })
}

const prependHeaderId = (headerId: number, payload: Uint8Array) => {
  const out = new Uint8Array(1 + payload.byteLength)
  out[0] = headerId
  out.set(payload, 1)
  return out
}

describe('SabrStream completion guard', () => {
  it('stops AUDIO_ONLY after all active segments finish even when protection status is 2', async () => {
    const formatId = { itag: 140, lastModified: '1', xtags: '' }
    const videoFormat = { itag: 137, lastModified: '1', mimeType: 'video/mp4', width: 640, height: 360 }
    const audioFormat = { ...formatId, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }
    let fetchCount = 0

    const stream = new SabrStream({
      serverAbrStreamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      videoPlaybackUstreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' } as never,
      formats: [videoFormat as never, audioFormat as never],
      durationMs: 19_000,
      fetch: async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          const initBytes = Uint8Array.from([1, 2, 3, 4])
          const mediaBytes = Uint8Array.from([5, 6, 7, 8])
          return writeUmpResponse((writer) => {
            writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({
              formatId,
              mimeType: 'audio/mp4',
              endSegmentNumber: '1',
              durationUnits: '19000',
              durationTimescale: '1000',
            }).finish())
            writer.write(UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status: 2 }).finish())
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 0,
              formatId,
              itag: 140,
              isInitSeg: true,
              sequenceNumber: 0,
              contentLength: '4',
              durationMs: '0',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(0, initBytes))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 1,
              formatId,
              itag: 140,
              isInitSeg: false,
              sequenceNumber: 1,
              contentLength: '4',
              durationMs: '19000',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(1, mediaBytes))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))
          })
        }
        return writeUmpResponse((writer) => {
          writer.write(UMPPartId.NEXT_REQUEST_POLICY, NextRequestPolicy.encode({ backoffTimeMs: 0 }).finish())
        })
      },
    })

    const started = await stream.start({
      videoFormat: videoFormat as never,
      audioFormat: audioFormat as never,
      enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
      maxRetries: 0,
    })

    const received: number[] = []
    const reader = started.audioStream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) received.push(...value)
    }

    expect(fetchCount).toBe(1)
    expect(received).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('stops VIDEO_AND_AUDIO cleanly once both video and audio complete with status 2', async () => {
    const videoId = { itag: 137, lastModified: '1', xtags: '' }
    const audioId = { itag: 140, lastModified: '1', xtags: '' }
    const videoFormat = { ...videoId, mimeType: 'video/mp4; codecs="avc1.640028"', width: 640, height: 360 }
    const audioFormat = { ...audioId, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }
    let fetchCount = 0

    const stream = new SabrStream({
      serverAbrStreamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      videoPlaybackUstreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' } as never,
      formats: [videoFormat as never, audioFormat as never],
      durationMs: 19_000,
      fetch: async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return writeUmpResponse((writer) => {
            writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({
              formatId: videoId,
              mimeType: 'video/mp4',
              endSegmentNumber: '1',
              durationUnits: '19000',
              durationTimescale: '1000',
            }).finish())
            writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({
              formatId: audioId,
              mimeType: 'audio/mp4',
              endSegmentNumber: '1',
              durationUnits: '19000',
              durationTimescale: '1000',
            }).finish())
            writer.write(UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status: 2 }).finish())

            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 0,
              formatId: videoId,
              itag: 137,
              isInitSeg: true,
              sequenceNumber: 0,
              contentLength: '2',
              durationMs: '0',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([10, 11])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 1,
              formatId: videoId,
              itag: 137,
              isInitSeg: false,
              sequenceNumber: 1,
              contentLength: '2',
              durationMs: '19000',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(1, Uint8Array.from([12, 13])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))

            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 2,
              formatId: audioId,
              itag: 140,
              isInitSeg: true,
              sequenceNumber: 0,
              contentLength: '2',
              durationMs: '0',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(2, Uint8Array.from([20, 21])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([2]))
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 3,
              formatId: audioId,
              itag: 140,
              isInitSeg: false,
              sequenceNumber: 1,
              contentLength: '2',
              durationMs: '19000',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(3, Uint8Array.from([22, 23])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([3]))
          })
        }
        return writeUmpResponse((writer) => {
          writer.write(UMPPartId.NEXT_REQUEST_POLICY, NextRequestPolicy.encode({ backoffTimeMs: 0 }).finish())
        })
      },
    })

    const started = await stream.start({
      videoFormat: videoFormat as never,
      audioFormat: audioFormat as never,
      enabledTrackTypes: EnabledTrackTypes.VIDEO_AND_AUDIO,
      maxRetries: 0,
    })

    const drain = async (readable: ReadableStream<Uint8Array>) => {
      const out: number[] = []
      const reader = readable.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) out.push(...value)
      }
      return out
    }

    const [videoBytes, audioBytes] = await Promise.all([
      drain(started.videoStream),
      drain(started.audioStream),
    ])

    expect(fetchCount).toBe(1)
    expect(videoBytes).toEqual([10, 11, 12, 13])
    expect(audioBytes).toEqual([20, 21, 22, 23])
  })
})

describe('runSabrDownload unified VOD loop', () => {
  const audioId = { itag: 140, lastModified: '1', xtags: '' }
  const videoId = { itag: 137, lastModified: '1', xtags: '' }
  const audioFormat = { ...audioId, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }
  const videoFormat = { ...videoId, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 800_000, width: 640, height: 360 }

  it('streams cropped segments incrementally before completion and verifies non-zero start + gaps', async () => {
    const emitted: { kind: 'video' | 'audio', bytes: number[], round: number }[] = []
    let round = 0
    const abort = new AbortController()

    await runSabrDownload({
      streamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      ustreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' },
      audioFormat: audioFormat as never,
      fallbackVideoFormat: videoFormat as never,
      mode: 'audio',
      effectiveDurationMs: 25_000,
      trim: { startMs: 10_000, endMs: 18_000 },
      signal: abort.signal,
      refreshPoToken: async () => undefined,
      fetch: async () => {
        round += 1
        if (round === 1) {
          // Delivers init + seq 3 (8000..13000ms) -> must stream immediately in round 1!
          return writeUmpResponse((writer) => {
            writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({
              formatId: audioId,
              mimeType: 'audio/mp4',
              endSegmentNumber: '5',
              durationUnits: '25000',
              durationTimescale: '1000',
            }).finish())
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 0,
              formatId: audioId,
              itag: 140,
              isInitSeg: true,
              sequenceNumber: 0,
              contentLength: '2',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([1, 2])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
            writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
              headerId: 1,
              formatId: audioId,
              itag: 140,
              isInitSeg: false,
              sequenceNumber: 3,
              startMs: '8000',
              durationMs: '5000',
              contentLength: '2',
            }).finish())
            writer.write(UMPPartId.MEDIA, prependHeaderId(1, Uint8Array.from([3, 4])))
            writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))
          })
        }
        // Round 2 should already see round 1 emitted!
        expect(emitted.filter((entry) => entry.round === 1)).toHaveLength(2)
        return writeUmpResponse((writer) => {
          writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
            headerId: 2,
            formatId: audioId,
            itag: 140,
            isInitSeg: false,
            sequenceNumber: 4,
            startMs: '13000',
            durationMs: '6000',
            contentLength: '2',
          }).finish())
          writer.write(UMPPartId.MEDIA, prependHeaderId(2, Uint8Array.from([5, 6])))
          writer.write(UMPPartId.MEDIA_END, Uint8Array.from([2]))
        })
      },
      onChunk: (kind, data) => {
        emitted.push({ kind, bytes: [...data], round })
      },
    })

    expect(round).toBe(2)
    expect(emitted.map((entry) => entry.bytes)).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('rejects cropped streams with missing segment gaps, late start boundaries, or maxBytes overrun', async () => {
    await expect(runSabrDownload({
      streamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      ustreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' },
      audioFormat: audioFormat as never,
      fallbackVideoFormat: videoFormat as never,
      mode: 'audio',
      effectiveDurationMs: 25_000,
      trim: { startMs: 10_000, endMs: 18_000 },
      signal: new AbortController().signal,
      refreshPoToken: async () => undefined,
      onChunk: () => {},
      fetch: async () => writeUmpResponse((writer) => {
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 0,
          formatId: audioId,
          itag: 140,
          isInitSeg: true,
          sequenceNumber: 0,
          contentLength: '2',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([1, 2])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
        // Missing seq 4 between seq 3 and seq 5
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 1,
          formatId: audioId,
          itag: 140,
          isInitSeg: false,
          sequenceNumber: 3,
          startMs: '8000',
          durationMs: '5000',
          contentLength: '2',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(1, Uint8Array.from([3, 4])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 2,
          formatId: audioId,
          itag: 140,
          isInitSeg: false,
          sequenceNumber: 5,
          startMs: '18000',
          durationMs: '5000',
          contentLength: '2',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(2, Uint8Array.from([5, 6])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([2]))
      }),
    })).rejects.toThrow('missing segment gap')

    await expect(runSabrDownload({
      streamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      ustreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' },
      audioFormat: audioFormat as never,
      fallbackVideoFormat: videoFormat as never,
      mode: 'audio',
      effectiveDurationMs: 25_000,
      trim: { startMs: 10_000, endMs: 18_000 },
      signal: new AbortController().signal,
      refreshPoToken: async () => undefined,
      onChunk: () => {},
      fetch: async () => writeUmpResponse((writer) => {
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 0,
          formatId: audioId,
          itag: 140,
          isInitSeg: true,
          sequenceNumber: 0,
          contentLength: '2',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([1, 2])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
        // First non-1 seq starts at 11_000ms (> 10_250ms boundary)
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 1,
          formatId: audioId,
          itag: 140,
          isInitSeg: false,
          sequenceNumber: 4,
          startMs: '11000',
          durationMs: '8000',
          contentLength: '2',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(1, Uint8Array.from([3, 4])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))
      }),
    })).rejects.toThrow('missed clip start boundary')

    await expect(runSabrDownload({
      streamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      ustreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' },
      audioFormat: audioFormat as never,
      fallbackVideoFormat: videoFormat as never,
      mode: 'audio',
      effectiveDurationMs: 10_000,
      maxBytes: 3,
      signal: new AbortController().signal,
      refreshPoToken: async () => undefined,
      onChunk: () => {},
      fetch: async () => writeUmpResponse((writer) => {
        writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
          headerId: 0,
          formatId: audioId,
          itag: 140,
          isInitSeg: true,
          sequenceNumber: 0,
          contentLength: '4',
        }).finish())
        writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([1, 2, 3, 4])))
        writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
      }),
    })).rejects.toThrow('1 GB')
  })

  it('recovers PoToken on status 3 and completes full downloads cleanly', async () => {
    let fetchCount = 0
    let refreshCount = 0
    const seenTokens: string[] = []
    const chunks: number[][] = []

    await runSabrDownload({
      streamingUrl: 'https://redirector.googlevideo.com/videoplayback',
      ustreamerConfig: 'cfg',
      clientInfo: { clientName: 1, clientVersion: '2.2026' },
      audioFormat: audioFormat as never,
      fallbackVideoFormat: videoFormat as never,
      mode: 'audio',
      effectiveDurationMs: 10_000,
      initialPoToken: Buffer.from('tok-old').toString('base64'),
      signal: new AbortController().signal,
      refreshPoToken: async () => {
        refreshCount += 1
        return Buffer.from('tok-new').toString('base64')
      },
      onChunk: (_kind, data) => {
        chunks.push([...data])
      },
      fetch: async (_url, init) => {
        fetchCount += 1
        seenTokens.push(Buffer.from(init.body as Uint8Array).toString('utf8'))
        if (fetchCount === 1) {
          return writeUmpResponse((writer) => {
            writer.write(UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status: 3 }).finish())
          })
        }
        return writeUmpResponse((writer) => {
          writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({
            formatId: audioId,
            mimeType: 'audio/mp4',
            endSegmentNumber: '1',
            durationUnits: '10000',
            durationTimescale: '1000',
          }).finish())
          writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
            headerId: 0,
            formatId: audioId,
            itag: 140,
            isInitSeg: true,
            sequenceNumber: 0,
            contentLength: '2',
          }).finish())
          writer.write(UMPPartId.MEDIA, prependHeaderId(0, Uint8Array.from([7, 8])))
          writer.write(UMPPartId.MEDIA_END, Uint8Array.from([0]))
          writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
            headerId: 1,
            formatId: audioId,
            itag: 140,
            isInitSeg: false,
            sequenceNumber: 1,
            startMs: '0',
            durationMs: '10000',
            contentLength: '2',
          }).finish())
          writer.write(UMPPartId.MEDIA, prependHeaderId(1, Uint8Array.from([9, 10])))
          writer.write(UMPPartId.MEDIA_END, Uint8Array.from([1]))
        })
      },
    })

    expect(fetchCount).toBe(2)
    expect(refreshCount).toBe(1)
    expect(seenTokens[1]).toContain('tok-new')
    expect(chunks).toEqual([[7, 8], [9, 10]])
  })
})
