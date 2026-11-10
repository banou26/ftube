import type { DIRECT_STATES, PageRequest, PageResponse } from '../engine/agent-protocol'
import type { TransportRequest, TransportResponse } from '../engine/protocol'

import type { ExtEgressFetch } from './egress-ports'

import { forgetChannel, readChannel } from '../engine/signed-in'

export type DirectReport = (typeof DIRECT_STATES)[number]

/** How long direct calls pause after one failed with a TypeError and the lane behind it then answered. */
export const DIRECT_SKIP_MS = 5 * 60_000

export type LaneRequest = { method: string, headers: Record<string, string>, body?: ArrayBuffer }

/** One way out for a request the engine makes, answering a standard Response. */
export type Lane = (url: string, request: LaneRequest, signal?: AbortSignal) => Promise<Response>

/**
 * - `direct`: the engine frame's own fetch, as a CORS simple request with no credentials.
 * - `catalog`: the extension's fetch when it is exposed, else the FKN relay.
 * - `session`: the FKN page's own fetch, on its jar, which holds the YouTube session.
 * - `media`: the extension's fetch, else libcurl over WebVPN.
 */
export type LaneName = 'direct' | 'catalog' | 'session' | 'media'

const YOUTUBE_ORIGIN = 'https://www.youtube.com'
const YOUTUBE_HOST = /(^|\.)youtube\.com$/

/**
 * The lane a request takes. Signed out: InnerTube POSTs on www.youtube.com go direct, which InnerTube answers for
 * youtube.fkn.app's origin, and every other youtube.com url takes the catalog lane. Signed in: every youtube.com url
 * takes the session lane, since InnerTube's answers carry no Access-Control-Allow-Credentials. Caption GETs go direct
 * either way, their urls being signed and needing no cookie. Anything else (googlevideo, the BotGuard interpreter,
 * GenerateIT) is media.
 */
export const laneOf = (url: string, method: string, signedIn: boolean): LaneName => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'media'
  }
  if (parsed.protocol !== 'https:' || !YOUTUBE_HOST.test(parsed.hostname)) return 'media'
  if (parsed.hostname === 'www.youtube.com') {
    if (method === 'GET' && parsed.pathname === '/api/timedtext') return 'direct'
    if (!signedIn && method === 'POST' && parsed.pathname.startsWith('/youtubei/v1/')) return 'direct'
  }
  return signedIn ? 'session' : 'catalog'
}

const isInnertube = (url: string) => {
  try {
    return new URL(url).pathname.startsWith('/youtubei/v1/')
  } catch {
    return false
  }
}

/**
 * The one shape a direct call leaves in: a CORS simple request (a GET, or a POST with a text/plain body, and no other
 * request header) with no credentials, so the browser's own Google cookies never travel. Simple is required: Firefox
 * refuses youtubei.js's preflighted shape from youtube.fkn.app (measured 2026-11-02, Firefox 151, 4 of 4 contexts),
 * and InnerTube answers X-Origin from this origin with 400 "Origin doesn't match Host for XD3".
 */
export const simpleRequest = (method: 'GET' | 'POST', body: string | undefined, signal?: AbortSignal): RequestInit => ({
  method,
  ...(method === 'POST' && { headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: body ?? '' }),
  credentials: 'omit',
  mode: 'cors',
  redirect: 'follow',
  signal,
})

/** The body with youtubei.js's `X-Goog-Visitor-Id` in its `context.client.visitorData` when it lacks one, since the
 * direct lane sends no header: InnerTube keeps a server-issued visitorData from the body alone (measured 2026-11-02,
 * search, next and browse). A body that already names one, or is not InnerTube JSON, is sent unchanged. */
export const withVisitorData = (body: string, visitorId: string | undefined) => {
  if (!visitorId) return body
  try {
    const payload = JSON.parse(body) as { context?: { client?: { visitorData?: string } } }
    const client = payload?.context?.client
    if (!client || typeof client !== 'object' || client.visitorData) return body
    client.visitorData = visitorId
    return JSON.stringify(payload)
  } catch {
    return body
  }
}

const NULL_BODY_STATUSES = [101, 204, 205, 304]

/** A lane's answer as a Response. A status that carries no body drops the one it came with. */
export const toResponse = ({ status, statusText, headers, body }: Omit<TransportResponse, 'body'> & { body: TransportResponse['body'] | ArrayBuffer }) => {
  if (NULL_BODY_STATUSES.includes(status)) {
    if (body instanceof ReadableStream) void body.cancel().catch(() => {})
    return new Response(null, { status, statusText, headers })
  }
  return new Response(body, { status, statusText, headers })
}

const encoder = new TextEncoder()

const requestParts = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : undefined
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const headers = Object.fromEntries(new Headers(init?.headers ?? request?.headers))
  const raw = init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? await request.clone().arrayBuffer() : undefined)
  const text = typeof raw === 'string' ? raw : undefined
  const body = raw == null ? undefined : text !== undefined ? encoder.encode(text).buffer as ArrayBuffer : await new Response(raw).arrayBuffer()
  return { url, method, headers, body, text, signal: init?.signal ?? request?.signal ?? undefined }
}

type YoutubeFetchOptions = {
  /** Whether this engine holds the session: the FKN page answered a SAPISID at boot. */
  signedIn: boolean
  /** The engine frame's own fetch, for the direct lane; undefined while `yt-client:step:direct` is off. */
  direct: typeof fetch | undefined
  catalog: Lane
  session: Lane
  media: Lane
  /** Hears the direct lane's state for InnerTube calls, once per change. */
  report: (value: DirectReport) => void
  now?: () => number
}

/**
 * The engine's fetch, for youtubei.js and every other read of the engine: each request takes the lane `laneOf` names.
 *
 * A direct answer is YouTube's own whatever its status, and is never sent again. Only a TypeError resends that one
 * request on the lane behind it (catalog signed out, session signed in), and only when that lane then answers with a
 * 2xx are direct calls paused, for `DIRECT_SKIP_MS`: an outage fails both, so it must not turn the direct lane off. A
 * resend repeats only reads, since every write needs a session and a signed-in InnerTube call never goes direct.
 */
export const createYoutubeFetch = ({ signedIn, direct, catalog, session, media, report: hear, now = Date.now }: YoutubeFetchOptions) => {
  let skipUntil = 0
  let reported: DirectReport | undefined
  const report = (value: DirectReport) => {
    if (value === reported) return
    reported = value
    hear(value)
  }
  const behind = signedIn ? session : catalog
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { url, method, headers, body, text, signal } = await requestParts(input, init)
    const request = { method, headers, body }
    const lane = laneOf(url, method, signedIn)
    if (lane === 'media') return media(url, request, signal)
    if (lane !== 'direct' || !direct || (method === 'POST' && text === undefined)) {
      if (isInnertube(url) && (signedIn || !direct)) report('off')
      return behind(url, request, signal)
    }
    if (now() < skipUntil) return behind(url, request, signal)
    try {
      const init = method === 'POST'
        ? simpleRequest('POST', withVisitorData(text!, headers['x-goog-visitor-id']), signal)
        : simpleRequest('GET', undefined, signal)
      const response = await direct(url, init)
      if (isInnertube(url)) report('on')
      return response
    } catch (error) {
      if (signal?.aborted || (error as { name?: unknown } | null)?.name !== 'TypeError') throw error
      const response = await behind(url, request, signal)
      if (response.ok) {
        skipUntil = now() + DIRECT_SKIP_MS
        report('skipped')
        console.warn('[yt-client] a direct YouTube request failed and the lane behind it answered, so direct requests pause for 5 minutes:', String((error as Error).message))
      }
      return response
    }
  }
}

/**
 * The catalog lane: the extension's fetch when it is exposed and can make the request, else the FKN relay, whose
 * nonce the egress worker adds (relay-nonce.ts). The referer, and on a write the origin, are www.youtube.com's, as
 * its own pages send them: InnerTube answers a POST with no Origin with a 403.
 */
export const createCatalogLane = ({ extFetch, relayFetch }: {
  extFetch: ExtEgressFetch
  relayFetch: (url: string, options: TransportRequest) => Promise<TransportResponse>
}): Lane => async (url, { method, headers, body }, signal) => {
  const options: TransportRequest = {
    method,
    headers: { ...headers, referer: `${YOUTUBE_ORIGIN}/`, ...(method === 'GET' || method === 'HEAD' ? {} : { origin: YOUTUBE_ORIGIN }) },
    body: body ?? null,
    redirect: 'follow',
  }
  const response = await extFetch(url, options, signal) ?? await relayFetch(url, options)
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => {})
    throw signal.reason
  }
  return toResponse(response)
}

const ACCOUNTS_LIST = 'https://www.youtube.com/youtubei/v1/account/accounts_list'
const LOGGED_OUT = /"loggedOut"\s*:\s*true/
const PLAYBACK_STATS_PATH = '/api/stats/playback'
const STATS_HOSTS = new Set(['s.youtube.com', 'www.youtube.com'])

type PageFetch = (url: string, request: PageRequest, signal?: AbortSignal) => Promise<PageResponse>

// where a call goes as the channel: InnerTube as it is, the playback registration on www.youtube.com, as youtubei.js
// sends it; undefined for a call the channel does not touch
const channelTarget = (url: string) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.hostname === 'www.youtube.com' && parsed.pathname.startsWith('/youtubei/')) return url
  if (!STATS_HOSTS.has(parsed.hostname) || parsed.pathname !== PLAYBACK_STATS_PATH) return undefined
  parsed.hostname = 'www.youtube.com'
  return parsed.href
}

type AccountRow = { isSelected?: boolean, serviceEndpoint?: { selectActiveIdentityEndpoint?: { supportedTokens?: { pageIdToken?: { pageId?: string } }[] } } }

const accountRows = (value: unknown): AccountRow[] => {
  if (Array.isArray(value)) return value.flatMap(accountRows)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => key === 'accountItem' ? [child as AccountRow] : accountRows(child))
}

// an unknown id is answered as the account's own channel with no error (measured 2026-11-06)
const selectsOther = (text: string, pageId: string) => {
  let rows: AccountRow[]
  try {
    rows = accountRows(JSON.parse(text))
  } catch {
    return false
  }
  return rows.length > 0 && !rows.some((row) => row.isSelected
    && row.serviceEndpoint?.selectActiveIdentityEndpoint?.supportedTokens?.some((token) => token.pageIdToken?.pageId === pageId))
}

/**
 * The session lane: the FKN page's own fetch on its jar. An accounts_list answer that says `loggedOut` means the jar's
 * session has ended, which `onSignedOut` hears.
 *
 * With `pageId`, the engine acts as that brand channel of the signed-in Google account: every InnerTube call carries it
 * as X-Goog-PageId, the one header youtube.com's own client sends for it, and the playback registration goes to
 * www.youtube.com with it, as youtubei.js sends that one. Alone the header picks the channel of the InnerTube reads
 * measured (accounts_list and browse, 2026-11-06); that it does the same for writes is inferred from youtube.com
 * sending it on them too. It acts as the channel only while `readChannel` still names `pageId`, so a sign-out or a new
 * pick in another tab stops it at once. accounts_list keeps the channel honest: an answer that selects another row
 * drops it, and a `loggedOut` answer to it, which is how YouTube answers a page ID another Google login owns (measured
 * 2026-11-06), drops it and asks once more without it, so only that second answer can say the session ended.
 */
export const createSessionLane = (fetchThroughPage: PageFetch, onSignedOut: () => void, pageId?: string): Lane => {
  let channel = pageId
  const drop = (sent: string) => {
    channel = undefined
    forgetChannel(sent)
  }
  const read = async (url: string, request: PageRequest, signal?: AbortSignal) => {
    const answer = await fetchThroughPage(url, request, signal)
    return { answer, text: url.startsWith(ACCOUNTS_LIST) ? new TextDecoder().decode(answer.body) : undefined }
  }
  return async (url, request, signal) => {
    const sent = channel !== undefined && readChannel() === channel ? channel : undefined
    const target = sent ? channelTarget(url) : undefined
    let { answer, text } = target
      ? await read(target, { ...request, headers: { ...request.headers, 'x-goog-pageid': sent! } }, signal)
      : await read(url, request, signal)
    if (text !== undefined && target) {
      if (LOGGED_OUT.test(text)) {
        drop(sent!)
        ;({ answer, text } = await read(url, request, signal))
      } else if (selectsOther(text, sent!)) {
        drop(sent!)
      }
    }
    if (text !== undefined && LOGGED_OUT.test(text)) onSignedOut()
    return toResponse(answer)
  }
}
