import type { QualityPreference } from '../settings'

export type QualityBadge = '8K' | '4K' | '2K' | 'HD' | `${number}p`

/** Normalizes ultrawide/cinemascope (based on width*9/16) and portrait (based on width) frame dimensions to a standard 16:9 tier height. */
export const normalizeQualityHeight = (height: number | undefined, width?: number): number | undefined => {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return undefined
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    if (height > width) return Math.round(width)
    return Math.round(Math.max(height, (width * 9) / 16))
  }
  return Math.round(height)
}

/** Returns the compact quality badge shown on the player Settings button for the active playing resolution. */
export const qualityBadgeLabel = (height: number | undefined, width?: number): QualityBadge | undefined => {
  const normalized = normalizeQualityHeight(height, width)
  if (normalized === undefined) return undefined
  if (normalized >= 4320) return '8K'
  if (normalized >= 2160) return '4K'
  if (normalized >= 1440) return '2K'
  if (normalized >= 1080) return 'HD'
  return `${normalized}p`
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

/** Picks the normalized height that drives the Settings button quality badge: manual selection immediately, playing resolution in Auto. */
export const resolveQualityBadgeHeight = ({
  preference,
  heights,
  playingHeight,
  playingWidth,
}: {
  preference: QualityPreference
  heights: readonly number[]
  playingHeight?: number
  playingWidth?: number
}): number | undefined => {
  const actual = typeof playingHeight === 'number' && playingHeight > 0 ? playingHeight : undefined
  if (preference === 'auto') return normalizeQualityHeight(actual, playingWidth)
  const resolved = resolveQualityDisplay({ preference, heights, playingHeight })
  if (typeof resolved.selected === 'number') {
    return resolved.selected === actual ? normalizeQualityHeight(actual, playingWidth) : resolved.selected
  }
  return normalizeQualityHeight(actual, playingWidth)
}
