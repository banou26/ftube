import type * as rooms from '@fkn/lib/rooms'
import type { Hub } from '@banou/social'

import { createSocial } from '@banou/social'
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

  it('integrates with @banou/social createSocial to forward social.hello and update signed-in and signed-out peers via onParticipants', async () => {
    const hub = createFakeHub()
    const makeSocialHub = (
      availability: 'ready' | 'signed-out',
      selfProfile?: { memberId: string, identity: SocialIdentity },
    ) => {
      let currentParticipants: Participant[] = []
      let pushParticipants: ((participants: Participant[]) => void) | undefined
      const announced = new Map<string, Participant>()
      if (selfProfile) {
        announced.set(selfProfile.memberId, {
          memberId: selfProfile.memberId,
          status: 'verified',
          identity: selfProfile.identity,
          self: true,
        })
      }

      const rpc = {
        hello: async () => ({ protocol: 2, min: 1 }),
        openInvite: async () => ({ ok: true as const }),
        openAdd: async () => ({ ok: true as const }),
        openEdit: async () => ({ ok: true as const }),
        ownKey: async () => null,
        openFriends: async () => ({ ok: false as const, reason: 'none' as const }),
        deleteEntries: async () => ({ ok: true as const }),
        setFavourite: async () => ({ ok: true as const }),
        deleteComments: async () => ({ ok: true as const }),
        sendComment: async () => ({ ok: true as const }),
        state: async () => availability,
        attach: async (binding: unknown) => {
          const opts = binding as {
            selfMemberId: string
            send?: (frame: string) => Promise<void>
            onParticipants?: (participants: Participant[]) => void
          }
          pushParticipants = opts.onParticipants
          currentParticipants = [...announced.values()]
          const announceSelf = () => {
            if (!selfProfile) return
            void opts.send?.(JSON.stringify({ t: 'social.hello', memberId: selfProfile.memberId, identity: selfProfile.identity }))
          }
          announceSelf()
          return {
            participants: async () => currentParticipants,
            ingest: async (from: string, frame: string) => {
              const parsed = JSON.parse(frame) as { t?: string, identity?: SocialIdentity }
              if (parsed.t === 'social.whois') {
                announceSelf()
                return true
              }
              if (parsed.t !== 'social.hello' || !parsed.identity) return false
              announced.set(from, {
                memberId: from,
                status: 'verified',
                identity: parsed.identity,
                self: from === opts.selfMemberId,
              })
              currentParticipants = [...announced.values()]
              pushParticipants?.(currentParticipants)
              return true
            },
            memberJoined: async (memberId: string) => {
              if (memberId !== opts.selfMemberId) announceSelf()
            },
            memberLeft: async () => {},
            announce: async () => { announceSelf() },
            detach: async () => {},
          }
        },
      }
      return rpc as unknown as Hub
    }

    const aliceId = socialIdentity({ handle: 'fkn:name:alice', name: 'alice', displayName: 'Alice' })
    const bobId = socialIdentity({ handle: 'fkn:name:bob', name: 'bob', displayName: 'Bob' })

    const host = createPartyStore(
      async () => hub.apiFor('host-1'),
      memoryStorage(),
      createSocial(async () => makeSocialHub('ready', { memberId: 'host-1', identity: aliceId })),
    )
    const guest = createPartyStore(
      async () => hub.apiFor('guest-1'),
      memoryStorage(),
      createSocial(async () => makeSocialHub('ready', { memberId: 'guest-1', identity: bobId })),
    )
    const anonGuest = createPartyStore(
      async () => hub.apiFor('anon-1'),
      memoryStorage(),
      createSocial(async () => makeSocialHub('signed-out')),
    )

    await host.create()
    await guest.join(hub.invite)
    await anonGuest.join(hub.invite)
    await vi.advanceTimersByTimeAsync(30)

    expect(host.nameOf('guest-1')).toBe('Bob')
    expect(guest.nameOf('host-1')).toBe('Alice')
    expect(anonGuest.nameOf('host-1')).toBe('Alice')
    expect(anonGuest.nameOf('guest-1')).toBe('Bob')

    const anonRoster = await anonGuest.roster()
    expect(anonRoster.find((m) => m.id === 'host-1')?.identity?.identity?.name).toBe('alice')
    expect(anonRoster.find((m) => m.id === 'guest-1')?.identity?.identity?.name).toBe('bob')

    await anonGuest.leave()
    await guest.leave()
    await host.leave()
  })

  it('keeps synchronous on() replay frames, buffers early join/leave, sends whois for existing peers, and detaches on leave', async () => {
    const membersGate = Promise.withResolvers<rooms.RoomMember[]>()
    const detachFirst = vi.fn(async () => {})
    const ingestFirst = vi.fn((_from: string, _frame: string, _at: number, _seq: number) => true)
    const joinedFirst = vi.fn((_memberId: string) => {})
    const leftFirst = vi.fn((_memberId: string) => {})
    const sentFrames: string[] = []
    let emitEvent: Listener | undefined

    const customRoom = (roomId: string, selfId: string, pendingMembers: boolean): rooms.Room => {
      const closed = Promise.withResolvers<rooms.RoomEnd>()
      return {
        id: roomId,
        name: 'custom',
        key: 'A'.repeat(43),
        invite: `${'A'.repeat(43)}.${roomId}`,
        self: { id: selfId } as rooms.RoomMember,
        owner: 'host-1',
        claimed: false,
        mailbox: null,
        members: async () => (pendingMembers ? membersGate.promise : [{ id: selfId }, { id: 'host-1' }] as rooms.RoomMember[]),
        send: async (text: string) => {
          sentFrames.push(text)
          const parsed = JSON.parse(text) as { t?: string, p?: string }
          if (parsed.t === 'social' && parsed.p) {
            emitEvent?.({
              type: 'message',
              replayed: false,
              message: { seq: 99, from: selfId, at: 1_000, text, envelope: null },
            })
          }
        },
        remove: async () => {},
        block: async () => {},
        on: async (listener: Listener) => {
          emitEvent = listener
          if (pendingMembers) {
            listener({
              type: 'message',
              replayed: true,
              message: {
                seq: 1,
                from: 'host-1',
                at: 500,
                text: encodePartyMessage({ t: 'social', p: '{"t":"social.hello","v":1}' }),
                envelope: null,
              },
            })
          }
          return () => {
            if (emitEvent === listener) emitEvent = undefined
          }
        },
        leave: async () => { closed.resolve({ reason: 'left' }) },
        closed: closed.promise,
      } as unknown as rooms.Room
    }

    const fakeSocial: SocialPresenceApi = {
      attach: async () => ({
        participants: () => [],
        of: (memberId) => ({ memberId, status: 'silent', identity: null, self: false }),
        on: () => () => {},
        ingest: ingestFirst,
        memberJoined: joinedFirst,
        memberLeft: leftFirst,
        announce: async () => {},
        detach: detachFirst,
      }),
    }

    const store = createPartyStore(async () => ({
      create: async () => customRoom('https://youtube.fkn.app/room-a', 'self-a', false),
      join: async () => customRoom('https://youtube.fkn.app/room-1', 'self-1', true),
    }), memoryStorage(), fakeSocial)

    await store.join('invite-a')
    // Emit an early joined and left while members() is still pending.
    emitEvent?.({ type: 'joined', member: { id: 'early-peer' } as rooms.RoomMember })
    emitEvent?.({ type: 'left', id: 'vanished-peer', reason: 'left' })

    membersGate.resolve([{ id: 'self-1' }, { id: 'host-1' }] as rooms.RoomMember[])
    await vi.advanceTimersByTimeAsync(20)

    expect(ingestFirst).toHaveBeenCalledWith('host-1', '{"t":"social.hello","v":1}', 500, 1)
    expect(joinedFirst).toHaveBeenCalledWith('early-peer')
    expect(leftFirst).toHaveBeenCalledWith('vanished-peer')
    expect(sentFrames.some((raw) => (JSON.parse(raw) as { p?: string }).p?.includes('"social.whois"'))).toBe(true)
    expect(ingestFirst.mock.calls.some((call) => String(call[1]).includes('social.whois'))).toBe(false)

    await store.leave()
    expect(detachFirst).toHaveBeenCalledTimes(1)
  })

  it('detaches a social presence that finishes loading members after switching rooms', async () => {
    const membersCalled = Promise.withResolvers<void>()
    const membersGate = Promise.withResolvers<rooms.RoomMember[]>()
    const attachGate = Promise.withResolvers<void>()
    const detachRace = vi.fn(async () => {})
    let socialAttached = false

    const makeRoom = (roomId: string, selfId: string, blockSecondMembers: boolean): rooms.Room => {
      const closed = Promise.withResolvers<rooms.RoomEnd>()
      return {
        id: roomId,
        name: 'custom',
        key: 'A'.repeat(43),
        invite: `${'A'.repeat(43)}.${roomId}`,
        self: { id: selfId } as rooms.RoomMember,
        owner: 'host-1',
        claimed: false,
        mailbox: null,
        members: async () => {
          if (!blockSecondMembers || !socialAttached) return [{ id: selfId }] as rooms.RoomMember[]
          membersCalled.resolve()
          return membersGate.promise
        },
        send: async () => {},
        remove: async () => {},
        block: async () => {},
        on: async () => () => {},
        leave: async () => { closed.resolve({ reason: 'left' }) },
        closed: closed.promise,
      } as unknown as rooms.Room
    }

    const raceStore = createPartyStore(async () => ({
      create: async () => makeRoom('https://youtube.fkn.app/race-2', 'self-r2', false),
      join: async () => makeRoom('https://youtube.fkn.app/race-1', 'self-r1', true),
    }), memoryStorage(), {
      attach: async () => {
        await attachGate.promise
        socialAttached = true
        return {
          participants: () => [],
          of: (memberId) => ({ memberId, status: 'silent', identity: null, self: false }),
          on: () => () => {},
          ingest: () => true,
          memberJoined: () => {},
          memberLeft: () => {},
          announce: async () => {},
          detach: detachRace,
        }
      },
    })

    await raceStore.join('race-1')
    attachGate.resolve()
    await membersCalled.promise
    await raceStore.create()
    expect(detachRace).toHaveBeenCalledTimes(0)
    membersGate.resolve([{ id: 'self-r1' }] as rooms.RoomMember[])
    await vi.advanceTimersByTimeAsync(20)
    expect(detachRace).toHaveBeenCalledTimes(1)

    await raceStore.leave()
  })

  it('skips social attach and whois when social reports unavailable', async () => {
    const attach = vi.fn(async () => {
      throw new Error('attach should not run')
    })
    const sentFrames: string[] = []
    const closed = Promise.withResolvers<rooms.RoomEnd>()
    const roomStub = {
      id: 'https://youtube.fkn.app/unavail-1',
      name: 'custom',
      key: 'A'.repeat(43),
      invite: `${'A'.repeat(43)}.unavail-1`,
      self: { id: 'guest-1' } as rooms.RoomMember,
      owner: 'host-1',
      claimed: false,
      mailbox: null,
      members: async () => [{ id: 'guest-1' }, { id: 'host-1' }] as rooms.RoomMember[],
      send: async (text: string) => { sentFrames.push(text) },
      remove: async () => {},
      block: async () => {},
      on: async () => () => {},
      leave: async () => { closed.resolve({ reason: 'left' }) },
      closed: closed.promise,
    } as unknown as rooms.Room

    const store = createPartyStore(async () => ({
      create: async () => roomStub,
      join: async () => roomStub,
    }), memoryStorage(), {
      available: async () => 'unavailable',
      attach,
    })

    await store.join('invite-u1')
    await vi.advanceTimersByTimeAsync(20)

    expect(attach).not.toHaveBeenCalled()
    expect(sentFrames.some((raw) => (JSON.parse(raw) as { t?: string }).t === 'social')).toBe(false)

    await store.leave()
  })
})
