import { useEffect, useState } from 'preact/hooks'

import type { DownloadFormatOption, FrameApi } from '../frame/protocol'
import type { TrimRange } from './trim'

import { startEngine } from '../engine/client'
import { showToast } from '../components/ui/toast'
import { MAX_DOWNLOAD_BYTES, MAX_DOWNLOAD_ERROR } from './bytes'
import { muxInWorker } from './mux-client'
import { formatClipFilenameSuffix, formatClipLabel, normalizeTrimRange } from './trim'

/** Target video metadata passed when opening the download picker or queuing a download. */
export type DownloadTarget = {
  videoId: string
  title: string
  thumbnail?: string | null
  channelName?: string | null
}

/** One active or completed download tracked by the client download manager. */
export type DownloadItem = {
  id: string
  videoId: string
  title: string
  channelName?: string
  thumbnail?: string
  mode: 'video' | 'audio'
  container: 'mp4' | 'm4a' | 'webm'
  qualityLabel: string
  clipLabel?: string
  filename: string
  status: 'starting' | 'downloading' | 'muxing' | 'completed' | 'failed' | 'cancelled'
  loadedBytes: number
  totalBytes?: number
  sizeBytes?: number
  error?: string
  createdAt: number
  completedAt?: number
  blobUrl?: string
}

/** Arguments accepted by `startVideoDownload`. */
export type StartVideoDownloadInput = {
  target: DownloadTarget
  mode: 'video' | 'audio'
  videoKey?: string
  audioKey: string
  qualityLabel: string
  container: 'mp4' | 'm4a' | 'webm'
  estimatedBytes?: number
  durationMs?: number
  trim?: TrimRange
}

export const DOWNLOADS_STORAGE_KEY = 'yt-client:downloads'

const MAX_HISTORY = 100
const FINAL_STATUSES = new Set<DownloadItem['status']>(['completed', 'failed', 'cancelled'])

// Bounded so completed downloads do not hold gigabytes of Blob backing memory across a long session.
export const MAX_CACHED_BLOB_BYTES = 128 * 1024 * 1024
const EPHEMERAL_BLOB_REVOKE_MS = 15_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Sanitizes a video title into a filesystem-safe download filename with extension `ext` and optional clip suffix. */
export const sanitizeFilename = (title: string, ext: string, trim?: TrimRange): string => {
  // Replace C0 control characters without splitting UTF-16 surrogate pairs.
  // oxlint-disable-next-line no-control-regex
  const withoutControls = title.replace(/[\u0000-\u001f]/g, ' ')
  const cleaned = withoutControls
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const extension = ext.replace(/^\.+/, '').trim() || 'bin'
  const suffix = trim ? ` (${formatClipFilenameSuffix(trim)})` : ''
  const maxBaseLen = Math.max(16, 120 - suffix.length)
  const base = (cleaned || 'video').slice(0, maxBaseLen).trim()
  return `${base}${suffix}.${extension}`
}

/** Formats a byte count into a short human-readable string (`B`, `KB`, `MB`, `GB`). */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${Math.round(value)} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`
}

/** Reads persisted download history entries from browser storage, ignoring active or corrupt entries. */
export const readDownloadHistory = (storage: StorageLike | undefined = defaultStorage()): DownloadItem[] => {
  if (!storage) return []
  try {
    const raw = storage.getItem(DOWNLOADS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is DownloadItem => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as Partial<DownloadItem>
        return typeof candidate.id === 'string'
          && typeof candidate.videoId === 'string'
          && typeof candidate.title === 'string'
          && (candidate.mode === 'video' || candidate.mode === 'audio')
          && (candidate.container === 'mp4' || candidate.container === 'm4a' || candidate.container === 'webm')
          && typeof candidate.filename === 'string'
          && FINAL_STATUSES.has(candidate.status as DownloadItem['status'])
      })
      .slice(0, MAX_HISTORY)
      .map((entry) => ({ ...entry, blobUrl: undefined }))
  } catch {
    return []
  }
}

/** Persists completed/failed/cancelled download metadata (excluding ephemeral Blob URLs). */
export const writeDownloadHistory = (
  items: readonly DownloadItem[],
  storage: StorageLike | undefined = defaultStorage(),
) => {
  if (!storage) return
  try {
    const serializable = items
      .filter((item) => FINAL_STATUSES.has(item.status))
      .slice(0, MAX_HISTORY)
      .map(({ blobUrl: _blobUrl, ...rest }) => rest)
    storage.setItem(DOWNLOADS_STORAGE_KEY, JSON.stringify(serializable))
  } catch {}
}

/** Returns whether a download item is currently in flight (`starting`, `downloading`, or `muxing`). */
export const isDownloadActive = (item: Pick<DownloadItem, 'status'>): boolean =>
  item.status === 'starting' || item.status === 'downloading' || item.status === 'muxing'

/** Returns a whole percentage (0 to 100) for a download item when `totalBytes` is known. */
export const downloadPercent = (item: Pick<DownloadItem, 'loadedBytes' | 'totalBytes'>): number | undefined =>
  item.totalBytes && item.totalBytes > 0
    ? Math.min(100, Math.round((item.loadedBytes / item.totalBytes) * 100))
    : undefined

/** Human-readable status label shared by the Downloads page and floating progress menu. */
export const downloadStatusLabel = (status: DownloadItem['status']): string => {
  if (status === 'starting') return 'Preparing…'
  if (status === 'downloading') return 'Downloading…'
  if (status === 'muxing') return 'Muxing MP4…'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'failed') return 'Failed'
  return 'Completed'
}

/** Floating header tray snapshot containing active downloads and current-session finished items not yet dismissed. */
export type DownloadTraySnapshot = {
  items: DownloadItem[]
  active: DownloadItem[]
  startedSeq: number
}

let items: DownloadItem[] = readDownloadHistory()
let dialogTarget: DownloadTarget | undefined
let nextSeq = 0
let startedSeq = 0

const itemListeners = new Set<(value: DownloadItem[]) => void>()
const trayListeners = new Set<(snapshot: DownloadTraySnapshot) => void>()
const dialogListeners = new Set<(target: DownloadTarget | undefined) => void>()
const trayIds = new Set<string>()
const remoteIds = new Map<string, string>()
const muxAbortControllers = new Map<string, AbortController>()
const cancelledIds = new Set<string>()
const blobUrls = new Map<string, string>()
const blobSizes = new Map<string, number>()
const blobRevokeTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const getDownloadTray = (): DownloadTraySnapshot => {
  const trayItems = items.filter((item) => isDownloadActive(item) || trayIds.has(item.id))
  return {
    items: trayItems,
    active: trayItems.filter(isDownloadActive),
    startedSeq,
  }
}

const publishTray = () => {
  const snapshot = getDownloadTray()
  for (const listener of trayListeners) listener(snapshot)
}

const revokeBlob = (id: string) => {
  const timer = blobRevokeTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    blobRevokeTimers.delete(id)
  }
  blobSizes.delete(id)
  const url = blobUrls.get(id)
  if (!url) return
  blobUrls.delete(id)
  try {
    URL.revokeObjectURL(url)
  } catch {}
}

const evictOldBlobs = (keepId: string) => {
  let cachedBytes = 0
  for (const bytes of blobSizes.values()) cachedBytes += bytes
  if (cachedBytes <= MAX_CACHED_BLOB_BYTES) return
  const evicted: string[] = []
  for (const id of blobUrls.keys()) {
    if (cachedBytes <= MAX_CACHED_BLOB_BYTES) break
    if (id === keepId) continue
    cachedBytes -= blobSizes.get(id) ?? 0
    revokeBlob(id)
    evicted.push(id)
  }
  if (evicted.length > 0) {
    const evictedSet = new Set(evicted)
    items = items.map((entry) => (evictedSet.has(entry.id) ? { ...entry, blobUrl: undefined } : entry))
  }
}

const publishItems = (next: DownloadItem[], persist = false) => {
  for (const dropped of next.slice(MAX_HISTORY)) {
    trayIds.delete(dropped.id)
    revokeBlob(dropped.id)
  }
  items = next.slice(0, MAX_HISTORY)
  if (persist) writeDownloadHistory(items)
  for (const listener of itemListeners) listener(items)
  publishTray()
}

const updateItem = (id: string, patch: Partial<DownloadItem>, persist = false) => {
  publishItems(
    items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    persist,
  )
}

const triggerBrowserSave = (blobUrl: string, filename: string) => {
  if (typeof document === 'undefined') return
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export const openDownloadDialog = (target: DownloadTarget) => {
  dialogTarget = target
  for (const listener of dialogListeners) listener(dialogTarget)
}

export const closeDownloadDialog = () => {
  dialogTarget = undefined
  for (const listener of dialogListeners) listener(undefined)
}

export const useDownloadDialogTarget = (): DownloadTarget | undefined => {
  const [current, setCurrent] = useState(dialogTarget)
  useEffect(() => {
    dialogListeners.add(setCurrent)
    setCurrent(dialogTarget)
    return () => {
      dialogListeners.delete(setCurrent)
    }
  }, [])
  return current
}

export const getDownloads = (): readonly DownloadItem[] => items

export const useDownloads = (): readonly DownloadItem[] => {
  const [current, setCurrent] = useState(items)
  useEffect(() => {
    itemListeners.add(setCurrent)
    setCurrent(items)
    return () => {
      itemListeners.delete(setCurrent)
    }
  }, [])
  return current
}

/** Subscribes to active and un-dismissed session downloads for the floating header menu. */
export const useDownloadTray = (): DownloadTraySnapshot => {
  const [snapshot, setSnapshot] = useState(getDownloadTray)
  useEffect(() => {
    trayListeners.add(setSnapshot)
    setSnapshot(getDownloadTray())
    return () => {
      trayListeners.delete(setSnapshot)
    }
  }, [])
  return snapshot
}

/** Hides a finished download row from the floating header menu while keeping it on `/downloads`. */
export const dismissDownloadFromTray = (id: string) => {
  const target = items.find((entry) => entry.id === id)
  if (target && isDownloadActive(target)) return
  if (!trayIds.delete(id)) return
  publishTray()
}

/** Clears all finished rows from the floating header menu while preserving active downloads and `/downloads` history. */
export const dismissFinishedFromTray = () => {
  let changed = false
  for (const id of Array.from(trayIds)) {
    const target = items.find((entry) => entry.id === id)
    if (!target || !isDownloadActive(target)) {
      trayIds.delete(id)
      changed = true
    }
  }
  if (changed) publishTray()
}

/** Triggers a browser file save for a session-cached completed download by `id`. */
export const saveCompletedAgain = (id: string): boolean => {
  const item = items.find((entry) => entry.id === id)
  if (!item?.blobUrl) return false
  triggerBrowserSave(item.blobUrl, item.filename)
  return true
}

export const cancelDownload = async (id: string) => {
  const current = items.find((entry) => entry.id === id)
  if (!current || FINAL_STATUSES.has(current.status)) return
  cancelledIds.add(id)
  muxAbortControllers.get(id)?.abort()
  muxAbortControllers.delete(id)
  const remoteId = remoteIds.get(id)
  remoteIds.delete(id)
  updateItem(id, { status: 'cancelled' }, true)
  if (remoteId) {
    try {
      await (await startEngine()).cancelDownload(remoteId)
    } catch {}
  }
}

export const removeDownload = (id: string) => {
  const target = items.find((entry) => entry.id === id)
  if (!target) return
  if (!FINAL_STATUSES.has(target.status)) {
    void cancelDownload(id)
  }
  trayIds.delete(id)
  revokeBlob(id)
  publishItems(items.filter((entry) => entry.id !== id), true)
}

/** Clears finished (`completed`, `failed`, `cancelled`) entries from download history. */
export const clearCompletedDownloads = () => {
  const kept: DownloadItem[] = []
  for (const item of items) {
    if (FINAL_STATUSES.has(item.status)) {
      trayIds.delete(item.id)
      revokeBlob(item.id)
    } else kept.push(item)
  }
  publishItems(kept, true)
}

/** Picks the default MP4 audio format (preferring AAC over multichannel codecs) for muxed video downloads. */
export const pickDefaultAudioForVideo = (
  audioFormats: readonly DownloadFormatOption[],
  trackId: string | undefined,
): DownloadFormatOption | undefined => {
  const trackPool = trackId ? audioFormats.filter((item) => item.audioTrackId === trackId) : []
  const scope = trackPool.length > 0 ? trackPool : audioFormats
  const aac = scope.filter((item) => item.container === 'm4a' && item.codec === 'AAC')
  const mp4 = aac.length > 0 ? aac : scope.filter((item) => item.container === 'm4a')
  const pool = mp4.length > 0 ? mp4 : scope
  return pool.find((item) => item.isOriginal) ?? pool[0]
}

/** Runs a video or audio download through the engine frame and saves the finished file in the browser. */
export const startVideoDownload = async (
  input: StartVideoDownloadInput,
  deps: {
    engine?: () => Promise<Pick<FrameApi, 'startDownload' | 'pollDownload' | 'cancelDownload'>>
    notify?: (message: string) => void
    saveFile?: (blobUrl: string, filename: string) => void
  } = {},
): Promise<DownloadItem> => {
  const effectiveTrim = input.trim
    ? (input.durationMs ? normalizeTrimRange(input.trim, input.durationMs) : input.trim)
    : undefined
  const clipLabel = effectiveTrim ? formatClipLabel(effectiveTrim) : undefined
  const id = `dl-${Date.now()}-${++nextSeq}`
  const filename = sanitizeFilename(input.target.title, input.container, effectiveTrim)
  const initial: DownloadItem = {
    id,
    videoId: input.target.videoId,
    title: input.target.title,
    channelName: input.target.channelName ?? undefined,
    thumbnail: input.target.thumbnail ?? undefined,
    mode: input.mode,
    container: input.container,
    qualityLabel: input.qualityLabel,
    clipLabel,
    filename,
    status: 'starting',
    loadedBytes: 0,
    totalBytes: input.estimatedBytes,
    createdAt: Date.now(),
  }
  trayIds.add(id)
  startedSeq += 1
  publishItems([initial, ...items])

  const getApi = deps.engine ?? startEngine
  const notify = deps.notify ?? ((message: string) => showToast(message))
  const saveFile = deps.saveFile ?? triggerBrowserSave

  try {
    if (input.estimatedBytes !== undefined && input.estimatedBytes > MAX_DOWNLOAD_BYTES) {
      throw new Error(MAX_DOWNLOAD_ERROR)
    }
    const api = await getApi()
    if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
    const started = await api.startDownload({
      videoId: input.target.videoId,
      mode: input.mode,
      videoKey: input.videoKey,
      audioKey: input.audioKey,
      ...(effectiveTrim ? { startMs: effectiveTrim.startMs, endMs: effectiveTrim.endMs } : {}),
    })
    remoteIds.set(id, started.downloadId)
    if (cancelledIds.has(id)) {
      void api.cancelDownload(started.downloadId).catch(() => {})
      throw new DOMException('Cancelled', 'AbortError')
    }
    const totalBytes = started.estimatedBytes ?? input.estimatedBytes
    if (totalBytes !== undefined && totalBytes > MAX_DOWNLOAD_BYTES) {
      void api.cancelDownload(started.downloadId).catch(() => {})
      throw new Error(MAX_DOWNLOAD_ERROR)
    }
    updateItem(id, { status: 'downloading', totalBytes })

    const videoChunks: Uint8Array[] = []
    const audioChunks: Uint8Array[] = []
    let receivedBytes = 0

    for (;;) {
      if (cancelledIds.has(id)) {
        void api.cancelDownload(started.downloadId).catch(() => {})
        throw new DOMException('Cancelled', 'AbortError')
      }
      const poll = await api.pollDownload(started.downloadId)
      for (const buffer of poll.videoChunks) {
        receivedBytes += buffer.byteLength
        videoChunks.push(new Uint8Array(buffer))
      }
      for (const buffer of poll.audioChunks) {
        receivedBytes += buffer.byteLength
        audioChunks.push(new Uint8Array(buffer))
      }
      if (receivedBytes > MAX_DOWNLOAD_BYTES || poll.loadedBytes > MAX_DOWNLOAD_BYTES) {
        videoChunks.length = 0
        audioChunks.length = 0
        void api.cancelDownload(started.downloadId).catch(() => {})
        throw new Error(MAX_DOWNLOAD_ERROR)
      }
      updateItem(id, {
        loadedBytes: poll.loadedBytes,
        totalBytes: poll.totalBytes ?? totalBytes,
      })
      if (poll.error) throw new Error(poll.error)
      if (poll.done) break
    }
    remoteIds.delete(id)

    if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')

    let blob: Blob
    const needsMuxOrTrim = input.mode === 'video' || input.container === 'm4a' || Boolean(effectiveTrim)
    if (needsMuxOrTrim) {
      updateItem(id, { status: 'muxing' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
      const muxAbort = new AbortController()
      muxAbortControllers.set(id, muxAbort)
      try {
        blob = input.mode === 'video'
          ? await muxInWorker({
              kind: 'mp4',
              videoChunks,
              audioChunks,
              trim: effectiveTrim,
              mimeType: started.mimeType,
            }, muxAbort.signal)
          : input.container === 'webm'
          ? await muxInWorker({
              kind: 'webm-trim',
              audioChunks,
              trim: effectiveTrim!,
              mimeType: started.mimeType,
            }, muxAbort.signal)
          : await muxInWorker({
              kind: 'm4a',
              audioChunks,
              trim: effectiveTrim,
              mimeType: started.mimeType,
            }, muxAbort.signal)
      } finally {
        muxAbortControllers.delete(id)
      }
      if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
    } else {
      blob = new Blob(audioChunks as BlobPart[], { type: started.mimeType })
    }
    videoChunks.length = 0
    audioChunks.length = 0
    if (blob.size === 0) throw new Error('youtube: downloaded file was empty')
    const blobUrl = URL.createObjectURL(blob)
    saveFile(blobUrl, filename)
    const keepSessionBlob = blob.size <= MAX_CACHED_BLOB_BYTES
    if (keepSessionBlob) {
      blobUrls.set(id, blobUrl)
      blobSizes.set(id, blob.size)
      evictOldBlobs(id)
    } else {
      const timer = setTimeout(() => {
        blobRevokeTimers.delete(id)
        try {
          URL.revokeObjectURL(blobUrl)
        } catch {}
      }, EPHEMERAL_BLOB_REVOKE_MS)
      blobRevokeTimers.set(id, timer)
    }
    const completedAt = Date.now()
    const completedPatch: Partial<DownloadItem> = {
      status: 'completed',
      loadedBytes: blob.size,
      totalBytes: blob.size,
      sizeBytes: blob.size,
      completedAt,
      blobUrl: keepSessionBlob ? blobUrl : undefined,
    }
    updateItem(id, completedPatch, true)
    notify(`Saved ${filename}`)
    return items.find((entry) => entry.id === id) ?? { ...initial, ...completedPatch }
  } catch (error) {
    remoteIds.delete(id)
    if (cancelledIds.has(id)) {
      cancelledIds.delete(id)
      updateItem(id, { status: 'cancelled' }, true)
      return items.find((entry) => entry.id === id) ?? { ...initial, status: 'cancelled' }
    }
    const message = error instanceof Error ? error.message.replace(/^youtube:\s*/i, '') : String(error)
    updateItem(id, { status: 'failed', error: message }, true)
    notify(`Download failed: ${message}`)
    return items.find((entry) => entry.id === id) ?? { ...initial, status: 'failed', error: message }
  }
}
