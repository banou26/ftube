// Party lifecycle and room state store. Pure over an injected lazy Rooms loader for unit testing.

import type * as rooms from '@fkn/lib/rooms'

import type { Participant, Presence, RoomBinding } from '../social'
import type { ClockSample } from './clock'
import type { PartyMessage, PlaybackState } from './protocol'

import { bestSample, clockSample, MAX_USABLE_RTT_MS } from './clock'
import { advance } from './playback'
import { decodePartyMessage, displayName, encodePartyMessage, isHostOnly } from './protocol'

export type RoomsApi = Pick<typeof rooms, 'create' | 'join'>
/** The slice of `@banou/social` room presence the party store uses, injectable for tests. */
export type SocialPresenceApi = { attach: (binding: RoomBinding) => Promise<Presence> }
export type PartyRole = 'host' | 'guest'
export type PartyEndReason = 'left' | 'host-left' | 'removed' | 'blocked' | 'closed'

export type PartyState =
  | { status: 'idle' }
  | { status: 'joining', invite: string }
  | { status: 'active', role: PartyRole, invite: string, roomId: string, self: string, owner: string, members: number }
  | { status: 'ended', reason: PartyEndReason }
  | { status: 'failed', code: rooms.RoomsErrorCode | 'unknown' }

export type PartyMessageMeta = {
  from: string
  self: boolean
  replayed: boolean
}

export type PartyChatLine = {
  id: number
  from: string
  self: boolean
  name?: string
  text: string
  at: number
}

export type PartyRosterMember = {
  id: string
  name?: string
  /** Verified FKN Social identity for this member, when available. */
  identity?: Participant
  host: boolean
  self: boolean
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type PartyStore = {
  getState: () => PartyState
  subscribe: (listener: (state: PartyState) => void) => () => void
  onMessage: (listener: (message: PartyMessage, meta: PartyMessageMeta) => void) => () => void
  /** Subscribes to verified FKN Social room presence changes (names, avatars, friend statuses). */
  onPresence: (listener: () => void) => () => void
  create: () => Promise<void>
  join: (invite: string) => Promise<void>
  resume: () => Promise<void>
  leave: () => Promise<void>
  dismiss: () => void
  send: (message: PartyMessage) => void
  setLocation: (path: string) => void
  setPlayback: (playback: PlaybackState | undefined) => void
  hostPath: () => string | undefined
  hostPlayback: () => { path: string, state: PlaybackState } | undefined
  hostClock: () => ClockSample | undefined
  following: () => boolean
  setFollowing: (on: boolean) => void
  replay: () => void
  chat: () => readonly PartyChatLine[]
  name: () => string | undefined
  setName: (name: string | undefined) => void
  nameOf: (id: string) => string | undefined
  /** Verified FKN Social participant for a member, or undefined while silent or unverified. */
  identityOf: (id: string) => Participant | undefined
  roster: () => Promise<PartyRosterMember[]>
  kick: (id: string) => Promise<void>
  ban: (id: string) => Promise<void>
}

export const PARTY_SESSION_KEY = 'yt-client:party-invite'
export const PARTY_NAME_KEY = 'yt-client:party-name'
export const CHAT_KEEP = 200
export const STATE_HEARTBEAT_MS = 10_000
export const NAME_HEARTBEAT_MS = 30_000
export const CLOCK_SAMPLES = 5
export const CLOCK_SPACING_MS = 400
export const CLOCK_INTERVAL_MS = 60_000
const MAX_PENDING_SOCIAL = 64
const SOCIAL_WHOIS_FRAME = '{"t":"social.whois","v":1}'

const isSocialWhois = (frame: string): boolean => {
  try {
    const parsed = JSON.parse(frame) as { t?: unknown } | null
    return parsed !== null && typeof parsed === 'object' && parsed.t === 'social.whois'
  } catch {
    return false
  }
}

const defaultStorage = (): StorageLike | undefined => {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

const isRoomsError = (error: unknown): error is rooms.RoomsError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === 'string'

export const createPartyStore = (
  loadRooms: () => Promise<RoomsApi>,
  storage: StorageLike | undefined = defaultStorage(),
  social?: SocialPresenceApi,
): PartyStore => {
  let state: PartyState = { status: 'idle' }
  let room: rooms.Room | undefined
  let unlisten: (() => void) | undefined
  let presence: Presence | undefined
  let presenceUnlisten: (() => void) | undefined
  let pendingSocial: { from: string, frame: string, at: number, seq: number }[] = []
  let pendingMembership: { type: 'joined' | 'left', id: string }[] = []
  let openGeneration = 0
  let hostLocation = '/'
  let hostPlayback: PlaybackState | undefined
  let hostPlaybackAt: number | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let introductions: ReturnType<typeof setInterval> | undefined
  let clockTimer: ReturnType<typeof setInterval> | undefined
  const stateListeners = new Set<(state: PartyState) => void>()
  const messageListeners = new Set<(message: PartyMessage, meta: PartyMessageMeta) => void>()
  const presenceListeners = new Set<() => void>()
  const heard = new Map<PartyMessage['t'], PartyMessage>()
  let heardPlayback: { path: string, state: PlaybackState } | undefined
  const names = new Map<string, string>()
  const lines: PartyChatLine[] = []
  let nextLineId = 1
  let following = true
  let clock: ClockSample | undefined
  let collecting: ClockSample[] | undefined
  const pings = new Map<number, number>()
  let nonce = 1
  let ownName: string | undefined = (() => {
    try {
      return displayName(storage?.getItem(PARTY_NAME_KEY) ?? undefined)
    } catch {
      return undefined
    }
  })()

  const emitState = (next: PartyState) => {
    state = next
    for (const listener of Array.from(stateListeners)) listener(state)
  }

  const bumpState = () => {
    if (state.status === 'active') emitState({ ...state })
  }

  const notifyPresence = () => {
    for (const listener of Array.from(presenceListeners)) listener()
  }

  const verifiedOf = (id: string): Participant | undefined => {
    const participant = presence?.of(id)
    return participant?.identity ? participant : undefined
  }

  // Friend nickname > verified displayName > verified @name > self-declared party name.
  const resolvedNameOf = (id: string): string | undefined => {
    const participant = verifiedOf(id)
    const identity = participant?.identity
    if (identity) {
      if (participant.status === 'friend' && identity.nickname?.trim()) return identity.nickname.trim()
      if (identity.displayName.trim()) return identity.displayName.trim()
      if (identity.name) return identity.name
    }
    return names.get(id)
  }

  const remember = (invite: string) => {
    try {
      storage?.setItem(PARTY_SESSION_KEY, invite)
    } catch {}
  }

  const forget = () => {
    try {
      storage?.removeItem(PARTY_SESSION_KEY)
    } catch {}
  }

  const remembered = (): string | undefined => {
    try {
      return storage?.getItem(PARTY_SESSION_KEY) ?? undefined
    } catch {
      return undefined
    }
  }

  const tell = (message: PartyMessage, meta: PartyMessageMeta) => {
    for (const listener of Array.from(messageListeners)) listener(message, meta)
  }

  const send = (message: PartyMessage) => {
    if (!room || state.status !== 'active') return
    if (isHostOnly(message) && state.role !== 'host') return
    void room.send(encodePartyMessage(message)).catch(() => {})
  }

  const whereWeAre = (): Extract<PartyMessage, { t: 'state' }> => ({
    t: 'state',
    path: hostLocation,
    ...(hostPlayback ? { s: advance(hostPlayback, hostPlaybackAt ?? Date.now(), Date.now()) } : {}),
  })

  const refreshMembers = async (joined: rooms.Room) => {
    const members = await joined.members().catch(() => undefined)
    if (room !== joined || state.status !== 'active' || !members) return
    emitState({ ...state, members: members.length })
  }

  const measureClock = () => {
    if (!room || state.status !== 'active' || state.role !== 'guest') return
    const joined = room
    const round: ClockSample[] = []
    collecting = round
    for (let index = 0; index < CLOCK_SAMPLES; index++) {
      setTimeout(() => {
        if (collecting !== round || room !== joined) return
        const at = Date.now()
        const n = nonce++
        pings.set(n, at)
        setTimeout(() => pings.delete(n), MAX_USABLE_RTT_MS)
        send({ t: 'ping', n, at })
      }, index * CLOCK_SPACING_MS)
    }
    setTimeout(() => {
      if (collecting !== round || room !== joined) return
      collecting = undefined
      const best = bestSample(round)
      if (best) clock = best
    }, CLOCK_SAMPLES * CLOCK_SPACING_MS + MAX_USABLE_RTT_MS)
  }

  const detach = () => {
    clearInterval(heartbeat)
    clearInterval(introductions)
    clearInterval(clockTimer)
    heartbeat = undefined
    introductions = undefined
    clockTimer = undefined
    collecting = undefined
    clock = undefined
    pings.clear()
    heard.clear()
    heardPlayback = undefined
    names.clear()
    lines.length = 0
    following = true
    const off = unlisten
    unlisten = undefined
    room = undefined
    off?.()
    presenceUnlisten?.()
    presenceUnlisten = undefined
    const detaching = presence
    presence = undefined
    pendingSocial = []
    pendingMembership = []
    if (detaching) {
      void detaching.detach().catch(() => {})
      notifyPresence()
    }
  }

  const end = async (reason: PartyEndReason) => {
    const leaving = room
    detach()
    forget()
    emitState({ status: 'ended', reason })
    await leaving?.leave().catch(() => {})
  }

  const attach = async (joined: rooms.Room, generation: number) => {
    if (generation !== openGeneration) {
      await joined.leave().catch(() => {})
      return
    }
    room = joined
    pendingSocial = []
    pendingMembership = []
    const role: PartyRole = joined.owner === joined.self.id ? 'host' : 'guest'
    remember(joined.invite)
    emitState({
      status: 'active',
      role,
      invite: joined.invite,
      roomId: joined.id,
      self: joined.self.id,
      owner: joined.owner,
      members: 1,
    })

    const off = await joined.on((event) => {
      if (room !== joined || state.status !== 'active') return
      if (event.type === 'joined') {
        if (presence) presence.memberJoined(event.member.id)
        else if (social && pendingMembership.length < MAX_PENDING_SOCIAL) {
          pendingMembership.push({ type: 'joined', id: event.member.id })
        }
        void refreshMembers(joined)
        if (role === 'host') send(whereWeAre())
        if (ownName) send({ t: 'name', name: ownName })
        return
      }
      if (event.type === 'left') {
        if (presence) presence.memberLeft(event.id)
        else if (social && pendingMembership.length < MAX_PENDING_SOCIAL) {
          pendingMembership.push({ type: 'left', id: event.id })
        }
        if (role === 'guest' && event.id === joined.owner) {
          void end('host-left')
          return
        }
        names.delete(event.id)
        void refreshMembers(joined)
        return
      }
      if (event.type !== 'message') return
      const { from, text } = event.message
      const message = decodePartyMessage(text)
      if (!message) return
      if (isHostOnly(message) && from !== joined.owner) return

      const self = from === joined.self.id
      if (message.t === 'social') {
        if (self && isSocialWhois(message.p)) return
        if (presence) presence.ingest(from, message.p, event.message.at, event.message.seq)
        else if (pendingSocial.length < MAX_PENDING_SOCIAL) {
          pendingSocial.push({ from, frame: message.p, at: event.message.at, seq: event.message.seq })
        }
        return
      }
      if (message.t === 'name') {
        names.set(from, message.name)
        bumpState()
        return
      }
      if (message.t === 'ping') {
        if (role === 'host' && !self) send({ t: 'pong', n: message.n, at: message.at, host: Date.now() })
        return
      }
      if (message.t === 'pong') {
        const sent = pings.get(message.n)
        if (sent === undefined) return
        pings.delete(message.n)
        const sample = clockSample(sent, message.host, Date.now())
        if (sample.rtt >= 0 && sample.rtt < MAX_USABLE_RTT_MS) {
          collecting?.push(sample)
          if (!clock || sample.rtt < clock.rtt) clock = sample
        }
        return
      }
      if (message.t === 'chat') {
        lines.push({
          id: nextLineId++,
          from,
          self,
          name: self ? ownName : names.get(from),
          text: message.text,
          at: Date.now(),
        })
        if (lines.length > CHAT_KEEP) lines.splice(0, lines.length - CHAT_KEEP)
        bumpState()
      }
      if (message.t === 'nav') {
        heard.set('nav', message)
        heard.delete('playback')
        if (heardPlayback?.path !== message.path) heardPlayback = undefined
      } else if (message.t === 'state') {
        heard.set('state', message)
        heardPlayback = message.s ? { path: message.path, state: message.s } : undefined
      } else if (message.t === 'playback') {
        heard.set('playback', message)
        const currentPath = hostPath()
        if (currentPath) heardPlayback = { path: currentPath, state: message.s }
      }
      tell(message, { from, self, replayed: event.replayed })
    })

    if (generation !== openGeneration || room !== joined) {
      off()
      await joined.leave().catch(() => {})
      return
    }
    unlisten = off
    void refreshMembers(joined)

    void joined.closed.then((closed) => {
      if (room !== joined) return
      detach()
      forget()
      const reason: PartyEndReason = closed.reason === 'removed' || closed.reason === 'blocked' || closed.reason === 'left'
        ? closed.reason
        : 'closed'
      emitState({ status: 'ended', reason })
    })

    if (ownName) {
      names.set(joined.self.id, ownName)
      send({ t: 'name', name: ownName })
    }
    introductions = setInterval(() => {
      if (ownName) send({ t: 'name', name: ownName })
    }, NAME_HEARTBEAT_MS)

    if (role === 'host') {
      send(whereWeAre())
      heartbeat = setInterval(() => send(whereWeAre()), STATE_HEARTBEAT_MS)
    } else {
      measureClock()
      clockTimer = setInterval(measureClock, CLOCK_INTERVAL_MS)
    }

    if (social) {
      const currentRoom = joined
      void social.attach({
        roomId: joined.id,
        selfMemberId: joined.self.id,
        send: (frame) => { if (room === currentRoom) send({ t: 'social', p: frame }) },
      }).then(async (attached) => {
        if (room !== currentRoom) {
          await attached.detach().catch(() => {})
          return
        }
        const currentMembers = await joined.members().catch(() => [])
        if (room !== currentRoom) {
          await attached.detach().catch(() => {})
          return
        }
        presence = attached
        presenceUnlisten = attached.on(() => notifyPresence())
        const seenMembers = new Set<string>()
        for (const member of currentMembers) {
          if (member.id !== joined.self.id) {
            seenMembers.add(member.id)
            attached.memberJoined(member.id)
          }
        }
        for (const pending of pendingMembership.splice(0)) {
          if (pending.type === 'joined') {
            if (pending.id !== joined.self.id && !seenMembers.has(pending.id)) {
              seenMembers.add(pending.id)
              attached.memberJoined(pending.id)
            }
          } else {
            seenMembers.delete(pending.id)
            attached.memberLeft(pending.id)
          }
        }
        for (const buffered of pendingSocial.splice(0)) {
          attached.ingest(buffered.from, buffered.frame, buffered.at, buffered.seq)
        }
        notifyPresence()
        if (seenMembers.size > 0) send({ t: 'social', p: SOCIAL_WHOIS_FRAME })
      }, () => {})
    }
  }

  const open = async (invite: string | undefined, start: (api: RoomsApi) => Promise<rooms.Room>, resuming = false) => {
    const generation = ++openGeneration
    if (room) {
      const previous = room
      detach()
      forget()
      await previous.leave().catch(() => {})
    }
    if (generation !== openGeneration) return
    emitState({ status: 'joining', invite: invite ?? '' })
    try {
      const api = await loadRooms()
      if (generation !== openGeneration) return
      const joined = await start(api)
      await attach(joined, generation)
    } catch (error) {
      if (generation !== openGeneration) return
      forget()
      if (resuming) {
        emitState({ status: 'idle' })
        return
      }
      emitState({ status: 'failed', code: isRoomsError(error) ? error.code : 'unknown' })
    }
  }

  const hostPath = (): string | undefined => {
    if (state.status === 'active' && state.role === 'host') return hostLocation
    const nav = heard.get('nav')
    if (nav?.t === 'nav') return nav.path
    const snapshot = heard.get('state')
    return snapshot?.t === 'state' ? snapshot.path : undefined
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    onMessage: (listener) => {
      messageListeners.add(listener)
      return () => {
        messageListeners.delete(listener)
      }
    },
    onPresence: (listener) => {
      presenceListeners.add(listener)
      return () => {
        presenceListeners.delete(listener)
      }
    },
    create: () => open(undefined, (api) => api.create()),
    join: (invite) => open(invite, (api) => api.join(invite)),
    resume: async () => {
      const invite = remembered()
      if (!invite || room || state.status === 'joining') return
      await open(invite, (api) => api.join(invite), true)
    },
    leave: async () => {
      openGeneration += 1
      if (room) await end('left')
      else if (state.status === 'joining') {
        forget()
        emitState({ status: 'idle' })
      }
    },
    dismiss: () => {
      if (state.status === 'ended' || state.status === 'failed') emitState({ status: 'idle' })
    },
    send,
    setLocation: (path) => {
      hostLocation = path
    },
    setPlayback: (playback) => {
      hostPlayback = playback
      hostPlaybackAt = playback ? Date.now() : undefined
    },
    hostPath,
    hostPlayback: () => heardPlayback,
    hostClock: () => clock,
    following: () => following,
    setFollowing: (on) => {
      if (following === on) return
      following = on
      bumpState()
    },
    replay: () => {
      if (!room) return
      if (!following) {
        following = true
        bumpState()
      }
      for (const kind of ['state', 'nav', 'playback'] as const) {
        const message = heard.get(kind)
        if (message) tell(message, { from: room.owner, self: false, replayed: true })
      }
    },
    chat: () => lines.map((line) => ({
      ...line,
      name: line.self ? (resolvedNameOf(line.from) ?? ownName ?? line.name) : (resolvedNameOf(line.from) ?? line.name),
    })),
    name: () => ownName,
    setName: (raw) => {
      ownName = displayName(raw)
      try {
        if (ownName) storage?.setItem(PARTY_NAME_KEY, ownName)
        else storage?.removeItem(PARTY_NAME_KEY)
      } catch {}
      if (room && state.status === 'active') {
        if (ownName) {
          names.set(room.self.id, ownName)
          send({ t: 'name', name: ownName })
        } else {
          names.delete(room.self.id)
        }
        bumpState()
      }
    },
    nameOf: (id) => resolvedNameOf(id),
    identityOf: (id) => verifiedOf(id),
    roster: async () => {
      if (!room) return []
      const current = room
      const members = await current.members().catch(() => [])
      return members.map((member) => ({
        id: member.id,
        name: resolvedNameOf(member.id),
        identity: verifiedOf(member.id),
        host: member.id === current.owner,
        self: member.id === current.self.id,
      }))
    },
    kick: async (id) => {
      if (room && state.status === 'active' && state.role === 'host') await room.remove(id)
    },
    ban: async (id) => {
      if (room && state.status === 'active' && state.role === 'host') await room.block(id)
    },
  }
}
