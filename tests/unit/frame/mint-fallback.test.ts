import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { AGENT_REPLACED, AGENT_UNAVAILABLE } from '../../../src/engine/agent-host'
import { GLOBAL_NAME, INTERPRETER, PROGRAM } from '../engine/agent-fakes'
import { streamed, watchPage } from './watch-page-fakes'

const egress = vi.hoisted(() => ({ egressFetch: vi.fn() }))
vi.mock('../../../src/frame/egress', () => egress)

type Request = { id: number, method: string, args: unknown[] }
type Reply = { result?: unknown, error?: string } | undefined

const endpoint = (url: string) => {
  if (url.includes('interpreter.js')) return 'interpreter'
  if (url.includes('GenerateIT')) return 'GenerateIT'
  return url
}

// Google as the frame's egress answers the attestation calls
const answerEgress = (url: string) => {
  const name = endpoint(url)
  if (name === 'interpreter') return new Response(INTERPRETER)
  if (name === 'GenerateIT') return new Response(JSON.stringify(['aXQ=', 3_600, null, 'fallback']))
  return new Response(null, { status: 404 })
}

// the engine frame: its storage, and its fetch of watch pages, each with an EVENT_ID of its own; it runs no VM, so a
// script element that ran BotGuard's interpreter here would show in `scripts`
const installRealm = ({ challenge = true } = {}) => {
  const storage = new Map<string, string>()
  const scripts: string[] = []
  const watched: string[] = []
  vi.stubGlobal('window', {})
  vi.stubGlobal('fetch', async (url: string) => {
    watched.push(url)
    return streamed([watchPage({ eventId: `event-${watched.length}`, challenge })])
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  vi.stubGlobal('document', {
    createElement: () => ({ textContent: '', remove: () => {} }),
    head: { appendChild: (element: { textContent: string }) => { scripts.push(element.textContent) } },
  })
  return { scripts, watched }
}

// the frame's read of a watch page, which offers its challenge to the next session
const readWatchPage = async (videoId = 'video-1') => {
  const { fetchPlayerResponse } = await import('../../../src/frame/watch-page')
  await fetchPlayerResponse(videoId)
}

// the app realm's end of the agent bridge, answering as a test case says the FKN page does
const connectAgent = async (answer: (request: Request) => Reply) => {
  const channel = new MessageChannel()
  const requests: string[] = []
  const creates: unknown[] = []
  const reports: unknown[] = []
  const cancels: number[] = []
  channel.port2.addEventListener('message', (event) => {
    const message = event.data as Request | { type: 'report' } | { type: 'cancel', id: number }
    if ('type' in message) {
      if (message.type === 'cancel') cancels.push(message.id)
      else reports.push(message)
      return
    }
    requests.push(message.method)
    if (message.method === 'create') creates.push(message.args[0])
    const reply = answer(message)
    if (reply) channel.port2.postMessage({ id: message.id, ...reply })
  })
  channel.port2.start()
  const { connectAgent: connect } = await import('../../../src/frame/agent')
  connect(channel.port1)
  const reply = (id: number, answer: NonNullable<Reply>) => channel.port2.postMessage({ id, ...answer })
  return { requests, creates, reports, cancels, reply, close: () => { channel.port1.close(); channel.port2.close() } }
}

// the FKN page's VM, numbering its sessions from 1, each minting tokens of its own
const sessionAgent = async () => {
  let created = 0
  const shutdowns: unknown[] = []
  const connected = await connectAgent(({ method, args }) => {
    if (method === 'create') return { result: ++created }
    if (method === 'snapshot') return { result: 'agent snapshot' }
    if (method === 'mint') return { result: `token-of-${String(args[0])}` }
    if (method === 'shutdown') shutdowns.push(args[0])
    return { result: undefined }
  })
  return { ...connected, shutdowns }
}

const immediate = () => new Promise((resolve) => { setImmediate(resolve) })
const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 500 && !check(); tries++) await immediate()
}

const cleanUp = () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>)[GLOBAL_NAME]
  delete (globalThis as Record<string, unknown>).yt
}

describe('minting when the FKN page fails', () => {
  let realm: ReturnType<typeof installRealm>
  let agent: Awaited<ReturnType<typeof connectAgent>> | undefined

  beforeEach(() => {
    vi.resetModules()
    egress.egressFetch.mockReset()
    egress.egressFetch.mockImplementation(async (url: string) => answerEgress(url))
    realm = installRealm()
  })

  afterEach(() => {
    agent?.close()
    agent = undefined
    cleanUp()
  })

  it('with the FKN page unavailable, the token is cold at once and no VM runs in the engine frame', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(() => ({ error: AGENT_UNAVAILABLE }))
    await readWatchPage()
    expect(await mintPoToken('video-1')).not.toMatch(/^token-of-/)
    expect(agent.requests).toEqual(['create'])
    expect(realm.scripts).toEqual([])
    await until(() => agent!.reports.length === 1)
    expect(agent.reports).toEqual([{ type: 'report', mint: 'cold' }])
  })

  it("the FKN page's VM is handed the challenge and the ytcfg of the watch page the frame read", async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(({ method }) => {
      if (method === 'create') return { result: 7 }
      if (method === 'snapshot') return { result: 'agent snapshot' }
      if (method === 'mint') return { result: 'agent-token' }
      return { result: undefined }
    })
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('agent-token')
    expect(agent.creates).toEqual([{
      interpreter: INTERPRETER,
      program: PROGRAM,
      globalName: GLOBAL_NAME,
      config: expect.objectContaining({ EVENT_ID: 'event-1' }),
    }])
    expect(egress.egressFetch.mock.calls.map(([url]) => endpoint(url as string))).toEqual(['interpreter', 'GenerateIT'])
    await until(() => agent!.reports.length === 2)
    expect(agent.reports).toEqual([{ type: 'report', engine: 'agent' }, { type: 'report', mint: 'session' }])
  })

  it('a refused GenerateIT is no second attestation, and the token is cold', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    egress.egressFetch.mockImplementation(async (url: string) =>
      endpoint(url) === 'GenerateIT' ? new Response(null, { status: 403 }) : answerEgress(url))
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(({ method }) => {
      if (method === 'create') return { result: 7 }
      if (method === 'snapshot') return { result: 'agent snapshot' }
      return { result: undefined }
    })
    await readWatchPage()
    expect(await mintPoToken('video-1')).not.toMatch(/agent/)
    expect(egress.egressFetch.mock.calls.map(([url]) => endpoint(url as string))).toEqual(['interpreter', 'GenerateIT'])
    expect(realm.scripts).toEqual([])
  })

  it('a fresh session whose first mint fails is dropped, and a new session of the page mints inside the wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mintPoToken } = await import('../../../src/frame/botguard')
    let mints = 0
    let created = 0
    agent = await connectAgent(({ method }) => {
      if (method === 'create') return { result: ++created }
      if (method === 'snapshot') return { result: 'agent snapshot' }
      if (method === 'mint') return ++mints === 1 ? { error: AGENT_REPLACED } : { result: `token-of-${created}` }
      return { result: undefined }
    })
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('token-of-2')
    expect(agent.requests).toEqual(['create', 'snapshot', 'minter', 'mint', 'shutdown', 'create', 'snapshot', 'minter', 'mint'])
    // the new session read the last video's watch page again for a challenge of its own
    expect(realm.watched).toHaveLength(2)
  })

  it('the new session shares the wait: 10000 ms from the call, the token is cold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let integrityTokens = 0
    // the second session's GenerateIT never answers
    egress.egressFetch.mockImplementation(async (url: string) =>
      endpoint(url) === 'GenerateIT' && ++integrityTokens > 1 ? new Promise<never>(() => {}) : answerEgress(url))
    const { mintPoToken } = await import('../../../src/frame/botguard')
    let creates = 0
    let first = 0
    agent = await connectAgent(({ id, method }) => {
      if (method === 'create') {
        if (++creates > 1) return { result: creates }
        first = id
        return undefined
      }
      if (method === 'snapshot') return { result: 'agent snapshot' }
      if (method === 'mint') return { error: AGENT_REPLACED }
      return { result: undefined }
    })
    await readWatchPage()
    let settled = false
    const token = mintPoToken('video-1').finally(() => { settled = true })
    await until(() => first !== 0)
    // the first session takes 4000 ms, under the agent's own 5000 ms call timeout
    await vi.advanceTimersByTimeAsync(4_000)
    agent.reply(first, { result: 1 })
    await until(() => integrityTokens === 2)
    await vi.advanceTimersByTimeAsync(5_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await until(() => settled)
    expect(await token).not.toMatch(/^token-of-/)
    await until(() => agent!.reports.length === 2)
    expect(agent.reports).toEqual([{ type: 'report', engine: 'agent' }, { type: 'report', mint: 'cold' }])
  })

  it('with a watch page that carries no challenge, the token is cold and the frame reports it cold, with no attestation call', async () => {
    vi.unstubAllGlobals()
    realm = installRealm({ challenge: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(() => ({ result: undefined }))
    await readWatchPage()
    await mintPoToken('video-1')
    await until(() => agent!.reports.length === 1)
    expect(agent.reports).toEqual([{ type: 'report', mint: 'cold' }])
    expect(agent.requests).toEqual([])
    expect(egress.egressFetch).not.toHaveBeenCalled()
  })

  it('with the FKN page timed out, the token is cold after the call timeout, and the call is cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(() => undefined)
    await readWatchPage()
    let settled = false
    const token = mintPoToken('video-1').finally(() => { settled = true })
    await until(() => agent!.requests.length === 1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await until(() => settled)
    expect(await token).not.toMatch(/^token-of-/)
    expect(agent.requests).toEqual(['create'])
    // the call it gave up on is cancelled, so a page still attaching never runs it
    await until(() => agent!.cancels.length === 1)
    expect(agent.cancels).toEqual([1])
  })

  it('with the FKN page detached mid-session, the next mint asks it for a new session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let detached = false
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await connectAgent(({ method }) => {
      if (detached) return { error: method === 'mint' ? AGENT_REPLACED : AGENT_UNAVAILABLE }
      if (method === 'create') return { result: 7 }
      if (method === 'snapshot') return { result: 'agent snapshot' }
      if (method === 'mint') return { result: 'agent-token' }
      return { result: undefined }
    })
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('agent-token')

    detached = true
    expect(await mintPoToken('video-2')).not.toBe('agent-token')
    expect(agent.requests).toEqual(['create', 'snapshot', 'minter', 'mint', 'mint', 'shutdown', 'create'])
    expect(realm.scripts).toEqual([])
  })
})

describe('the session wait', () => {
  let agent: Awaited<ReturnType<typeof sessionAgent>> | undefined

  beforeEach(() => {
    vi.resetModules()
    egress.egressFetch.mockReset()
    egress.egressFetch.mockImplementation(async (url: string) => answerEgress(url))
  })

  afterEach(() => {
    agent?.close()
    agent = undefined
    cleanUp()
  })

  it('a session one mint waited its whole wait for sends the next mints cold at once, until a session settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let answerIntegrity: (() => void) | undefined
    egress.egressFetch.mockImplementation(async (url: string) => endpoint(url) === 'GenerateIT'
      ? new Promise<Response>((resolve) => { answerIntegrity = () => resolve(answerEgress(url)) })
      : answerEgress(url))
    installRealm()
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()

    let firstSettled = false
    const first = mintPoToken('video-1').finally(() => { firstSettled = true })
    await until(() => answerIntegrity !== undefined)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(firstSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).not.toMatch(/^token-of-/)

    // no timer advances from here: a mint that waited on that session or the one started in its place would never settle
    let secondSettled = false
    const second = mintPoToken('video-2').finally(() => { secondSettled = true })
    await until(() => secondSettled)
    expect(secondSettled).toBe(true)
    expect(await second).not.toMatch(/^token-of-/)
    await until(() => egress.egressFetch.mock.calls.length === 4)
    expect(egress.egressFetch.mock.calls.map(([url]) => endpoint(url as string))).toEqual(['interpreter', 'GenerateIT', 'interpreter', 'GenerateIT'])

    answerIntegrity!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-3')).toMatch(/^token-of-/) })
  })

  it('once the session started in place of a waited-out one fails, the next mint waits on a new one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const integrityAnswers: ((ok: boolean) => void)[] = []
    egress.egressFetch.mockImplementation(async (url: string) => endpoint(url) === 'GenerateIT'
      ? new Promise<Response>((resolve) => {
        integrityAnswers.push(ok => resolve(ok ? answerEgress(url) : new Response(null, { status: 500 })))
      })
      : answerEgress(url))
    installRealm()
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()

    const first = mintPoToken('video-1')
    await until(() => integrityAnswers.length === 1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await first).not.toMatch(/^token-of-/)
    await until(() => integrityAnswers.length === 2)
    integrityAnswers[1]!(false)
    await until(() => error.mock.calls.length === 1)

    await readWatchPage('video-2')
    const second = mintPoToken('video-2')
    await until(() => integrityAnswers.length === 3)
    integrityAnswers[2]!(true)
    expect(await second).toBe('token-of-3')
  })

  it("a session runs on the challenge and the ytcfg of the watch page read, and the next mint is the same session's", async () => {
    const realm = installRealm()
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('token-of-1')
    expect(agent.creates).toEqual([expect.objectContaining({ config: expect.objectContaining({ EVENT_ID: 'event-1' }) })])
    expect(await mintPoToken('video-2')).toBe('token-of-1')
    expect(egress.egressFetch).toHaveBeenCalledTimes(2)
    expect(realm.watched).toHaveLength(1)
  })

  it("a recovered session runs on a new read of the last video's watch page, not on the page the first session took", async () => {
    const realm = installRealm()
    const { mintPoToken, recoverPoTokenSession } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await mintPoToken('video-1')
    await recoverPoTokenSession()
    expect(realm.watched).toEqual(['https://www.youtube.com/watch?v=video-1', 'https://www.youtube.com/watch?v=video-1'])
    expect(agent.creates).toEqual([
      expect.objectContaining({ config: expect.objectContaining({ EVENT_ID: 'event-1' }) }),
      expect.objectContaining({ config: expect.objectContaining({ EVENT_ID: 'event-2' }) }),
    ])
  })

  it('a session asked for before any watch page was read waits for the first page', async () => {
    const realm = installRealm()
    const { mintPoToken, warmPoTokenSession } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    warmPoTokenSession('visitor')
    await immediate()
    expect(egress.egressFetch).not.toHaveBeenCalled()
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('token-of-1')
    expect(realm.watched).toHaveLength(1)
    expect(egress.egressFetch).toHaveBeenCalledTimes(2)
  })
})

describe('a session that never settles', () => {
  let agent: Awaited<ReturnType<typeof sessionAgent>> | undefined
  let interpreters: ((error?: Error) => void)[]

  // the first mint waits the whole 10000 ms on the first session, whose interpreter fetch has not answered
  const waitOutFirst = async (mintPoToken: (identifier: string) => Promise<string>) => {
    const first = mintPoToken('video-1')
    await until(() => interpreters.length === 1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await first).not.toMatch(/^token-of-/)
  }

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    interpreters = []
    egress.egressFetch.mockReset()
    egress.egressFetch.mockImplementation(async (url: string) => endpoint(url) === 'interpreter'
      ? new Promise<Response>((resolve, reject) => {
        interpreters.push((error) => error ? reject(error) : resolve(answerEgress(url)))
      })
      : answerEgress(url))
    installRealm()
  })

  afterEach(() => {
    agent?.close()
    agent = undefined
    cleanUp()
  })

  it('once a mint waited it out, a new session starts in the background and the next mint takes its token', async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    await until(() => interpreters.length === 2)
    expect(interpreters).toHaveLength(2)
    interpreters[1]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-2')).toBe('token-of-1') })
  })

  it('never more than one session is started in place of it, however many mints go cold', async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    for (const video of ['video-2', 'video-3', 'video-4']) {
      const token = mintPoToken(video)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await token).not.toMatch(/^token-of-/)
    }
    expect(interpreters).toHaveLength(2)
  })

  it('the session waited out is used if it settles late, while the one started in its place is still pending', async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    await until(() => interpreters.length === 2)
    interpreters[0]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-2')).toBe('token-of-1') })
  })

  it('the session waited out failing late leaves the one started in its place pending, and starts no other', async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    await until(() => interpreters.length === 2)
    interpreters[0]!(new Error('the connection was reset'))
    await until(() => vi.mocked(console.error).mock.calls.length === 1)

    // no timer advances from here: a mint that waited on a new session would never settle
    let settled = false
    const next = mintPoToken('video-2').finally(() => { settled = true })
    await until(() => settled)
    expect(settled).toBe(true)
    expect(await next).not.toMatch(/^token-of-/)
    expect(interpreters).toHaveLength(2)
    interpreters[1]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-3')).toBe('token-of-1') })
  })

  it('of the two, the first to settle is kept and the later one is shut down', async () => {
    const { mintPoToken } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    await until(() => interpreters.length === 2)
    interpreters[1]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-2')).toBe('token-of-1') })
    interpreters[0]!()
    await vi.waitFor(() => { expect(agent!.shutdowns).toEqual([2]) })
    expect(await mintPoToken('video-3')).toBe('token-of-1')
  })

  it('a recovery waits on it for 10000 ms, not for good, and starts the new session', async () => {
    const { mintPoToken, recoverPoTokenSession, warmPoTokenSession } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    warmPoTokenSession('video-1')
    await until(() => interpreters.length === 1)
    let recovered = false
    const recovery = recoverPoTokenSession().finally(() => { recovered = true })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(recovered).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await recovery
    await until(() => interpreters.length === 2)
    interpreters[1]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-1')).toBe('token-of-1') })
  })

  it('a recovery drops the session that settled late, even while the one started in its place is pending', async () => {
    const { mintPoToken, recoverPoTokenSession } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    await waitOutFirst(mintPoToken)
    await until(() => interpreters.length === 2)
    interpreters[0]!()
    await vi.waitFor(async () => { expect(await mintPoToken('video-2')).toBe('token-of-1') })
    await recoverPoTokenSession()
    expect(agent.shutdowns).toEqual([1])
    expect(await mintPoToken('video-3')).not.toMatch(/^token-of-/)
  })
})

describe('the interpreter cache', () => {
  let agent: Awaited<ReturnType<typeof sessionAgent>> | undefined

  beforeEach(() => {
    vi.resetModules()
    egress.egressFetch.mockReset()
    egress.egressFetch.mockImplementation(async (url: string) => answerEgress(url))
  })

  afterEach(() => {
    agent?.close()
    agent = undefined
    cleanUp()
  })

  it('reuses a cached content-addressed interpreter from CacheStorage without re-fetching it over egress', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => {
          const text = stored.get(url)
          return text === undefined ? undefined : new Response(text)
        },
        put: async (url: string, response: Response) => {
          stored.set(url, await response.text())
        },
        keys: async () => [...stored.keys()].map((url) => ({ url })),
        delete: async (request: { url: string }) => stored.delete(request.url),
      }),
    })
    installRealm()
    const { mintPoToken, recoverPoTokenSession } = await import('../../../src/frame/botguard')
    agent = await sessionAgent()
    await readWatchPage()
    expect(await mintPoToken('video-1')).toBe('token-of-1')
    expect(egress.egressFetch.mock.calls.map(([url]) => endpoint(url as string))).toEqual(['interpreter', 'GenerateIT'])

    await recoverPoTokenSession()
    expect(egress.egressFetch.mock.calls.map(([url]) => endpoint(url as string))).toEqual(['interpreter', 'GenerateIT', 'GenerateIT'])
  })
})
