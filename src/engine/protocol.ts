export type TransportResponse = {
  status: number
  statusText: string
  headers: [string, string][]
  body: ReadableStream<Uint8Array> | null
}

export type TransportRequest = {
  method?: string
  headers?: Record<string, string>
  body?: ArrayBuffer | null
  redirect?: 'follow' | 'manual'
}

export type EgressApi = {
  fknFetch(url: string, options: TransportRequest): Promise<TransportResponse>
  libcurlFetch(
    requestId: string,
    url: string,
    options: TransportRequest,
  ): Promise<TransportResponse>
  cancelLibcurlFetch(requestId: string): Promise<void>
  prewarm(host: string): Promise<void>
}

export const EGRESS_KEY = 'yt-client-egress'
export const ENGINE_READY = 'yt-client-engine-ready'

export const EGRESS_ABORT_ALL = 'yt-client-egress-abort-all'

/**
 * The engine frame (`ENGINE_PATH`, src/frame/main.ts) says HOST_HELLO to the app realm, which answers HOST_BOOTSTRAP
 * with three ports: ports[0] the EgressApi straight to the egress worker, ports[1] the extension fetch back into the
 * app realm, ports[2] the bridge to the FKN page (agent-host.ts); `signedIn`, the jar that page attached on; and
 * `direct`, whether signed-out InnerTube calls may leave from the frame itself (`yt-client:step:direct`). The frame
 * answers ENGINE_READY with the FrameApi port, or with `error`. The engine frame must not import `@fkn/lib`: importing
 * it anywhere injects an `fkn.app/api` broker iframe into that realm's document. Each side names its build
 * (engine-build.ts), and a peer that names another one, or none, is refused before any port is used.
 */
export const HOST_HELLO = 'yt-client-host-hello'
export const HOST_BOOTSTRAP = 'yt-client-host-bootstrap'

/** The engine frame, a same-origin page of this app's own build. */
export const ENGINE_PATH = '/__yt_engine__/engine.html'

export type HostHello = { type: typeof HOST_HELLO, build: string }
export type HostBootstrap = { type: typeof HOST_BOOTSTRAP, build: string, signedIn: boolean, direct: boolean }
export type EngineReady = { type: typeof ENGINE_READY, error?: string, signedIn?: boolean }

/**
 * HOST_RESTART asks an engine frame that already served an engine for a new one in its place, and is answered by
 * ENGINE_READY as the bootstrap is. Its one port is the new bridge to the FKN page, and `signedIn` the jar that page
 * attached on; the frame keeps the bootstrap's egress and extension fetch ports, and refuses a jar it did not boot on.
 */
export const HOST_RESTART = 'yt-client-host-restart'

export type HostRestart = { type: typeof HOST_RESTART, signedIn: boolean }

export type ExtFetchRequest = {
  type: 'fetch'
  id: number
  url: string
  options: TransportRequest
} | {
  type: 'cancel'
  id: number
}

export type ExtFetchResponse = {
  id: number
  response: TransportResponse | null
  error?: never
} | {
  id: number
  response?: never
  error: string
}
