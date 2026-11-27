import { useEffect, useState } from 'preact/hooks'

import { DEFAULT_EMOJI } from './store'

export const GROUP_ICONS_KEY = 'yt-client:group-icons'

export const DEFAULT_GROUP_ICONS: readonly string[] = [
  DEFAULT_EMOJI, '⭐', '🎵', '🎮', '💻', '🎬', '📚', '🍳', '⚽', '🏀', '🚗', '✈️',
  '🔬', '🎨', '📰', '💼', '😂', '🐶', '🌱', '🏋️', '🎧', '🎤', '📷', '🛠️',
]

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedList: readonly string[] = DEFAULT_GROUP_ICONS

const emit = () => {
  for (const listener of Array.from(listeners)) listener()
}

const normalize = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [...DEFAULT_GROUP_ICONS]
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique.length > 0 ? unique : [...DEFAULT_GROUP_ICONS]
}

const readRaw = (): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(GROUP_ICONS_KEY)
  } catch {
    return null
  }
}

const parseRaw = (raw: string | null): readonly string[] => {
  if (!raw) return [...DEFAULT_GROUP_ICONS]
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return [...DEFAULT_GROUP_ICONS]
  }
}

const writeIcons = (icons: readonly string[]) => {
  const next = normalize(icons)
  const serialized = JSON.stringify(next)
  cachedRaw = serialized
  cachedList = next
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(GROUP_ICONS_KEY, serialized)
  } catch {}
  emit()
  return next
}

/** Returns the persisted icon palette for the Create / Edit group dialog. */
export const getGroupIcons = (): readonly string[] => {
  const raw = readRaw()
  if (raw === cachedRaw) return cachedList
  cachedRaw = raw
  cachedList = parseRaw(raw)
  return cachedList
}

/** Adds a custom emoji to the front of the group icon list if not already present. */
export const addGroupIcon = (icon: string): readonly string[] => {
  const trimmed = icon.trim()
  const current = getGroupIcons()
  if (!trimmed || current.includes(trimmed)) return current
  return writeIcons([trimmed, ...current])
}

/** Removes an icon from the group icon list, refusing to delete the last remaining icon. */
export const removeGroupIcon = (icon: string): readonly string[] => {
  const current = getGroupIcons()
  if (current.length <= 1 || !current.includes(icon)) return current
  return writeIcons(current.filter(entry => entry !== icon))
}

/** Restores the default group icon palette and clears any custom overrides from storage. */
export const resetGroupIcons = (): readonly string[] => {
  cachedRaw = undefined
  cachedList = [...DEFAULT_GROUP_ICONS]
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(GROUP_ICONS_KEY)
  } catch {}
  emit()
  return getGroupIcons()
}

export const subscribeGroupIcons = (listener: () => void): (() => void) => {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GROUP_ICONS_KEY && event.key !== null) return
    cachedRaw = undefined
    listener()
  }
  const win = typeof window !== 'undefined' ? window : undefined
  win?.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    win?.removeEventListener('storage', onStorage)
  }
}

export const useGroupIcons = (): readonly string[] => {
  const [icons, setIcons] = useState(getGroupIcons)
  useEffect(() => {
    setIcons(getGroupIcons())
    return subscribeGroupIcons(() => setIcons(getGroupIcons()))
  }, [])
  return icons
}
