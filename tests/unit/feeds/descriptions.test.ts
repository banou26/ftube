import { Client, fetchExchange } from '@urql/core'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('urql', () => import('@urql/core'))

import { FAILED_COOLDOWN_MS, fetchVideoDescription, normalizeDescriptionText } from '../../../src/feeds/descriptions'
import { createYoutubeSource } from '../../../src/sources/youtube'

const makeTestClient = (
  handler: (id: string) => Promise<unknown>,
) => new Client({
  url: '/test-graphql',
  exchanges: [fetchExchange],
  fetch: async (_input, init) => {
    const body = JSON.parse(init?.body as string) as { variables?: { id?: string } }
    const id = body.variables?.id ?? ''
    const payload = await handler(id)
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
  },
  preferGetMethod: false,
})

describe('feed video descriptions', () => {
  it('normalizes whitespace and newlines into single-line display text', () => {
    expect(normalizeDescriptionText(undefined)).toBe('')
    expect(normalizeDescriptionText(null)).toBe('')
    expect(normalizeDescriptionText('   \n\t  ')).toBe('')
    expect(normalizeDescriptionText('  First line\n\n  second   line\tthird  ')).toBe('First line second line third')
  })

  it('bounds concurrent VideoDescription queries to at most 2 and deduplicates same video ids', async () => {
    let active = 0
    let peakActive = 0
    const fetchedIds: string[] = []
    const blockers = new Map<string, () => void>()

    const client = makeTestClient(async (id) => {
      fetchedIds.push(id)
      active += 1
      peakActive = Math.max(peakActive, active)
      await new Promise<void>((resolve) => blockers.set(id, resolve))
      active -= 1
      return { data: { videoDescription: `Description\n  for ${id}` } }
    })

    const ids = ['vid-1', 'vid-2', 'vid-3', 'vid-4', 'vid-5', 'vid-6', 'vid-7']
    const requests = [...ids.map(id => fetchVideoDescription(client, id)), fetchVideoDescription(client, 'vid-1')]

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(peakActive).toBeLessThanOrEqual(2)
    expect(fetchedIds).toHaveLength(2)

    while (blockers.size > 0 || fetchedIds.length < ids.length) {
      const nextEntry = blockers.entries().next()
      if (!nextEntry.done) {
        const [id, release] = nextEntry.value
        blockers.delete(id)
        release()
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    const results = await Promise.all(requests)
    expect(peakActive).toBeLessThanOrEqual(2)
    expect(fetchedIds).toEqual(ids)
    expect(results.slice(0, 7)).toEqual(ids.map(id => `Description for ${id}`))
    expect(results[7]).toBe('Description for vid-1')

    expect(await fetchVideoDescription(client, 'vid-1')).toBe('Description for vid-1')
    expect(fetchedIds).toHaveLength(7)
  })

  it('cancels queued fetches when all callers abort while preserving shared fetches for active callers', async () => {
    const fetchedIds: string[] = []
    const blockers = new Map<string, () => void>()

    const client = makeTestClient(async (id) => {
      fetchedIds.push(id)
      await new Promise<void>((resolve) => blockers.set(id, resolve))
      return { data: { videoDescription: `Text for ${id}` } }
    })

    // Occupy both concurrent slots.
    const p1 = fetchVideoDescription(client, 'active-1')
    const p2 = fetchVideoDescription(client, 'active-2')
    // Queue vid-abort with an exclusive caller and vid-shared with two callers (one aborts).
    const abortOnly = new AbortController()
    const abortShared = new AbortController()
    const pAbort = fetchVideoDescription(client, 'queued-abort', { signal: abortOnly.signal })
    const pSharedAborted = fetchVideoDescription(client, 'queued-shared', { signal: abortShared.signal })
    const pSharedKept = fetchVideoDescription(client, 'queued-shared')

    abortOnly.abort()
    abortShared.abort()

    expect(await pAbort).toBe('')
    expect(await pSharedAborted).toBe('')

    while (blockers.size > 0 || fetchedIds.length < 3) {
      const nextEntry = blockers.entries().next()
      if (!nextEntry.done) {
        const [id, release] = nextEntry.value
        blockers.delete(id)
        release()
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(await p1).toBe('Text for active-1')
    expect(await p2).toBe('Text for active-2')
    expect(await pSharedKept).toBe('Text for queued-shared')
    expect(fetchedIds).not.toContain('queued-abort')
    expect(fetchedIds).toEqual(['active-1', 'active-2', 'queued-shared'])
  })

  it('isolates caches across Client instances and retries failed lookups only after cooldown', async () => {
    const callsA: string[] = []
    const callsB: string[] = []
    let failA = true
    let clock = 10_000

    const clientA = makeTestClient(async (id) => {
      callsA.push(id)
      if (failA) return { errors: [{ message: 'transient error' }], data: null }
      return { data: { videoDescription: 'Recovered from client A' } }
    })
    const clientB = makeTestClient(async (id) => {
      callsB.push(id)
      return { data: { videoDescription: 'From client B' } }
    })

    expect(await fetchVideoDescription(clientA, 'shared-vid', { now: () => clock })).toBe('')
    expect(await fetchVideoDescription(clientA, 'shared-vid', { now: () => clock })).toBe('')
    expect(callsA).toEqual(['shared-vid'])

    // Distinct client instance still fetches independently.
    expect(await fetchVideoDescription(clientB, 'shared-vid')).toBe('From client B')
    expect(callsB).toEqual(['shared-vid'])

    // After cooldown expires, clientA retries and caches the recovered description.
    failA = false
    clock += FAILED_COOLDOWN_MS + 1
    expect(await fetchVideoDescription(clientA, 'shared-vid', { now: () => clock })).toBe('Recovered from client A')
    expect(callsA).toEqual(['shared-vid', 'shared-vid'])
  })

  it('fetches descriptions from /next rather than getBasicInfo and reuses watch cache', async () => {
    let basicInfoCalls = 0
    const nextCalls: string[] = []
    const makeNextPayload = (text: string) => ({
      contents_memo: new Map([
        ['VideoPrimaryInfo', [{ title: { text: 'Video Title' } }]],
        ['VideoSecondaryInfo', [{ description: { text } }]],
      ]),
    })

    const client = {
      session: { logged_in: false, context: { client: { hl: 'en', gl: 'US' } } },
      getBasicInfo: async () => {
        basicInfoCalls += 1
        return {}
      },
      actions: {
        execute: async (endpoint: string, args: { videoId?: string }) => {
          if (endpoint !== '/next') throw new Error(`unexpected endpoint ${endpoint}`)
          nextCalls.push(args.videoId ?? '')
          return makeNextPayload(`Desc for ${args.videoId}`)
        },
      },
    }

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client as never })
    expect(await source.videoDescription('vid-next-1')).toBe('Desc for vid-next-1')
    expect(await source.videoDescription('vid-next-1')).toBe('Desc for vid-next-1')
    expect(basicInfoCalls).toBe(0)
    expect(nextCalls).toEqual(['vid-next-1'])

    // watch() also populates the description cache for subsequent videoDescription() lookups.
    await source.watch('vid-watch-2')
    expect(await source.videoDescription('vid-watch-2')).toBe('Desc for vid-watch-2')
    expect(nextCalls).toEqual(['vid-next-1', 'vid-watch-2'])
  })
})
