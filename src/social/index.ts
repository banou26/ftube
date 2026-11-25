import type { Participant } from '@banou/social'

export type {
  Availability,
  Participant,
  Post,
  Presence,
  PublishAnswer,
  PublishingRefusal,
  PublishingState,
  RoomBinding,
} from '@banou/social'

export { social, SOCIAL_PACKAGE, SOCIAL_PROTOCOL } from '@banou/social'

/** Verified FKN Social identity fields carried on room presence updates. */
export type SocialIdentity = NonNullable<Participant['identity']>

/** FKN Social's site, where the viewer sets a name and manages friends. */
export const SOCIAL_SITE = 'https://social.fkn.app/'
