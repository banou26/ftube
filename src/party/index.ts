import type { RoomBinding } from '../social'
import type { SocialPresenceApi } from './store'

import { startPlatform } from '../engine/platform'
import { createPartyStore } from './store'

export type {
  PartyChatLine,
  PartyEndReason,
  PartyMessageMeta,
  PartyRole,
  PartyRosterMember,
  PartyState,
  PartyStore,
  SocialPresenceApi,
} from './store'
export type { Participant } from '../social'
export type { PartyMessage, PlaybackState } from './protocol'

export { inviteFromHash, PARTY_PATH, partyLink } from './invite'

// `@banou/social` pulls in `@fkn/lib`, so wait for startPlatform() to mount the broker frame first.
const socialPresence: SocialPresenceApi = {
  available: async () => {
    await startPlatform()
    const { social } = await import('../social')
    return social.available()
  },
  attach: async (binding: RoomBinding) => {
    await startPlatform()
    const { social } = await import('../social')
    return social.attach(binding)
  },
}

// Imported lazily after startPlatform() mounts the single broker frame, for the same reason src/groups/sync-live.ts does.
export const party = createPartyStore(async () => {
  await startPlatform()
  return import('@fkn/lib/rooms')
}, undefined, socialPresence)
