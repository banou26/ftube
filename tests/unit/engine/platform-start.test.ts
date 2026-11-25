import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const relayWorker = vi.fn<() => Promise<void>>()
const extensionFetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null))
const getCookie = vi.fn(async (_details: { url: string, name: string }) => null)
const requestPermissions = vi.fn(async (_requests: unknown[]) => [{ allow: true }])

vi.mock('@fkn/lib', () => ({
  FORGEABLE_HEADERS: ['origin', 'referer', 'cookie'],
  extension: { fetch: extensionFetch, cookies: { get: getCookie }, permissions: { request: requestPermissions } },
  isExtensionExposed: () => false,
  promptInstall: async () => false,
  relayWorker,
  setMissingExtensionHandler: () => {},
}))

// the broker iframe loads as soon as it is appended, and the egress worker is inert
const installWindow = () => {
  vi.stubGlobal('Worker', class {
    postMessage() {}
    terminate() {}
  })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('document', {
    createElement: () => {
      const listeners = new Map<string, () => void>()
      return { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener), listeners }
    },
    body: { appendChild: (element: { listeners: Map<string, () => void> }) => element.listeners.get('load')?.() },
  })
}

describe('starting the platform', () => {
  beforeEach(() => {
    vi.resetModules()
    relayWorker.mockReset()
    installWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // @fkn/lib 0.9.13 made relayWorker async, and it rejects when the realm has no FKN transport; the real lib rejects again on a retry, so this pins only that the failure is not memoized
  it('fails the start when the worker cannot be relayed, without memoizing the failure', async () => {
    relayWorker.mockRejectedValue(new Error('FKN @fkn/lib: relayWorker found no FKN transport in this realm'))
    const { startPlatform } = await import('../../../src/engine/platform')
    await expect(startPlatform()).rejects.toThrow(/no FKN transport/)
    await expect(startPlatform()).rejects.toThrow(/no FKN transport/)
    expect(relayWorker).toHaveBeenCalledTimes(2)
  })

  it('starts once the worker is relayed', async () => {
    relayWorker.mockResolvedValue(undefined)
    const { startPlatform } = await import('../../../src/engine/platform')
    const platform = await startPlatform()
    expect(Object.keys(platform).sort()).toEqual(['abortEgress', 'browserSession', 'openEgressPort', 'openExtFetchPort', 'promptInstall'])
    expect(relayWorker).toHaveBeenCalledTimes(1)
  })

  // the history import's only way to the browser's YouTube session, and every call goes to the extension, never to the cloud
  it('binds the browser session calls to the extension', async () => {
    relayWorker.mockResolvedValue(undefined)
    const { startPlatform } = await import('../../../src/engine/platform')
    const { browserSession } = await startPlatform()
    await browserSession.requestNetwork(['www.youtube.com'], 'reason')
    expect(requestPermissions).toHaveBeenCalledWith([{ category: 'network', hosts: ['www.youtube.com'], reason: 'reason' }])
    await browserSession.cookie({ url: 'https://www.youtube.com', name: 'SAPISID' })
    expect(getCookie).toHaveBeenCalledWith({ url: 'https://www.youtube.com', name: 'SAPISID' })
    const init: RequestInit = { method: 'POST', credentials: 'include' }
    await browserSession.fetch('https://www.youtube.com/youtubei/v1/browse', init)
    expect(extensionFetch).toHaveBeenCalledWith('https://www.youtube.com/youtubei/v1/browse', init)
  })

  it('skips mounting a duplicate broker iframe when running framed inside a sandbox shell', async () => {
    relayWorker.mockResolvedValue(undefined)
    const createElement = vi.fn()
    const appendChild = vi.fn()
    const selfWindow: Record<string, unknown> = { addEventListener: () => {} }
    selfWindow.parent = { framed: true }
    vi.stubGlobal('window', selfWindow)
    vi.stubGlobal('document', { createElement, body: { appendChild } })

    const { startPlatform } = await import('../../../src/engine/platform')
    await startPlatform()
    expect(createElement).not.toHaveBeenCalled()
    expect(appendChild).not.toHaveBeenCalled()
    expect(relayWorker).toHaveBeenCalledTimes(1)
  })

  it('keeps the egress worker alive across persisted pagehide transitions', async () => {
    relayWorker.mockResolvedValue(undefined)
    const terminate = vi.fn()
    vi.stubGlobal('Worker', class {
      postMessage() {}
      terminate = terminate
    })
    const listeners = new Map<string, Set<(event: { persisted?: boolean }) => void>>()
    const emitPagehide = (persisted: boolean) => {
      for (const listener of Array.from(listeners.get('pagehide') ?? [])) listener({ persisted })
    }
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: { persisted?: boolean }) => void) => {
        let set = listeners.get(type)
        if (!set) {
          set = new Set()
          listeners.set(type, set)
        }
        set.add(listener)
      },
      removeEventListener: (type: string, listener: (event: { persisted?: boolean }) => void) => {
        listeners.get(type)?.delete(listener)
      },
    })

    const { startPlatform } = await import('../../../src/engine/platform')
    await startPlatform()

    emitPagehide(true)
    expect(terminate).not.toHaveBeenCalled()

    emitPagehide(false)
    expect(terminate).toHaveBeenCalledTimes(1)
  })
})
