import type { EgressApi, ExtFetchRequest, ExtFetchResponse, TransportRequest, TransportResponse } from '../engine/protocol'
import type { FrameEgressRequest, FrameEgressResponse } from './protocol'

/** The extension's fetch from the app realm: null when the extension is not exposed or cannot make the request. */
export type ExtEgressFetch = (url: string, options: TransportRequest, signal?: AbortSignal) => Promise<TransportResponse | null>

/** The engine's end of the app realm's extension fetch (platform.ts `openExtFetchPort`). */
export const createExtFetch = (port: MessagePort): ExtEgressFetch => {
  let requestId = 0
  const pending = new Map<number, { resolve(value: TransportResponse | null): void, reject(reason: unknown): void }>()
  port.addEventListener('message', (event) => {
    const message = event.data as ExtFetchResponse
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.response ?? null)
  })
  port.start()
  return (url, options, signal) => new Promise<TransportResponse | null>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const id = ++requestId
    pending.set(id, { resolve, reject })
    signal?.addEventListener('abort', () => {
      if (!pending.delete(id)) return
      port.postMessage({ type: 'cancel', id } satisfies ExtFetchRequest)
      reject(signal.reason)
    }, { once: true })
    // `options.body` is NOT transferred: the caller reuses this same options object on the relay or libcurl, and a transferred ArrayBuffer would reach it detached.
    port.postMessage({ type: 'fetch', id, url, options } satisfies ExtFetchRequest)
  })
}

/**
 * Serves the media lane (`egressFetch`, egress.ts) on `port`: the extension's fetch when it can, else libcurl over
 * WebVPN in the egress worker, under a request id that starts with `prefix` so a cancel reaches it there.
 */
export const serveMediaPort = (port: MessagePort, { extFetch, remote, prefix }: {
  extFetch: ExtEgressFetch
  remote: Promise<Pick<EgressApi, 'libcurlFetch' | 'cancelLibcurlFetch'>>
  prefix: string
}) => {
  const aborts = new Map<number, AbortController>()
  port.addEventListener('message', (event) => {
    const request = event.data as FrameEgressRequest
    const egressRequestId = `${prefix}:${request.id}`
    if (request.type === 'cancel') {
      aborts.get(request.id)?.abort()
      aborts.delete(request.id)
      void remote.then((api) => api.cancelLibcurlFetch(egressRequestId)).catch(() => {})
      return
    }
    const abort = new AbortController()
    aborts.set(request.id, abort)
    const run = async () => {
      const viaExtension = await extFetch(request.url, request.options, abort.signal)
      if (viaExtension) return viaExtension
      return (await remote).libcurlFetch(egressRequestId, request.url, request.options)
    }
    void run().then(
      (response) => {
        aborts.delete(request.id)
        port.postMessage({ id: request.id, response } satisfies FrameEgressResponse, response.body ? [response.body] : [])
      },
      (error) => {
        aborts.delete(request.id)
        port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies FrameEgressResponse)
      },
    )
  })
  port.start()
}
