import { describe, expect, it } from 'vite-plus/test'

import type { TransportRequest } from '../../../src/engine/protocol'

import { createWebvpnTransport } from '../../../src/scramjet/fkn-transport'

describe('webvpn transport', () => {
  it('routes requests through libcurl with a request id, cancels on abort, and promotes auth soft-redirects', async () => {
    let libcurl: { requestId: string, url: string, options: TransportRequest } | undefined
    let cancelled: string | undefined
    const remote = Promise.resolve({
      libcurlFetch: async (requestId: string, url: string, options: TransportRequest) => {
        libcurl = { requestId, url, options }
        return {
          status: 200,
          statusText: 'OK',
          headers: [['content-type', 'application/binary'], ['location', 'https://accounts.google.com/v3/signin/identifier']] as [string, string][],
          body: null,
        }
      },
      cancelLibcurlFetch: async (requestId: string) => { cancelled = requestId },
    })
    const transport = createWebvpnTransport(remote)
    await transport.init()
    expect(transport.ready).toBe(true)

    const controller = new AbortController()
    const result = await transport.request(
      new URL('https://accounts.google.com/ServiceLogin?service=youtube'),
      'GET',
      null,
      [['sec-fetch-dest', 'document']],
      controller.signal,
    )

    expect(libcurl?.url).toBe('https://accounts.google.com/ServiceLogin?service=youtube')
    expect(libcurl?.requestId).toMatch(/^signin:\d+$/)
    expect(libcurl?.options).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(result.status).toBe(302)
    expect(result.headers).toEqual([['location', 'https://accounts.google.com/v3/signin/identifier']])

    controller.abort()
    expect(cancelled).toBe(libcurl?.requestId)
  })
})

describe('webvpn transport keeps the whole login on one connection', () => {
  /* b691605 broke sign-in by preferring an extension fetch: it answers `redirect: 'manual'` with an
     opaque redirect, and hops split across two transports are two sessions to Google. */
  it('always uses libcurl, with no way to route a hop elsewhere', async () => {
    const calls: string[] = []
    const remote = Promise.resolve({
      libcurlFetch: async (id: string, url: string) => {
        calls.push(`libcurl:${id}:${url}`)
        return { status: 302, statusText: 'Found', headers: [] as [string, string][], body: null }
      },
      cancelLibcurlFetch: async () => {},
    })
    const transport = createWebvpnTransport(remote)
    await transport.init()
    await transport.request(new URL('https://accounts.google.com/ServiceLogin'), 'GET', null, [], undefined)
    await transport.request(new URL('https://accounts.google.com/signin/challenge'), 'GET', null, [], undefined)

    expect(calls).toEqual([
      'libcurl:signin:1:https://accounts.google.com/ServiceLogin',
      'libcurl:signin:2:https://accounts.google.com/signin/challenge',
    ])
  })
})
