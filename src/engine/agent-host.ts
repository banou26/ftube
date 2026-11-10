import type { AgentCancel, AgentControl, AgentRequest, AgentResponse, EngineReport } from './agent-protocol'

import { startPlatform } from './platform'
import { readSignedIn } from './signed-in'
import { AGENT_INSTALL, AGENT_PAGE_ORIGIN, AGENT_PAGE_URL, DIRECT_STATES, ENGINES, MINT_KINDS } from './agent-protocol'

/** What the host needs of an attached engine page: the part of `@fkn/lib`'s `Frame` it calls. */
export type AgentFrame = {
  addScriptTag(options: { content: string, sourceUrl?: string }): Promise<void>
  postMessage(message: unknown, options: { targetOrigin: string, transfer: Transferable[] }): Promise<void>
  on(type: 'document', listener: () => void): void
}

export type AgentHostOptions = {
  /** Mounts a fresh frame and attaches the engine page in it; `detach` removes it. */
  attach: () => Promise<{ frame: AgentFrame, detach: () => void }>
  /** The agent bundle with its install call, as one classic script. */
  source: () => Promise<string>
  publish: (name: 'ytMint' | 'ytEngine' | 'ytDirect', value: string) => void
  now?: () => number
}

/** The answer to every bridged call while the engine page cannot be had, so the frame falls back at once. */
export const AGENT_UNAVAILABLE = 'yt-client agent: the engine page is unavailable'
/** The answer to a call in flight when its page was replaced (a new document, a missed heartbeat). */
export const AGENT_REPLACED = 'yt-client agent: the engine page was replaced during the call'

const HEARTBEAT_MS = 5_000
const SILENCE_MS = 15_000
const INSTALL_TIMEOUT_MS = 5_000
// after a failed attach or install, the next attach waits this long, doubled per failure in a row up to the cap
export const RETRY_MS = 1_000
export const RETRY_MAX_MS = 30_000
const AGENT_SOURCE_URL = 'yt-client-botguard-agent.js'

const waitForReady = (port: MessagePort) => new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('yt-client agent: the agent never took its port')), INSTALL_TIMEOUT_MS)
  port.addEventListener('message', (event) => {
    if ((event.data as AgentControl | undefined)?.type !== 'ready') return
    clearTimeout(timeout)
    resolve()
  })
  port.start()
})

const isReport = (message: unknown): message is EngineReport =>
  (message as EngineReport | null)?.type === 'report'

const isCancel = (message: unknown): message is AgentCancel =>
  (message as AgentCancel | null)?.type === 'cancel'

/**
 * The app realm's side of the FKN page. One attachment per app realm, kept across engine resets;
 * each engine generation gets a bridge, whose frame end goes in `HOST_BOOTSTRAP` (or in
 * `HOST_RESTART` for an engine started again in a kept frame), and the host relays it to whichever
 * agent port is current. A `document` event installs the agent again on the same attachment, and a
 * ping (sent every 5000 ms) that 15000 ms bring nothing back for attaches again. While the page is
 * attaching a call waits, unless the frame cancels it, and a cancel of a call in flight reaches the
 * page. After a failed attach or install, calls are answered `AGENT_UNAVAILABLE` at once until the
 * backoff (`RETRY_MS`, doubling) has passed; then the next call or bridge attaches again and the call
 * waits for it. `stop` detaches for good.
 */
export const createAgentHost = ({ attach, source, publish, now = Date.now }: AgentHostOptions) => {
  let state: 'attaching' | 'ready' | 'failed' | 'stopped' = 'attaching'
  let failures = 0
  let retryAt = 0
  let generation = 0
  let attachment: Awaited<ReturnType<AgentHostOptions['attach']>> | undefined
  let agent: MessagePort | undefined
  let bridge: MessagePort | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  // when the oldest ping nothing has answered yet went out
  let unanswered: number | undefined
  const queued: AgentRequest[] = []
  const inFlight = new Set<number>()

  const answerBridge = (id: number, error: string) => bridge?.postMessage({ id, error } satisfies AgentResponse)

  const dropAgent = () => {
    clearInterval(heartbeat)
    heartbeat = undefined
    agent?.close()
    agent = undefined
    for (const id of inFlight) answerBridge(id, AGENT_REPLACED)
    inFlight.clear()
  }

  const fail = (error: unknown) => {
    dropAgent()
    state = 'failed'
    failures++
    retryAt = now() + Math.min(RETRY_MS * 2 ** (failures - 1), RETRY_MAX_MS)
    for (const request of queued.splice(0)) answerBridge(request.id, AGENT_UNAVAILABLE)
    console.warn('[yt-client] the FKN page is unavailable until it attaches again:', error instanceof Error ? error.message : String(error))
  }

  const retry = () => {
    if (state === 'failed' && now() >= retryAt) void attachAgain()
  }

  const send = (request: AgentRequest) => {
    retry()
    if (state === 'failed' || state === 'stopped') answerBridge(request.id, AGENT_UNAVAILABLE)
    else if (!agent) queued.push(request)
    else {
      inFlight.add(request.id)
      agent.postMessage(request)
    }
  }

  const take = (port: MessagePort) => {
    agent = port
    state = 'ready'
    failures = 0
    unanswered = undefined
    port.addEventListener('message', (event) => {
      unanswered = undefined
      const message = event.data as AgentResponse | AgentControl
      if ('id' in message && inFlight.delete(message.id)) bridge?.postMessage(message)
    })
    // silence counts from a ping, not from the last answer: a hidden tab runs this about once a minute while the page is fine
    heartbeat = setInterval(() => {
      if (unanswered !== undefined && Date.now() - unanswered >= SILENCE_MS) void attachAgain()
      else {
        unanswered ??= Date.now()
        port.postMessage({ type: 'ping' } satisfies AgentControl)
      }
    }, HEARTBEAT_MS)
    for (const request of queued.splice(0)) send(request)
  }

  const install = async (frame: AgentFrame) => {
    const current = ++generation
    dropAgent()
    state = 'attaching'
    const channel = new MessageChannel()
    try {
      await frame.addScriptTag({ content: await source(), sourceUrl: AGENT_SOURCE_URL })
      const ready = waitForReady(channel.port1)
      // a failed postMessage leaves this wait to time out on its own, after the catch below has run
      ready.catch(() => {})
      await frame.postMessage({ type: AGENT_INSTALL }, { targetOrigin: AGENT_PAGE_ORIGIN, transfer: [channel.port2] })
      await ready
      if (current !== generation) {
        channel.port1.close()
        return
      }
      take(channel.port1)
    } catch (error) {
      channel.port1.close()
      if (current === generation) fail(error)
    }
  }

  const attachAgain = async () => {
    const current = ++generation
    dropAgent()
    attachment?.detach()
    attachment = undefined
    state = 'attaching'
    try {
      const next = await attach()
      if (current !== generation) {
        next.detach()
        return
      }
      attachment = next
      next.frame.on('document', () => { if (attachment === next) void install(next.frame) })
      await install(next.frame)
    } catch (error) {
      if (current === generation) fail(error)
    }
  }

  const relay = (message: unknown) => {
    if (isReport(message)) {
      if (message.engine && ENGINES.includes(message.engine)) publish('ytEngine', message.engine)
      if (message.mint && MINT_KINDS.includes(message.mint)) publish('ytMint', message.mint)
      if (message.direct && DIRECT_STATES.includes(message.direct)) publish('ytDirect', message.direct)
      return
    }
    if (isCancel(message)) {
      const index = queued.findIndex(({ id }) => id === message.id)
      if (index !== -1) queued.splice(index, 1)
      else if (inFlight.has(message.id)) agent?.postMessage({ type: 'cancel', id: message.id } satisfies AgentCancel)
      return
    }
    const request = message as AgentRequest
    if (typeof request?.id === 'number') send(request)
  }

  /** A new bridge for a new engine generation: the previous one closes, and a live agent takes a fresh port. */
  const openBridge = () => {
    const previous = bridge
    previous?.close()
    // the previous generation's calls are cleared before the switch, so none is answered on the new bridge, whose ids start over
    queued.length = 0
    inFlight.clear()
    const channel = new MessageChannel()
    bridge = channel.port1
    channel.port1.addEventListener('message', (event) => relay(event.data))
    channel.port1.start()
    if (previous && state === 'ready' && attachment) void install(attachment.frame)
    retry()
    return channel.port2
  }

  /** Detaches the page and attaches no other: every call from then on is answered `AGENT_UNAVAILABLE`. */
  const stop = () => {
    generation++
    dropAgent()
    state = 'stopped'
    for (const request of queued.splice(0)) answerBridge(request.id, AGENT_UNAVAILABLE)
    attachment?.detach()
    attachment = undefined
  }

  void attachAgain()
  return { openBridge, stop }
}

// rendered rather than display: none, as the brief has it; whether an off screen cross-origin frame's timers slow is measured at Y1
const HIDDEN_FRAME_STYLE = 'position: fixed; left: -10px; top: -10px; width: 1px; height: 1px; border: 0; pointer-events: none;'

/** A frame for an FKN attachment, rendered 1 px off screen and out of the tab order. */
export const mountHiddenFrame = () => {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = HIDDEN_FRAME_STYLE
  document.body.appendChild(iframe)
  return iframe
}

const attachEnginePage = async (signedIn: boolean) => {
  await startPlatform()
  // the platform mounted the broker before its own import of the lib, so this import adds no second one
  const { attachFrame } = await import('@fkn/lib')
  const iframe = mountHiddenFrame()
  try {
    const frame = await attachFrame({ iframe, blank: { url: AGENT_PAGE_URL }, cookies: signedIn ? 'persistent' : 'ephemeral' })
    return { frame, detach: () => iframe.remove() }
  } catch (error) {
    iframe.remove()
    throw error
  }
}

let host: (ReturnType<typeof createAgentHost> & { signedIn: boolean }) | undefined

/**
 * Starts attaching the FKN page, once per app realm until `stopAgentHost`. `signedIn` is the jar it attached on,
 * read from `yt-client:signed-in` at that start, and it is what the engine is told.
 */
export const startAgentHost = () => {
  if (host) return host
  const signedIn = readSignedIn()
  host = {
    ...createAgentHost({
      attach: () => attachEnginePage(signedIn),
      source: () => import('./agent-source').then(({ agentSource }) => agentSource(location.origin)),
      publish: (name, value) => { document.documentElement.dataset[name] = value },
    }),
    signedIn,
  }
  return host
}

/** Detaches the FKN page, so nothing in flight on its jar can set a cookie again; the next start attaches anew. */
export const stopAgentHost = () => {
  host?.stop()
  host = undefined
}
