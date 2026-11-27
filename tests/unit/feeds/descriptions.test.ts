import { Client, fetchExchange } from '@urql/core'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('urql', () => import('@urql/core'))

import { fetchVideoDescription, normalizeDescriptionText } from '../../../src/feeds/descriptions'

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

  it('bounds concurrent VideoDescription queries to at most 3 and deduplicates same video ids', async () => {
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
      return { data: { video: { __typename: 'Video', id, description: `Description\n  for ${id}` } } }
    })

    const ids = ['vid-1', 'vid-2', 'vid-3', 'vid-4', 'vid-5', 'vid-6', 'vid-7']
    const requests = [...ids.map(id => fetchVideoDescription(client, id)), fetchVideoDescription(client, 'vid-1')]

    // Wait a tick for the first batch to enqueue and start.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(peakActive).toBeLessThanOrEqual(3)
    expect(fetchedIds).toHaveLength(3)

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
    expect(peakActive).toBeLessThanOrEqual(3)
    expect(fetchedIds).toEqual(ids)
    expect(results.slice(0, 7)).toEqual(ids.map(id => `Description for ${id}`))
    expect(results[7]).toBe('Description for vid-1')

    // Subsequent call for the same Client hits memory cache without another fetch.
    expect(await fetchVideoDescription(client, 'vid-1')).toBe('Description for vid-1')
    expect(fetchedIds).toHaveLength(7)
  })

  it('isolates caches across Client instances and swallows errors without caching failures globally', async () => {
    const callsA: string[] = []
    const callsB: string[] = []

    const clientA = makeTestClient(async (id) => {
      callsA.push(id)
      return { errors: [{ message: 'transient error' }], data: null }
    })
    const clientB = makeTestClient(async (id) => {
      callsB.push(id)
      return { data: { video: { __typename: 'Video', id, description: 'From client B' } } }
    })

    expect(await fetchVideoDescription(clientA, 'shared-vid')).toBe('')
    // Same client does not retry a failed video repeatedly.
    expect(await fetchVideoDescription(clientA, 'shared-vid')).toBe('')
    expect(callsA).toEqual(['shared-vid'])

    // Distinct client instance still fetches independently.
    expect(await fetchVideoDescription(clientB, 'shared-vid')).toBe('From client B')
    expect(callsB).toEqual(['shared-vid'])
  })
})
