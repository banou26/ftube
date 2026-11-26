import { useEffect, useState } from 'preact/hooks'

/** Entry stored in the session playback queue. */
export type QueueEntry = {
  id: string
  title: string
  thumbnail?: string | null
  durationSeconds?: number | null
  channel?: { id: string, name: string } | null
}

/** Snapshot of the session playback queue. */
export type QueueState = {
  items: QueueEntry[]
  currentIndex: number
  resumeIndex: number
}

const listeners = new Set<(state: QueueState) => void>()

let state: QueueState = { items: [], currentIndex: -1, resumeIndex: 0 }

const publish = (next: QueueState) => {
  state = next
  for (const listener of listeners) listener(state)
}

/** Returns the current session queue snapshot. */
export const getQueue = () => state

/** Returns the queue index that should play next, or undefined at the end. */
export const nextInQueueIndex = (currentState: QueueState = state): number | undefined => {
  if (currentState.items.length === 0) return undefined
  if (currentState.currentIndex >= 0) {
    return currentState.currentIndex + 1 < currentState.items.length ? currentState.currentIndex + 1 : undefined
  }
  return currentState.resumeIndex >= 0 && currentState.resumeIndex < currentState.items.length
    ? currentState.resumeIndex
    : undefined
}

/** Returns the queue index before the current or resume position, if one exists. */
export const previousInQueueIndex = (currentState: QueueState = state): number | undefined => {
  if (currentState.items.length === 0) return undefined
  if (currentState.currentIndex > 0) return currentState.currentIndex - 1
  if (currentState.currentIndex === -1 && currentState.resumeIndex > 0) {
    return Math.min(currentState.resumeIndex - 1, currentState.items.length - 1)
  }
  return undefined
}

/** Adds a video to the tail of the playback queue if not already queued. */
export const appendQueueEntry = (entry: QueueEntry): boolean => {
  if (state.items.some(item => item.id === entry.id)) return false
  publish({ ...state, items: [...state.items, entry] })
  return true
}

/** Removes the entry at `index` while preserving the next playback position. */
export const removeFromQueue = (index: number) => {
  if (index < 0 || index >= state.items.length) return
  const items = state.items.filter((_, candidate) => candidate !== index)
  if (items.length === 0) {
    publish({ items: [], currentIndex: -1, resumeIndex: 0 })
    return
  }
  if (index === state.currentIndex) {
    publish({ items, currentIndex: -1, resumeIndex: Math.min(index, items.length) })
    return
  }
  const currentIndex = state.currentIndex > index ? state.currentIndex - 1 : state.currentIndex
  const resumeIndex = currentIndex >= 0
    ? currentIndex + 1
    : state.resumeIndex > index
    ? state.resumeIndex - 1
    : Math.min(state.resumeIndex, items.length)
  publish({ items, currentIndex, resumeIndex })
}

const shiftIndex = (pos: number, from: number, to: number) => {
  if (pos === from) return to
  if (from < pos && to >= pos) return pos - 1
  if (from > pos && to <= pos) return pos + 1
  return pos
}

/** Moves an entry from `from` to `to` while tracking the active index. */
export const moveInQueue = (from: number, to: number) => {
  if (from === to || from < 0 || to < 0 || from >= state.items.length || to >= state.items.length) return
  const items = [...state.items]
  const [moved] = items.splice(from, 1)
  if (!moved) return
  items.splice(to, 0, moved)
  if (state.currentIndex >= 0) {
    const currentIndex = shiftIndex(state.currentIndex, from, to)
    publish({ items, currentIndex, resumeIndex: currentIndex + 1 })
    return
  }
  publish({ items, currentIndex: -1, resumeIndex: state.resumeIndex })
}

/** Marks which entry in the queue is currently playing, if any. */
export const setQueueIndex = (index: number) => {
  if (index < -1 || index >= state.items.length) return
  const resumeIndex = index >= 0 ? index + 1 : 0
  if (index === state.currentIndex && resumeIndex === state.resumeIndex) return
  publish({ ...state, currentIndex: index, resumeIndex })
}

/** Syncs `currentIndex` with the currently playing video, clearing active highlight on unrelated videos. */
export const syncQueueVideo = (videoId: string | undefined) => {
  if (state.items.length === 0) return
  const match = videoId ? state.items.findIndex(item => item.id === videoId) : -1
  if (match !== -1) {
    if (match !== state.currentIndex || state.resumeIndex !== match + 1) {
      publish({ ...state, currentIndex: match, resumeIndex: match + 1 })
    }
    return
  }
  if (state.currentIndex !== -1) publish({ ...state, currentIndex: -1 })
}

/** Empties the session playback queue. */
export const clearQueue = () => {
  if (state.items.length === 0 && state.currentIndex === -1 && state.resumeIndex === 0) return
  publish({ items: [], currentIndex: -1, resumeIndex: 0 })
}

/** Removes an entry matching `id` from the queue if present. */
export const removeFromQueueById = (id: string) => {
  const index = state.items.findIndex(item => item.id === id)
  if (index !== -1) removeFromQueue(index)
}

/** Inserts `entry` back into the queue at `index`, shifting active indices while skipping duplicates. */
export const insertQueueEntry = (entry: QueueEntry, index: number, wasCurrent = false) => {
  if (state.items.some(item => item.id === entry.id)) return
  const at = Math.max(0, Math.min(index, state.items.length))
  const items = [...state.items]
  items.splice(at, 0, entry)
  if (wasCurrent && state.currentIndex === -1) {
    publish({ items, currentIndex: at, resumeIndex: at + 1 })
    return
  }
  const currentIndex = state.currentIndex >= at ? state.currentIndex + 1 : state.currentIndex
  const resumeIndex = currentIndex >= 0
    ? currentIndex + 1
    : state.resumeIndex >= at
    ? state.resumeIndex + 1
    : state.resumeIndex
  publish({ items, currentIndex, resumeIndex })
}

/** Restores a previously captured playback queue snapshot, preserving any newer queued items. */
export const restoreQueue = (snapshot: QueueState) => {
  if (state.items.length === 0) {
    publish({
      items: [...snapshot.items],
      currentIndex: snapshot.currentIndex,
      resumeIndex: snapshot.resumeIndex,
    })
    return
  }
  const existingIds = new Set(state.items.map(item => item.id))
  const prepended = snapshot.items.filter(item => !existingIds.has(item.id))
  if (prepended.length === 0) return
  const items = [...prepended, ...state.items]
  const currentIndex = state.currentIndex >= 0 ? state.currentIndex + prepended.length : -1
  const resumeIndex = currentIndex >= 0 ? currentIndex + 1 : state.resumeIndex + prepended.length
  publish({ items, currentIndex, resumeIndex })
}

/** Subscribes a component to the session playback queue. */
export const useQueue = () => {
  const [value, setValue] = useState(state)
  useEffect(() => {
    const listener = (next: QueueState) => setValue(next)
    listeners.add(listener)
    listener(state)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}
