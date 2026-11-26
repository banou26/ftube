import type { GroupSyncStatus } from '../../../src/groups/sync-live'

import { describe, expect, it, vi } from 'vite-plus/test'

type VNode = { type: unknown, props: Record<string, unknown> }

const element = (type: unknown, props: Record<string, unknown>): VNode => ({ type, props })

const mockStatus: { current: GroupSyncStatus } = {
  current: { state: 'loading', syncing: false },
}
const checkGroupsMock = vi.fn(async () => {})
const effectCallbacks: (() => void)[] = []

vi.mock('../../../src/groups/sync-live', () => ({
  useGroupSyncStatus: () => mockStatus.current,
  checkGroups: checkGroupsMock,
}))
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => void) => { effectCallbacks.push(fn) },
}))
vi.mock('lucide-react', () => ({
  LockKeyholeOpen: 'LockKeyholeOpen',
  LogIn: 'LogIn',
  RefreshCw: 'RefreshCw',
}))
vi.mock('@emotion/react', () => ({ css: () => undefined }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: element, jsxs: element }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: element }))

const { GroupSyncBanner } = await import('../../../src/components/group-sync-banner')

const findButtons = (node: unknown): VNode[] => {
  if (!node || typeof node !== 'object') return []
  const vnode = node as VNode
  const own = vnode.type === 'button' ? [vnode] : []
  const children = Array.isArray(vnode.props?.children) ? vnode.props.children : [vnode.props?.children]
  return [...own, ...children.flatMap(findButtons)]
}

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const vnode = node as VNode
  const children = Array.isArray(vnode.props?.children) ? vnode.props.children : [vnode.props?.children]
  return children.map(textOf).join('')
}

describe('GroupSyncBanner', () => {
  it('triggers a sync check on mount and hides while loading or unavailable', () => {
    effectCallbacks.length = 0
    checkGroupsMock.mockClear()

    mockStatus.current = { state: 'loading', syncing: false }
    expect(GroupSyncBanner({})).toBeNull()
    expect(effectCallbacks).toHaveLength(1)
    effectCallbacks[0]!()
    expect(checkGroupsMock).toHaveBeenCalledTimes(1)

    mockStatus.current = { state: 'unavailable', syncing: false }
    expect(GroupSyncBanner({})).toBeNull()
  })

  it('calls lib.fs.unlock synchronously inside the Unlock click and rechecks afterwards', async () => {
    checkGroupsMock.mockClear()
    const unlock = vi.fn(async () => true)
    const login = vi.fn(async () => true)
    mockStatus.current = {
      state: 'locked',
      syncing: false,
      lib: { account: { login }, fs: { unlock } } as never,
    }

    const tree = GroupSyncBanner({})
    expect(textOf(tree)).toContain('FKN storage is locked on this device')
    const buttons = findButtons(tree)
    expect(buttons).toHaveLength(1)
    expect(textOf(buttons[0])).toContain('Unlock')

    const onClick = buttons[0]!.props.onClick as () => void
    onClick()
    // Must be called in the same synchronous turn for Safari popup activation.
    expect(unlock).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(checkGroupsMock).toHaveBeenCalledTimes(1))
  })

  it('calls lib.account.login synchronously inside Sign in to FKN click', async () => {
    checkGroupsMock.mockClear()
    const login = vi.fn(async () => true)
    const unlock = vi.fn(async () => true)
    mockStatus.current = {
      state: 'signed-out',
      syncing: false,
      lib: { account: { login }, fs: { unlock } } as never,
    }

    const tree = GroupSyncBanner({})
    expect(textOf(tree)).toContain('Sign in to FKN to sync groups across devices.')
    const buttons = findButtons(tree)
    const onClick = buttons[0]!.props.onClick as () => void
    onClick()
    expect(login).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(checkGroupsMock).toHaveBeenCalledTimes(1))
  })

  it('shows synced notice only when showWhenSynced is true and renders error retry on failure', () => {
    mockStatus.current = { state: 'synced', syncing: false }
    expect(GroupSyncBanner({ showWhenSynced: false })).toBeNull()
    const syncedTree = GroupSyncBanner({})
    expect(textOf(syncedTree)).toContain('Synced with FKN')
    expect(textOf(findButtons(syncedTree)[0])).toContain('Sync now')

    mockStatus.current = { state: 'error', syncing: false }
    const errorTree = GroupSyncBanner({ showWhenSynced: false })
    expect(textOf(errorTree)).toContain('Could not sync groups with FKN.')
    expect(textOf(findButtons(errorTree)[0])).toContain('Try again')
  })
})
