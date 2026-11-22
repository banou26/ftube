// Invite link encoding and decoding. Pure and import-free so unit tests never pull in @fkn/lib.

/** Route that opens an invite. The invite rides in the fragment so the room key never reaches a server. */
export const PARTY_PATH = '/party'

const KEY = '[A-Za-z0-9_-]{43}'
const NAME = '[a-z0-9][a-z0-9._-]{0,63}'
const INVITE = new RegExp(`^${KEY}\\.[\\x21-\\x7e]{1,256}\\/${NAME}$`)
const SHORT = new RegExp(`^${KEY}\\.${NAME}$`)

const withoutScope = (origin: string, invite: string): string => {
  const dot = invite.indexOf('.')
  const room = invite.slice(dot + 1)
  const slash = room.lastIndexOf('/')
  return slash > 0 && room.slice(0, slash) === origin
    ? `${invite.slice(0, dot)}.${room.slice(slash + 1)}`
    : invite
}

/** Shareable link with the room key in the fragment, omitting the origin scope when it matches `origin`. */
export const partyLink = (origin: string, invite: string): string =>
  `${origin}${PARTY_PATH}#${withoutScope(origin, invite)}`

/** Parses a room invite from a location hash, restoring `origin` when the short form omitted it. */
export const inviteFromHash = (hash: string, origin: string): string | undefined => {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  let invite: string
  try {
    invite = decodeURIComponent(raw).trim()
  } catch {
    return undefined
  }
  if (INVITE.test(invite)) return invite
  if (!SHORT.test(invite)) return undefined
  const dot = invite.indexOf('.')
  const full = `${invite.slice(0, dot)}.${origin}/${invite.slice(dot + 1)}`
  return INVITE.test(full) ? full : undefined
}
