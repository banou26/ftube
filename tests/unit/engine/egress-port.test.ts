import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { EgressApi } from '../../../src/engine/protocol'

import { EGRESS_ABORT_ALL, EGRESS_KEY } from '../../../src/engine/protocol'

const expose = vi.fn()
// a libcurl request that never answers until it is aborted
const libcurlFetch = vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
}))

vi.mock('@fkn/lib', () => ({ fetch: vi.fn() }))
vi.mock('@fkn/lib/net', () => ({ connect: () => ({ on: () => {}, write: () => {}, destroy: () => {} }) }))
vi.mock('osra', () => ({ expose }))
vi.mock('libcurl.js/bundled', () => ({ libcurl: { load_wasm: async () => {}, set_websocket: () => {}, fetch: libcurlFetch } }))

type Port = { start: () => void, close: ReturnType<typeof vi.fn> }

const loadWorker = async () => {
  const listeners: ((event: { data: unknown }) => void)[] = []
  vi.stubGlobal('self', { addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.push(listener) })
  await import('../../../src/engine/egress.worker')
  const post = (data: unknown) => { for (const listener of listeners) listener({ data }) }
  const hand = (): Port => {
    const port = { start: () => {}, close: vi.fn() }
    post({ type: EGRESS_KEY, port })
    return port
  }
  return { post, hand, api: () => expose.mock.lastCall![0] as EgressApi }
}

describe('the egress worker ports', () => {
  beforeEach(() => {
    vi.resetModules()
    expose.mockClear()
    libcurlFetch.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('releases the previous port when the next engine takes one', async () => {
    const { hand } = await loadWorker()
    const first = hand()
    const second = hand()
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).not.toHaveBeenCalled()
  })

  it("drops every request in flight on an engine reset", async () => {
    const { hand, post, api } = await loadWorker()
    hand()
    const egress = api()
    const first = egress.libcurlFetch('frame:1:1', 'https://rr1.googlevideo.com/videoplayback', { method: 'GET' })
    const second = egress.libcurlFetch('frame:1:2', 'https://www.google.com/js/th/interpreter.js', { method: 'GET' })
    await vi.waitFor(() => expect(libcurlFetch).toHaveBeenCalledTimes(2))
    post({ type: EGRESS_ABORT_ALL })
    await expect(first).rejects.toThrow('aborted')
    await expect(second).rejects.toThrow('aborted')
  })
})
