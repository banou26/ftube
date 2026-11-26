import { useEffect, useState } from 'preact/hooks'

import { isChannelId } from '../sources/youtube/channel-feed'

/** A channel as a group keeps it: enough to draw it without asking YouTube. */
export type GroupChannel = { id: string, name: string, avatar?: string }

/** A named set of channels, optionally nested under a parent folder (`parentId`). `updatedAt` (ms) decides which copy wins when two browsers edited it. */
export type Group = { id: string, name: string, emoji: string, channels: GroupChannel[], updatedAt: number, parentId?: string }

export type GroupFields = { name: string, emoji?: string, channels?: GroupChannel[], parentId?: string }

export const GROUPS_KEY = 'yt-client:groups'

/** The groups' link to the FKN account, src/groups/sync.ts's to keep. */
export const GROUPS_SYNC_KEY = 'yt-client:groups-sync'

/** When each deleted group went, by id, so a copy of it elsewhere does not bring it back. */
export type Deleted = Record<string, number>

/** `file` is the account file this list was last merged with, absent while the list is this browser's own. */
export type GroupsSync = { file?: string, deleted: Deleted }

export const groupHrefFor = (groupId: string) => `/feed/groups/${encodeURIComponent(groupId)}`

export const DEFAULT_EMOJI = '📁'

export const NAME_LIMIT = 100

const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, limit) : undefined

const coerceChannel = (value: unknown): GroupChannel | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { id, name, avatar } = value as Record<string, unknown>
  const label = text(name, NAME_LIMIT)
  if (typeof id !== 'string' || !isChannelId(id) || !label) return undefined
  return typeof avatar === 'string' && /^(https:)?\/\//.test(avatar) ? { id, name: label, avatar } : { id, name: label }
}

const uniqueById = <Item extends { id: string }>(items: (Item | undefined)[]) => {
  const byId = new Map<string, Item>()
  for (const item of items) if (item && !byId.has(item.id)) byId.set(item.id, item)
  return [...byId.values()]
}

const coerceGroup = (value: unknown): Group | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { id, name, emoji, channels, updatedAt, parentId } = value as Record<string, unknown>
  const groupId = text(id, 64)
  const label = text(name, NAME_LIMIT)
  if (!groupId || !label) return undefined
  const parent = text(parentId, 64)
  return {
    id: groupId,
    name: label,
    emoji: text(emoji, 16) ?? DEFAULT_EMOJI,
    channels: Array.isArray(channels) ? uniqueById(channels.map(coerceChannel)) : [],
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
    ...(parent && parent !== groupId ? { parentId: parent } : {}),
  }
}

export type GroupTreeNode = {
  group: Group
  depth: number
  parentId?: string
  hasChildren: boolean
}

// A valid parent exists in the list and does not lead back into a cycle.
const validParentId = (group: Group, byId: ReadonlyMap<string, Group>): string | undefined => {
  if (!group.parentId || group.parentId === group.id || !byId.has(group.parentId)) return undefined
  const seen = new Set<string>([group.id])
  let cursor: string | undefined = group.parentId
  while (cursor) {
    if (seen.has(cursor)) return undefined
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId
  }
  return group.parentId
}

/** True when `candidateId` is `ancestorId` itself or nested anywhere inside it. */
export const isDescendant = (groups: readonly Group[], candidateId: string, ancestorId: string): boolean => {
  if (candidateId === ancestorId) return true
  const byId = new Map(groups.map(group => [group.id, group]))
  const seen = new Set<string>()
  let cursor = byId.get(candidateId)?.parentId
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId
  }
  return false
}

/** Groups in depth-first tree order, with orphans and cyclic references safely lifted to depth 0. */
export const groupTreeOrder = (groups: readonly Group[]): GroupTreeNode[] => {
  const byId = new Map(groups.map(group => [group.id, group]))
  const childrenByParent = new Map<string | undefined, Group[]>()
  for (const group of groups) {
    const parent = validParentId(group, byId)
    const list = childrenByParent.get(parent)
    if (list) list.push(group)
    else childrenByParent.set(parent, [group])
  }
  const ordered: GroupTreeNode[] = []
  const visit = (parentId: string | undefined, depth: number) => {
    for (const group of childrenByParent.get(parentId) ?? []) {
      const children = childrenByParent.get(group.id) ?? []
      ordered.push({ group, depth, parentId, hasChildren: children.length > 0 })
      visit(group.id, depth + 1)
    }
  }
  visit(undefined, 0)
  return ordered
}

/** Ancestor folders of `groupId` from outermost root to direct parent. */
export const groupAncestors = (groups: readonly Group[], groupId: string): Group[] => {
  const byId = new Map(groups.map(group => [group.id, group]))
  const chain: Group[] = []
  const seen = new Set<string>([groupId])
  let cursor = byId.get(groupId)?.parentId
  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor)
    if (!parent) break
    seen.add(cursor)
    chain.unshift(parent)
    cursor = parent.parentId
  }
  return chain
}

/** Direct child folders of `parentId`. */
export const directSubgroups = (groups: readonly Group[], parentId: string): Group[] => {
  const byId = new Map(groups.map(group => [group.id, group]))
  return groups.filter(group => validParentId(group, byId) === parentId)
}

/** Unique channels belonging to `groupId` and all of its nested subfolders. */
export const groupChannelsWithDescendants = (groups: readonly Group[], groupId: string): GroupChannel[] => {
  const byId = new Map(groups.map(group => [group.id, group]))
  const root = byId.get(groupId)
  if (!root) return []
  const childrenByParent = new Map<string, Group[]>()
  for (const group of groups) {
    const parent = validParentId(group, byId)
    if (!parent) continue
    const list = childrenByParent.get(parent)
    if (list) list.push(group)
    else childrenByParent.set(parent, [group])
  }
  const collected: GroupChannel[] = []
  const seenGroups = new Set<string>()
  const walk = (group: Group) => {
    if (seenGroups.has(group.id)) return
    seenGroups.add(group.id)
    collected.push(...group.channels)
    for (const child of childrenByParent.get(group.id) ?? []) walk(child)
  }
  walk(root)
  return uniqueById(collected)
}

/** Groups out of anything: storage is user-editable, so each bad group or channel drops alone and the rest stand. */
export const coerceGroups = (value: unknown): Group[] =>
  Array.isArray(value) ? uniqueById(value.map(coerceGroup)) : []

export const coerceSync = (value: unknown): GroupsSync => {
  const { file, deleted } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const kept: Deleted = {}
  if (deleted && typeof deleted === 'object') {
    for (const [id, at] of Object.entries(deleted)) if (typeof at === 'number' && Number.isFinite(at)) kept[id] = at
  }
  return typeof file === 'string' && file ? { file, deleted: kept } : { deleted: kept }
}

// later than the copy it replaces whatever this clock says, or a slow clock's edit would lose to the one before it
const stamp = (after = 0) => Math.max(Date.now(), after + 1)

export type GroupStore = ReturnType<typeof createGroupStore>

/**
 * The groups kept under `yt-client:groups` in `storage`, with every change, this tab's or another tab's (the
 * `storage` event on `events`), handed to subscribers. Without storage, or once it refused a write, the groups live
 * in memory only and `persists()` says false.
 */
export const createGroupStore = (storage?: Storage, events?: EventTarget) => {
  const readJson = (key: string, fallback: string): unknown => {
    try {
      return JSON.parse(storage?.getItem(key) ?? fallback)
    } catch {
      return undefined
    }
  }
  const readGroups = () => coerceGroups(readJson(GROUPS_KEY, '[]'))
  const readSync = () => coerceSync(readJson(GROUPS_SYNC_KEY, '{}'))

  let current = readGroups()
  let sync = readSync()
  let persists = storage !== undefined
  const listeners = new Set<(groups: Group[]) => void>()
  const edits = new Set<() => void>()
  const publish = () => {
    for (const listener of listeners) listener(current)
  }

  const save = (groups: Group[], next: GroupsSync) => {
    current = groups
    sync = next
    try {
      storage?.setItem(GROUPS_KEY, JSON.stringify(groups))
      storage?.setItem(GROUPS_SYNC_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable (private mode, quota): the in-memory value still stands
      persists = false
    }
    publish()
  }
  const edit = (groups: Group[], next = sync) => {
    save(groups, next)
    for (const listener of edits) listener()
  }

  events?.addEventListener('storage', (event) => {
    const key = (event as StorageEvent).key
    // a null key is the other tab clearing the whole storage
    if (key !== null && key !== GROUPS_KEY && key !== GROUPS_SYNC_KEY) return
    current = readGroups()
    sync = readSync()
    publish()
  })

  const update = (id: string, change: (group: Group) => Group) =>
    edit(current.map(group => group.id === id ? coerceGroup({ ...change(group), updatedAt: stamp(group.updatedAt) }) ?? group : group))

  return {
    getGroups: () => current,
    subscribe: (listener: (groups: Group[]) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    createGroup: (fields: GroupFields) => {
      const parent = fields.parentId && current.some(kept => kept.id === fields.parentId) ? fields.parentId : undefined
      const group = coerceGroup({ id: crypto.randomUUID(), ...fields, parentId: parent, updatedAt: stamp() })
      if (!group) throw new Error('A group needs a name')
      edit([...current, group])
      return group
    },
    updateGroup: (id: string, fields: Partial<GroupFields>) => update(id, (group) => {
      if (!('parentId' in fields)) return { ...group, ...fields }
      const nextParent = fields.parentId && current.some(kept => kept.id === fields.parentId) && !isDescendant(current, fields.parentId, id)
        ? fields.parentId
        : undefined
      return { ...group, ...fields, parentId: nextParent }
    }),
    deleteGroup: (id: string) => {
      const gone = current.find(group => group.id === id)
      if (!gone) return
      const promoted = current
        .filter(group => group.id !== id)
        .map(group => group.parentId === id
          ? coerceGroup({ ...group, parentId: gone.parentId, updatedAt: stamp(group.updatedAt) }) ?? group
          : group)
      edit(promoted, { ...sync, deleted: { ...sync.deleted, [id]: stamp(gone.updatedAt) } })
    },
    setChannel: (groupId: string, channel: GroupChannel, included: boolean) => update(groupId, group => ({
      ...group,
      channels: included
        ? [...group.channels.filter(kept => kept.id !== channel.id), channel]
        : group.channels.filter(kept => kept.id !== channel.id),
    })),
    /** Restores a previously deleted group, re-attaches promoted direct subfolders, and clears its tombstone. */
    restoreGroup: (group: Group, childIds: readonly string[] = []) => {
      if (current.some(kept => kept.id === group.id)) return
      const tombstone = sync.deleted[group.id] ?? 0
      const restoredAt = stamp(Math.max(group.updatedAt, tombstone))
      const validParent = group.parentId && current.some(kept => kept.id === group.parentId) ? group.parentId : undefined
      const restored = coerceGroup({ ...group, parentId: validParent, updatedAt: restoredAt })
      if (!restored) return
      const nextGroups = [...current, restored]
      const childSet = new Set(childIds)
      const relinked = childSet.size === 0
        ? nextGroups
        : nextGroups.map(entry => {
          if (!childSet.has(entry.id) || entry.id === restored.id || isDescendant(nextGroups, restored.id, entry.id)) return entry
          return coerceGroup({ ...entry, parentId: restored.id, updatedAt: stamp(entry.updatedAt) }) ?? entry
        })
      const { [group.id]: _dropped, ...remainingDeleted } = sync.deleted
      edit(relinked, { ...sync, deleted: remainingDeleted })
    },
    persists: () => persists,
    /** What src/groups/sync.ts merges, read from storage so that another tab's change is in it. */
    snapshot: () => ({ groups: readGroups(), ...readSync() }),
    /** Keeps what a sync step settled on, without counting it as an edit. */
    settle: (groups: Group[], next: GroupsSync) => save(groups, next),
    /** Told after every edit made in this tab. */
    onEdit: (listener: () => void) => {
      edits.add(listener)
      return () => {
        edits.delete(listener)
      }
    },
  }
}

const browserStorage = () => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const groupStore = typeof window === 'undefined'
  ? createGroupStore()
  : createGroupStore(browserStorage(), window)

export const useGroups = () => {
  const [groups, setGroups] = useState(groupStore.getGroups)
  useEffect(() => {
    setGroups(groupStore.getGroups())
    return groupStore.subscribe(setGroups)
  }, [])
  return groups
}
