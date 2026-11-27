export type WatchActionId = 'share' | 'save' | 'download'

/** Order in which watch-page action pills stay inline before overflowing into the More actions menu. */
export const WATCH_ACTION_PRIORITY: readonly WatchActionId[] = ['share', 'save', 'download']

export const DEFAULT_WATCH_ACTION_WIDTHS: Record<WatchActionId, number> = {
  share: 98,
  save: 88,
  download: 120,
}

export type WatchActionLayoutInput = {
  availableWidth: number
  likeWidth: number
  moreWidth: number
  actionWidths?: Partial<Record<WatchActionId, number>>
  enabled: readonly WatchActionId[]
  gap?: number
}

/**
 * Splits enabled watch actions into visible inline pills and overflow menu items based on available row width.
 * Always reserves room for `LikePill` + gap + `Share` (when enabled) + `More actions` trigger so `Share` never moves into `More actions`.
 */
export const computeVisibleWatchActions = (
  { availableWidth, likeWidth, moreWidth, actionWidths = {}, enabled, gap = 8 }: WatchActionLayoutInput,
): { inline: WatchActionId[], overflow: WatchActionId[] } => {
  const enabledSet = new Set(enabled)
  const shareInline = enabledSet.has('share')
  const overflowable = WATCH_ACTION_PRIORITY.filter(id => id !== 'share' && enabledSet.has(id))
  const inline: WatchActionId[] = shareInline ? ['share'] : []
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { inline, overflow: overflowable }
  }

  const safeGap = Math.max(0, gap)
  let used = Math.max(0, likeWidth) + safeGap + Math.max(0, moreWidth)
  if (shareInline) {
    used += safeGap + Math.max(0, actionWidths.share ?? DEFAULT_WATCH_ACTION_WIDTHS.share)
  }
  const overflow: WatchActionId[] = []

  for (const id of overflowable) {
    const itemWidth = Math.max(0, actionWidths[id] ?? DEFAULT_WATCH_ACTION_WIDTHS[id])
    const nextUsed = used + safeGap + itemWidth
    if (nextUsed <= availableWidth + 0.5) {
      inline.push(id)
      used = nextUsed
    } else {
      overflow.push(id)
    }
  }

  return { inline, overflow }
}
