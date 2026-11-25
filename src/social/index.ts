import type { Participant as BaseParticipant, Presence as BasePresence } from '@banou/social'

import { social, SOCIAL_PACKAGE, SOCIAL_PROTOCOL } from '@banou/social'

export type {
  Availability,
  Post,
  PublishAnswer,
  PublishingRefusal,
  PublishingState,
  RoomBinding,
} from '@banou/social'

export { social, SOCIAL_PACKAGE, SOCIAL_PROTOCOL }

/** Forward-compatible identity fields carried on `@banou/social` room presence updates. */
export type SocialIdentity = NonNullable<BaseParticipant['identity']> & {
  identicon?: string
  signKey?: string
  nickname?: string | null
}

/** Room participant enriched with optional verified social avatar, identicon, key, and friend nickname. */
export type Participant = Omit<BaseParticipant, 'identity'> & {
  identity: SocialIdentity | null
}

/** Room presence handle whose participant stream may carry `SocialIdentity` fields. */
export type Presence = Omit<BasePresence, 'participants' | 'of' | 'on'> & {
  participants: () => Participant[]
  of: (memberId: string) => Participant
  on: (listener: (participants: Participant[]) => void) => () => void
}

/** FKN Social's site, where the viewer sets a name and manages friends. */
export const SOCIAL_SITE = 'https://social.fkn.app/'
