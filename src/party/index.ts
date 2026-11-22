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
} from './store'
export type { PartyMessage, PlaybackState } from './protocol'

export { inviteFromHash, PARTY_PATH, partyLink } from './invite'

// Imported lazily after startPlatform() mounts the single broker frame, for the same reason src/groups/sync-live.ts does.
export const party = createPartyStore(async () => {
  await startPlatform()
  return import('@fkn/lib/rooms')
})
