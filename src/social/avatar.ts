import type { Participant, SocialIdentity } from './index'

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

/** Filters avatar URLs down to HTTPS or inline image data URIs before rendering. */
export const safeAvatarSrc = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.startsWith('data:image/') || trimmed.startsWith('https://') ? trimmed : null
}

/** Picks the single-grapheme fallback initial for a verified FKN Social participant. */
export const avatarInitialOf = (identity: SocialIdentity, status: Participant['status']): string => {
  const source = (
    (status === 'friend' ? identity.nickname?.trim() : undefined)
    || identity.displayName.trim()
    || identity.name
  ).normalize('NFC')
  const first = graphemeSegmenter
    ? graphemeSegmenter.segment(source)[Symbol.iterator]().next().value?.segment
    : source.slice(0, 1)
  return (first || '?').toUpperCase()
}
