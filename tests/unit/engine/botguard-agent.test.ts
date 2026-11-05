import { afterEach, describe, expect, it } from 'vite-plus/test'

import { AGENT_INSTALL } from '../../../src/engine/agent-protocol'
import { installAgent } from '../../../src/engine/botguard-agent'
import { agentClient, APP_ORIGIN, CHALLENGE, CONFIG, fakeAgentPage, INTEGRITY, mintedBy, PROGRAM, turn } from './agent-fakes'

const open: MessagePort[] = []

const connect = (page: ReturnType<typeof fakeAgentPage>) => {
  const channel = new MessageChannel()
  open.push(channel.port1)
  const client = agentClient(channel.port1)
  page.deliver({ origin: APP_ORIGIN, data: { type: AGENT_INSTALL }, ports: [channel.port2] })
  return client
}

const installed = () => {
  const page = fakeAgentPage()
  expect(installAgent({ scope: page.scope, appOrigin: APP_ORIGIN, runScript: page.runScript, fetch: page.fetch, readCookie: page.readCookie })).toBe('installed')
  return page
}

describe('the BotGuard agent', () => {
  afterEach(() => {
    for (const port of open.splice(0)) port.close()
  })

  it('create, snapshot, mint and shutdown against a fake BotGuard', async () => {
    const page = installed()
    const agent = connect(page)
    await turn()
    expect(agent.controls).toEqual([{ type: 'ready' }])

    const session = await agent.call('create', CHALLENGE)
    expect(page.scripts).toEqual([CHALLENGE.interpreter])
    expect(page.log).toEqual([`agent load ${PROGRAM}`])
    expect(await agent.call('snapshot', session)).toBe(`agent snapshot of ${PROGRAM}`)
    expect(await agent.call('minter', session, INTEGRITY)).toBeUndefined()
    expect(await agent.call('mint', session, 'video-1')).toBe(mintedBy('agent', 'video-1'))
    expect(await agent.call('mint', session, 'video-2')).toBe(mintedBy('agent', 'video-2'))

    expect(await agent.call('shutdown', session)).toBeUndefined()
    expect(page.log).toContain('agent shutdown')
    expect(page.removed()).toBe(1)
    await expect(agent.call('mint', session, 'video-1')).rejects.toThrow(/no session/)
  })

  it("create sets the watch page's ytcfg as yt.config_ before the interpreter runs", async () => {
    const page = installed()
    const agent = connect(page)
    await agent.call('create', CHALLENGE)
    await agent.call('create', { ...CHALLENGE, config: { EVENT_ID: 'the next page event' } })
    expect(page.configs).toEqual([CONFIG, { EVENT_ID: 'the next page event' }])
  })

  it('an unknown method is refused', async () => {
    const agent = connect(installed())
    await expect(agent.call('evaluate', 'document.cookie')).rejects.toThrow('yt-client agent: unknown method "evaluate"')
    await expect(agent.call('constructor')).rejects.toThrow('yt-client agent: unknown method "constructor"')
  })

  it("a second install answers 'already' and adds no second listener", () => {
    const page = installed()
    expect(installAgent({ scope: page.scope, appOrigin: APP_ORIGIN, runScript: page.runScript, fetch: page.fetch, readCookie: page.readCookie })).toBe('already')
    expect(page.listeners.size).toBe(1)
  })

  it('answers a ping, which is the heartbeat the app realm counts', async () => {
    const agent = connect(installed())
    agent.post({ type: 'ping' })
    await turn()
    expect(agent.controls).toEqual([{ type: 'ready' }, { type: 'pong' }])
  })

  it('refuses an interpreter that defines no global, and removes its script', async () => {
    const page = installed()
    const agent = connect(page)
    await expect(agent.call('create', { ...CHALLENGE, interpreter: 'something else' })).rejects.toThrow(/did not define fakeBotguard/)
    expect(page.removed()).toBe(1)
  })

  it("a new port shuts down the previous port's sessions", async () => {
    const page = installed()
    const first = connect(page)
    const session = await first.call('create', CHALLENGE)
    await first.call('snapshot', session)

    const second = connect(page)
    await turn()
    expect(second.controls).toEqual([{ type: 'ready' }])
    expect(page.log).toContain('agent shutdown')
    await expect(second.call('snapshot', session)).rejects.toThrow(/no session/)
  })

  it("fetch sends the page's jar and the caller's headers but a cookie, and answers the whole body", async () => {
    const page = installed()
    page.page.answerFetch = async () => new Response('{"responseContext":{}}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } })
    const agent = connect(page)
    const body = new TextEncoder().encode('{"context":{}}').buffer
    const answer = await agent.call('fetch', 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: {
        Cookie: 'SAPISID=x; SID=y',
        authorization: 'SAPISIDHASH 1_abc',
        'X-Goog-AuthUser': '1',
        'x-goog-visitor-id': 'visitor',
        'x-youtube-client-name': '1',
        'content-type': 'application/json',
      },
      body,
    }) as { status: number, statusText: string, headers: [string, string][], body: ArrayBuffer }
    expect(page.fetches).toHaveLength(1)
    const { url, init } = page.fetches[0]!
    expect(url).toBe('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false')
    const { signal, ...sent } = init
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(sent).toEqual({
      method: 'POST',
      headers: {
        authorization: 'SAPISIDHASH 1_abc',
        'X-Goog-AuthUser': '1',
        'x-goog-visitor-id': 'visitor',
        'x-youtube-client-name': '1',
        'content-type': 'application/json',
      },
      body,
      credentials: 'include',
      redirect: 'follow',
    })
    expect(answer.status).toBe(201)
    expect(answer.statusText).toBe('Created')
    expect(answer.headers).toEqual([['content-type', 'application/json']])
    expect(answer.body).toBeInstanceOf(ArrayBuffer)
    expect(new TextDecoder().decode(answer.body)).toBe('{"responseContext":{}}')
  })

  it("cookie answers the page's document.cookie", async () => {
    const page = installed()
    page.page.cookie = 'PREF=f6=40000000; SAPISID=abc/def'
    expect(await connect(page).call('cookie')).toBe('PREF=f6=40000000; SAPISID=abc/def')
  })

  it('a cancel aborts a fetch in flight, which answers with the abort', async () => {
    const page = installed()
    let aborted: AbortSignal | undefined
    page.page.answerFetch = (_url, init) => new Promise((_resolve, reject) => {
      aborted = init.signal!
      init.signal!.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    })
    const agent = connect(page)
    const call = agent.call('fetch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', { method: 'GET' })
    await turn()
    expect(aborted?.aborted).toBe(false)
    agent.post({ type: 'cancel', id: 1 })
    await expect(call).rejects.toThrow(/aborted/)
    expect(aborted?.aborted).toBe(true)
  })

  it('a new port aborts the fetches of the previous one', async () => {
    const page = installed()
    let aborted: AbortSignal | undefined
    page.page.answerFetch = (_url, init) => new Promise(() => { aborted = init.signal! })
    const first = connect(page)
    void first.call('fetch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', { method: 'GET' })
    await turn()
    connect(page)
    await turn()
    expect(aborted?.aborted).toBe(true)
  })
})
