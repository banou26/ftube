import { FormatKeyUtils } from 'googlevideo/utils'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('../../../src/frame/innertube', () => ({ getSabrSource: vi.fn() }))
vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))

const { selectDownloadFormats } = await import('../../../src/frame/download')

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
