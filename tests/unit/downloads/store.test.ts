import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { codecLabel } from '../../../src/frame/formats'

const loadStore = async () => {
  vi.resetModules()
  vi.doMock('../../../src/engine/client', () => ({ startEngine: vi.fn() }))
  vi.doMock('../../../src/components/ui/toast', () => ({ showToast: vi.fn() }))
  return await import('../../../src/downloads/store')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('download formatting and filename helpers', () => {
  it('sanitizes reserved filesystem characters and falls back cleanly', async () => {
    const { sanitizeFilename } = await loadStore()
    expect(sanitizeFilename('Rick Astley: Never / Gonna * Give <You> Up?', 'mp4'))
      .toBe('Rick Astley Never Gonna Give You Up.mp4')
    expect(sanitizeFilename('   ...   ', '.m4a')).toBe('video.m4a')
    expect(sanitizeFilename('a'.repeat(160), 'webm').length).toBeLessThanOrEqual(125)
  })

  it('formats bytes and codec labels cleanly', async () => {
    const { formatBytes } = await loadStore()
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(codecLabel('video/mp4; codecs="avc1.640028"')).toBe('H.264')
    expect(codecLabel('video/mp4; codecs="av01.0.08M.08"')).toBe('AV1')
    expect(codecLabel('audio/mp4; codecs="mp4a.40.2"')).toBe('AAC')
    expect(codecLabel('audio/webm; codecs="opus"')).toBe('Opus')
  })

  it('prefers AAC over multichannel Dolby MP4 tracks for default video audio', async () => {
    const { pickDefaultAudioForVideo } = await loadStore()
    const picked = pickDefaultAudioForVideo([
      {
        key: '328:',
        itag: 328,
        kind: 'audio',
        container: 'm4a',
        mimeType: 'audio/mp4; codecs="ec-3"',
        codec: 'ec-3',
        qualityLabel: '384 kbps',
        bitrate: 384_000,
        audioTrackId: 'en.4',
        isOriginal: true,
      },
      {
        key: '140:',
        itag: 140,
        kind: 'audio',
        container: 'm4a',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        codec: 'AAC',
        qualityLabel: '128 kbps',
        bitrate: 128_000,
        audioTrackId: 'en.4',
        isOriginal: true,
      },
      {
        key: '251:',
        itag: 251,
        kind: 'audio',
        container: 'webm',
        mimeType: 'audio/webm; codecs="opus"',
        codec: 'Opus',
        qualityLabel: '130 kbps',
        bitrate: 130_000,
        audioTrackId: 'en.4',
        isOriginal: true,
      },
    ], 'en.4')
    expect(picked?.key).toBe('140:')
  })
})

describe('download store history and flow', () => {
  it('round-trips completed items in storage while stripping blob URLs', async () => {
    const { DOWNLOADS_STORAGE_KEY, readDownloadHistory, writeDownloadHistory } = await loadStore()
    const map = new Map<string, string>()
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    }
    writeDownloadHistory([
      {
        id: 'dl-1',
        videoId: 'v1',
        title: 'Clip',
        mode: 'audio',
        container: 'm4a',
        qualityLabel: 'M4A 128 kbps',
        filename: 'Clip.m4a',
        status: 'completed',
        loadedBytes: 1000,
        sizeBytes: 1000,
        createdAt: 1,
        blobUrl: 'blob:ephemeral',
      },
      {
        id: 'dl-active',
        videoId: 'v2',
        title: 'Still Downloading',
        mode: 'audio',
        container: 'm4a',
        qualityLabel: 'M4A 128 kbps',
        filename: 'Still Downloading.m4a',
        status: 'downloading',
        loadedBytes: 200,
        createdAt: 2,
      },
    ], storage)

    const loaded = readDownloadHistory(storage)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ id: 'dl-1', status: 'completed', blobUrl: undefined })
    expect(map.get(DOWNLOADS_STORAGE_KEY)).not.toContain('blob:ephemeral')
  })

  it('tracks audio download progress, triggers save, and supports removal and clear', async () => {
    const {
      clearCompletedDownloads,
      getDownloads,
      removeDownload,
      startVideoDownload,
    } = await loadStore()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-audio')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const saved: { url: string, filename: string }[] = []
    const notified: string[] = []
    let pollCount = 0

    const result = await startVideoDownload({
      target: { videoId: 'vid-a', title: 'Track: One' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A 128 kbps',
      container: 'm4a',
      estimatedBytes: 10,
    }, {
      engine: async () => ({
        startDownload: async () => ({
          downloadId: 'sess-1',
          estimatedBytes: 10,
          container: 'm4a',
          mimeType: 'audio/mp4',
        }),
        pollDownload: async () => {
          pollCount += 1
          if (pollCount === 1) {
            return {
              videoChunks: [],
              audioChunks: [Uint8Array.from([1, 2, 3, 4]).buffer],
              loadedBytes: 4,
              totalBytes: 10,
              done: false,
            }
          }
          return {
            videoChunks: [],
            audioChunks: [Uint8Array.from([5, 6, 7, 8, 9, 10]).buffer],
            loadedBytes: 10,
            totalBytes: 10,
            done: true,
          }
        },
        cancelDownload: async () => {},
      }),
      notify: (msg) => notified.push(msg),
      saveFile: (url, filename) => saved.push({ url, filename }),
    })

    expect(result.status).toBe('completed')
    expect(result.sizeBytes).toBe(10)
    expect(saved).toEqual([{ url: 'blob:test-audio', filename: 'Track One.m4a' }])
    expect(notified).toEqual(['Saved Track One.m4a'])
    expect(getDownloads()).toHaveLength(1)

    removeDownload(result.id)
    expect(revokeUrl).toHaveBeenCalledWith('blob:test-audio')
    expect(getDownloads()).toHaveLength(0)

    const second = await startVideoDownload({
      target: { videoId: 'vid-b', title: 'Track: Two' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A 128 kbps',
      container: 'm4a',
    }, {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess-2', container: 'm4a', mimeType: 'audio/mp4' }),
        pollDownload: async () => ({
          videoChunks: [],
          audioChunks: [Uint8Array.from([1, 2]).buffer],
          loadedBytes: 2,
          done: true,
        }),
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: () => {},
    })
    expect(second.status).toBe('completed')
    clearCompletedDownloads()
    expect(getDownloads()).toHaveLength(0)
  })

  it('does not save when cancelled during muxing', async () => {
    const { cancelDownload, getDownloads, startVideoDownload } = await loadStore()
    const saved: string[] = []
    let sawMuxingStatus: string | undefined

    const result = await startVideoDownload({
      target: { videoId: 'vid-m', title: 'Mux Cancel' },
      mode: 'video',
      videoKey: '137',
      audioKey: '140',
      qualityLabel: '1080p',
      container: 'mp4',
    }, {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess-m', container: 'mp4', mimeType: 'video/mp4' }),
        pollDownload: async () => {
          setTimeout(() => {
            const current = getDownloads()[0]
            sawMuxingStatus = current?.status
            if (current) void cancelDownload(current.id)
          }, 0)
          return {
            videoChunks: [Uint8Array.from([1]).buffer],
            audioChunks: [Uint8Array.from([2]).buffer],
            loadedBytes: 2,
            done: true,
          }
        },
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: (url) => saved.push(url),
    })

    expect(sawMuxingStatus).toBe('muxing')
    expect(result.status).toBe('cancelled')
    expect(saved).toEqual([])
  })

  it('returns a safe cancelled snapshot if removed mid-flight', async () => {
    const { getDownloads, removeDownload, startVideoDownload } = await loadStore()
    const result = await startVideoDownload({
      target: { videoId: 'vid-rm', title: 'Remove Active' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A',
      container: 'm4a',
    }, {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess-rm', container: 'm4a', mimeType: 'audio/mp4' }),
        pollDownload: async () => {
          const active = getDownloads()[0]
          if (active) removeDownload(active.id)
          return {
            videoChunks: [],
            audioChunks: [Uint8Array.from([1, 2]).buffer],
            loadedBytes: 2,
            done: true,
          }
        },
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: () => {},
    })

    expect(result.status).toBe('cancelled')
    expect(getDownloads()).toHaveLength(0)
  })

  it('evicts and revokes oldest cached Blob URLs past the memory cap and past history limit', async () => {
    const { getDownloads, MAX_CACHED_BLOB_BYTES, startVideoDownload } = await loadStore()
    let seq = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:item-${++seq}`)
    const revoked: string[] = []
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url))

    const fakeBytes = Math.ceil(MAX_CACHED_BLOB_BYTES * 0.6)
    vi.stubGlobal('Blob', class FakeLargeBlob {
      size = fakeBytes
    })
    const deps = {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess', container: 'm4a' as const, mimeType: 'audio/mp4' }),
        pollDownload: async () => ({
          videoChunks: [],
          audioChunks: [Uint8Array.from([1]).buffer],
          loadedBytes: 1,
          done: true,
        }),
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: () => {},
    }
    const input = {
      target: { videoId: 'v', title: 'Large' },
      mode: 'audio' as const,
      audioKey: '140',
      qualityLabel: 'M4A',
      container: 'm4a' as const,
    }
    await startVideoDownload(input, deps)
    await startVideoDownload(input, deps)
    expect(revoked).toContain('blob:item-1')
    expect(getDownloads()[1]!.blobUrl).toBeUndefined()
    expect(getDownloads()[0]!.blobUrl).toBe('blob:item-2')

    const fresh = await loadStore()
    seq = 0
    revoked.length = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:hist-${++seq}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url))
    for (let index = 0; index < 101; index += 1) {
      await fresh.startVideoDownload(input, deps)
    }
    expect(fresh.getDownloads()).toHaveLength(100)
    expect(revoked).toContain('blob:hist-1')
  })

  it('exposes shared progress helpers and session-scoped floating tray state', async () => {
    const map = new Map<string, string>()
    const persisted = [
      {
        id: 'dl-old',
        videoId: 'v-old',
        title: 'Persisted Item',
        mode: 'audio' as const,
        container: 'm4a' as const,
        qualityLabel: 'M4A 128 kbps',
        filename: 'Persisted Item.m4a',
        status: 'completed' as const,
        loadedBytes: 500,
        sizeBytes: 500,
        createdAt: 1,
      },
    ]
    map.set('yt-client:downloads', JSON.stringify(persisted))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    })

    const {
      dismissDownloadFromTray,
      dismissFinishedFromTray,
      downloadPercent,
      downloadStatusLabel,
      getDownloadTray,
      getDownloads,
      isDownloadActive,
      startVideoDownload,
    } = await loadStore()

    expect(isDownloadActive({ status: 'starting' })).toBe(true)
    expect(isDownloadActive({ status: 'downloading' })).toBe(true)
    expect(isDownloadActive({ status: 'muxing' })).toBe(true)
    expect(isDownloadActive({ status: 'completed' })).toBe(false)
    expect(downloadPercent({ loadedBytes: 50, totalBytes: 200 })).toBe(25)
    expect(downloadPercent({ loadedBytes: 300, totalBytes: 200 })).toBe(100)
    expect(downloadPercent({ loadedBytes: 50, totalBytes: undefined })).toBeUndefined()
    expect(downloadStatusLabel('muxing')).toBe('Muxing MP4…')

    expect(getDownloads()).toHaveLength(1)
    expect(getDownloadTray()).toEqual({ items: [], active: [], startedSeq: 0 })

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tray-item')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const result = await startVideoDownload({
      target: { videoId: 'vid-tray', title: 'Tray Video' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A 128 kbps',
      container: 'm4a',
      estimatedBytes: 4,
    }, {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess-tray', container: 'm4a', mimeType: 'audio/mp4' }),
        pollDownload: async () => ({
          videoChunks: [],
          audioChunks: [Uint8Array.from([1, 2, 3, 4]).buffer],
          loadedBytes: 4,
          totalBytes: 4,
          done: true,
        }),
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: () => {},
    })

    expect(getDownloadTray()).toMatchObject({
      startedSeq: 1,
      active: [],
      items: [{ id: result.id, status: 'completed' }],
    })

    dismissDownloadFromTray(result.id)
    expect(getDownloadTray().items).toHaveLength(0)
    expect(getDownloads().some((entry) => entry.id === result.id)).toBe(true)

    const second = await startVideoDownload({
      target: { videoId: 'vid-tray-2', title: 'Tray Video Two' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A 128 kbps',
      container: 'm4a',
    }, {
      engine: async () => ({
        startDownload: async () => ({ downloadId: 'sess-tray-2', container: 'm4a', mimeType: 'audio/mp4' }),
        pollDownload: async () => ({
          videoChunks: [],
          audioChunks: [Uint8Array.from([1, 2]).buffer],
          loadedBytes: 2,
          done: true,
        }),
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: () => {},
    })
    expect(getDownloadTray()).toMatchObject({ startedSeq: 2, items: [{ id: second.id }] })
    dismissFinishedFromTray()
    expect(getDownloadTray().items).toHaveLength(0)
    expect(getDownloads().some((entry) => entry.id === second.id)).toBe(true)
  })

  it('includes crop bounds in filename, startDownload payload, and DownloadItem clipLabel', async () => {
    const { sanitizeFilename, startVideoDownload } = await loadStore()
    expect(sanitizeFilename('Zoo Visit', 'mp4', { startMs: 4_000, endMs: 12_000 })).toBe('Zoo Visit (0m04s-0m12s).mp4')

    const u32 = (value: number) => {
      const b = new Uint8Array(4)
      new DataView(b.buffer).setUint32(0, value >>> 0)
      return b
    }
    const fourcc = (tag: string) => Uint8Array.from([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)])
    const concat = (parts: readonly Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0))
      let o = 0
      for (const p of parts) { out.set(p, o); o += p.byteLength }
      return out
    }
    const mp4Box = (type: string, ...payloads: Uint8Array[]) => {
      const body = concat(payloads)
      const h = new Uint8Array(8)
      new DataView(h.buffer).setUint32(0, 8 + body.byteLength)
      h.set(fourcc(type), 4)
      return concat([h, body])
    }
    const mvhd = new Uint8Array(100); new DataView(mvhd.buffer).setUint32(12, 1000); new DataView(mvhd.buffer).setUint32(16, 15_000); new DataView(mvhd.buffer).setUint32(96, 2)
    const tkhd = new Uint8Array(84); tkhd[3] = 3; new DataView(tkhd.buffer).setUint32(12, 1); new DataView(tkhd.buffer).setUint32(20, 15_000); new DataView(tkhd.buffer).setUint16(36, 0x0100)
    const mdhd = new Uint8Array(24); new DataView(mdhd.buffer).setUint32(12, 1000); new DataView(mdhd.buffer).setUint32(16, 15_000)
    const hdlr = new Uint8Array(24); hdlr.set(fourcc('soun'), 8)
    const stsdEntry = new Uint8Array(24); new DataView(stsdEntry.buffer).setUint32(0, 24); stsdEntry.set(fourcc('mp4a'), 4)
    const stsdHdr = new Uint8Array(8); new DataView(stsdHdr.buffer).setUint32(4, 1)
    const trex = new Uint8Array(24); new DataView(trex.buffer).setUint32(4, 1); new DataView(trex.buffer).setUint32(8, 1); new DataView(trex.buffer).setUint32(12, 1000)
    const moov = mp4Box('moov', mp4Box('mvhd', mvhd), mp4Box('trak', mp4Box('tkhd', tkhd), mp4Box('mdia', mp4Box('mdhd', mdhd), mp4Box('hdlr', hdlr), mp4Box('minf', mp4Box('smhd', new Uint8Array(8)), mp4Box('dinf', mp4Box('dref', new Uint8Array(8))), mp4Box('stbl', mp4Box('stsd', stsdHdr, stsdEntry))))), mp4Box('mvex', mp4Box('trex', trex)))
    const mfhd = new Uint8Array(8); new DataView(mfhd.buffer).setUint32(4, 1)
    const tfhd = new Uint8Array(12); new DataView(tfhd.buffer).setUint32(0, 0x020002); new DataView(tfhd.buffer).setUint32(4, 1); new DataView(tfhd.buffer).setUint32(8, 1)
    const tfdt = new Uint8Array(8); new DataView(tfdt.buffer).setUint32(4, 0)
    const sampleCount = 15
    const trun = new Uint8Array(12 + sampleCount * 4); new DataView(trun.buffer).setUint32(0, 0x000201); new DataView(trun.buffer).setUint32(4, sampleCount)
    for (let i = 0; i < sampleCount; i += 1) new DataView(trun.buffer).setUint32(12 + i * 4, 4)
    const traf = mp4Box('traf', mp4Box('tfhd', tfhd), mp4Box('tfdt', tfdt), mp4Box('trun', trun))
    const moofNoDataOff = mp4Box('moof', mp4Box('mfhd', mfhd), traf)
    const moofStartToMdatData = moofNoDataOff.byteLength + 8
    const trunOffset = 8 + (8 + 8 + tfhd.byteLength) + (8 + 8 + tfdt.byteLength) + 8
    new DataView(moofNoDataOff.buffer).setInt32(trunOffset + 16, moofStartToMdatData)
    const fmp4 = concat([mp4Box('ftyp', fourcc('iso6')), moov, moofNoDataOff, mp4Box('mdat', new Uint8Array(sampleCount * 4).fill(7))])

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cropped-audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const startArgs: unknown[] = []
    const saved: { url: string, filename: string }[] = []

    const item = await startVideoDownload({
      target: { videoId: 'vid-crop', title: 'Zoo Visit' },
      mode: 'audio',
      audioKey: '140',
      qualityLabel: 'M4A 128 kbps',
      container: 'm4a',
      durationMs: 19_000,
      trim: { startMs: 4_000, endMs: 12_000 },
    }, {
      engine: async () => ({
        startDownload: async (opts) => {
          startArgs.push(opts)
          return { downloadId: 'sess-crop', container: 'm4a', mimeType: 'audio/mp4' }
        },
        pollDownload: async () => ({
          videoChunks: [],
          audioChunks: [fmp4.slice().buffer],
          loadedBytes: fmp4.byteLength,
          done: true,
        }),
        cancelDownload: async () => {},
      }),
      notify: () => {},
      saveFile: (url, filename) => saved.push({ url, filename }),
    })

    expect(startArgs[0]).toMatchObject({ videoId: 'vid-crop', startMs: 4_000, endMs: 12_000 })
    expect(item.status).toBe('completed')
    expect(item.clipLabel).toBe('0:04 - 0:12')
    expect(item.filename).toBe('Zoo Visit (0m04s-0m12s).m4a')
    expect(saved).toEqual([{ url: 'blob:cropped-audio', filename: 'Zoo Visit (0m04s-0m12s).m4a' }])
    expect(u32(0)).toHaveLength(4)
  })
})
