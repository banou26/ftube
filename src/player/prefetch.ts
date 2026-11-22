import { useRef } from 'preact/hooks'

import { startEngine } from '../engine/client'

// Keyed by bare `v` param (plus card `playerParams` when present), so hover/pointerDown prefetch and route prefetch share a key.
const prefetched = new Set<string>()

export const warmShaka = () => import('./shaka')

export const prefetchPlayback = (videoId: string, playerParams?: string) => {
  if (!videoId) return
  const key = playerParams ? `${videoId}\0${playerParams}` : videoId
  if (prefetched.has(key)) return
  prefetched.add(key)
  if (prefetched.size > 128) prefetched.delete(prefetched.values().next().value!)
  void warmShaka().catch(() => {})
  void startEngine().then((api) => (
    playerParams ? api.prefetchPlayback(videoId, playerParams) : api.prefetchPlayback(videoId)
  )).catch(() => {})
}

const HOVER_DWELL_MS = 140

export const usePrefetchOnIntent = (videoId: string, playerParams?: string) => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  return {
    onPointerEnter: () => {
      if (playerParams) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => prefetchPlayback(videoId), HOVER_DWELL_MS)
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onPointerDown: () => {
      clearTimeout(timer.current)
      prefetchPlayback(videoId, playerParams)
    },
  }
}
