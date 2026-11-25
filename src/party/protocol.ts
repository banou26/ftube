// Wire protocol for Watch Together rooms. Pure and import-free so it can be tested independently.

import { PARTY_PATH } from './invite'

/** Host playback snapshot, with `at` stamped on the host's clock (milliseconds since epoch). */
export type PlaybackState = {
  paused: boolean
  time: number
  rate: number
  at: number
}

/**
 * Messages exchanged over the encrypted room channel.
 *
 * Host-only messages (`nav`, `playback`, `state`, `pong`) are dropped by guests if sent by anyone other than the room
 * owner. Any member may send `chat`, `name`, or `ping`.
 */
export type PartyMessage =
  | { t: 'nav', path: string }
  | { t: 'playback', s: PlaybackState }
  | { t: 'state', path: string, s?: PlaybackState }
  | { t: 'chat', text: string }
  | { t: 'name', name: string }
  | { t: 'social', p: string }
  | { t: 'ping', n: number, at: number }
  | { t: 'pong', n: number, at: number, host: number }

const HOST_ONLY: ReadonlySet<PartyMessage['t']> = new Set(['nav', 'playback', 'state', 'pong'])

export const MAX_PATH_LENGTH = 1024
export const MAX_NAME_LENGTH = 32
export const MAX_CHAT_LENGTH = 500
export const SOCIAL_MAX_CHARS = 3_500
const MAX_RATE = 16

/** Whether a message may only be accepted from the room owner. */
export const isHostOnly = (message: PartyMessage): boolean => HOST_ONLY.has(message.t)

/** Validates a relative in-app route path and rejects external URLs, control chars, and `/party`. */
export const sanitizePath = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATH_LENGTH) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return undefined
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return undefined
  }
  const pathname = raw.split(/[?#]/, 1)[0] ?? ''
  if (pathname === PARTY_PATH || pathname.startsWith(`${PARTY_PATH}/`)) return undefined
  return raw
}

/** Normalizes the current route for party sync, stripping `/watch`'s `t` position query parameter. */
export const normalizePartyPath = (pathname: string, search: string): string | undefined => {
  const cleanSearch = search.startsWith('?') ? search.slice(1) : search
  if (pathname === '/watch') {
    const params = new URLSearchParams(cleanSearch)
    params.delete('t')
    const rest = params.toString()
    return sanitizePath(rest ? `${pathname}?${rest}` : pathname)
  }
  return sanitizePath(cleanSearch ? `${pathname}?${cleanSearch}` : pathname)
}

/** Extracts the YouTube video ID from a `/watch` route path, if present. */
export const videoIdOfPath = (path: string | undefined): string | undefined => {
  if (!path) return undefined
  const queryStart = path.indexOf('?')
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart)
  if (pathname !== '/watch' || queryStart === -1) return undefined
  const id = new URLSearchParams(path.slice(queryStart + 1)).get('v')
  return id || undefined
}

/** Trims and bounds a member display name to one line of at most 32 characters. */
export const displayName = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim()
  return clean || undefined
}

/** Trims and bounds a chat line to one line of at most 500 characters. */
export const chatText = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH).trim()
  return clean || undefined
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const decodePlayback = (raw: unknown): PlaybackState | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.paused !== 'boolean') return undefined
  if (!isFiniteNumber(record.time) || record.time < 0) return undefined
  if (!isFiniteNumber(record.rate) || record.rate <= 0 || record.rate > MAX_RATE) return undefined
  if (!isFiniteNumber(record.at) || record.at < 0) return undefined
  return { paused: record.paused, time: record.time, rate: record.rate, at: record.at }
}

/** Encodes a party message as JSON text for `room.send`. */
export const encodePartyMessage = (message: PartyMessage): string => JSON.stringify(message)

/** Parses and validates a wire message, returning undefined for malformed or unknown frames. */
export const decodePartyMessage = (raw: string): PartyMessage | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  switch (record.t) {
    case 'nav': {
      const path = sanitizePath(record.path)
      return path ? { t: 'nav', path } : undefined
    }
    case 'playback': {
      const s = decodePlayback(record.s)
      return s ? { t: 'playback', s } : undefined
    }
    case 'state': {
      const path = sanitizePath(record.path)
      if (!path) return undefined
      if (record.s === undefined) return { t: 'state', path }
      const s = decodePlayback(record.s)
      return s ? { t: 'state', path, s } : undefined
    }
    case 'chat': {
      const text = chatText(record.text)
      return text ? { t: 'chat', text } : undefined
    }
    case 'name': {
      const name = displayName(record.name)
      return name ? { t: 'name', name } : undefined
    }
    case 'social':
      return typeof record.p === 'string' && record.p.length > 0 && record.p.length <= SOCIAL_MAX_CHARS
        ? { t: 'social', p: record.p }
        : undefined
    case 'ping': {
      if (!Number.isInteger(record.n) || !isFiniteNumber(record.at) || record.at < 0) return undefined
      return { t: 'ping', n: record.n as number, at: record.at }
    }
    case 'pong': {
      if (!Number.isInteger(record.n) || !isFiniteNumber(record.at) || record.at < 0) return undefined
      if (!isFiniteNumber(record.host) || record.host < 0) return undefined
      return { t: 'pong', n: record.n as number, at: record.at, host: record.host }
    }
    default:
      return undefined
  }
}
