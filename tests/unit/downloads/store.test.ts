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
})
