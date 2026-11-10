import type { EgressApi, EngineReady, HostBootstrap, HostHello } from '../engine/protocol'

import { expose } from 'osra'

import { buildId, ENGINE_BUILD_MISMATCH } from '../engine/engine-build'
import { EGRESS_KEY, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO } from '../engine/protocol'
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

const bootstrap = new Promise<{ egress: MessagePort, extFetch: MessagePort, agent: MessagePort, signedIn: boolean, direct: boolean }>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('yt-client: engine bootstrap ports never arrived')), BOOTSTRAP_TIMEOUT_MS)
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== window.parent) return
    const message = event.data as Partial<HostBootstrap> | undefined
    if (message?.type !== HOST_BOOTSTRAP) return
    window.removeEventListener('message', onMessage)
    clearTimeout(timeout)
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
    resolve({ egress, extFetch, agent, signedIn: message.signedIn === true, direct: message.direct !== false })
  }
  window.addEventListener('message', onMessage)
  toApp({ type: HOST_HELLO, build: buildId() })
})

const boot = async () => {
  stage('bootstrap')
  const { egress, extFetch: extFetchPort, agent, signedIn, direct } = await bootstrap
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
  realm.fetch = createYoutubeFetch({
    signedIn: session.cookie !== undefined,
    direct: direct ? (input, init) => fetch(input, init) : undefined,
    catalog: createCatalogLane({ extFetch, relayFetch: async (url, options) => (await remote).fknFetch(url, options) }),
    session: createSessionLane(pageFetch, () => {
      realm.signedOut = true
      clearSignedIn()
    }, session.cookie === undefined ? undefined : readChannel()),
    media: (url, { method, headers, body }, signal) => egressFetch(url, { method, headers, body: body ?? null, redirect: 'follow' }, signal),
    report: (value) => reportEngine({ direct: value }),
  })

  stage('engine')
  const { connect } = await import('./index')
  const api = new MessageChannel()
  connect(api.port1)
  toApp({ type: ENGINE_READY, signedIn: realm.cookie !== undefined }, [api.port2])
  stage('ready')
}

void boot().catch((error: unknown) => {
  stage('error')
  toApp({ type: ENGINE_READY, error: error instanceof Error ? error.message : String(error) })
})
