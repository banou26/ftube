import type { IntegrityTokenData } from 'bgutils-js'

/**
 * The FKN blank page BotGuard's VM runs in, presented at this url and never loaded from it. Its jar follows
 * `yt-client:signed-in` (signed-in.ts): `'ephemeral'` signed out, `'persistent'` signed in, where FKN's jar holds the
 * YouTube session and the page's own requests carry it.
 */
export const AGENT_PAGE_URL = 'https://www.youtube.com/__yt_client__/frame'
export const AGENT_PAGE_ORIGIN = 'https://www.youtube.com'

/** The message the app realm posts to the page with the agent's port as its one transferred port. */
export const AGENT_INSTALL = 'yt-client:agent'

/** The name the agent's IIFE bundle binds (vite.agent.config.ts), local to the function agent-source.ts wraps it in, whose `install` the app calls after it. */
export const AGENT_GLOBAL = 'YtClientAgent'

export type AgentChallenge = {
  interpreter: string
  program: string
  globalName: string
  /** The `ytcfg` of the watch page the challenge came from, set as the page's `yt.config_` before the interpreter runs. */
  config: Record<string, unknown>
}

/**
 * The agent's methods, each reached as a numbered request on its port. A session is the agent's
 * number for one BotGuard VM; the caller keeps the challenge, GenerateIT and the token's lifetime.
 */
export type AgentApi = {
  /** Sets `yt.config_`, runs the interpreter as an inline script and loads the program: `BotGuardClient.create`. */
  create(challenge: AgentChallenge): Promise<number>
  /** BotGuard's response for GenerateIT; the signal functions it fills stay with the session. */
  snapshot(session: number): Promise<string>
  /** `WebPoMinter.create` from GenerateIT's answer and the session's own signal functions. */
  minter(session: number, token: IntegrityTokenData): Promise<void>
  mint(session: number, identifier: string): Promise<string>
  shutdown(session: number): Promise<void>
  /** Evaluates a youtubei.js decipher snippet in the attached page and returns its result. */
  decipher(script: string): Promise<unknown>
  /**
   * The page's own fetch, with its jar's cookies (`credentials: 'include'`) and a `cookie` header dropped, answered
   * whole. A `cancel` for the call's id aborts it in flight.
   */
  fetch(url: string, request: PageRequest): Promise<PageResponse>
  /** The page's `document.cookie`: every cookie of its jar but the HttpOnly ones. */
  cookie(): Promise<string>
}

export type PageRequest = { method?: string, headers?: Record<string, string>, body?: ArrayBuffer }

export type PageResponse = { status: number, statusText: string, headers: [string, string][], body: ArrayBuffer }

export const AGENT_METHODS = ['create', 'snapshot', 'minter', 'mint', 'shutdown', 'decipher', 'fetch', 'cookie'] as const satisfies readonly (keyof AgentApi)[]

export type AgentMethod = (typeof AGENT_METHODS)[number]

const agentMethods: ReadonlySet<string> = new Set(AGENT_METHODS)

export const isAgentMethod = (value: unknown): value is AgentMethod =>
  typeof value === 'string' && agentMethods.has(value)

export type AgentRequest = {
  [Method in AgentMethod]: { id: number, method: Method, args: Parameters<AgentApi[Method]> }
}[AgentMethod]

export type AgentResponse = { id: number, result: unknown, error?: never } | { id: number, result?: never, error: string }

/** What the frame posts on the bridge when it stops waiting for call `id`: a call still queued never runs, and a `fetch` in flight is aborted. */
export type AgentCancel = { type: 'cancel', id: number }

/** Messages on an agent port that are not answers: `ready` once the agent holds the port, the heartbeat's `ping` and `pong`. */
export type AgentControl = { type: 'ready' } | { type: 'ping' } | { type: 'pong' }

export const MINT_KINDS = ['session', 'stored', 'cold'] as const
export const ENGINES = ['agent'] as const
export const DIRECT_STATES = ['on', 'off', 'skipped'] as const

/**
 * What the frame tells the app realm over the bridge, published on `<html>` as `data-yt-mint`, `data-yt-engine` and
 * `data-yt-direct`: the last mint's kind, which VM built the session in use, and the direct lane's state (lanes.ts).
 */
export type EngineReport = {
  type: 'report'
  mint?: (typeof MINT_KINDS)[number]
  engine?: (typeof ENGINES)[number]
  direct?: (typeof DIRECT_STATES)[number]
}
