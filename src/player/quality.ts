import type { QualityPreference } from '../settings'

export type QualityBadge = '8K' | '4K' | '2K' | 'HD' | `${number}p`

/** Returns the compact quality badge shown on the player Settings button for the active playing height. */
export const qualityBadgeLabel = (height: number | undefined): QualityBadge | undefined => {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return undefined
  const rounded = Math.round(height)
  if (rounded >= 4320) return '8K'
  if (rounded >= 2160) return '4K'
  if (rounded >= 1440) return '2K'
  if (rounded >= 1080) return 'HD'
  return `${rounded}p`
}

export type ResolvedQuality = {
  selected: 'auto' | number | undefined
  detail: string | undefined
  activeLabel: string | undefined
}

/** Picks the requested manual quality height if available, else the highest tier at or below it (or lowest available). */
export const resolveQualityHeight = (heights: readonly number[], requested: number): number | undefined => {
  if (heights.length === 0) return undefined
  if (heights.includes(requested)) return requested
  const sorted = [...heights].sort((a, b) => b - a)
  return sorted.find((height) => height <= requested) ?? sorted[sorted.length - 1]
}

/** Resolves the player settings Quality row label and submenu checkmark from preference, available heights, and playing height. */
export const resolveQualityDisplay = ({
  preference,
  heights,
  playingHeight,
}: {
  preference: QualityPreference
  heights: readonly number[]
  playingHeight?: number
}): ResolvedQuality => {
  const actual = typeof playingHeight === 'number' && playingHeight > 0 ? playingHeight : undefined
  const activeLabel = actual !== undefined ? `${actual}p` : undefined

  if (preference === 'auto') {
    return {
      selected: 'auto',
      detail: activeLabel ? `Auto (${activeLabel})` : 'Auto',
      activeLabel,
    }
  }

  if (heights.includes(preference)) {
    return {
      selected: preference,
      detail: `${preference}p`,
      activeLabel,
    }
  }

  const effective = actual !== undefined && heights.includes(actual)
    ? actual
    : actual ?? resolveQualityHeight(heights, preference)
  const selected = effective !== undefined && heights.includes(effective)
    ? effective
    : resolveQualityHeight(heights, preference)
  const detail = effective !== undefined ? `${effective}p` : undefined

  return {
    selected,
    detail,
    activeLabel,
  }
}

/** Picks the height that drives the Settings button quality badge: manual selection immediately, playing height in Auto. */
export const resolveQualityBadgeHeight = ({
  preference,
  heights,
  playingHeight,
}: {
  preference: QualityPreference
  heights: readonly number[]
  playingHeight?: number
}): number | undefined => {
  const actual = typeof playingHeight === 'number' && playingHeight > 0 ? playingHeight : undefined
  if (preference === 'auto') return actual
  const resolved = resolveQualityDisplay({ preference, heights, playingHeight })
  return typeof resolved.selected === 'number' ? resolved.selected : actual
}
