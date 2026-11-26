import { expose } from 'osra'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

type RecordedCall = {
  url: string
  method: string
  body: ArrayBuffer | null
}

const originalBodyDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'body')

const restoreRequestBody = () => {
  if (originalBodyDescriptor) {
    Object.defineProperty(Request.prototype, 'body', originalBodyDescriptor)
  } else {
    delete (Request.prototype as { body?: unknown }).body
  }
}

describe('@fkn/lib extension.fetch request bodies', () => {
  const openPorts: MessagePort[] = []

  afterEach(() => {
    for (const port of openPorts) port.close()
    openPorts.length = 0
    restoreRequestBody()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('forwards POST ArrayBuffer and Request bodies when Request.prototype.body is undefined (Firefox)', async () => {
    const calls: RecordedCall[] = []
    const { port1, port2 } = new MessageChannel()
    openPorts.push(port1, port2)

    const noop = () => {}
    const fakeDocument: Record<string, unknown> = {
      documentElement: {
        dataset: { fknExtension: 'true', fknExtensionAbi: '5' },
      },
      body: { appendChild: noop },
      addEventListener: noop,
      removeEventListener: noop,
    }
    const fakeIframe = {
      setAttribute: noop,
      addEventListener: noop,
      removeEventListener: noop,
      style: { setProperty: noop },
      contentWindow: null,
      ownerDocument: { defaultView: null },
      isConnected: false,
    }
    fakeDocument.querySelector = () => fakeIframe
    fakeDocument.createElement = () => fakeIframe

    const messageListeners = new Map<EventListenerOrEventListenerObject, EventListener>()
    const fakeWindow: Record<string, unknown> = {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type !== 'message') return
        const wrapped: EventListener = (event) => {
          if (typeof listener === 'function') listener(event)
          else listener.handleEvent(event)
        }
        messageListeners.set(listener, wrapped)
        port1.addEventListener('message', wrapped)
        port1.start()
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type !== 'message') return
        const wrapped = messageListeners.get(listener)
        if (!wrapped) return
        port1.removeEventListener('message', wrapped)
        messageListeners.delete(listener)
      },
      postMessage: (data: unknown, _origin?: string, transfer?: Transferable[]) => {
        port1.postMessage(data, transfer ?? [])
      },
      document: fakeDocument,
    }
    fakeWindow.parent = fakeWindow
    fakeWindow.window = fakeWindow

    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('window', fakeWindow)

    // Firefox exposes `undefined` on `Request.prototype.body` even when an init or Request body is present.
    Object.defineProperty(Request.prototype, 'body', {
      get: () => undefined,
      configurable: true,
    })

    const { fetch: extFetch, handleRevivableModules } = await import('@fkn/lib/extension')
    void expose({
      proxyFetch: async (req: RecordedCall) => {
        calls.push(req)
        return new Response('ok', { status: 200 })
      },
    }, {
      transport: port2,
      revivableModules: handleRevivableModules,
    })

    const payload = Uint8Array.from([8, 42, 16, 7, 26, 2, 1, 2])
    const response = await extFetch('https://rr1---sn.googlevideo.com/videoplayback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: payload.buffer,
    })
    expect(response.status).toBe(200)
    await response.body?.cancel()

    const requestInput = new Request('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"videoId":"9nDSmqqkq8E"}',
    })
    const secondResponse = await extFetch(requestInput)
    expect(secondResponse.status).toBe(200)
    await secondResponse.body?.cancel()

    const getResponse = await extFetch('https://www.youtube.com/watch?v=9nDSmqqkq8E')
    expect(getResponse.status).toBe(200)
    await getResponse.body?.cancel()

    expect(calls).toHaveLength(3)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(calls[0]!.body!))).toEqual(Array.from(payload))
    expect(calls[1]!.method).toBe('POST')
    expect(calls[1]!.body).toBeInstanceOf(ArrayBuffer)
    expect(new TextDecoder().decode(calls[1]!.body!)).toBe('{"videoId":"9nDSmqqkq8E"}')
    expect(calls[2]!.method).toBe('GET')
    expect(calls[2]!.body).toBeNull()
  })
})
