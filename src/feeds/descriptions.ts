import type { RefObject } from 'preact'
import type { Client } from 'urql'

import { useEffect, useState } from 'preact/hooks'
import { useClient } from 'urql'

import { gql } from '../generated'

const VIDEO_DESCRIPTION_QUERY = gql(`
  query VideoDescription($id: ID!) {
    videoDescription(id: $id)
  }
`)

const MAX_CONCURRENT = 2
const DWELL_MS = 150
export const FAILED_COOLDOWN_MS = 60_000

type InflightRequest = {
  promise: Promise<string>
  started: boolean
  cancelled: boolean
  callers: number
  cancelQueued?: () => void
}

type DescriptionStore = {
  cache: Map<string, string>
  inflight: Map<string, InflightRequest>
  failedUntil: Map<string, number>
  active: number
  queue: (() => void)[]
}

const stores = new WeakMap<Client, DescriptionStore>()

const storeOf = (client: Client): DescriptionStore => {
  let store = stores.get(client)
  if (!store) {
    store = {
      cache: new Map(),
      inflight: new Map(),
      failedUntil: new Map(),
      active: 0,
      queue: [],
    }
    stores.set(client, store)
  }
  return store
}

/** Collapses newlines and extra whitespace into single-line card description text. */
export const normalizeDescriptionText = (raw: string | null | undefined): string =>
  raw ? raw.replace(/\s+/g, ' ').trim() : ''

/**
 * Fetches and caches a single video's description per urql Client with bounded concurrency (`<= 2`),
 * abortable queued work, and temporary failure cooldown.
 */
export const fetchVideoDescription = (
  client: Client,
  videoId: string,
  options?: { signal?: AbortSignal, now?: () => number },
): Promise<string> => {
  const signal = options?.signal
  const now = options?.now ?? (() => Date.now())
  const store = storeOf(client)
  if (!videoId || signal?.aborted) return Promise.resolve('')
  if (store.cache.has(videoId)) return Promise.resolve(store.cache.get(videoId) ?? '')

  const retryAt = store.failedUntil.get(videoId)
  if (retryAt !== undefined) {
    if (now() < retryAt) return Promise.resolve('')
    store.failedUntil.delete(videoId)
  }

  let entry = store.inflight.get(videoId)
  let execute: (() => void) | undefined
  if (!entry) {
    let resolvePromise!: (text: string) => void
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve
    })
    const created: InflightRequest = {
      promise,
      started: false,
      cancelled: false,
      callers: 0,
    }
    created.cancelQueued = () => {
      created.cancelled = true
      store.inflight.delete(videoId)
      resolvePromise('')
    }
    store.inflight.set(videoId, created)
    entry = created

    execute = () => {
      if (created.cancelled) return
      created.started = true
      store.active += 1
      void (async () => {
        try {
          const result = await client
            .query(VIDEO_DESCRIPTION_QUERY, { id: videoId }, { requestPolicy: 'cache-first' })
            .toPromise()
          if (result.error) {
            store.failedUntil.set(videoId, now() + FAILED_COOLDOWN_MS)
            return ''
          }
          const text = normalizeDescriptionText(result.data?.videoDescription)
          store.cache.set(videoId, text)
          store.failedUntil.delete(videoId)
          return text
        } catch {
          store.failedUntil.set(videoId, now() + FAILED_COOLDOWN_MS)
          return ''
        } finally {
          store.inflight.delete(videoId)
          store.active -= 1
          while (store.queue.length > 0 && store.active < MAX_CONCURRENT) {
            const next = store.queue.shift()
            next?.()
          }
        }
      })().then(resolvePromise)
    }
  }

  entry.callers += 1
  if (execute) {
    if (store.active < MAX_CONCURRENT) execute()
    else store.queue.push(execute)
  }

  if (!signal) return entry.promise

  return new Promise<string>((resolve) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      entry.callers = Math.max(0, entry.callers - 1)
      if (!entry.started && entry.callers === 0) entry.cancelQueued?.()
      resolve('')
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void entry.promise.then((text) => {
      signal.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      resolve(text)
    })
  })
}

/**
 * Lazily fetches a feed card's video description once the card dwells near the viewport while `enabled` is true.
 */
export const useVideoDescription = (
  videoId: string,
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): string => {
  const client = useClient()
  const [loaded, setLoaded] = useState<{ id: string, text: string }>(() => ({
    id: videoId,
    text: enabled ? storeOf(client).cache.get(videoId) ?? '' : '',
  }))

  useEffect(() => {
    if (!enabled || !videoId) {
      setLoaded({ id: videoId, text: '' })
      return
    }
    const cached = storeOf(client).cache.get(videoId)
    if (cached !== undefined) {
      setLoaded({ id: videoId, text: cached })
      return
    }
    setLoaded({ id: videoId, text: '' })

    let active = true
    let dwellTimer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const cancelPending = () => {
      if (dwellTimer !== undefined) {
        clearTimeout(dwellTimer)
        dwellTimer = undefined
      }
      if (controller) {
        controller.abort()
        controller = undefined
      }
    }

    const startFetch = () => {
      if (!active || controller) return
      const nextController = new AbortController()
      controller = nextController
      void fetchVideoDescription(client, videoId, { signal: nextController.signal }).then((text) => {
        if (active && text) setLoaded({ id: videoId, text })
      })
    }

    const node = elementRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      startFetch()
      return () => {
        active = false
        cancelPending()
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some(entry => entry.isIntersecting)
        if (visible) {
          if (dwellTimer !== undefined || controller) return
          dwellTimer = setTimeout(() => {
            dwellTimer = undefined
            startFetch()
          }, DWELL_MS)
        } else {
          cancelPending()
        }
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(node)
    return () => {
      active = false
      cancelPending()
      observer.disconnect()
    }
  }, [client, elementRef, enabled, videoId])

  if (!enabled) return ''
  return storeOf(client).cache.get(videoId) ?? (loaded.id === videoId ? loaded.text : '')
}
