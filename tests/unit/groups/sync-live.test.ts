import type { FknLib } from '../../../src/groups/sync-live'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const mockState = vi.hoisted(() => ({
  availability: 'disconnected' as 'connected' | 'disconnected' | 'unknown',
  unlocked: true,
  enrolled: true,
  readFileError: undefined as Error | undefined,
  onChange: vi.fn(async () => () => {}),
}))

vi.mock('../../../src/engine/platform', () => ({ startPlatform: async () => ({}) }))
vi.mock('@fkn/lib/account', () => ({ onChange: mockState.onChange }))
vi.mock('@fkn/lib/cloud/fs', () => ({
  availability: async () => mockState.availability,
  encryption: async () => ({ unlocked: mockState.unlocked, enrolled: mockState.enrolled, keyEpoch: null }),
  isNotFound: (error: unknown) => (error as { code?: string } | null)?.code === 'STORAGE_NOT_FOUND',
  promises: {
    readFile: async () => {
      if (mockState.readFileError) throw mockState.readFileError
      const err = Object.assign(new Error('not found'), { code: 'STORAGE_NOT_FOUND' })
      throw err
    },
    writeFile: async () => {},
  },
  unlock: async () => true,
}))

afterEach(() => {
  mockState.availability = 'disconnected'
  mockState.unlocked = true
  mockState.enrolled = true
  mockState.readFileError = undefined
  mockState.onChange.mockClear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const installStorageGlobals = () => {
  const docTarget = new EventTarget()
  const winTarget = new EventTarget()
  const store = new Map<string, string>()
  const localStorage: Storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
    clear: () => store.clear(),
    key: index => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }
  vi.stubGlobal('document', Object.assign(docTarget, { visibilityState: 'visible' }))
  vi.stubGlobal('window', Object.assign(winTarget, { localStorage }))
  return { docTarget, winTarget }
}

describe('readFkn', () => {
  // account.info() answers null for a sign out and for an FKN that failed alike
  const lib = (availability: 'connected' | 'disconnected' | 'unknown', { unlocked = true, enrolled = true } = {}) => ({
    account: { info: async () => null },
    fs: { availability: async () => availability, encryption: async () => ({ unlocked, enrolled, keyEpoch: null }) },
  }) as unknown as FknLib

  it('reads signed in or out only from an answer, so a failing FKN shows no FKN row', async () => {
    const { readFkn } = await import('../../../src/groups/sync-live')
    expect(await readFkn(lib('unknown'))).toBeUndefined()
    expect(await readFkn(lib('disconnected'))).toMatchObject({ signedIn: false, locked: false })
    expect(await readFkn(lib('connected'))).toMatchObject({ signedIn: true, locked: false })
    expect(await readFkn(lib('connected', { unlocked: false, enrolled: true }))).toMatchObject({ signedIn: true, locked: true })
    expect(await readFkn(lib('connected', { unlocked: false, enrolled: false }))).toMatchObject({ signedIn: true, locked: false })
  })
})

describe('startGroupSync', () => {
  it('starts only where navigator.locks exists and sets unavailable status on failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {} })
    vi.stubGlobal('window', { addEventListener: () => {} })

    vi.stubGlobal('navigator', {})
    const unlocked = await import('../../../src/groups/sync-live')
    await expect(unlocked.startGroupSync()).rejects.toThrow('navigator.locks')
    expect(unlocked.getGroupSyncStatus().state).toBe('unavailable')
    expect(mockState.onChange).not.toHaveBeenCalled()

    // the control: the same start in a page that has the lock
    vi.resetModules()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => Promise<void>) => work() } })
    const locked = await import('../../../src/groups/sync-live')
    await locked.startGroupSync()
    expect(mockState.onChange).toHaveBeenCalledTimes(1)
  })

  it('tracks live sync state across locked, synced, unknown retry backoff, error, and focus checks', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { winTarget } = installStorageGlobals()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => Promise<void>) => work() } })
    mockState.availability = 'unknown'

    const { getGroupSyncStatus, startGroupSync, subscribeGroupSyncStatus } = await import('../../../src/groups/sync-live')
    const seen: string[] = []
    const unsubscribe = subscribeGroupSyncStatus(next => seen.push(`${next.state}:${next.syncing}`))

    await startGroupSync()
    await vi.advanceTimersByTimeAsync(0)
    expect(getGroupSyncStatus().state).toBe('unavailable')

    // Startup retry fires after 5s when availability returned unknown, picking up locked state once connected.
    mockState.availability = 'connected'
    mockState.unlocked = false
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(getGroupSyncStatus().state).toBe('locked')
    expect(getGroupSyncStatus().lib).toBeDefined()

    // Focusing the window pulls again once unlocked.
    mockState.unlocked = true
    winTarget.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(getGroupSyncStatus().state).toBe('synced')

    // Read errors surface as error state without dropping lib.
    mockState.readFileError = new Error('transient error')
    winTarget.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(getGroupSyncStatus().state).toBe('error')
    expect(warn).toHaveBeenCalled()

    unsubscribe()
    expect(seen).toContain('locked:true')
    expect(seen).toContain('synced:true')
    expect(seen).toContain('error:true')
  })
})
