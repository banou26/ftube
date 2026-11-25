import type { EgressApi, EngineReady, HostBootstrap, HostHello, HostRestart } from '../engine/protocol'
import type { Lane } from './lanes'

import { expose } from 'osra'

import { buildId, ENGINE_BUILD_MISMATCH } from '../engine/engine-build'
import { EGRESS_KEY, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO, HOST_RESTART } from '../engine/protocol'
import { clearSignedIn, readChannel } from '../engine/signed-in'
import { connectAgent, pageCookie, pageFetch, reportEngine } from './agent'
import { connectEgress, egressFetch } from './egress'
import { createExtFetch, serveMediaPort } from './egress-ports'
import { createCatalogLane, createSessionLane, createYoutubeFetch } from './lanes'
import { readSession, realm } from './realm'

const BOOTSTRAP_TIMEOUT_MS = 30_000
// signed in, the boot waits for the FKN page's cookies, which can take an attach and a card the person still answers
const SESSION_READ_MS = 30_000

const stage = (value: string) => {
  document.documentElement.dataset.stage = value
}

const toApp = (message: HostHello | EngineReady, transfer: Transferable[] = []) => window.parent.postMessage(message, location.origin, transfer)

let bootAttempt: number | undefined

const bootstrap = new Promise<{ egress: MessagePort, extFetch: MessagePort, agent: MessagePort, signedIn: boolean, direct: boolean, attempt?: number }>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('yt-client: engine bootstrap ports never arrived')), BOOTSTRAP_TIMEOUT_MS)
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== window.parent) return
    const message = event.data as Partial<HostBootstrap> | undefined
    if (message?.type !== HOST_BOOTSTRAP) return
    window.removeEventListener('message', onMessage)
    clearTimeout(timeout)
    bootAttempt = message.attempt
    if (message.build !== buildId()) {
      for (const port of event.ports) port.close()
      reject(new Error(ENGINE_BUILD_MISMATCH))
      return
    }
    const [egress, extFetch, agent] = event.ports
    if (!egress || !extFetch || !agent) {
      reject(new Error('yt-client: engine bootstrap ports are missing'))
      return
    }
    resolve({ egress, extFetch, agent, signedIn: message.signedIn === true, direct: message.direct !== false, attempt: message.attempt })
  }
  window.addEventListener('message', onMessage)
  toApp({ type: HOST_HELLO, build: buildId() })
})

const readyFields = (attempt: number | undefined) => (attempt !== undefined ? { attempt } : {})

const boot = async () => {
  stage('bootstrap')
  const { egress, extFetch: extFetchPort, agent, signedIn, direct, attempt } = await bootstrap
  egress.start()
  const remote = expose<EgressApi>({}, { key: EGRESS_KEY, transport: { receive: egress, emit: egress } })
  const extFetch = createExtFetch(extFetchPort)
  const media = new MessageChannel()
  serveMediaPort(media.port2, { extFetch, remote, prefix: `frame:${crypto.randomUUID().slice(0, 8)}` })
  connectEgress(media.port1)
  connectAgent(agent)
  window.addEventListener('pagehide', () => {
    for (const port of [egress, extFetchPort, media.port1, media.port2, agent]) port.close()
  }, { once: true })

  stage('session')
  const session = signedIn ? await readSession(() => pageCookie(SESSION_READ_MS)) : { signedOut: false }
  if (session.signedOut) clearSignedIn()
  realm.cookie = session.cookie
  const directFetch = direct ? (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) : undefined
  const catalogLane = createCatalogLane({ extFetch, relayFetch: async (url, options) => (await remote).fknFetch(url, options) })
  const mediaLane: Lane = (url, { method, headers, body }, signal) =>
    egressFetch(url, { method, headers, body: body ?? null, redirect: 'follow' }, signal)
  realm.fetch = createYoutubeFetch({
    signedIn: session.cookie !== undefined,
    direct: directFetch,
    catalog: catalogLane,
    session: createSessionLane(pageFetch, () => {
      realm.signedOut = true
      clearSignedIn()
    }, session.cookie === undefined ? undefined : readChannel()),
    media: mediaLane,
    report: (value) => reportEngine({ direct: value }),
  })
  // ANDROID_VR caption requests cannot use Web cookies or SAPISIDHASH, so keep a separate unauthenticated fetcher
  realm.anonymousFetch = createYoutubeFetch({
    signedIn: false,
    direct: directFetch,
    catalog: catalogLane,
    session: catalogLane,
    media: mediaLane,
    report: () => {},
  })

  stage('engine')
  const { connect } = await import('./index')
  const serve = (forAttempt: number | undefined) => {
    const api = new MessageChannel()
    const disconnect = connect(api.port1)
    toApp({ type: ENGINE_READY, signedIn: realm.cookie !== undefined, ...readyFields(forAttempt) }, [api.port2])
    return disconnect
  }
  let disconnect = serve(attempt)
  // a restart keeps this realm and the session it read, so it takes only a bridge on the jar it booted on
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return
    const message = event.data as Partial<HostRestart> | undefined
    if (message?.type !== HOST_RESTART) return
    disconnect()
    const [next] = event.ports
    if (!next || message.signedIn !== signedIn) {
      for (const port of event.ports) port.close()
      toApp({ type: ENGINE_READY, error: 'yt-client: the engine frame booted on another jar', ...readyFields(message.attempt) })
      return
    }
    connectAgent(next)
    disconnect = serve(message.attempt)
  })
  stage('ready')
}

void boot().catch((error: unknown) => {
  stage('error')
  toApp({ type: ENGINE_READY, error: error instanceof Error ? error.message : String(error), ...readyFields(bootAttempt) })
})
