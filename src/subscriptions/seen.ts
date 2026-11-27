import { useEffect, useState } from 'preact/hooks'

export const SEEN_SUBSCRIPTIONS_KEY = 'yt-client:seen-subscriptions'

export const SEEN_TTL_MS = 24 * 60 * 60 * 1000

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedEntries: Record<string, number> = {}

const emit = () => {
  for (const listener of Array.from(listeners)) listener()
}

const readRaw = (): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(SEEN_SUBSCRIPTIONS_KEY)
  } catch {
    return null
  }
}

const prune = (value: unknown, now: number): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, number> = {}
  for (const [id, seenAt] of Object.entries(value as Record<string, unknown>)) {
    if (!id || typeof seenAt !== 'number' || !Number.isFinite(seenAt)) continue
    if (seenAt <= now && now - seenAt < SEEN_TTL_MS) next[id] = seenAt
  }
  return next
}

const writeEntries = (entries: Record<string, number>) => {
  const keys = Object.keys(entries)
  cachedEntries = entries
  try {
    if (typeof localStorage !== 'undefined') {
      if (keys.length === 0) {
        localStorage.removeItem(SEEN_SUBSCRIPTIONS_KEY)
        cachedRaw = null
      } else {
        const serialized = JSON.stringify(entries)
        localStorage.setItem(SEEN_SUBSCRIPTIONS_KEY, serialized)
        cachedRaw = serialized
      }
    } else {
      cachedRaw = keys.length === 0 ? null : JSON.stringify(entries)
    }
  } catch {}
  emit()
}

const readEntries = (now = Date.now()): Record<string, number> => {
  const raw = readRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    if (!raw) {
      cachedEntries = {}
    } else {
      try {
        cachedEntries = prune(JSON.parse(raw), now)
      } catch {
        cachedEntries = {}
      }
    }
    return cachedEntries
  }
  return prune(cachedEntries, now)
}

/** Extracts a non-handle channel id from a `/channel/<id>` path, ignoring `/channel/@handle`. */
export const channelIdFromPath = (path: string): string | undefined => {
  const match = /^\/channel\/([^/?#]+)/.exec(path)
  if (!match) return undefined
  try {
    const id = decodeURIComponent(match[1]!)
    return id && !id.startsWith('@') ? id : undefined
  } catch {
    return undefined
  }
}

/** Records that a subscribed channel was opened so its new-content badge hides until YouTube drops the dot. */
export const markSubscriptionSeen = (channelId: string, now = Date.now()) => {
  const id = channelId.trim()
  if (!id) return
  const entries = readEntries(now)
  const existing = entries[id]
  if (existing !== undefined && now - existing < 1_000 && Object.keys(entries).length === Object.keys(cachedEntries).length) {
    return
  }
  writeEntries({ ...entries, [id]: now })
}

/** Removes seen entries once YouTube reports `hasNewContent === false`, so future uploads show a fresh dot. */
export const reconcileSeenSubscriptions = (
  channels: readonly { id: string, hasNewContent?: boolean | null }[],
  now = Date.now(),
) => {
  const entries = readEntries(now)
  const existingKeys = Object.keys(entries)
  if (existingKeys.length === 0) return
  const clearedIds = new Set(channels.filter(ch => ch.hasNewContent === false).map(ch => ch.id))
  let changed = existingKeys.length !== Object.keys(cachedEntries).length
  const next: Record<string, number> = {}
  for (const [id, seenAt] of Object.entries(entries)) {
    if (clearedIds.has(id)) {
      changed = true
      continue
    }
    next[id] = seenAt
  }
  if (changed) writeEntries(next)
}

/** Clears all stored subscription seen markers, used when signing out. */
export const clearSeenSubscriptions = () => {
  cachedRaw = null
  cachedEntries = {}
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SEEN_SUBSCRIPTIONS_KEY)
  } catch {}
  emit()
}

export const isSubscriptionSeen = (channelId: string, now = Date.now()): boolean =>
  channelId in readEntries(now)

const readSeenSet = () => new Set(Object.keys(readEntries()))

export const useSeenSubscriptions = (): ReadonlySet<string> => {
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeenSet)
  useEffect(() => {
    setSeen(readSeenSet())
    const sync = () => setSeen(readSeenSet())
    listeners.add(sync)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SEEN_SUBSCRIPTIONS_KEY && event.key !== null) return
      cachedRaw = undefined
      sync()
    }
    const win = typeof window !== 'undefined' ? window : undefined
    win?.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(sync)
      win?.removeEventListener('storage', onStorage)
    }
  }, [])
  return seen
}
