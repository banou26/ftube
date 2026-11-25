import { useEffect, useState } from 'preact/hooks'

import type { FrameApi } from '../frame/protocol'

import { startEngine } from '../engine/client'
import { showToast } from '../components/ui/toast'
import { muxMp4 } from './mp4-muxer'

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

/** Sanitizes a video title into a filesystem-safe download filename with extension `ext`. */
export const sanitizeFilename = (title: string, ext: string): string => {
  // Replace C0 control characters without splitting UTF-16 surrogate pairs.
  // oxlint-disable-next-line no-control-regex
  const withoutControls = title.replace(/[\u0000-\u001f]/g, ' ')
  const cleaned = withoutControls
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const base = (cleaned || 'video').slice(0, 120).trim()
  const extension = ext.replace(/^\.+/, '').trim() || 'bin'
  return `${base}.${extension}`
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

let items: DownloadItem[] = readDownloadHistory()
let dialogTarget: DownloadTarget | undefined
let nextSeq = 0

const itemListeners = new Set<(value: DownloadItem[]) => void>()
const dialogListeners = new Set<(target: DownloadTarget | undefined) => void>()
const remoteIds = new Map<string, string>()
const cancelledIds = new Set<string>()
const blobUrls = new Map<string, string>()
const blobSizes = new Map<string, number>()
const blobRevokeTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  for (const dropped of next.slice(MAX_HISTORY)) revokeBlob(dropped.id)
  items = next.slice(0, MAX_HISTORY)
  if (persist) writeDownloadHistory(items)
  for (const listener of itemListeners) listener(items)
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
  revokeBlob(id)
  publishItems(items.filter((entry) => entry.id !== id), true)
}

/** Clears finished (`completed`, `failed`, `cancelled`) entries from download history. */
export const clearCompletedDownloads = () => {
  const kept: DownloadItem[] = []
  for (const item of items) {
    if (FINAL_STATUSES.has(item.status)) revokeBlob(item.id)
    else kept.push(item)
  }
  publishItems(kept, true)
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
  const id = `dl-${Date.now()}-${++nextSeq}`
  const filename = sanitizeFilename(input.target.title, input.container)
  const initial: DownloadItem = {
    id,
    videoId: input.target.videoId,
    title: input.target.title,
    channelName: input.target.channelName ?? undefined,
    thumbnail: input.target.thumbnail ?? undefined,
    mode: input.mode,
    container: input.container,
    qualityLabel: input.qualityLabel,
    filename,
    status: 'starting',
    loadedBytes: 0,
    totalBytes: input.estimatedBytes,
    createdAt: Date.now(),
  }
  publishItems([initial, ...items])

  const getApi = deps.engine ?? startEngine
  const notify = deps.notify ?? ((message: string) => showToast(message))
  const saveFile = deps.saveFile ?? triggerBrowserSave

  try {
    const api = await getApi()
    if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
    const started = await api.startDownload({
      videoId: input.target.videoId,
      mode: input.mode,
      videoKey: input.videoKey,
      audioKey: input.audioKey,
    })
    remoteIds.set(id, started.downloadId)
    if (cancelledIds.has(id)) {
      void api.cancelDownload(started.downloadId).catch(() => {})
      throw new DOMException('Cancelled', 'AbortError')
    }
    const totalBytes = started.estimatedBytes ?? input.estimatedBytes
    updateItem(id, { status: 'downloading', totalBytes })

    const videoChunks: Uint8Array[] = []
    const audioChunks: Uint8Array[] = []

    for (;;) {
      if (cancelledIds.has(id)) {
        void api.cancelDownload(started.downloadId).catch(() => {})
        throw new DOMException('Cancelled', 'AbortError')
      }
      const poll = await api.pollDownload(started.downloadId)
      for (const buffer of poll.videoChunks) videoChunks.push(new Uint8Array(buffer))
      for (const buffer of poll.audioChunks) audioChunks.push(new Uint8Array(buffer))
      updateItem(id, {
        loadedBytes: poll.loadedBytes,
        totalBytes: poll.totalBytes ?? totalBytes,
      })
      if (poll.error) throw new Error(poll.error)
      if (poll.done) break
    }
    remoteIds.delete(id)

    if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')

    let parts: Uint8Array[]
    if (input.mode === 'video') {
      updateItem(id, { status: 'muxing' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
      parts = muxMp4(videoChunks, audioChunks)
      if (cancelledIds.has(id)) throw new DOMException('Cancelled', 'AbortError')
    } else {
      parts = audioChunks
    }

    const blob = new Blob(parts as BlobPart[], { type: started.mimeType })
    videoChunks.length = 0
    audioChunks.length = 0
    parts = []
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
