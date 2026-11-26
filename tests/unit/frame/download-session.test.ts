import { FormatKeyUtils } from 'googlevideo/utils'
import { describe, expect, it, vi } from 'vite-plus/test'

import { MAX_DOWNLOAD_BYTES, MAX_DOWNLOAD_ERROR } from '../../../src/downloads/bytes'

const getSabrSource = vi.fn()

vi.mock('../../../src/frame/innertube', () => ({ getSabrSource }))
vi.mock('../../../src/frame/egress', () => ({ egressFetch: vi.fn() }))

const { startDownloadSession } = await import('../../../src/frame/download')

describe('startDownloadSession', () => {
  it('rejects requests exceeding MAX_DOWNLOAD_BYTES before minting PoTokens or fetching segments', async () => {
    const mint = vi.fn(async () => 'po-token')
    const videoFormat = {
      itag: 137,
      lastModified: '1',
      mimeType: 'video/mp4; codecs="avc1.640028"',
      width: 1920,
      height: 1080,
      bitrate: 16_000_000,
      contentLength: MAX_DOWNLOAD_BYTES + 1,
      approxDurationMs: 600_000,
    }
    const audioFormat = {
      itag: 140,
      lastModified: '1',
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 128_000,
      contentLength: 10_000_000,
      approxDurationMs: 600_000,
    }
    getSabrSource.mockResolvedValueOnce({
      isLive: false,
      durationMs: 600_000,
      formats: [videoFormat, audioFormat],
      mint,
      recoverMint: vi.fn(async () => {}),
    })

    await expect(startDownloadSession({
      videoId: 'vid-too-large',
      mode: 'video',
      videoKey: FormatKeyUtils.fromFormat(videoFormat as never)!,
      audioKey: FormatKeyUtils.fromFormat(audioFormat as never)!,
    })).rejects.toThrow(MAX_DOWNLOAD_ERROR)
    expect(mint).not.toHaveBeenCalled()
  })
})
