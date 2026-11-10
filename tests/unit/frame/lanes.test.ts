import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { TransportRequest, TransportResponse } from '../../../src/engine/protocol'
import type { DirectReport, Lane, LaneRequest } from '../../../src/frame/lanes'

import { CHANNEL_KEY } from '../../../src/engine/signed-in'
import { createCatalogLane, createSessionLane, createYoutubeFetch, DIRECT_SKIP_MS, laneOf, toResponse } from '../../../src/frame/lanes'
import { accountsListAnswer, BRAND_PAGE_ID, OTHER_PAGE_ID, twoChannels } from '../fixtures/accounts-list'

const SEARCH = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false&alt=json'
const VISITOR = 'CgtWSVNJVE9SXzEyMyiA'
const PAYLOAD = JSON.stringify({ context: { client: { clientName: 'WEB', visitorData: VISITOR } }, query: 'lofi' })
const TIMEDTEXT = 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&caps=asr&signature=AB12&lang=en&fmt=json3'

// what youtubei.js's HTTPClient hands its fetch for an InnerTube call: a Request, and the processed body and headers in init
const youtubeiCall = (url = SEARCH, body = PAYLOAD, extra: Record<string, string> = {}) => [
  new Request(url, { method: 'POST', body }),
  {
    body,
    headers: new Headers({
      Accept: '*/*',
      'Accept-Language': '*',
      'Content-Type': 'application/json',
      'X-Goog-Visitor-Id': VISITOR,
      'X-Origin': 'https://www.youtube.com',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20260618.05.00',
      ...extra,
    }),
    redirect: 'follow',
    credentials: 'include',
  } satisfies RequestInit,
] as const

type Sent = { url: string, request: LaneRequest }

const recordingLane = (name: string, answer: () => Promise<Response> = async () => new Response(name)) => {
  const sent: Sent[] = []
  const lane = vi.fn<Lane>(async (url, request) => {
    sent.push({ url, request })
    return answer()
  })
  return { lane, sent }
}

const wire = ({ signedIn = false, direct = async () => new Response('direct'), directOff = false }: {
  signedIn?: boolean
  direct?: (url: string, init: RequestInit) => Promise<Response>
  directOff?: boolean
} = {}) => {
  const directSent: { url: string, init: RequestInit }[] = []
  const catalog = recordingLane('catalog')
  const session = recordingLane('session')
  const media = recordingLane('media')
  const reports: DirectReport[] = []
  let clock = 1_000
  const youtubeFetch = createYoutubeFetch({
    signedIn,
    direct: directOff ? undefined : async (input, init) => {
      const url = input as string
      directSent.push({ url, init: init! })
      return direct(url, init!)
    },
    catalog: catalog.lane,
    session: session.lane,
    media: media.lane,
    report: (value) => reports.push(value),
    now: () => clock,
  })
  return { youtubeFetch, directSent, catalog, session, media, reports, advance: (ms: number) => { clock += ms } }
}

describe('the lane a request takes', () => {
  it('signed out: InnerTube POSTs and caption GETs go direct, other YouTube urls take the catalog lane, the rest media', () => {
    expect(laneOf(SEARCH, 'POST', false)).toBe('direct')
    expect(laneOf(TIMEDTEXT, 'GET', false)).toBe('direct')
    expect(laneOf(TIMEDTEXT, 'POST', false)).toBe('catalog')
    expect(laneOf('https://www.youtube.com/api/timedtext/list', 'GET', false)).toBe('catalog')
    expect(laneOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'GET', false)).toBe('catalog')
    expect(laneOf('https://www.youtube.com/sw.js_data', 'GET', false)).toBe('catalog')
    expect(laneOf('https://www.youtube.com/youtubei/v1/search', 'GET', false)).toBe('catalog')
    expect(laneOf('https://s.youtube.com/api/stats/playback?cpn=x', 'POST', false)).toBe('catalog')
    expect(laneOf('https://suggestqueries-clients6.youtube.com/complete/search?q=a', 'GET', false)).toBe('catalog')
    expect(laneOf('https://rr1---sn-x.googlevideo.com/videoplayback', 'POST', false)).toBe('media')
    expect(laneOf('https://www.google.com/js/th/interpreter.js', 'GET', false)).toBe('media')
    expect(laneOf('https://youtubei.googleapis.com/youtubei/v1/search', 'POST', false)).toBe('media')
    expect(laneOf('https://www.youtube.com.example/youtubei/v1/search', 'POST', false)).toBe('media')
    expect(laneOf('not a url', 'GET', false)).toBe('media')
  })

  it('signed in: every YouTube url takes the session lane, captions still go direct, the rest media', () => {
    expect(laneOf(SEARCH, 'POST', true)).toBe('session')
    expect(laneOf('https://www.youtube.com/youtubei/v1/account/accounts_list', 'POST', true)).toBe('session')
    expect(laneOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'GET', true)).toBe('session')
    expect(laneOf('https://s.youtube.com/api/stats/playback?cpn=x', 'POST', true)).toBe('session')
    expect(laneOf(TIMEDTEXT, 'GET', true)).toBe('direct')
    expect(laneOf('https://rr1---sn-x.googlevideo.com/videoplayback', 'POST', true)).toBe('media')
  })
})

describe('the engine fetch, signed out', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a youtubei.js InnerTube call as a simple request: POST, a text/plain body, no other header, no credentials', async () => {
    const { youtubeFetch, directSent, catalog, reports } = wire({ direct: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }) })
    const response = await youtubeFetch(...youtubeiCall())
    expect(catalog.lane).not.toHaveBeenCalled()
    expect(directSent).toHaveLength(1)
    expect(directSent[0]!.url).toBe(SEARCH)
    const { signal, ...init } = directSent[0]!.init
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(init).toEqual({
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: PAYLOAD,
      credentials: 'omit',
      mode: 'cors',
      redirect: 'follow',
    })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ ok: true })
    expect(reports).toEqual(['on'])
  })

  it('drops X-Origin from youtubei.js\'s /config call and keeps its visitorData in the body', async () => {
    const { youtubeFetch, directSent } = wire()
    const config = JSON.stringify({ context: { client: { clientName: 'WEB', visitorData: VISITOR } } })
    await youtubeFetch('https://www.youtube.com/youtubei/v1/config?prettyPrint=false', {
      method: 'POST',
      headers: { 'X-Origin': 'https://www.youtube.com', 'X-Goog-Visitor-Id': VISITOR, Referer: 'https://www.youtube.com' },
      body: config,
    })
    expect(directSent[0]!.init.headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8' })
    expect(directSent[0]!.init.body).toBe(config)
  })

  it('carries the visitor header in the body\'s context when the body names no visitorData', async () => {
    const { youtubeFetch, directSent } = wire()
    const bare = JSON.stringify({ context: { client: { clientName: 'ANDROID_VR' } }, videoId: 'dQw4w9WgXcQ' })
    await youtubeFetch(...youtubeiCall('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json', bare))
    expect(JSON.parse(directSent[0]!.init.body as string)).toEqual({
      context: { client: { clientName: 'ANDROID_VR', visitorData: VISITOR } },
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('reads a caption track direct as a plain GET with no header and no credentials', async () => {
    const cues = '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Never"}]}]}'
    const { youtubeFetch, directSent, catalog, reports } = wire({ direct: async () => new Response(cues) })
    expect(await (await youtubeFetch(TIMEDTEXT)).text()).toBe(cues)
    expect(catalog.lane).not.toHaveBeenCalled()
    expect(directSent[0]!.init).toEqual({ method: 'GET', credentials: 'omit', mode: 'cors', redirect: 'follow' })
    // the state reported is InnerTube's, which captions say nothing about
    expect(reports).toEqual([])
  })

  it('returns a non-2xx direct answer as YouTube\'s own, never resent', async () => {
    const { youtubeFetch, catalog, directSent } = wire({ direct: async () => new Response('{"error":{"code":400}}', { status: 400 }) })
    const response = await youtubeFetch(...youtubeiCall())
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":{"code":400}}')
    expect(catalog.lane).not.toHaveBeenCalled()
    expect(directSent).toHaveLength(1)
  })

  it('sends every request that is not an InnerTube POST or a caption GET on the catalog or media lane, with its body and headers', async () => {
    const { youtubeFetch, directSent, catalog, media, reports } = wire()
    await youtubeFetch('https://www.youtube.com/sw.js_data', { headers: { 'X-Goog-Visitor-Id': VISITOR } })
    await youtubeFetch('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await youtubeFetch('https://www.youtube.com/iframe_api')
    await youtubeFetch('https://s.youtube.com/api/stats/playback?cpn=x', { method: 'POST', body: '' })
    await youtubeFetch('https://www.youtube.com/youtubei/v1/browse', { method: 'PUT', body: PAYLOAD })
    await youtubeFetch('https://www.youtube.com/youtubei/v1/browse', { method: 'POST', body: new Uint8Array([1, 2]) })
    await youtubeFetch(TIMEDTEXT, { method: 'POST', body: '' })
    await youtubeFetch('https://rr1---sn-x.googlevideo.com/generate_204')
    expect(directSent).toHaveLength(0)
    expect(catalog.sent.map(({ url, request }) => `${request.method} ${url}`)).toEqual([
      'GET https://www.youtube.com/sw.js_data',
      'GET https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'GET https://www.youtube.com/iframe_api',
      'POST https://s.youtube.com/api/stats/playback?cpn=x',
      'PUT https://www.youtube.com/youtubei/v1/browse',
      'POST https://www.youtube.com/youtubei/v1/browse',
      `POST ${TIMEDTEXT}`,
    ])
    expect(catalog.sent[0]!.request.headers).toEqual({ 'x-goog-visitor-id': VISITOR })
    expect(new TextDecoder().decode(catalog.sent[4]!.request.body)).toBe(PAYLOAD)
    expect([...new Uint8Array(catalog.sent[5]!.request.body!)]).toEqual([1, 2])
    expect(media.sent.map(({ url }) => url)).toEqual(['https://rr1---sn-x.googlevideo.com/generate_204'])
    expect(reports).toEqual([])
  })

  it('never goes direct while the step is off, and reports the lane off once', async () => {
    const { youtubeFetch, catalog, reports } = wire({ directOff: true })
    expect(await (await youtubeFetch(...youtubeiCall())).text()).toBe('catalog')
    await youtubeFetch(...youtubeiCall())
    await youtubeFetch(TIMEDTEXT)
    expect(catalog.sent.map(({ url }) => url)).toEqual([SEARCH, SEARCH, TIMEDTEXT])
    expect(reports).toEqual(['off'])
  })

  it('resends a TypeError on the catalog lane, and skips direct for the window only when that lane answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let down = true
    const { youtubeFetch, catalog, directSent, reports, advance } = wire({
      direct: async () => {
        if (down) throw new TypeError('Failed to fetch')
        return new Response('{"direct":true}')
      },
    })
    expect(await (await youtubeFetch(...youtubeiCall())).text()).toBe('catalog')
    expect(directSent).toHaveLength(1)
    expect(reports).toEqual(['skipped'])

    down = false
    advance(DIRECT_SKIP_MS - 1)
    await youtubeFetch(...youtubeiCall())
    expect(directSent).toHaveLength(1)
    expect(catalog.lane).toHaveBeenCalledTimes(2)

    advance(1)
    expect(await (await youtubeFetch(...youtubeiCall())).text()).toBe('{"direct":true}')
    await youtubeFetch(...youtubeiCall())
    expect(directSent).toHaveLength(3)
    expect(reports).toEqual(['skipped', 'on'])
  })

  it('keeps direct on when the catalog lane fails the resend too, since an outage fails both', async () => {
    let down = true
    const { youtubeFetch, catalog, directSent } = wire({
      direct: async () => {
        if (down) throw new TypeError('Failed to fetch')
        return new Response('{}')
      },
    })
    catalog.lane.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(youtubeFetch(...youtubeiCall())).rejects.toThrow('Failed to fetch')
    down = false
    await youtubeFetch(...youtubeiCall())
    expect(directSent).toHaveLength(2)
    expect(catalog.lane).toHaveBeenCalledOnce()
  })

  it('keeps direct on when the catalog lane answers the resend with an error status', async () => {
    const { youtubeFetch, catalog, directSent } = wire({ direct: async () => { throw new TypeError('Failed to fetch') } })
    catalog.lane.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect((await youtubeFetch(...youtubeiCall())).status).toBe(503)
    await youtubeFetch(...youtubeiCall())
    expect(directSent).toHaveLength(2)
  })

  it('does not resend a failure that is not a TypeError, nor an aborted call', async () => {
    const { youtubeFetch, catalog } = wire({ direct: async () => { throw new Error('something else') } })
    await expect(youtubeFetch(...youtubeiCall())).rejects.toThrow('something else')
    const aborted = wire({ direct: async () => { throw new TypeError('aborted') } })
    const controller = new AbortController()
    controller.abort()
    const [request, init] = youtubeiCall()
    await expect(aborted.youtubeFetch(request, { ...init, signal: controller.signal })).rejects.toThrow()
    expect(catalog.lane).not.toHaveBeenCalled()
    expect(aborted.catalog.lane).not.toHaveBeenCalled()
  })
})

describe('the engine fetch, signed in', () => {
  it('sends every YouTube request through the FKN page, none direct and none on the catalog lane, and reports direct off', async () => {
    const { youtubeFetch, directSent, catalog, session, media, reports } = wire({ signedIn: true })
    await youtubeFetch(...youtubeiCall(SEARCH, PAYLOAD, { Authorization: 'SAPISIDHASH 1_abc', Cookie: 'SAPISID=x' }))
    await youtubeFetch('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await youtubeFetch('https://s.youtube.com/api/stats/playback?cpn=x', { method: 'POST' })
    await youtubeFetch('https://rr1---sn-x.googlevideo.com/videoplayback', { method: 'POST' })
    await youtubeFetch(TIMEDTEXT)
    expect(catalog.lane).not.toHaveBeenCalled()
    expect(session.sent.map(({ url }) => url)).toEqual([SEARCH, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://s.youtube.com/api/stats/playback?cpn=x'])
    expect(session.sent[0]!.request.headers).toMatchObject({ authorization: 'SAPISIDHASH 1_abc', 'x-goog-visitor-id': VISITOR })
    expect(media.sent.map(({ url }) => url)).toEqual(['https://rr1---sn-x.googlevideo.com/videoplayback'])
    expect(directSent.map(({ url }) => url)).toEqual([TIMEDTEXT])
    expect(reports).toEqual(['off'])
  })

  it('resends a caption the browser could not read through the FKN page, never the catalog lane', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { youtubeFetch, catalog, session } = wire({ signedIn: true, direct: async () => { throw new TypeError('Failed to fetch') } })
    expect(await (await youtubeFetch(TIMEDTEXT)).text()).toBe('session')
    expect(session.sent.map(({ url }) => url)).toEqual([TIMEDTEXT])
    expect(catalog.lane).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('the catalog lane', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { languages: ['ja-JP', 'en-US', 'en'] })
  })

  afterEach(() => vi.unstubAllGlobals())

  const transport = (status = 200, body = 'answer'): TransportResponse => ({
    status,
    statusText: 'OK',
    headers: [['content-type', 'text/plain']],
    body: new Response(body).body,
  })

  it('takes the extension when it answers, the relay when it does not, with the same options', async () => {
    const relayed: [string, TransportRequest][] = []
    const extFetch = vi.fn(async (_url: string, _options: TransportRequest) => null as TransportResponse | null)
    const lane = createCatalogLane({ extFetch, relayFetch: async (url, options) => { relayed.push([url, options]); return transport() } })
    const response = await lane('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { method: 'GET', headers: { 'x-goog-visitor-id': VISITOR } })
    expect(await response.text()).toBe('answer')
    expect(relayed).toHaveLength(1)
    expect(relayed[0]![1]).toBe(extFetch.mock.calls[0]![1])
    expect(relayed[0]![1]).toEqual({
      method: 'GET',
      headers: { 'x-goog-visitor-id': VISITOR, referer: 'https://www.youtube.com/', 'accept-language': 'ja-JP,en-US;q=0.9,en;q=0.8' },
      body: null,
      redirect: 'follow',
    })

    extFetch.mockResolvedValueOnce(transport(200, 'from the extension'))
    expect(await (await lane('https://www.youtube.com/sw.js_data', { method: 'GET', headers: {} })).text()).toBe('from the extension')
    expect(relayed).toHaveLength(1)
  })

  it('keeps the Accept-Language a call names, as youtubei.js\'s InnerTube calls do', async () => {
    const relayed: TransportRequest[] = []
    const lane = createCatalogLane({ extFetch: async () => null, relayFetch: async (_url, options) => { relayed.push(options); return transport() } })
    await lane(SEARCH, { method: 'POST', headers: { 'accept-language': '*' }, body: new ArrayBuffer(0) })
    expect(relayed[0]!.headers).toEqual({ 'accept-language': '*', referer: 'https://www.youtube.com/', origin: 'https://www.youtube.com' })
  })

  it('sends a write with www.youtube.com as its origin, which InnerTube needs on a POST', async () => {
    const relayed: TransportRequest[] = []
    const lane = createCatalogLane({ extFetch: async () => null, relayFetch: async (_url, options) => { relayed.push(options); return transport() } })
    const body = new TextEncoder().encode(PAYLOAD).buffer as ArrayBuffer
    await lane(SEARCH, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(relayed[0]).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'https://www.youtube.com/', origin: 'https://www.youtube.com', 'accept-language': 'ja-JP,en-US;q=0.9,en;q=0.8' },
      body,
      redirect: 'follow',
    })
  })
})

const ACCOUNTS_LIST = 'https://www.youtube.com/youtubei/v1/account/accounts_list?prettyPrint=false&alt=json'
const BROWSE = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json'
const PING = 'https://s.youtube.com/api/stats/playback?ns=yt&docid=dQw4w9WgXcQ&ver=2&cpn=abcdefghijklmnop'
const LOGGED_OUT = accountsListAnswer([], { loggedOut: true })

// the FKN page: each request recorded with its headers, answered from `answers` in turn and the last one from then on
const fknPage = (...answers: unknown[]) => {
  const sent: { url: string, method?: string, headers: Record<string, string>, body?: ArrayBuffer }[] = []
  const fetchThroughPage = vi.fn(async (url: string, request: { method?: string, headers?: Record<string, string>, body?: ArrayBuffer }) => {
    sent.push({ url, method: request.method, headers: request.headers ?? {}, body: request.body })
    const answer = answers.length > 1 ? answers.shift() : answers[0]
    const body = typeof answer === 'string' ? answer : JSON.stringify(answer ?? {})
    return { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] as [string, string][], body: new TextEncoder().encode(body).buffer as ArrayBuffer }
  })
  return { sent, fetchThroughPage, pageIds: () => sent.map(({ headers }) => headers['x-goog-pageid']) }
}

const SIGNED_IN = { authorization: 'SAPISIDHASH 1762700000_0123456789abcdef', 'x-goog-authuser': '0', 'content-type': 'application/json' }
const post = (): LaneRequest => ({ method: 'POST', headers: SIGNED_IN, body: new TextEncoder().encode('{"context":{}}').buffer as ArrayBuffer })

describe('the session lane', () => {
  it('answers what the FKN page fetched', async () => {
    const { fetchThroughPage } = fknPage('{"contents":[]}')
    const response = await createSessionLane(fetchThroughPage, () => {})(SEARCH, { method: 'POST', headers: {} })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ contents: [] })
  })

  it('hears an accounts_list answer that says the session ended, and no other answer', async () => {
    const signedOut = vi.fn()
    await createSessionLane(fknPage(LOGGED_OUT).fetchThroughPage, signedOut)(BROWSE, post())
    await createSessionLane(fknPage(accountsListAnswer([])).fetchThroughPage, signedOut)(ACCOUNTS_LIST, post())
    expect(signedOut).not.toHaveBeenCalled()
    await createSessionLane(fknPage(LOGGED_OUT).fetchThroughPage, signedOut)(ACCOUNTS_LIST, post())
    expect(signedOut).toHaveBeenCalledOnce()
  })
})

describe('the session lane, as a brand channel', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map([[CHANNEL_KEY, BRAND_PAGE_ID]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const listAccounts = (lane: Lane) => lane(ACCOUNTS_LIST, post())

  it('sends X-Goog-PageId on every InnerTube call, keeping its other headers and body, and on no other request', async () => {
    const { sent, fetchThroughPage } = fknPage({})
    const lane = createSessionLane(fetchThroughPage, () => {}, BRAND_PAGE_ID)
    const calls: [string, LaneRequest][] = [
      [BROWSE, post()],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { method: 'GET', headers: {} }],
      ['https://www.youtube.com/sw.js_data', { method: 'GET', headers: {} }],
      ['https://www.youtube.com.example/youtubei/v1/browse', post()],
      ['https://suggestqueries-clients6.youtube.com/complete/search?q=a', { method: 'GET', headers: {} }],
    ]
    for (const [url, request] of calls) await lane(url, request)
    expect(sent.map(({ url }) => url)).toEqual(calls.map(([url]) => url))
    expect(sent.map(({ headers }) => headers)).toEqual([
      { ...SIGNED_IN, 'x-goog-pageid': BRAND_PAGE_ID },
      ...calls.slice(1).map(([, request]) => request.headers),
    ])
    expect(new TextDecoder().decode(sent[0]!.body)).toBe('{"context":{}}')
  })

  it('sends the playback registration to www.youtube.com with X-Goog-PageId, as youtubei.js does', async () => {
    const { sent, fetchThroughPage } = fknPage({})
    await createSessionLane(fetchThroughPage, () => {}, BRAND_PAGE_ID)(PING, { method: 'POST', headers: {} })
    const registration = new URL(sent[0]!.url)
    expect(registration.origin + registration.pathname).toBe('https://www.youtube.com/api/stats/playback')
    expect(registration.search).toBe(new URL(PING).search)
    expect(sent[0]).toMatchObject({ method: 'POST', headers: { 'x-goog-pageid': BRAND_PAGE_ID } })
  })

  it('sends no X-Goog-PageId for the account\'s own channel, and the registration to www.youtube.com still', async () => {
    const { sent, pageIds, fetchThroughPage } = fknPage({})
    const lane = createSessionLane(fetchThroughPage, () => {})
    await lane(BROWSE, post())
    await lane(PING, { method: 'POST', headers: {} })
    expect(pageIds()).toEqual([undefined, undefined])
    const registration = new URL(sent[1]!.url)
    expect(registration.origin + registration.pathname).toBe('https://www.youtube.com/api/stats/playback')
    expect(registration.search).toBe(new URL(PING).search)
  })

  it('reads a loggedOut answer to a channel as an id of another login: drops the channel and asks once more without it', async () => {
    const signedOut = vi.fn()
    const own = accountsListAnswer([{ name: 'Viewer', handle: '@viewer', selected: true }])
    const { sent, pageIds, fetchThroughPage } = fknPage(LOGGED_OUT, own)
    const lane = createSessionLane(fetchThroughPage, signedOut, BRAND_PAGE_ID)
    expect(await (await listAccounts(lane)).json()).toEqual(own)
    expect(signedOut).not.toHaveBeenCalled()
    expect(store.has(CHANNEL_KEY)).toBe(false)
    expect(sent[1]).toEqual({ url: ACCOUNTS_LIST, method: 'POST', headers: SIGNED_IN, body: sent[0]!.body })
    await lane(BROWSE, post())
    expect(pageIds()).toEqual([BRAND_PAGE_ID, undefined, undefined])
  })

  it('hears the session end when the answer without the channel says so too, with no channel kept', async () => {
    const signedOut = vi.fn()
    const { pageIds, fetchThroughPage } = fknPage(LOGGED_OUT)
    expect(await (await listAccounts(createSessionLane(fetchThroughPage, signedOut, BRAND_PAGE_ID))).json()).toEqual(LOGGED_OUT)
    expect(pageIds()).toEqual([BRAND_PAGE_ID, undefined])
    expect(signedOut).toHaveBeenCalledOnce()
    expect(store.has(CHANNEL_KEY)).toBe(false)
  })

  it('drops a channel the answer does not select, which YouTube answers as the account\'s own', async () => {
    const answer = accountsListAnswer(twoChannels('own'))
    const { pageIds, fetchThroughPage } = fknPage(answer)
    const lane = createSessionLane(fetchThroughPage, () => {}, BRAND_PAGE_ID)
    expect(await (await listAccounts(lane)).json()).toEqual(answer)
    await lane(BROWSE, post())
    expect(store.has(CHANNEL_KEY)).toBe(false)
    expect(pageIds()).toEqual([BRAND_PAGE_ID, undefined])
  })

  it('keeps the channel the answer selects, and keeps it through an error and an answer that lists no row', async () => {
    const { pageIds, fetchThroughPage } = fknPage(accountsListAnswer(twoChannels('brand')), { error: { code: 500 } }, accountsListAnswer([]))
    const lane = createSessionLane(fetchThroughPage, () => {}, BRAND_PAGE_ID)
    await listAccounts(lane)
    await listAccounts(lane)
    await listAccounts(lane)
    await lane(BROWSE, post())
    expect(store.get(CHANNEL_KEY)).toBe(BRAND_PAGE_ID)
    expect(pageIds()).toEqual([BRAND_PAGE_ID, BRAND_PAGE_ID, BRAND_PAGE_ID, BRAND_PAGE_ID])
  })

  it('leaves a channel picked in another tab while its answer was on the way stored when it drops its own', async () => {
    const { pageIds, fetchThroughPage } = fknPage(accountsListAnswer(twoChannels('own')))
    const pickedElsewhere: typeof fetchThroughPage = vi.fn(async (url, request) => {
      store.set(CHANNEL_KEY, OTHER_PAGE_ID)
      return fetchThroughPage(url, request)
    })
    await listAccounts(createSessionLane(pickedElsewhere, () => {}, BRAND_PAGE_ID))
    expect(pageIds()).toEqual([BRAND_PAGE_ID])
    expect(store.get(CHANNEL_KEY)).toBe(OTHER_PAGE_ID)
  })

  it('stops sending the channel once storage no longer holds it, as after a sign-out or a sign-in in another tab', async () => {
    const { sent, pageIds, fetchThroughPage } = fknPage(accountsListAnswer(twoChannels('brand')))
    const lane = createSessionLane(fetchThroughPage, () => {}, BRAND_PAGE_ID)
    await lane(BROWSE, post())
    store.delete(CHANNEL_KEY)
    await lane(BROWSE, post())
    await lane(PING, { method: 'POST', headers: {} })
    await listAccounts(lane)
    expect(pageIds()).toEqual([BRAND_PAGE_ID, undefined, undefined, undefined])
    expect(new URL(sent[2]!.url).host).toBe('www.youtube.com')
  })
})

describe('a lane answer as a Response', () => {
  it('drops the body of a status that carries none', async () => {
    const response = toResponse({ status: 204, statusText: 'No Content', headers: [], body: new Response('x').body })
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })
})
