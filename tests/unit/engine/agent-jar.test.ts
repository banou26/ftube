import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { AGENT_PAGE_URL } from '../../../src/engine/agent-protocol'
import { SIGNED_IN_KEY } from '../../../src/engine/signed-in'

const attachFrame = vi.fn(async (_options: Record<string, unknown>) => ({
  addScriptTag: async () => {},
  postMessage: async () => {},
  on: () => {},
}))

vi.mock('@fkn/lib', () => ({ attachFrame }))
vi.mock('../../../src/engine/platform', () => ({ startPlatform: async () => ({}) }))
vi.mock('../../../src/engine/agent-source', () => ({ agentSource: () => 'the agent bundle' }))

const install = (stored: Record<string, string>) => {
  const removed: unknown[] = []
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null })
  vi.stubGlobal('location', { origin: 'https://youtube.fkn.app' })
  vi.stubGlobal('document', {
    createElement: () => {
      const element = { setAttribute: () => {}, style: {}, remove: () => { removed.push(element) } }
      return element
    },
    body: { appendChild: () => {} },
    documentElement: { dataset: {} },
  })
  return { removed }
}

const attached = () => vi.waitFor(() => expect(attachFrame).toHaveBeenCalled())

describe("the FKN page's jar", () => {
  beforeEach(() => {
    vi.resetModules()
    attachFrame.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    const { stopAgentHost } = await import('../../../src/engine/agent-host')
    stopAgentHost()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('is ephemeral without yt-client:signed-in, so a signed-out visitor never attaches on the shared jar', async () => {
    install({})
    const { startAgentHost } = await import('../../../src/engine/agent-host')
    expect(startAgentHost().signedIn).toBe(false)
    await attached()
    expect(attachFrame.mock.calls.map(([options]) => options.cookies)).toEqual(['ephemeral'])
    expect(attachFrame.mock.calls[0]![0]).toMatchObject({ blank: { url: AGENT_PAGE_URL } })
  })

  it('is persistent with yt-client:signed-in, where the session is', async () => {
    install({ [SIGNED_IN_KEY]: '1' })
    const { startAgentHost } = await import('../../../src/engine/agent-host')
    expect(startAgentHost().signedIn).toBe(true)
    await attached()
    expect(attachFrame.mock.calls.map(([options]) => options.cookies)).toEqual(['persistent'])
  })

  it('a stopped host detaches its page, and the next start attaches a new one', async () => {
    const { removed } = install({ [SIGNED_IN_KEY]: '1' })
    const { startAgentHost, stopAgentHost } = await import('../../../src/engine/agent-host')
    const first = startAgentHost()
    await attached()
    await new Promise((resolve) => setTimeout(resolve, 10))
    stopAgentHost()
    expect(removed).toHaveLength(1)
    expect(startAgentHost()).not.toBe(first)
    await vi.waitFor(() => expect(attachFrame).toHaveBeenCalledTimes(2))
  })
})
