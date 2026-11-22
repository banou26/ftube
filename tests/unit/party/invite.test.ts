import { describe, expect, it } from 'vite-plus/test'

import { inviteFromHash, PARTY_PATH, partyLink } from '../../../src/party/invite'

const KEY = 'A'.repeat(43)
const ORIGIN = 'https://youtube.fkn.app'

describe('partyLink and inviteFromHash', () => {
  it('omits the origin scope in same-origin links and restores it on parse', () => {
    const invite = `${KEY}.${ORIGIN}/room-1`
    const link = partyLink(ORIGIN, invite)
    expect(link).toBe(`${ORIGIN}${PARTY_PATH}#${KEY}.room-1`)
    expect(inviteFromHash(`#${KEY}.room-1`, ORIGIN)).toBe(invite)
    expect(inviteFromHash(`${KEY}.room-1`, ORIGIN)).toBe(invite)
  })

  it('keeps cross-origin scope intact in both directions', () => {
    const other = `${KEY}.https://other.fkn.app/room-2`
    expect(partyLink(ORIGIN, other)).toBe(`${ORIGIN}${PARTY_PATH}#${other}`)
    expect(inviteFromHash(`#${other}`, ORIGIN)).toBe(other)
  })

  it('accepts percent-encoded fragments and rejects malformed ones', () => {
    const invite = `${KEY}.${ORIGIN}/room_3.test`
    expect(inviteFromHash(`#${encodeURIComponent(invite)}`, ORIGIN)).toBe(invite)
    expect(inviteFromHash('', ORIGIN)).toBeUndefined()
    expect(inviteFromHash('#short.room', ORIGIN)).toBeUndefined()
    expect(inviteFromHash(`#${KEY}.BAD_UPPER`, ORIGIN)).toBeUndefined()
    expect(inviteFromHash('#%E0%A4%A', ORIGIN)).toBeUndefined()
  })
})
