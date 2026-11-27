import { useEffect, useState } from 'preact/hooks'

export const DISMISSED_NOTIFICATIONS_KEY = 'yt-client:dismissed-notifications'

export const DISMISSED_NOTIFICATIONS_MAX = 500

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedIds: string[] = []
let cachedSet = new Set<string>()

const emit = () => {
  for (const listener of Array.from(listeners)) listener()
}

const readRaw = (): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY)
  } catch {
    return null
  }
}

const sanitize = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const next: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next.slice(-DISMISSED_NOTIFICATIONS_MAX)
}

const writeIds = (ids: string[]) => {
  const capped = ids.slice(-DISMISSED_NOTIFICATIONS_MAX)
  cachedIds = capped
  cachedSet = new Set(capped)
  try {
    if (typeof localStorage !== 'undefined') {
      if (capped.length === 0) {
        localStorage.removeItem(DISMISSED_NOTIFICATIONS_KEY)
        cachedRaw = null
      } else {
        const serialized = JSON.stringify(capped)
        localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, serialized)
        cachedRaw = serialized
      }
    } else {
      cachedRaw = capped.length === 0 ? null : JSON.stringify(capped)
    }
  } catch {}
  emit()
}

const readIds = (): string[] => {
  const raw = readRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    if (!raw) {
      cachedIds = []
      cachedSet = new Set()
    } else {
      try {
        cachedIds = sanitize(JSON.parse(raw))
        cachedSet = new Set(cachedIds)
      } catch {
        cachedIds = []
        cachedSet = new Set()
      }
    }
  }
  return cachedIds
}

export const readDismissedNotifications = (): Set<string> => {
  readIds()
  return cachedSet
}

export const isNotificationDismissed = (id: string): boolean => readDismissedNotifications().has(id)

export const dismissNotificationIds = (ids: readonly string[]) => {
  const incoming = sanitize(ids)
  if (incoming.length === 0) return
  const existing = readIds()
  const incomingSet = new Set(incoming)
  const merged = [...existing.filter(id => !incomingSet.has(id)), ...incoming]
  writeIds(merged)
}

export const clearDismissedNotifications = () => {
  cachedRaw = null
  cachedIds = []
  cachedSet = new Set()
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DISMISSED_NOTIFICATIONS_KEY)
  } catch {}
  emit()
}

export const useDismissedNotifications = (): Set<string> => {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedNotifications())

  useEffect(() => {
    const sync = () => setDismissed(new Set(readDismissedNotifications()))
    listeners.add(sync)
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])

  return dismissed
}
