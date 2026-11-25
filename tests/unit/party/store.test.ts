import type * as rooms from '@fkn/lib/rooms'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { Participant, RoomBinding, SocialIdentity } from '../../../src/social'
import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyMessageMeta, RoomsApi, SocialPresenceApi, StorageLike } from '../../../src/party/store'

import { encodePartyMessage } from '../../../src/party/protocol'
import {
  CHAT_KEEP,
  CLOCK_SPACING_MS,
  createPartyStore,
  PARTY_NAME_KEY,
  PARTY_SESSION_KEY,
  STATE_HEARTBEAT_MS,
} from '../../../src/party/store'

type Listener = (event: rooms.RoomEvent) => void

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) },
  }
}

const createFakeHub = () => {
  const invite = `${'A'.repeat(43)}.https://youtube.fkn.app/room-1`
  const peers = new Map<string, { member: rooms.RoomMember, listener?: Listener, close: (end: rooms.RoomEnd) => void }>()
  let owner = ''
  const blocked = new Set<string>()
  const removed = vi.fn()
  const blockedFn = vi.fn()

  const connect = (id: string, isOwner: boolean): rooms.Room => {
    if (blocked.has(id)) {
      throw Object.assign(new Error('rooms: blocked'), { code: 'blocked' })
    }
    if (isOwner) owner = id
    const member = { id } as rooms.RoomMember
    const closed = Promise.withResolvers<rooms.RoomEnd>()
    const entry = { member, listener: undefined as Listener | undefined, close: closed.resolve }
    peers.set(id, entry)

    setTimeout(() => {
      if (!peers.has(id)) return
      for (const [peerId, peer] of peers) {
        if (peerId !== id) peer.listener?.({ type: 'joined', member })
      }
    }, 10)

    let seq = 0
    const leave = async (reason: rooms.RoomEnd['reason'] = 'left') => {
      if (!peers.has(id)) return
      peers.delete(id)
      for (const peer of peers.values()) {
        peer.listener?.({ type: 'left', id, reason: 'left' })
      }
      closed.resolve({ reason })
    }

    return {
      id: 'https://youtube.fkn.app/room-1',
      name: 'room-1',
      key: 'A'.repeat(43),
      invite,
      self: member,
      get owner() { return owner },
      claimed: false,
      mailbox: null,
      members: async () => [...peers.values()].map((peer) => peer.member),
      send: async (text: string) => {
        const message: rooms.RoomMessage = { seq: ++seq, from: id, at: Date.now(), text, envelope: null }
        for (const peer of peers.values()) {
          peer.listener?.({ type: 'message', message, replayed: false })
        }
      },
      remove: async (targetId: string) => {
        removed(targetId)
        const target = peers.get(targetId)
        if (!target) return
        peers.delete(targetId)
        for (const peer of peers.values()) peer.listener?.({ type: 'left', id: targetId, reason: 'removed' })
        target.close({ reason: 'removed' })
      },
      block: async (targetId: string) => {
        blockedFn(targetId)
        blocked.add(targetId)
        const target = peers.get(targetId)
        if (!target) return
        peers.delete(targetId)
        for (const peer of peers.values()) peer.listener?.({ type: 'left', id: targetId, reason: 'blocked' })
        target.close({ reason: 'blocked' })
      },
      on: async (listener: Listener) => {
        entry.listener = listener
        return () => {
          if (entry.listener === listener) entry.listener = undefined
        }
      },
      leave: () => leave('left'),
      closed: closed.promise,
    } as unknown as rooms.Room
  }

  const apiFor = (id: string): RoomsApi => ({
    create: async () => connect(id, true),
    join: async (wanted: string) => {
      if (wanted !== invite || !owner) throw Object.assign(new Error('rooms: not found'), { code: 'not-found' })
      return connect(id, false)
    },
  })

  return { invite, apiFor, removed, blockedFn }
}

describe('createPartyStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads @fkn/lib/rooms lazily only when a party starts or joins', async () => {
    const hub = createFakeHub()
    const loader = vi.fn(async () => hub.apiFor('host-1'))
    const store = createPartyStore(loader, memoryStorage())
    expect(loader).not.toHaveBeenCalled()
    await store.create()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ status: 'active', role: 'host', members: 1 })
    await store.leave()
  })

  it('syncs location, playback heartbeats, clock offset, chat, names, and drops guest steering', async () => {
    const hub = createFakeHub()
    const hostStorage = memoryStorage()
    const guestStorage = memoryStorage()
    const host = createPartyStore(async () => hub.apiFor('host-1'), hostStorage)
    const guest = createPartyStore(async () => hub.apiFor('guest-1'), guestStorage)

    host.setLocation('/watch?v=dQw4w9WgXcQ')
    host.setPlayback({ paused: false, time: 30, rate: 1, at: Date.now() })
    host.setName('HostUser')
    await host.create()
    expect(hostStorage.data.get(PARTY_SESSION_KEY)).toBe(hub.invite)
    expect(hostStorage.data.get(PARTY_NAME_KEY)).toBe('HostUser')

    const guestHeard: Array<{ message: PartyMessage, meta: PartyMessageMeta }> = []
    guest.onMessage((message, meta) => guestHeard.push({ message, meta }))

    await guest.join(hub.invite)
    await vi.advanceTimersByTimeAsync(20)
    expect(guest.getState()).toMatchObject({ status: 'active', role: 'guest', members: 2 })
    expect(host.getState()).toMatchObject({ status: 'active', role: 'host', members: 2 })

    // Host sent state snapshot to the joiner with location + playback (advanced by the 10 ms join delay).
    expect(guest.hostPath()).toBe('/watch?v=dQw4w9WgXcQ')
    expect(guest.hostPlayback()).toMatchObject({ path: '/watch?v=dQw4w9WgXcQ', state: { paused: false, rate: 1 } })
    expect(guest.hostPlayback()?.state.time).toBeCloseTo(30.01, 2)
    expect(guest.nameOf('host-1')).toBe('HostUser')

    // Guest clock sync runs on join and measures host offset via ping/pong.
    await vi.advanceTimersByTimeAsync(CLOCK_SPACING_MS * 2)
    expect(guest.hostClock()).toMatchObject({ rtt: 0, offset: 0 })

    // Guest attempts to send host-only steering are blocked locally.
    guest.send({ t: 'nav', path: '/results?search_query=hack' })
    expect(guest.hostPath()).toBe('/watch?v=dQw4w9WgXcQ')

    // Even if a spoofed host-only frame arrives from another guest, it is dropped on receipt.
    const guest2 = createPartyStore(async () => hub.apiFor('guest-2'), memoryStorage())
    await guest2.join(hub.invite)
    const spoofed = encodePartyMessage({ t: 'nav', path: '/results?search_query=spoof' })
    await (await hub.apiFor('guest-2').join(hub.invite)).send(spoofed)
    expect(guest.hostPath()).toBe('/watch?v=dQw4w9WgXcQ')

    // Chat round-trips to both host and guest with sender names.
    guest.setName('GuestUser')
    guest.send({ t: 'chat', text: 'hello everyone' })
    expect(host.chat().at(-1)).toMatchObject({ from: 'guest-1', self: false, name: 'GuestUser', text: 'hello everyone' })
    expect(guest.chat().at(-1)).toMatchObject({ from: 'guest-1', self: true, name: 'GuestUser', text: 'hello everyone' })

    // Heartbeat advances playing time by 10 seconds.
    const before = guestHeard.length
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS)
    const beat = guestHeard.slice(before).findLast((entry) => entry.message.t === 'state')?.message
    expect(beat).toMatchObject({ t: 'state', path: '/watch?v=dQw4w9WgXcQ' })
    if (beat?.t === 'state') expect(beat.s?.time).toBeGreaterThanOrEqual(40)

    // Replay / Catch up re-enables following and replays with replayed: true.
    guest.setFollowing(false)
    expect(guest.following()).toBe(false)
    const preReplay = guestHeard.length
    guest.replay()
    expect(guest.following()).toBe(true)
    expect(guestHeard.slice(preReplay).some((entry) => entry.meta.replayed && entry.message.t === 'state')).toBe(true)

    // Roster reports host/self/name accurately.
    const roster = await host.roster()
    expect(roster.find((m) => m.id === 'host-1')).toMatchObject({ host: true, self: true, name: 'HostUser' })
    expect(roster.find((m) => m.id === 'guest-1')).toMatchObject({ host: false, self: false, name: 'GuestUser' })

    await host.leave()
    await guest.leave()
    await guest2.leave()
  })

  it('caps chat history at CHAT_KEEP lines', async () => {
    const hub = createFakeHub()
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage())
    await host.create()
    for (let index = 0; index < CHAT_KEEP + 25; index++) {
      host.send({ t: 'chat', text: `line ${index}` })
    }
    expect(host.chat()).toHaveLength(CHAT_KEEP)
    expect(host.chat()[0]?.text).toBe('line 25')
    expect(host.chat().at(-1)?.text).toBe(`line ${CHAT_KEEP + 24}`)
    await host.leave()
  })

  it('supports host kick and ban, ignores guest moderation, and ends guests when host leaves', async () => {
    const hub = createFakeHub()
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage())
    const guest1 = createPartyStore(async () => hub.apiFor('guest-1'), memoryStorage())
    const guest2 = createPartyStore(async () => hub.apiFor('guest-2'), memoryStorage())
    await host.create()
    await guest1.join(hub.invite)
    await guest2.join(hub.invite)

    // Guest cannot kick the host.
    await guest1.kick('host-1')
    expect(hub.removed).not.toHaveBeenCalled()

    // Host kicks guest-1.
    await host.kick('guest-1')
    await vi.waitFor(() => expect(guest1.getState()).toStrictEqual({ status: 'ended', reason: 'removed' }))

    // Host bans guest-2.
    await host.ban('guest-2')
    await vi.waitFor(() => expect(guest2.getState()).toStrictEqual({ status: 'ended', reason: 'blocked' }))

    // A fresh guest sees host-left when host leaves.
    const guest3 = createPartyStore(async () => hub.apiFor('guest-3'), memoryStorage())
    await guest3.join(hub.invite)
    await host.leave()
    await vi.waitFor(() => expect(guest3.getState()).toStrictEqual({ status: 'ended', reason: 'host-left' }))
  })

  it('resumes a stored invite and quietly returns to idle when an old room expired', async () => {
    const hub = createFakeHub()
    const storage = memoryStorage()
    storage.setItem(PARTY_SESSION_KEY, hub.invite)
    const store = createPartyStore(async () => hub.apiFor('guest-1'), storage)
    // No host created yet -> not-found -> silent idle on resume.
    await store.resume()
    expect(store.getState()).toStrictEqual({ status: 'idle' })
    expect(storage.data.has(PARTY_SESSION_KEY)).toBe(false)

    // With an active host, resume joins the room.
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage())
    await host.create()
    storage.setItem(PARTY_SESSION_KEY, hub.invite)
    await store.resume()
    expect(store.getState()).toMatchObject({ status: 'active', role: 'guest' })
    await host.leave()
    await store.leave()
  })

  const socialIdentity = (over: Partial<SocialIdentity> = {}): SocialIdentity => ({
    handle: 'fkn:name:alice',
    name: 'alice',
    displayName: 'Alice',
    avatar: null,
    identicon: 'data:image/svg+xml;utf8,<svg/>',
    ...over,
  })

  const createFakeSocial = (holdAttach = false) => {
    let binding: RoomBinding | undefined
    const joined: string[] = []
    const left: string[] = []
    const ingested: { from: string, frame: string, at: number, seq: number }[] = []
    let detached = 0
    const byId = new Map<string, Participant>()
    const listeners = new Set<(participants: Participant[]) => void>()
    const release = Promise.withResolvers<void>()
    if (!holdAttach) release.resolve()

    const presence = () => ({
      participants: () => Array.from(byId.values()),
      of: (memberId: string): Participant =>
        byId.get(memberId) ?? { memberId, status: 'silent', identity: null, self: false },
      on: (listener: (participants: Participant[]) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      ingest: (from: string, frame: string, at: number, seq: number) => {
        ingested.push({ from, frame, at, seq })
        return true
      },
      memberJoined: (memberId: string) => { joined.push(memberId) },
      memberLeft: (memberId: string) => { left.push(memberId) },
      announce: async () => {},
      detach: async () => { detached += 1 },
    })

    const api: SocialPresenceApi = {
      attach: async (next) => {
        binding = next
        await release.promise
        return presence()
      },
    }

    const emitParticipant = (participant: Participant) => {
      byId.set(participant.memberId, participant)
      const all = Array.from(byId.values())
      for (const listener of listeners) listener(all)
    }

    return {
      api,
      calls: { binding: () => binding, joined, left, ingested, detached: () => detached },
      finishAttach: () => release.resolve(),
      emitParticipant,
    }
  }

  it('attaches social over the room, forwards outbound frames, and buffers early inbound social frames', async () => {
    const hub = createFakeHub()
    const social = createFakeSocial(true)
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage())
    const guest = createPartyStore(async () => hub.apiFor('guest-1'), memoryStorage(), social.api)
    const onPresence = vi.fn()
    guest.onPresence(onPresence)
    const guestMessages: PartyMessage['t'][] = []
    guest.onMessage((message) => guestMessages.push(message.t))

    await host.create()
    await guest.join(hub.invite)
    await vi.advanceTimersByTimeAsync(20)

    host.send({ t: 'chat', text: 'hi' })
    host.send({ t: 'social', p: '{"t":"social.hello","v":1}' })
    expect(guestMessages).toContain('chat')
    expect(guestMessages).not.toContain('social')
    expect(social.calls.ingested).toEqual([])

    social.finishAttach()
    await vi.advanceTimersByTimeAsync(20)

    expect(social.calls.binding()?.roomId).toBe('https://youtube.fkn.app/room-1')
    expect(social.calls.binding()?.selfMemberId).toBe('guest-1')
    expect(social.calls.joined).toEqual(['host-1'])
    expect(social.calls.ingested).toMatchObject([{ from: 'host-1', frame: '{"t":"social.hello","v":1}' }])
    expect(onPresence).toHaveBeenCalled()

    await social.calls.binding()!.send('{"t":"social.hello","out":1}')
    const guest2 = createPartyStore(async () => hub.apiFor('guest-2'), memoryStorage())
    const seen: PartyMessage['t'][] = []
    guest2.onMessage((message) => seen.push(message.t))
    await guest2.join(hub.invite)
    await vi.advanceTimersByTimeAsync(20)
    expect(social.calls.joined).toContain('guest-2')

    await guest2.leave()
    await vi.advanceTimersByTimeAsync(20)
    expect(social.calls.left).toEqual(['guest-2'])

    await guest.leave()
    await host.leave()
  })

  it('prefers friend nickname, displayName, verified name, then party name and updates chat retroactively', async () => {
    const hub = createFakeHub()
    const social = createFakeSocial()
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage(), social.api)
    const ann = createPartyStore(async () => hub.apiFor('ann'), memoryStorage())
    const bob = createPartyStore(async () => hub.apiFor('bob'), memoryStorage())
    const raw = createPartyStore(async () => hub.apiFor('raw'), memoryStorage())

    host.setName('FallbackHost')
    await host.create()
    await ann.join(hub.invite)
    await bob.join(hub.invite)
    await raw.join(hub.invite)
    await vi.advanceTimersByTimeAsync(20)

    ann.send({ t: 'chat', text: 'earlier' })
    expect(host.chat()[0]?.name).toBeUndefined()

    social.emitParticipant({
      memberId: 'host-1',
      status: 'friend',
      identity: socialIdentity({ name: 'hosthandle', displayName: 'Host Public', nickname: 'Bestie' }),
      self: true,
    })
    social.emitParticipant({
      memberId: 'ann',
      status: 'verified',
      identity: socialIdentity({ name: 'annhandle', displayName: 'AnnDisplay' }),
      self: false,
    })
    social.emitParticipant({
      memberId: 'bob',
      status: 'verified',
      identity: socialIdentity({ name: 'bobhandle', displayName: '   ' }),
      self: false,
    })
    social.emitParticipant({ memberId: 'raw', status: 'unverified', identity: null, self: false })

    expect(host.nameOf('host-1')).toBe('Bestie')
    expect(host.nameOf('ann')).toBe('AnnDisplay')
    expect(host.nameOf('bob')).toBe('bobhandle')
    expect(host.nameOf('raw')).toBeUndefined()
    expect(host.chat()[0]?.name).toBe('AnnDisplay')
    expect(host.identityOf('ann')?.identity?.name).toBe('annhandle')
    expect(host.identityOf('raw')).toBeUndefined()

    const roster = await host.roster()
    expect(roster.find((m) => m.id === 'host-1')?.identity?.status).toBe('friend')
    expect(roster.find((m) => m.id === 'raw')?.identity).toBeUndefined()

    await raw.leave()
    await bob.leave()
    await ann.leave()
    await host.leave()
  })

  it('detaches social cleanly on leave and detaches late attaches that resolve after leave', async () => {
    const hub = createFakeHub()
    const social = createFakeSocial()
    const host = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage(), social.api)
    await host.create()
    await vi.advanceTimersByTimeAsync(20)
    await host.leave()
    expect(social.calls.detached()).toBe(1)

    const slow = createFakeSocial(true)
    const slowHost = createPartyStore(async () => hub.apiFor('host-1'), memoryStorage(), slow.api)
    await slowHost.create()
    await slowHost.leave()
    expect(slow.calls.detached()).toBe(0)
    slow.finishAttach()
    await vi.advanceTimersByTimeAsync(20)
    expect(slow.calls.detached()).toBe(1)
  })
})
