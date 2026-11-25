import { useEffect, useState } from 'preact/hooks'

const STORAGE_KEY = 'yt-client:dismissed'
const MAX_ENTRIES = 500

/** Sets of dismissed video IDs and channel IDs persisted in localStorage. */
export type DismissedState = {
  videos: ReadonlySet<string>
  channels: ReadonlySet<string>
}

const EMPTY: DismissedState = { videos: new Set(), channels: new Set() }

const sanitizeList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out.slice(-MAX_ENTRIES)
}

const loadState = (): DismissedState => {
  try {
    if (typeof localStorage === 'undefined') return EMPTY
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as { videos?: unknown, channels?: unknown } | null
    if (!parsed || typeof parsed !== 'object') return EMPTY
    return {
      videos: new Set(sanitizeList(parsed.videos)),
      channels: new Set(sanitizeList(parsed.channels)),
    }
  } catch {
    return EMPTY
  }
}

const saveState = (next: DismissedState) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        videos: [...next.videos],
        channels: [...next.channels],
      }))
    }
  } catch {
    // storage unavailable (private mode or quota)
  }
}

let state: DismissedState = loadState()
const listeners = new Set<(value: DismissedState) => void>()

const publish = (next: DismissedState) => {
  state = next
  saveState(next)
  for (const listener of listeners) listener(state)
}

/** Returns the current dismissed videos and channels snapshot. */
export const getDismissed = () => state

/** Marks a video ID as dismissed ("Not interested") and persists it locally. */
export const dismissVideo = (videoId: string) => {
  if (!videoId || state.videos.has(videoId)) return
  const nextVideos = [...state.videos, videoId].slice(-MAX_ENTRIES)
  publish({ ...state, videos: new Set(nextVideos) })
}

/** Restores a previously dismissed video ID. */
export const undismissVideo = (videoId: string) => {
  if (!state.videos.has(videoId)) return
  const next = new Set(state.videos)
  next.delete(videoId)
  publish({ ...state, videos: next })
}

/** Marks a channel ID as dismissed ("Don't recommend channel") and persists it locally. */
export const dismissChannel = (channelId: string) => {
  if (!channelId || state.channels.has(channelId)) return
  const nextChannels = [...state.channels, channelId].slice(-MAX_ENTRIES)
  publish({ ...state, channels: new Set(nextChannels) })
}

/** Restores a previously dismissed channel ID. */
export const undismissChannel = (channelId: string) => {
  if (!state.channels.has(channelId)) return
  const next = new Set(state.channels)
  next.delete(channelId)
  publish({ ...state, channels: next })
}

/** Clears all locally dismissed videos and channels. */
export const clearDismissed = () => {
  if (state.videos.size === 0 && state.channels.size === 0) return
  publish({ videos: new Set(), channels: new Set() })
}

/** Returns true when either the video or its channel has been dismissed. */
export const isDismissedVideo = (
  current: DismissedState,
  video: { id: string, channel?: { id: string } | null },
) => current.videos.has(video.id) || (Boolean(video.channel?.id) && current.channels.has(video.channel!.id))

/** Subscribes a component to local recommendation dismissals. */
export const useDismissed = () => {
  const [value, setValue] = useState(state)
  useEffect(() => {
    const listener = (next: DismissedState) => setValue(next)
    listeners.add(listener)
    listener(state)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}
