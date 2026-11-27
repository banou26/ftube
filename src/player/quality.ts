import type { QualityPreference } from '../settings'

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
