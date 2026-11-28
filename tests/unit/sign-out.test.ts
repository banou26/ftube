import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { CHANNEL_KEY, SIGNED_IN_KEY } from '../../src/engine/signed-in'
import { BRAND_PAGE_ID } from './fixtures/accounts-list'

const calls: string[] = []
const resetIdentity = vi.fn(async () => { calls.push('reset identity') })
const flagAtReset: (string | null)[] = []
const resetEngine = vi.fn(() => {
  calls.push('reset engine')
  flagAtReset.push(localStorage.getItem(SIGNED_IN_KEY))
})
const stopAgentHost = vi.fn(() => { calls.push('detach the page') })
const iframe = { remove: () => { calls.push('remove the frame') } }
const clearCookies = vi.fn(async () => { calls.push('clear cookies') })
const attachFrame = vi.fn(async (options: { cookies: string }) => {
  calls.push(`attach ${options.cookies}`)
  return { clearCookies }
})

vi.mock('../../src/components/ui/toast', () => ({ showToast: vi.fn(), dismissToast: vi.fn(), TOAST_DISMISS_MS: 5_000 }))
vi.mock('../../src/engine/client', () => ({ startEngine: async () => ({ resetIdentity }), resetEngine }))
vi.mock('../../src/engine/agent-host', () => ({ mountHiddenFrame: () => iframe, stopAgentHost }))
vi.mock('../../src/engine/platform', () => ({
  startPlatform: async () => ({}),
  loadedLib: () => ({
    attachFrame,
    isLocatorInvalid: () => false,
    isLocatorUnsupported: () => false,
    isPermissionDenied: () => false,
  }),
}))

type Listener = (event: { data: unknown }) => void

// every module instance is a tab: a message reaches every other instance's channel of that name, a task later
const channels = new Set<{ name: string, listeners: Set<Listener> }>()
class FakeBroadcastChannel {
  readonly listeners = new Set<Listener>()
  constructor(readonly name: string) {
    channels.add(this)
  }
  addEventListener(_type: string, listener: Listener) {
    this.listeners.add(listener)
  }
  postMessage(data: unknown) {
    for (const channel of channels) {
      if (channel === this || channel.name !== this.name) continue
      setTimeout(() => { for (const listener of channel.listeners) listener({ data }) })
    }
  }
}

const install = () => {
  const stored: Record<string, string> = { [SIGNED_IN_KEY]: '1', [CHANNEL_KEY]: BRAND_PAGE_ID }
  const assign = vi.fn((path: string) => { calls.push(`go to ${path}`) })
  const reload = vi.fn(() => { calls.push('reload') })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => { stored[key] = value },
    removeItem: (key: string) => { delete stored[key] },
  })
  vi.stubGlobal('location', { origin: 'https://youtube.fkn.app', pathname: '/', assign, reload })
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  return { stored, assign, reload }
}

describe('signing out', () => {
  beforeEach(() => {
    vi.resetModules()
    calls.length = 0
    flagAtReset.length = 0
    channels.clear()
    attachFrame.mockClear()
    clearCookies.mockReset()
    clearCookies.mockImplementation(async () => { calls.push('clear cookies') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resets the engine and detaches the FKN page before clearing FKN's jar, then loads every tab again", async () => {
    const { stored, reload } = install()
    const tab = await import('../../src/sign-in')
    vi.resetModules()
    await import('../../src/sign-in')
    await tab.signOut()
    expect(calls).toEqual(['reset identity', 'reset engine', 'detach the page', 'attach persistent', 'clear cookies', 'remove the frame', 'go to /'])
    expect(attachFrame).toHaveBeenCalledWith({ iframe, cookies: 'persistent', domains: ['www.youtube.com', 'accounts.google.com'] })
    expect(stored[SIGNED_IN_KEY]).toBeUndefined()
    expect(stored[CHANNEL_KEY]).toBeUndefined()
    // the other tab loads again too
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('every other tab resets its engine and detaches its FKN page before the jar is cleared', async () => {
    const { reload } = install()
    // an attach takes longer than a message to the other tabs
    attachFrame.mockImplementationOnce(async (options: { cookies: string }) => {
      calls.push(`attach ${options.cookies}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { clearCookies }
    })
    const tab = await import('../../src/sign-in')
    vi.resetModules()
    await import('../../src/sign-in')
    await tab.signOut()
    const beforeClear = calls.slice(0, calls.indexOf('clear cookies'))
    expect(beforeClear.filter((call) => call === 'reset engine')).toHaveLength(2)
    expect(beforeClear.filter((call) => call === 'detach the page')).toHaveLength(2)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('a clear that fails rejects, loads nothing again and keeps the tab signed in', async () => {
    const { stored, assign } = install()
    clearCookies.mockRejectedValueOnce(new Error('frame.clearCookies: the render proxy did not answer within 30000ms'))
    const { signOut } = await import('../../src/sign-in')
    await expect(signOut()).rejects.toThrow(/did not answer/)
    expect(calls).toContain('remove the frame')
    expect(assign).not.toHaveBeenCalled()
    expect(stored[SIGNED_IN_KEY]).toBe('1')
    expect(stored[CHANNEL_KEY]).toBe(BRAND_PAGE_ID)
  })

  it('a clear that fails resets again whatever started signed out meanwhile, once the flag is back', async () => {
    install()
    clearCookies.mockRejectedValueOnce(new Error('frame.clearCookies: the render proxy did not answer within 30000ms'))
    const { signOut } = await import('../../src/sign-in')
    await expect(signOut()).rejects.toThrow(/did not answer/)
    expect(calls.slice(calls.indexOf('attach persistent') + 1)).toEqual(['remove the frame', 'reset engine', 'detach the page'])
    expect(flagAtReset).toEqual([null, '1'])
  })
})
