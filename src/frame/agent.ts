import type { AgentApi, AgentCancel, AgentMethod, AgentResponse, EngineReport, PageRequest, PageResponse } from '../engine/agent-protocol'

import { AGENT_METHODS } from '../engine/agent-protocol'

// past this a BotGuard call counts as the FKN page's failure; under botguard.ts's 10000 ms wait so a new session still lands inside it
const AGENT_CALL_TIMEOUT_MS = 5_000

let port: MessagePort | undefined
let requestId = 0
const pending = new Map<number, { resolve(value: unknown): void, reject(error: Error): void }>()

/** Connects the engine to the app realm's bridge to the FKN page (agent-host.ts). */
export const connectAgent = (next: MessagePort) => {
  next.addEventListener('message', (event) => {
    const message = event.data as AgentResponse
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error !== undefined) request.reject(new Error(message.error))
    else request.resolve(message.result)
  })
  next.start()
  port = next
}

const notConnected = () => new Error('yt-client agent: the FKN page is not connected')

// a call with no deadline ends with its signal: the page's fetch is then aborted where it runs
const call = (target: MessagePort, method: AgentMethod, args: unknown[], { timeoutMs, signal }: { timeoutMs?: number, signal?: AbortSignal } = {}) =>
  new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const id = ++requestId
    const giveUp = (error: unknown) => {
      if (!pending.delete(id)) return
      target.postMessage({ type: 'cancel', id } satisfies AgentCancel)
      reject(error)
    }
    const timeout = timeoutMs === undefined
      ? undefined
      : setTimeout(() => giveUp(new Error(`yt-client agent: ${method} timed out after ${timeoutMs} ms`)), timeoutMs)
    const onAbort = () => giveUp(signal!.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const settle = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    pending.set(id, {
      resolve: (value) => {
        settle()
        resolve(value)
      },
      reject: (error) => {
        settle()
        reject(error)
      },
    })
    target.postMessage({ id, method, args })
  })

/** BotGuard's half in the FKN page, each call bounded by 5000 ms, or undefined when no bridge was connected. */
export const engineAgent = (): AgentApi | undefined => {
  const target = port
  if (!target) return undefined
  return Object.fromEntries(AGENT_METHODS.map((method) => [method, (...args: unknown[]) => call(target, method, args, { timeoutMs: AGENT_CALL_TIMEOUT_MS })])) as AgentApi
}

/** A request through the FKN page's own fetch, on its jar. It has no deadline: `signal` ends it, in the page too. */
export const pageFetch = async (url: string, request: PageRequest, signal?: AbortSignal) => {
  if (!port) throw notConnected()
  return await call(port, 'fetch', [url, request], { signal }) as PageResponse
}

/** The FKN page's `document.cookie`, bounded by `timeoutMs`. */
export const pageCookie = async (timeoutMs = AGENT_CALL_TIMEOUT_MS) => {
  if (!port) throw notConnected()
  return await call(port, 'cookie', [], { timeoutMs }) as string
}

/** Tells the app realm the last mint's kind, the session's VM or the direct lane's state; nothing is sent with no bridge. */
export const reportEngine = (report: Omit<EngineReport, 'type'>) => {
  port?.postMessage({ type: 'report', ...report } satisfies EngineReport)
}
