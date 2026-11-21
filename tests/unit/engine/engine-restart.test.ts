import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO, HOST_RESTART } from '../../../src/engine/protocol'
import { BUILD, querySelector } from '../fixtures/build-tag'

vi.mock('../../../src/engine/platform', () => ({
  startPlatform: async () => ({
    openEgressPort: () => new MessageChannel().port2,
    openExtFetchPort: () => new MessageChannel().port2,
  }),
  abortPlatformEgress: () => {},
}))

const bridges = vi.hoisted(() => [] as MessagePort[])
vi.mock('../../../src/engine/agent-host', async (original) => ({
  ...await original<typeof import('../../../src/engine/agent-host')>(),
  startAgentHost: () => ({
    openBridge: () => {
      const port = new MessageChannel().port2
      bridges.push(port)
      return port
    },
    signedIn: false,
  }),
}))

// the engine's modules past the boot: youtubei.js and its warm-ups are not this file's concern
const engineModule = vi.hoisted(() => ({ connected: [] as MessagePort[], disconnects: 0 }))
vi.mock('../../../src/frame/index', () => ({
  connect: (port: MessagePort) => {
    engineModule.connected.push(port)
    return () => { engineModule.disconnects += 1 }
  },
}))

const ORIGIN = 'https://youtube.fkn.app'
const LATER_BUILD = 'a-later-build'

const open: MessagePort[] = []
const channel = () => {
  const made = new MessageChannel()
  open.push(made.port1, made.port2)
  return made
}

type Posted = { message: { type?: string, signedIn?: boolean, attempt?: number }, transfer: unknown[] }
type FakeFrame = {
  contentWindow: { postMessage(message: Posted['message'], origin: string, transfer?: unknown[]): void }
  contentDocument?: unknown
  posted: Posted[]
  removed: boolean
}

// the app realm: one iframe per engine frame loaded, and the window's message/online listeners
const installAppRealm = () => {
  const frames: FakeFrame[] = []
  const messageListeners = new Set<(event: MessageEvent) => void>()
  const onlineListeners = new Set<(event: Event) => void>()
  const reload = vi.fn()
  vi.stubGlobal('document', {
    createElement: () => {
      const frame: FakeFrame & Record<string, unknown> = {
        posted: [],
        removed: false,
        contentWindow: { postMessage: (message, _origin, transfer = []) => frame.posted.push({ message, transfer }) },
        remove: () => { frame.removed = true },
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
    addEventListener: (type: string, listener: (event: never) => void) => {
      if (type === 'message') messageListeners.add(listener as (event: MessageEvent) => void)
      if (type === 'online') onlineListeners.add(listener as (event: Event) => void)
    },
    removeEventListener: (type: string, listener: (event: never) => void) => {
      if (type === 'message') messageListeners.delete(listener as (event: MessageEvent) => void)
      if (type === 'online') onlineListeners.delete(listener as (event: Event) => void)
    },
  })
  vi.stubGlobal('location', { origin: ORIGIN, reload })
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
  const fromFrame = (frame: FakeFrame, data: unknown, ports: MessagePort[] = []) => {
    for (const listener of messageListeners) {
      listener({ origin: ORIGIN, source: frame.contentWindow, data, ports } as unknown as MessageEvent)
    }
  }
  const fireOnline = () => {
    for (const listener of [...onlineListeners]) listener({ type: 'online' } as Event)
  }
  const ready = (frame: FakeFrame, attempt?: number) => {
    const api = channel()
    fromFrame(frame, { type: ENGINE_READY, signedIn: false, ...(attempt !== undefined ? { attempt } : {}) }, [api.port2])
    return api.port2
  }
  return { frames, reload, fromFrame, fireOnline, ready }
}

const settled = <T>(promise: Promise<T>) => Promise.race([
  promise.then((value) => ({ value }), (error: unknown) => ({ error })),
  new Promise<{ pending: true }>((resolve) => setTimeout(() => resolve({ pending: true }), 50)),
])

const sent = (frame: FakeFrame, type: string) => frame.posted.filter(({ message }) => message.type === type)

describe('the next engine of an app realm', () => {
  let realm: ReturnType<typeof installAppRealm>

  beforeEach(() => {
    vi.resetModules()
    bridges.length = 0
    realm = installAppRealm()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    for (const port of open.splice(0)) port.close()
  })

  const connect = async () => {
    const client = await import('../../../src/engine/client')
    const first = client.startEngine()
    realm.fromFrame(realm.frames[0]!, { type: HOST_HELLO, build: BUILD })
    await settled(first)
    const api = realm.ready(realm.frames[0]!)
    expect(await settled(first)).toHaveProperty('value')
    return { ...client, api }
  }

  it('starts in the frame that served the last one when the engine page is of a later build, so the page does not reload', async () => {
    const { startEngine, resetEngine } = await connect()
    resetEngine()
    const next = startEngine()
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: LATER_BUILD })
    expect(await settled(next)).toEqual({ pending: true })
    expect(realm.frames[1]!.removed).toBe(true)
    expect(realm.frames[0]!.removed).toBe(false)
    const [restart] = sent(realm.frames[0]!, HOST_RESTART)
    expect(restart?.message).toEqual({ type: HOST_RESTART, signedIn: false, attempt: 2 })
    // the new engine's bridge alone: the frame keeps the bootstrap's egress and extension ports
    expect(restart?.transfer).toEqual([bridges.at(-1)])
    expect(sent(realm.frames[0]!, HOST_BOOTSTRAP)).toHaveLength(1)
    expect(sent(realm.frames[1]!, HOST_BOOTSTRAP)).toEqual([])
    realm.ready(realm.frames[0]!)
    expect(await settled(next)).toHaveProperty('value')
    expect(realm.reload).not.toHaveBeenCalled()
  })

  it('starts in the same frame after the engine API failed', async () => {
    const { startEngine, api } = await connect()
    api.dispatchEvent(new MessageEvent('messageerror'))
    const next = startEngine()
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: LATER_BUILD })
    await settled(next)
    expect(sent(realm.frames[0]!, HOST_RESTART)).toHaveLength(1)
    realm.ready(realm.frames[0]!)
    expect(await settled(next)).toHaveProperty('value')
    expect(realm.reload).not.toHaveBeenCalled()
  })

  it('starts in a new frame of this build and drops the kept one', async () => {
    const { startEngine, resetEngine } = await connect()
    resetEngine()
    const next = startEngine()
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: BUILD })
    await settled(next)
    expect(realm.frames[0]!.removed).toBe(true)
    expect(sent(realm.frames[0]!, HOST_RESTART)).toEqual([])
    expect(sent(realm.frames[1]!, HOST_BOOTSTRAP)).toHaveLength(1)
    realm.ready(realm.frames[1]!)
    expect(await settled(next)).toHaveProperty('value')
  })

  it('reloads once when no frame served an engine', async () => {
    const { startEngine } = await import('../../../src/engine/client')
    const first = startEngine()
    realm.fromFrame(realm.frames[0]!, { type: HOST_HELLO, build: BUILD })
    realm.fromFrame(realm.frames[0]!, { type: ENGINE_READY, error: 'yt-client: engine bootstrap ports are missing' })
    expect(await settled(first)).toHaveProperty('error')
    expect(realm.frames[0]!.removed).toBe(true)
    void startEngine().catch(() => {})
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: LATER_BUILD })
    expect(sent(realm.frames[0]!, HOST_RESTART)).toEqual([])
    expect(realm.reload).toHaveBeenCalledTimes(1)
  })

  it('drops the kept frame when its restart failed, and the page then reloads once', async () => {
    const { startEngine, resetEngine } = await connect()
    resetEngine()
    const next = startEngine()
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: LATER_BUILD })
    realm.fromFrame(realm.frames[0]!, { type: ENGINE_READY, error: 'yt-client: the engine frame booted on another jar' })
    expect(await settled(next)).toHaveProperty('error')
    expect(realm.frames[0]!.removed).toBe(true)
    void startEngine().catch(() => {})
    realm.fromFrame(realm.frames[2]!, { type: HOST_HELLO, build: LATER_BUILD })
    expect(realm.reload).toHaveBeenCalledTimes(1)
  })

  it('retries on timer and on online when a frame never says hello, and ignores a late answer from an earlier attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { startEngine, HELLO_TIMEOUT_MS } = await import('../../../src/engine/client')
    const pending = startEngine()
    expect(realm.frames).toHaveLength(1)

    // first attempt times out waiting for HOST_HELLO -> schedules backoff retry
    await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS)
    expect(realm.frames[0]!.removed).toBe(true)
    expect(realm.frames).toHaveLength(1)

    // firing `online` retries immediately instead of waiting out the timer
    realm.fireOnline()
    expect(realm.frames).toHaveLength(2)

    // second attempt also times out -> timer retries automatically
    await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS)
    expect(realm.frames[1]!.removed).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(realm.frames).toHaveLength(3)

    // third attempt answers hello and receives attempt: 3
    realm.fromFrame(realm.frames[2]!, { type: HOST_HELLO, build: BUILD })
    await vi.waitFor(() => expect(sent(realm.frames[2]!, HOST_BOOTSTRAP)).toHaveLength(1))
    const attempt = sent(realm.frames[2]!, HOST_BOOTSTRAP)[0]!.message.attempt!
    expect(attempt).toBe(3)

    // a late answer carrying an older attempt id is ignored and its port is closed
    const stale = channel()
    let staleClosed = false
    stale.port1.addEventListener('close', () => { staleClosed = true })
    stale.port1.start()
    realm.fromFrame(realm.frames[2]!, { type: ENGINE_READY, signedIn: false, attempt: 1 }, [stale.port2])
    await vi.waitFor(() => expect(staleClosed).toBe(true))

    // matching attempt resolves the engine
    realm.ready(realm.frames[2]!, attempt)
    expect(await pending).toBeDefined()
  })

  it('retries on a transient module fetch failure reported in ENGINE_READY', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { startEngine } = await import('../../../src/engine/client')
    const pending = startEngine()
    realm.fromFrame(realm.frames[0]!, { type: HOST_HELLO, build: BUILD })
    await vi.waitFor(() => expect(sent(realm.frames[0]!, HOST_BOOTSTRAP)).toHaveLength(1))
    realm.fromFrame(realm.frames[0]!, {
      type: ENGINE_READY,
      attempt: 1,
      error: 'Failed to fetch dynamically imported module: https://youtube.fkn.app/assets/frame.js',
    })
    expect(realm.frames[0]!.removed).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(realm.frames).toHaveLength(2)
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: BUILD })
    await vi.waitFor(() => expect(sent(realm.frames[1]!, HOST_BOOTSTRAP)).toHaveLength(1))
    realm.ready(realm.frames[1]!, 2)
    expect(await pending).toBeDefined()
  })

  it('drops a silent kept frame once its restart deadline runs out and loads a fresh frame', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const client = await import('../../../src/engine/client')
    const first = client.startEngine()
    realm.fromFrame(realm.frames[0]!, { type: HOST_HELLO, build: BUILD })
    await vi.waitFor(() => expect(sent(realm.frames[0]!, HOST_BOOTSTRAP)).toHaveLength(1))
    realm.ready(realm.frames[0]!, 1)
    await first

    client.resetEngine()
    const next = client.startEngine()
    realm.fromFrame(realm.frames[1]!, { type: HOST_HELLO, build: LATER_BUILD })
    expect(sent(realm.frames[0]!, HOST_RESTART)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(client.RESTART_TIMEOUT_MS)
    expect(realm.frames[0]!.removed).toBe(true)
    expect(realm.frames).toHaveLength(3)

    realm.fromFrame(realm.frames[2]!, { type: HOST_HELLO, build: BUILD })
    await vi.waitFor(() => expect(sent(realm.frames[2]!, HOST_BOOTSTRAP)).toHaveLength(1))
    realm.ready(realm.frames[2]!, 3)
    expect(await next).toBeDefined()
  })
})

describe('the engine frame asked for another engine', () => {
  const installFrame = () => {
    const toApp: { message: { type?: string, error?: string, signedIn?: boolean }, ports: MessagePort[] }[] = []
    const listeners = new Set<(event: MessageEvent) => void>()
    const parent = { postMessage: (message: (typeof toApp)[number]['message'], _origin: string, ports: MessagePort[] = []) => { toApp.push({ message, ports }) } }
    vi.stubGlobal('window', {
      parent,
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => { if (type === 'message') listeners.add(listener) },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => { listeners.delete(listener) },
    })
    vi.stubGlobal('location', { origin: ORIGIN })
    vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector })
    vi.stubGlobal('localStorage', { getItem: () => null, removeItem: () => {} })
    const fromApp = (data: unknown, ports: MessagePort[]) => {
      for (const listener of listeners) {
        listener({ origin: ORIGIN, source: parent, data, ports } as unknown as MessageEvent)
      }
    }
    const readies = () => toApp.filter(({ message }) => message.type === ENGINE_READY)
    return { fromApp, readies }
  }

  const boot = async () => {
    const frame = installFrame()
    await import('../../../src/frame/main')
    const [egress, extFetch, agent] = [channel(), channel(), channel()]
    frame.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: false, direct: true }, [egress.port2, extFetch.port2, agent.port2])
    await vi.waitFor(() => expect(frame.readies()).toHaveLength(1))
    return { ...frame, agent }
  }

  beforeEach(() => {
    vi.resetModules()
    engineModule.connected.length = 0
    engineModule.disconnects = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    for (const port of open.splice(0)) port.close()
  })

  it('ends the last engine and serves a new FrameApi port, its FKN page calls on the bridge the restart brings', async () => {
    const frame = await boot()
    const { pageCookie } = await import('../../../src/frame/agent')
    const left = pageCookie(60_000)
    const nextAgent = channel()
    const asked: string[] = []
    nextAgent.port1.addEventListener('message', (event) => {
      const request = event.data as { id: number, method?: string }
      asked.push(String(request.method))
      nextAgent.port1.postMessage({ id: request.id, result: 'PREF=f6=40000000' })
    })
    nextAgent.port1.start()

    frame.fromApp({ type: HOST_RESTART, signedIn: false }, [nextAgent.port2])
    expect(engineModule.disconnects).toBe(1)
    expect(frame.readies().map(({ message }) => message)).toEqual([
      { type: ENGINE_READY, signedIn: false },
      { type: ENGINE_READY, signedIn: false },
    ])
    expect(frame.readies()[1]!.ports).toHaveLength(1)
    expect(engineModule.connected).toHaveLength(2)
    expect(engineModule.connected[1]).not.toBe(engineModule.connected[0])
    await expect(left).rejects.toThrow('replaced')
    expect(await pageCookie()).toBe('PREF=f6=40000000')
    expect(asked).toEqual(['cookie'])
  })

  it('refuses a restart on another jar than the one it booted on', async () => {
    const frame = await boot()
    const nextAgent = channel()
    frame.fromApp({ type: HOST_RESTART, signedIn: true }, [nextAgent.port2])
    expect(frame.readies().map(({ message }) => message)).toEqual([
      { type: ENGINE_READY, signedIn: false },
      { type: ENGINE_READY, error: 'yt-client: the engine frame booted on another jar' },
    ])
    expect(engineModule.connected).toHaveLength(1)
  })

  it('echoes the attempt id in ENGINE_READY on bootstrap and restart', async () => {
    const frame = installFrame()
    await import('../../../src/frame/main')
    const [egress, extFetch, agent, nextAgent] = [channel(), channel(), channel(), channel()]
    frame.fromApp({ type: HOST_BOOTSTRAP, build: BUILD, signedIn: false, direct: true, attempt: 7 }, [egress.port2, extFetch.port2, agent.port2])
    await vi.waitFor(() => expect(frame.readies()).toHaveLength(1))
    frame.fromApp({ type: HOST_RESTART, signedIn: false, attempt: 9 }, [nextAgent.port2])
    expect(frame.readies().map(({ message }) => message)).toEqual([
      { type: ENGINE_READY, signedIn: false, attempt: 7 },
      { type: ENGINE_READY, signedIn: false, attempt: 9 },
    ])
  })
})
