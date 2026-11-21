import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { AGENT_UNAVAILABLE } from '../../../src/engine/agent-host'
import { buildId, ENGINE_BUILD_MISMATCH } from '../../../src/engine/engine-build'
import { ENGINE_PATH, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO } from '../../../src/engine/protocol'
import { SIGNED_IN_KEY } from '../../../src/engine/signed-in'
import scramjetHostStub from '../../../public/__yt_scramjet__/host.html?raw'
import { BUILD, querySelector } from '../fixtures/build-tag'

vi.mock('../../../src/engine/platform', () => ({
  startPlatform: async () => ({
    openEgressPort: () => new MessageChannel().port2,
    openExtFetchPort: () => new MessageChannel().port2,
  }),
  abortPlatformEgress: () => {},
}))

vi.mock('../../../src/engine/agent-host', async (original) => ({
  ...await original<typeof import('../../../src/engine/agent-host')>(),
  startAgentHost: () => ({ openBridge: () => new MessageChannel().port2, signedIn: false }),
}))

// the engine's modules past the boot: youtubei.js and its warm-ups are not this file's concern
const engineModule = vi.hoisted(() => ({ connected: [] as MessagePort[] }))
vi.mock('../../../src/frame/index', () => ({ connect: (port: MessagePort) => { engineModule.connected.push(port) } }))

const ORIGIN = 'https://youtube.fkn.app'

type Posted = { message: { type?: string, build?: string }, transfer: unknown[] }
type FakeFrame = { contentWindow: { postMessage(message: Posted['message'], origin: string, transfer?: unknown[]): void }, posted: Posted[] }

// just enough of a window for client.ts: one iframe per engine attempt, and the window's message listeners
const installWindow = () => {
  const frames: FakeFrame[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  const storage = new Map<string, string>()
  const reload = vi.fn()
  vi.stubGlobal('document', {
    createElement: () => {
      const frame: FakeFrame & Record<string, unknown> = {
        posted: [],
        src: '',
        contentWindow: { postMessage: (message, _origin, transfer = []) => frame.posted.push({ message, transfer }) },
        remove: () => {},
        removeAttribute: () => {},
        style: {},
      }
      frames.push(frame)
      return frame
    },
    body: { appendChild: () => {} },
    documentElement: { dataset: {} },
    querySelector,
  })
  vi.stubGlobal('window', {
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
  })
  vi.stubGlobal('location', { origin: ORIGIN, reload })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
  const fromFrame = (frame: FakeFrame, data: unknown, ports: MessagePort[] = []) => {
    for (const listener of listeners) {
      listener({ origin: ORIGIN, source: frame.contentWindow, data, ports } as unknown as MessageEvent)
    }
  }
  return { frames, reload, fromFrame }
}

// a promise that is still pending after the platform's own awaits have run is reported as such, rather than timing the test out
const settled = <T>(promise: Promise<T>) => Promise.race([
  promise.then((value) => ({ value }), (error: unknown) => ({ error })),
  new Promise<{ pending: true }>((resolve) => setTimeout(() => resolve({ pending: true }), 50)),
])

const bootstraps = (frame: FakeFrame) => frame.posted.filter(({ message }) => message.type === HOST_BOOTSTRAP)

describe('an engine from another build', () => {
  let window: ReturnType<typeof installWindow>

  beforeEach(() => {
    vi.resetModules()
    window = installWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('an app realm from another build reloads once instead of calling a method the frame no longer serves', async () => {
    const { startEngine } = await import('../../../src/engine/client')

    const first = startEngine()
    window.fromFrame(window.frames[0]!, { type: HOST_HELLO, build: 'a-later-build' })
    expect(await settled(first)).toEqual({ error: new Error(ENGINE_BUILD_MISMATCH) })
    // no bootstrap means no ports, so no FrameApi exists whose methods could reach the newer frame
    expect(bootstraps(window.frames[0]!)).toEqual([])
    expect(window.reload).toHaveBeenCalledTimes(1)

    // the same pair once more (a cache still serving the old app) fails by name instead of reloading in a loop
    const second = startEngine()
    window.fromFrame(window.frames[1]!, { type: HOST_HELLO, build: 'a-later-build' })
    expect(await settled(second)).toEqual({ error: new Error(ENGINE_BUILD_MISMATCH) })
    expect(bootstraps(window.frames[1]!)).toEqual([])
    expect(window.reload).toHaveBeenCalledTimes(1)
  })

  it('a host from before build ids reads as another build', async () => {
    const { startEngine } = await import('../../../src/engine/client')
    const engine = startEngine()
    window.fromFrame(window.frames[0]!, { type: HOST_HELLO })
    expect(await settled(engine)).toEqual({ error: new Error(ENGINE_BUILD_MISMATCH) })
    expect(bootstraps(window.frames[0]!)).toEqual([])
    expect(window.reload).toHaveBeenCalledTimes(1)
  })

  it('a host that refuses this realm by name reloads it once as well', async () => {
    const { startEngine } = await import('../../../src/engine/client')
    const engine = startEngine()
    window.fromFrame(window.frames[0]!, { type: HOST_HELLO, build: BUILD })
    await settled(engine)
    window.fromFrame(window.frames[0]!, { type: ENGINE_READY, error: ENGINE_BUILD_MISMATCH })
    expect(await settled(engine)).toEqual({ error: new Error(ENGINE_BUILD_MISMATCH) })
    expect(window.reload).toHaveBeenCalledTimes(1)
  })

  it('an engine frame from this build gets its ports, this build and the jar named, and nothing reloads', async () => {
    const { startEngine, resetEngine } = await import('../../../src/engine/client')
    const engine = startEngine()
    expect((window.frames[0] as unknown as { src: string }).src).toBe(ENGINE_PATH)
    window.fromFrame(window.frames[0]!, { type: HOST_HELLO, build: BUILD })
    expect(await settled(engine)).toEqual({ pending: true })
    const [bootstrap] = bootstraps(window.frames[0]!)
    expect(bootstrap?.message).toEqual({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: false, direct: true, attempt: 1 })
    expect(bootstrap?.transfer).toHaveLength(3)

    const api = new MessageChannel()
    window.fromFrame(window.frames[0]!, { type: ENGINE_READY, signedIn: false }, [api.port2])
    const ready = await settled(engine)
    expect(ready).toHaveProperty('value')
    expect(window.reload).not.toHaveBeenCalled()
    resetEngine()
    api.port1.close()
  })
})

describe("the page left at Scramjet's old engine path", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says hello as another build, so a tab opened before the engine left Scramjet reloads once into this one', async () => {
    const window = installWindow()
    const { startEngine } = await import('../../../src/engine/client')
    const engine = startEngine()
    const frame = window.frames[0]!
    const script = /<script>([\s\S]*?)<\/script>/.exec(scramjetHostStub)?.[1]
    expect(script).toBeDefined()
    const posted: { message: unknown, origin: string }[] = []
    // eslint-disable-next-line no-implied-eval
    new Function('parent', 'location', script!)({ postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) }, { origin: ORIGIN })
    expect(posted).toEqual([{ message: { type: HOST_HELLO, build: 'scramjet-removed' }, origin: ORIGIN }])
    window.fromFrame(frame, posted[0]!.message)
    expect(await settled(engine)).toEqual({ error: new Error(ENGINE_BUILD_MISMATCH) })
    expect(window.reload).toHaveBeenCalledTimes(1)
    expect(bootstraps(frame)).toEqual([])
  })
})

describe('the build id', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the one the page names in its yt-build tag', () => {
    vi.stubGlobal('document', { querySelector })
    expect(buildId()).toBe(BUILD)
  })
})

describe('the engine frame', () => {
  const installHost = (stored: Record<string, string> = {}) => {
    const toApp: { message: { type?: string, build?: string, error?: string, signedIn?: boolean }, ports: unknown[] }[] = []
    const listeners = new Set<(event: MessageEvent) => void>()
    const parent = { postMessage: (message: (typeof toApp)[number]['message'], _origin: string, ports: unknown[] = []) => { toApp.push({ message, ports }) } }
    vi.stubGlobal('window', {
      parent,
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => { if (type === 'message') listeners.add(listener) },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => { listeners.delete(listener) },
    })
    vi.stubGlobal('location', { origin: ORIGIN })
    vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      removeItem: (key: string) => { delete stored[key] },
    })
    const fromApp = (data: unknown, ports: MessagePort[]) => {
      for (const listener of listeners) {
        listener({ origin: ORIGIN, source: parent, data, ports } as unknown as MessageEvent)
      }
    }
    return { toApp, fromApp, stored }
  }

  const ports = () => {
    const egress = new MessageChannel()
    const extFetch = new MessageChannel()
    const agent = new MessageChannel()
    return { egress, extFetch, agent, frameEnds: [egress.port2, extFetch.port2, agent.port2], close: () => { for (const end of [egress.port1, extFetch.port1, agent.port1]) end.close() } }
  }

  // the FKN page's end of the bridge, answering `cookie` as a case says
  const answerCookie = (port: MessagePort, answer: (id: number) => { result?: string, error?: string } | undefined) => {
    port.addEventListener('message', (event) => {
      const request = event.data as { id: number, method?: string }
      if (request.method !== 'cookie') return
      const reply = answer(request.id)
      if (reply) port.postMessage({ id: request.id, ...reply })
    })
    port.start()
  }

  const readyMessage = (host: ReturnType<typeof installHost>) => host.toApp.find(({ message }) => message.type === ENGINE_READY)

  beforeEach(() => {
    vi.resetModules()
    engineModule.connected.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([
    ['names another build', { type: HOST_BOOTSTRAP, build: 'an-earlier-build', signedIn: false }],
    ['names none, as a tab opened before build ids', { type: HOST_BOOTSTRAP }],
  ])('refuses an app realm that %s, by name and before using its ports', async (_, bootstrap) => {
    const host = installHost()
    await import('../../../src/frame/main')
    expect(host.toApp.map(({ message }) => message)).toEqual([{ type: HOST_HELLO, build: BUILD }])

    const channels = ports()
    let egressClosed = false
    channels.egress.port1.addEventListener('close', () => { egressClosed = true })
    channels.egress.port1.start()
    host.fromApp(bootstrap, channels.frameEnds)
    await vi.waitFor(() => expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, error: ENGINE_BUILD_MISMATCH }))
    await vi.waitFor(() => expect(egressClosed).toBe(true))
    expect(engineModule.connected).toEqual([])
    channels.close()
  })

  it('signed out, takes the ports of an app realm from this build and answers with the FrameApi port', async () => {
    const host = installHost()
    await import('../../../src/frame/main')
    const channels = ports()
    host.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: false }, channels.frameEnds)
    await vi.waitFor(() => expect(readyMessage(host)).toBeDefined())
    expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, signedIn: false })
    expect(readyMessage(host)?.ports).toHaveLength(1)
    expect(engineModule.connected).toHaveLength(1)
    channels.close()
  })

  it('signed in, boots on the FKN page\'s cookies when they hold a session', async () => {
    const host = installHost({ [SIGNED_IN_KEY]: '1' })
    await import('../../../src/frame/main')
    const channels = ports()
    answerCookie(channels.agent.port1, () => ({ result: 'PREF=f6=40000000; SAPISID=abc/def' }))
    host.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: true }, channels.frameEnds)
    await vi.waitFor(() => expect(readyMessage(host)).toBeDefined())
    expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, signedIn: true })
    const { realm } = await import('../../../src/frame/realm')
    expect(realm.cookie).toBe('PREF=f6=40000000; SAPISID=abc/def')
    expect(host.stored[SIGNED_IN_KEY]).toBe('1')
    channels.close()
  })

  it('signed in, a jar the page says holds no session clears yt-client:signed-in', async () => {
    const host = installHost({ [SIGNED_IN_KEY]: '1' })
    await import('../../../src/frame/main')
    const channels = ports()
    answerCookie(channels.agent.port1, () => ({ result: 'PREF=f6=40000000' }))
    host.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: true }, channels.frameEnds)
    await vi.waitFor(() => expect(readyMessage(host)).toBeDefined())
    expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, signedIn: false })
    expect(host.stored[SIGNED_IN_KEY]).toBeUndefined()
    channels.close()
  })

  it('signed in, a page that is unavailable boots this load signed out and keeps yt-client:signed-in', async () => {
    const host = installHost({ [SIGNED_IN_KEY]: '1' })
    await import('../../../src/frame/main')
    const channels = ports()
    answerCookie(channels.agent.port1, () => ({ error: AGENT_UNAVAILABLE }))
    host.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: true }, channels.frameEnds)
    await vi.waitFor(() => expect(readyMessage(host)).toBeDefined())
    expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, signedIn: false })
    expect(host.stored[SIGNED_IN_KEY]).toBe('1')
    channels.close()
  })

  it('signed in, a page that never answers boots this load signed out once its wait ran out, and keeps yt-client:signed-in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const host = installHost({ [SIGNED_IN_KEY]: '1' })
    await import('../../../src/frame/main')
    const channels = ports()
    const asked: number[] = []
    answerCookie(channels.agent.port1, (id) => {
      asked.push(id)
      return undefined
    })
    host.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: true }, channels.frameEnds)
    // vi.waitFor moves fake timers by itself, so these waits turn the real event loop instead
    const until = async (check: () => boolean) => {
      for (let tries = 0; tries < 500 && !check(); tries++) await new Promise((resolve) => setImmediate(resolve))
    }
    await until(() => asked.length === 1)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(readyMessage(host)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await until(() => readyMessage(host) !== undefined)
    expect(readyMessage(host)?.message).toEqual({ type: ENGINE_READY, signedIn: false })
    expect(host.stored[SIGNED_IN_KEY]).toBe('1')
    channels.close()
  })
})
