import { describe, expect, it, vi } from 'vite-plus/test'

import {
  createGroupStore,
  DEFAULT_EMOJI,
  directSubgroups,
  GROUPS_KEY,
  GROUPS_SYNC_KEY,
  groupAncestors,
  groupChannelsWithDescendants,
  groupTreeOrder,
  isDescendant,
} from '../../../src/groups/store'

const ALPHA = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha', avatar: 'https://yt3.ggpht.com/alpha' }
const BETA = { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta' }

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size
      },
    } satisfies Storage,
  }
}

const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key })

describe('group store', () => {
  it('keeps what it writes, and a new store over the same storage reads it back', () => {
    const { storage } = memoryStorage()
    const store = createGroupStore(storage)
    const group = store.createGroup({ name: '  Tech  ', emoji: '💻', channels: [ALPHA] })
    store.setChannel(group.id, BETA, true)
    store.updateGroup(group.id, { name: 'Tech and science' })

    const expected = [{ id: group.id, name: 'Tech and science', emoji: '💻', channels: [ALPHA, BETA], updatedAt: expect.any(Number) }]
    expect(store.getGroups()).toEqual(expected)
    expect(createGroupStore(storage).getGroups()).toEqual(expected)

    store.setChannel(group.id, ALPHA, false)
    expect(store.getGroups()[0]?.channels).toEqual([BETA])
    store.deleteGroup(group.id)
    expect(createGroupStore(storage).getGroups()).toEqual([])
  })

  it('gives a new group its own id and a default icon', () => {
    const store = createGroupStore(memoryStorage().storage)
    const first = store.createGroup({ name: 'One' })
    const second = store.createGroup({ name: 'Two' })
    expect(first.id).not.toBe(second.id)
    expect(first.emoji).toBe(DEFAULT_EMOJI)
    expect(() => store.createGroup({ name: '   ' })).toThrow()
    expect(store.getGroups().map(group => group.name)).toEqual(['One', 'Two'])
  })

  it('reads storage that is not JSON as no groups', () => {
    const store = createGroupStore(memoryStorage({ [GROUPS_KEY]: '{not json' }).storage)
    expect(store.getGroups()).toEqual([])
  })

  it('drops each bad group or channel alone and keeps the rest', () => {
    const stored = [
      { id: 'kept', name: 'Kept', emoji: '🎵', channels: [
        ALPHA,
        { id: '@handle', name: 'Not a channel id' },
        { id: 'UCcccccccccccccccccccccc' },
        { ...BETA, avatar: 'javascript:alert(1)' },
        ALPHA,
        'nonsense',
      ] },
      { id: 'kept', name: 'Same id again' },
      { id: 'no-name', name: '' },
      { name: 'No id' },
      { id: 'no-channels', name: 'No channels', channels: 'many' },
      null,
      42,
    ]
    const store = createGroupStore(memoryStorage({ [GROUPS_KEY]: JSON.stringify(stored) }).storage)
    expect(store.getGroups()).toEqual([
      { id: 'kept', name: 'Kept', emoji: '🎵', channels: [ALPHA, BETA], updatedAt: 0 },
      { id: 'no-channels', name: 'No channels', emoji: DEFAULT_EMOJI, channels: [], updatedAt: 0 },
    ])
    expect(createGroupStore(memoryStorage({ [GROUPS_KEY]: '{"groups":[]}' }).storage).getGroups()).toEqual([])
  })

  it('tells subscribers about every change until they leave', () => {
    const store = createGroupStore(memoryStorage().storage)
    const seen: string[][] = []
    const leave = store.subscribe(groups => seen.push(groups.map(group => group.name)))
    const group = store.createGroup({ name: 'One' })
    store.updateGroup(group.id, { name: 'Uno' })
    leave()
    store.deleteGroup(group.id)
    expect(seen).toEqual([['One'], ['Uno']])
  })

  it('follows a change another tab made', () => {
    const { storage, data } = memoryStorage()
    const events = new EventTarget()
    const store = createGroupStore(storage, events)
    const seen: string[][] = []
    store.subscribe(groups => seen.push(groups.map(group => group.name)))

    data.set(GROUPS_KEY, JSON.stringify([{ id: 'other', name: 'From the other tab', channels: [BETA] }]))
    events.dispatchEvent(storageEvent('yt-client:settings'))
    expect(seen).toEqual([])
    events.dispatchEvent(storageEvent(GROUPS_KEY))
    expect(store.getGroups()).toEqual([{ id: 'other', name: 'From the other tab', emoji: DEFAULT_EMOJI, channels: [BETA], updatedAt: 0 }])

    data.clear()
    events.dispatchEvent(storageEvent(null))
    expect(seen).toEqual([['From the other tab'], []])
  })

  it('keeps working in memory when storage refuses a write, and says it no longer persists', () => {
    const { storage } = memoryStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const store = createGroupStore(storage)
    expect(store.persists()).toBe(true)
    store.createGroup({ name: 'Unsaved' })
    expect(store.getGroups().map(group => group.name)).toEqual(['Unsaved'])
    expect(store.persists()).toBe(false)
    expect(createGroupStore().persists()).toBe(false)
  })

  it('stamps every edit later than the copy it replaces, even on a clock running behind', () => {
    vi.useFakeTimers({ now: 1_000 })
    try {
      const store = createGroupStore(memoryStorage().storage)
      const group = store.createGroup({ name: 'One' })
      expect(group.updatedAt).toBe(1_000)
      store.updateGroup(group.id, { name: 'Uno' })
      store.setChannel(group.id, ALPHA, true)
      expect(store.getGroups()[0]?.updatedAt).toBe(1_002)
      vi.setSystemTime(10)
      store.updateGroup(group.id, { emoji: '🎵' })
      expect(store.getGroups()[0]?.updatedAt).toBe(1_003)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records when each group was deleted, and only edits tell the sync', () => {
    const { storage, data } = memoryStorage()
    const store = createGroupStore(storage)
    let edits = 0
    store.onEdit(() => {
      edits += 1
    })
    const group = store.createGroup({ name: 'Gone' })
    store.deleteGroup(group.id)
    store.deleteGroup('not-a-group')
    expect(edits).toBe(2)
    expect(Object.keys(JSON.parse(data.get(GROUPS_SYNC_KEY) ?? '{}').deleted)).toEqual([group.id])
    expect(store.snapshot().deleted[group.id]).toBeGreaterThan(group.updatedAt)

    store.settle([], { file: 'account-file', deleted: {} })
    expect(edits).toBe(2)
    expect(createGroupStore(storage).snapshot()).toEqual({ groups: [], file: 'account-file', deleted: {} })
  })

  it('nests folders, prevents cycles, aggregates descendant channels, and promotes children on delete', () => {
    const store = createGroupStore(memoryStorage().storage)
    const root = store.createGroup({ name: 'Tech', channels: [ALPHA] })
    const child = store.createGroup({ name: 'Programming', parentId: root.id, channels: [BETA] })
    const grand = store.createGroup({ name: 'Systems', parentId: child.id, channels: [ALPHA] })

    expect(groupTreeOrder(store.getGroups()).map(node => [node.group.name, node.depth, node.hasChildren])).toEqual([
      ['Tech', 0, true],
      ['Programming', 1, true],
      ['Systems', 2, false],
    ])
    expect(groupAncestors(store.getGroups(), grand.id).map(group => group.name)).toEqual(['Tech', 'Programming'])
    expect(directSubgroups(store.getGroups(), root.id).map(group => group.name)).toEqual(['Programming'])
    expect(groupChannelsWithDescendants(store.getGroups(), root.id)).toEqual([ALPHA, BETA])
    expect(isDescendant(store.getGroups(), grand.id, root.id)).toBe(true)
    expect(isDescendant(store.getGroups(), root.id, grand.id)).toBe(false)

    // reparenting a folder under its own descendant is rejected (moves to root rather than creating a cycle)
    store.updateGroup(root.id, { parentId: grand.id })
    expect(store.getGroups().find(group => group.id === root.id)?.parentId).toBeUndefined()

    // deleting a parent promotes direct subfolders up one level rather than orphaning or deleting them
    store.deleteGroup(child.id)
    const remaining = store.getGroups()
    expect(remaining.find(group => group.id === grand.id)?.parentId).toBe(root.id)
    expect(directSubgroups(remaining, root.id).map(group => group.name)).toEqual(['Systems'])
  })

  it('lifts orphaned or cyclic stored parentIds safely to top level', () => {
    const stored = [
      { id: 'a', name: 'A', parentId: 'b', channels: [ALPHA] },
      { id: 'b', name: 'B', parentId: 'a', channels: [BETA] },
      { id: 'orphan', name: 'Orphan', parentId: 'missing', channels: [] },
    ]
    const store = createGroupStore(memoryStorage({ [GROUPS_KEY]: JSON.stringify(stored) }).storage)
    const tree = groupTreeOrder(store.getGroups())
    expect(tree.map(node => [node.group.id, node.depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['orphan', 0],
    ])
  })

  it('restores a deleted group, re-parents its children, and clears its tombstone cleanly', () => {
    const store = createGroupStore(memoryStorage().storage)
    const root = store.createGroup({ name: 'Gaming', emoji: '🎮', channels: [ALPHA] })
    const child = store.createGroup({ name: 'Trailers', emoji: '🎬', parentId: root.id, channels: [BETA] })
    const childIds = directSubgroups(store.getGroups(), root.id).map(group => group.id)
    const deletedAtBefore = root.updatedAt

    store.deleteGroup(root.id)
    expect(store.getGroups().find(group => group.id === root.id)).toBeUndefined()
    expect(store.getGroups().find(group => group.id === child.id)?.parentId).toBeUndefined()
    expect(store.snapshot().deleted[root.id]).toBeDefined()

    const tombstoneTime = store.snapshot().deleted[root.id]!
    store.restoreGroup(root, childIds)

    const restored = store.getGroups().find(group => group.id === root.id)
    expect(restored).toBeDefined()
    expect(restored?.name).toBe('Gaming')
    expect(restored?.channels).toEqual([ALPHA])
    expect(restored?.updatedAt).toBeGreaterThan(tombstoneTime)
    expect(restored?.updatedAt).toBeGreaterThan(deletedAtBefore)
    expect(store.getGroups().find(group => group.id === child.id)?.parentId).toBe(root.id)
    expect(store.snapshot().deleted[root.id]).toBeUndefined()
  })
})
