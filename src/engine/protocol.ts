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

/* The sign-in window (`SIGNIN_WINDOW_PATH`) is a same-origin popup the app opens on the click. It says SIGNIN_HELLO to its
   opener, which answers SIGNIN_PORTS with ports[0], an EgressApi port to the opener's egress worker, so every hop of the
   sign-in leaves through the app's own libcurl over WebVPN, as it did inline. SIGNIN_DONE tells the opener the window's Scramjet jar holds
   the session and was persisted, which the engine's controller reads through IndexedDB `__scramjet_controller`. */
export const SIGNIN_WINDOW_PATH = '/__yt_scramjet__/signin.html'
export const SIGNIN_HELLO = 'yt-client-signin-hello'
export const SIGNIN_PORTS = 'yt-client-signin-ports'
export const SIGNIN_DONE = 'yt-client-signin-done'

// the window names its build as the engine host does (engine-build.ts): it loads from a fixed path, so a tab opened before a deploy gets the new one
export type SignInWindowMessage = { type: typeof SIGNIN_HELLO, build: string } | { type: typeof SIGNIN_DONE }
export type SignInPorts = { type: typeof SIGNIN_PORTS }

export type EgressRole = 'engine' | 'signin'
/** The sign-in window's libcurl request ids start with it, so an engine reset's abort leaves them alone. */
export const SIGNIN_REQUEST_PREFIX = 'signin:'
