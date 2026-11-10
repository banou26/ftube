import type { IntegrityTokenData } from 'bgutils-js'

import type { AgentApi } from '../engine/agent-protocol'

import { BG, buildURL, GOOG_API_KEY } from 'bgutils-js'

import { engineAgent, reportEngine } from './agent'
import { egressFetch } from './egress'
import { takePageChallenge } from './watch-page'

// the interpreter and GenerateIT take the media lane (the extension or libcurl), as they always have
const attestFetch = (url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) =>
  egressFetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
    body: init?.body ? (new TextEncoder().encode(init.body).buffer as ArrayBuffer) : null,
    redirect: 'follow',
  })

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
// the name Scramjet's www.youtube.com realm stored it under, kept so a browser keeps its tokens
const TOKEN_STORE_KEY = 'www.youtube.com@yt-client:po-tokens'

// a session of the FKN page's VM, reached through its port (createAgentSession)
type MinterSession = {
  client: { shutdown(): Promise<unknown> }
  minter: { mintAsWebsafeString(identifier: string): Promise<string> }
  expiresAt: number
}

type StoredToken = {
  token: string
  expiresAt: number
}

let session: MinterSession | undefined
let pending: Promise<MinterSession> | undefined

const readStoredTokens = (): Record<string, StoredToken> => {
  try {
    const raw = localStorage.getItem(TOKEN_STORE_KEY)
    return raw ? JSON.parse(raw) as Record<string, StoredToken> : {}
  } catch {
    return {}
  }
}

const storeToken = (identifier: string, token: string, expiresAt: number) => {
  try {
    const tokens = readStoredTokens()
    for (const [key, value] of Object.entries(tokens)) {
      if (value.expiresAt <= Date.now()) delete tokens[key]
    }
    tokens[identifier] = { token, expiresAt }
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(tokens))
  } catch {}
}

const readStoredToken = (identifier: string) => {
  const stored = readStoredTokens()[identifier]
  return stored && stored.expiresAt > Date.now() ? stored.token : undefined
}

export const clearStoredTokens = () => {
  try {
    localStorage.removeItem(TOKEN_STORE_KEY)
  } catch {}
}

// Innertube answers a POST with no Origin with a 403
const YOUTUBE_ORIGIN_HEADERS = {
  origin: 'https://www.youtube.com',
  referer: 'https://www.youtube.com/',
} as const

const fetchChallenge = async () => {
  const page = await takePageChallenge()
  const interpreter = await attestFetch(page.interpreterUrl).then((result) => result.text())
  return { ...page, interpreter }
}

type Challenge = Awaited<ReturnType<typeof fetchChallenge>>

const stage = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`botguard: ${name} failed: ${reason}`, { cause: error })
  }
}

const generateIntegrityToken = async (botguardResponse: string) => {
  const integrity = await stage('GenerateIT', async () => {
    const response = await attestFetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: {
        ...YOUTUBE_ORIGIN_HEADERS,
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': GOOG_API_KEY,
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    })
    if (!response.ok) throw new Error(`returned ${response.status}`)
    return await response.json() as [string | null, number, number | null, string]
  })
  const token = {
    integrityToken: integrity[0] ?? undefined,
    estimatedTtlSecs: integrity[1],
    mintRefreshThreshold: integrity[2] ?? undefined,
    websafeFallbackToken: integrity[3],
  } satisfies IntegrityTokenData
  if (!token.integrityToken && !token.websafeFallbackToken) throw new Error('botguard: integrity token is missing')
  return token
}

// the VM runs in the FKN page, while the challenge, GenerateIT and the token's lifetime stay here
const createAgentSession = async (challenge: Challenge, agent: AgentApi): Promise<MinterSession> => {
  const id = await stage('agent interpreter', () => agent.create({
    interpreter: challenge.interpreter,
    program: challenge.program,
    globalName: challenge.globalName,
    config: challenge.config,
  }))
  try {
    const botguardResponse = await stage('agent snapshot', () => agent.snapshot(id))
    const token = await generateIntegrityToken(botguardResponse)
    await stage('agent minter', () => agent.minter(id, token))
    return {
      client: { shutdown: () => agent.shutdown(id) },
      minter: { mintAsWebsafeString: (identifier) => agent.mint(id, identifier) },
      expiresAt: performance.now() + (token.estimatedTtlSecs ?? 3_600) * 800,
    }
  } catch (error) {
    void agent.shutdown(id).catch(() => {})
    throw error
  }
}

const newSession = async () => {
  const agent = engineAgent()
  if (!agent) throw new Error('botguard: the FKN page is not connected')
  const challenge = await stage('challenge', fetchChallenge)
  const next = await createAgentSession(challenge, agent)
  reportEngine({ engine: 'agent' })
  return next
}

const reported = new Set<string>()

const reportSessionFailure = (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error)
  if (reported.has(reason)) return
  reported.add(reason)
  console.error(
    `yt-client: botguard session failed, falling back to cold-start tokens (playback will stop at the preview limit): ${reason}`,
    error,
  )
}

const startSession = () => {
  const attempt: Promise<MinterSession> = newSession().then(
    (next) => {
      if (pending === attempt) pending = undefined
      // a session waited out can settle after the one started in its place: the first to settle is kept
      if (session && performance.now() < session.expiresAt) {
        void next.client.shutdown().catch(() => {})
        return session
      }
      session = next
      reported.clear()
      return next
    },
    (error: unknown) => {
      if (pending === attempt) pending = undefined
      reportSessionFailure(error)
      throw error
    },
  )
  void attempt.catch(() => {})
  return attempt
}

const getSession = () => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= startSession()
  return pending
}

// cap on a persisted token's own ttl, as insurance against a server-side invalidation we cannot observe
const PERSISTED_TOKEN_MAX_MS = 6 * 3_600_000

const mintSessionToken = async (target: MinterSession, identifier: string) => {
  const token = await target.minter.mintAsWebsafeString(identifier)
  const remaining = Math.max(0, target.expiresAt - performance.now())
  storeToken(identifier, token, Date.now() + Math.min(remaining, PERSISTED_TOKEN_MAX_MS))
  return token
}

const reportedMintFailures = new Set<string>()

// a session whose mint fails (the FKN page replaced or gone) is dropped and answers undefined, so the caller goes on to a stored token or a new session
const mintLive = async (target: MinterSession, identifier: string) => {
  try {
    const token = await mintSessionToken(target, identifier)
    reportEngine({ mint: 'session' })
    return token
  } catch (error) {
    if (session === target) session = undefined
    void target.client.shutdown().catch(() => {})
    const reason = error instanceof Error ? error.message : String(error)
    if (!reportedMintFailures.has(reason)) {
      reportedMintFailures.add(reason)
      console.warn(`yt-client: a BotGuard session's mint failed, so a new session is started: ${reason}`)
    }
    return undefined
  }
}

const REFRESH_MARGIN_MS = 30 * 60_000

export const warmPoTokenSession = (identifier: string) => {
  if (session && performance.now() < session.expiresAt) return
  const stored = readStoredTokens()[identifier]
  if (stored && stored.expiresAt - Date.now() > REFRESH_MARGIN_MS) return
  void getSession().catch(() => {})
}

const SESSION_WAIT_MS = 10_000

const sessionWait = () => new Promise<undefined>((resolve) => { setTimeout(() => resolve(undefined), SESSION_WAIT_MS) })

let waitedOut: Promise<MinterSession> | undefined

// MUST wait rather than start cold: SABR fixes attestation state from a stream's first request, for its whole life.
// A session waited the whole SESSION_WAIT_MS is not waited on again, and is used if it settles; one new session starts
// in its place, not waited on either, so a session that never settles costs one wait instead of every token after it
// (measured 2026-10-16: an interpreter fetch that died with fkn.app's data plane worker never settled)
const waitForSession = async (waitOver: Promise<undefined>) => {
  const next = getSession()
  if (next === waitedOut) return undefined
  const live = await Promise.race([next, waitOver])
  if (!live && next === pending) pending = waitedOut = startSession()
  return live
}

export const mintPoToken = async (identifier: string) => {
  if (session && performance.now() < session.expiresAt) {
    const minted = await mintLive(session, identifier)
    if (minted !== undefined) return minted
  }
  const stored = readStoredToken(identifier)
  if (stored) {
    reportEngine({ mint: 'stored' })
    warmPoTokenSession(identifier)
    return stored
  }
  const waitOver = sessionWait()
  const live = await waitForSession(waitOver).catch(() => undefined)
  if (live) {
    const minted = await mintLive(live, identifier)
    if (minted !== undefined) return minted
    // its first mint failed, which dropped it, so a new session gets the rest of the wait
    const next = await Promise.race([getSession().catch(() => undefined), waitOver])
    const retried = next && await mintLive(next, identifier)
    if (retried !== undefined) return retried
  }
  reportEngine({ mint: 'cold' })
  return BG.PoToken.generateColdStartToken(identifier)
}

export const recoverPoTokenSession = async () => {
  clearStoredTokens()
  await resetPoTokenSession()
  await waitForSession(sessionWait())
}

export const resetPoTokenSession = async () => {
  if (!session) return
  const current = session
  session = undefined
  await current.client.shutdown().catch(() => {})
}
