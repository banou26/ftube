import type { RefObject } from 'preact'
import type { Client } from 'urql'

import { useEffect, useState } from 'preact/hooks'
import { useClient } from 'urql'

import { gql } from '../generated'

// Select only `id` and `description` so graphcache never overwrites other Video fields on shared entities.
const VIDEO_DESCRIPTION_QUERY = gql(`
  query VideoDescription($id: ID!) {
    video(id: $id) {
      id
      description
    }
  }
`)

const MAX_CONCURRENT = 3

type DescriptionStore = {
  cache: Map<string, string>
  inflight: Map<string, Promise<string>>
  failed: Set<string>
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
      failed: new Set(),
      active: 0,
      queue: [],
    }
    stores.set(client, store)
  }
  return store
}

const enqueue = <T>(store: DescriptionStore, task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const run = () => {
      store.active += 1
      void task().then(resolve, reject).finally(() => {
        store.active -= 1
        const next = store.queue.shift()
        if (next) next()
      })
    }
    if (store.active < MAX_CONCURRENT) run()
    else store.queue.push(run)
  })

/** Collapses newlines and extra whitespace into single-line card description text. */
export const normalizeDescriptionText = (raw: string | null | undefined): string =>
  raw ? raw.replace(/\s+/g, ' ').trim() : ''

/**
 * Fetches and caches a single video's description per urql Client with bounded concurrency (`<= 3`),
 * returning an empty string cleanly on error or when missing.
 */
export const fetchVideoDescription = (client: Client, videoId: string): Promise<string> => {
  const store = storeOf(client)
  if (!videoId) return Promise.resolve('')
  if (store.cache.has(videoId)) return Promise.resolve(store.cache.get(videoId) ?? '')
  if (store.failed.has(videoId)) return Promise.resolve('')
  const pending = store.inflight.get(videoId)
  if (pending) return pending

  const request = enqueue(store, async () => {
    try {
      const result = await client
        .query(VIDEO_DESCRIPTION_QUERY, { id: videoId }, { requestPolicy: 'cache-first' })
        .toPromise()
      if (result.error) {
        store.failed.add(videoId)
        return ''
      }
      const text = normalizeDescriptionText(result.data?.video?.description)
      store.cache.set(videoId, text)
      return text
    } catch {
      store.failed.add(videoId)
      return ''
    } finally {
      store.inflight.delete(videoId)
    }
  })
  store.inflight.set(videoId, request)
  return request
}

/**
 * Lazily fetches a feed card's video description once the card nears the viewport and `enabled` is true.
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
    const startFetch = () => {
      void fetchVideoDescription(client, videoId).then((text) => {
        if (active && text) setLoaded({ id: videoId, text })
      })
    }

    const node = elementRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      startFetch()
      return () => {
        active = false
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return
        observer.disconnect()
        startFetch()
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(node)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [client, elementRef, enabled, videoId])

  if (!enabled) return ''
  return storeOf(client).cache.get(videoId) ?? (loaded.id === videoId ? loaded.text : '')
}
