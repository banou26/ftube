/** Identifier of a customizable control item in the main player bar. */
export type PlayerBarControlId =
  | 'play'
  | 'next'
  | 'volume'
  | 'time'
  | 'chapter'
  | 'autoplay'
  | 'captions'
  | 'settings'
  | 'pip'
  | 'theater'
  | 'fullscreen'

/** Side of the main player control bar where a control is placed. */
export type PlayerBarSide = 'left' | 'right'

/** Persisted order and visibility of main player bar controls. */
export type PlayerBarLayout = {
  left: PlayerBarControlId[]
  right: PlayerBarControlId[]
  hidden: PlayerBarControlId[]
}

/** Identifier of a toggleable entry inside the player's settings popup menu. */
export type PlayerSettingsMenuItemId =
  | 'stableVolume'
  | 'ambientMode'
  | 'annotations'
  | 'pip'
  | 'subtitles'
  | 'audioTrack'
  | 'sleepTimer'
  | 'playbackSpeed'
  | 'quality'

/** Display labels and default bar sides for every customizable player bar control. */
export const PLAYER_BAR_CONTROL_META: Record<PlayerBarControlId, { label: string, defaultSide: PlayerBarSide }> = {
  play: { label: 'Play / Pause', defaultSide: 'left' },
  next: { label: 'Next', defaultSide: 'left' },
  volume: { label: 'Volume', defaultSide: 'left' },
  time: { label: 'Time', defaultSide: 'left' },
  chapter: { label: 'Chapter', defaultSide: 'left' },
  autoplay: { label: 'Autoplay', defaultSide: 'right' },
  captions: { label: 'Subtitles / Captions', defaultSide: 'right' },
  settings: { label: 'Settings', defaultSide: 'right' },
  pip: { label: 'Picture in picture', defaultSide: 'right' },
  theater: { label: 'Theater mode', defaultSide: 'right' },
  fullscreen: { label: 'Full screen', defaultSide: 'right' },
}

/** Ordered list of all customizable entries shown in the player settings popup menu. */
export const PLAYER_SETTINGS_MENU_ITEMS: readonly { id: PlayerSettingsMenuItemId, label: string }[] = [
  { id: 'stableVolume', label: 'Stable Volume' },
  { id: 'ambientMode', label: 'Ambient mode' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'pip', label: 'Picture in picture' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'audioTrack', label: 'Audio track' },
  { id: 'sleepTimer', label: 'Sleep timer' },
  { id: 'playbackSpeed', label: 'Playback speed' },
  { id: 'quality', label: 'Quality' },
]

const ALL_CONTROL_IDS = Object.keys(PLAYER_BAR_CONTROL_META) as PlayerBarControlId[]
const CONTROL_ID_SET = new Set<string>(ALL_CONTROL_IDS)
const MENU_ITEM_IDS = PLAYER_SETTINGS_MENU_ITEMS.map(item => item.id)
const MENU_ITEM_ID_SET = new Set<string>(MENU_ITEM_IDS)

/** Default order and full visibility for all main player bar controls. */
export const DEFAULT_PLAYER_BAR_LAYOUT: PlayerBarLayout = {
  left: ['play', 'next', 'volume', 'time', 'chapter'],
  right: ['autoplay', 'captions', 'settings', 'pip', 'theater', 'fullscreen'],
  hidden: [],
}

/** Returns a fresh deep clone of `DEFAULT_PLAYER_BAR_LAYOUT` safe to store or pass to callers. */
export const cloneDefaultPlayerBarLayout = (): PlayerBarLayout => ({
  left: [...DEFAULT_PLAYER_BAR_LAYOUT.left],
  right: [...DEFAULT_PLAYER_BAR_LAYOUT.right],
  hidden: [...DEFAULT_PLAYER_BAR_LAYOUT.hidden],
})

const isControlId = (value: unknown): value is PlayerBarControlId =>
  typeof value === 'string' && CONTROL_ID_SET.has(value)

const isMenuItemId = (value: unknown): value is PlayerSettingsMenuItemId =>
  typeof value === 'string' && MENU_ITEM_ID_SET.has(value)

/**
 * Normalizes untrusted or partial stored player bar layout data into a complete, deduplicated
 * `PlayerBarLayout`. Every known control ID appears once across `left` and `right`, and any
 * missing IDs are appended to their default side in default order.
 */
export const coercePlayerBarLayout = (value: unknown): PlayerBarLayout => {
  if (!value || typeof value !== 'object') return cloneDefaultPlayerBarLayout()
  const raw = value as { left?: unknown, right?: unknown, hidden?: unknown }
  const seen = new Set<PlayerBarControlId>()
  const left: PlayerBarControlId[] = []
  const right: PlayerBarControlId[] = []
  const hidden: PlayerBarControlId[] = []

  if (Array.isArray(raw.left)) {
    for (const entry of raw.left) {
      if (!isControlId(entry) || seen.has(entry)) continue
      seen.add(entry)
      left.push(entry)
    }
  }
  if (Array.isArray(raw.right)) {
    for (const entry of raw.right) {
      if (!isControlId(entry) || seen.has(entry)) continue
      seen.add(entry)
      right.push(entry)
    }
  }
  for (const id of ALL_CONTROL_IDS) {
    if (seen.has(id)) continue
    seen.add(id)
    if (PLAYER_BAR_CONTROL_META[id].defaultSide === 'left') left.push(id)
    else right.push(id)
  }

  if (Array.isArray(raw.hidden)) {
    const hiddenSeen = new Set<PlayerBarControlId>()
    for (const entry of raw.hidden) {
      if (!isControlId(entry) || hiddenSeen.has(entry)) continue
      hiddenSeen.add(entry)
      hidden.push(entry)
    }
  }

  return { left, right, hidden }
}

/** Normalizes stored hidden menu item IDs, discarding unknown or duplicate entries. */
export const coercePlayerMenuHidden = (value: unknown): PlayerSettingsMenuItemId[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<PlayerSettingsMenuItemId>()
  const next: PlayerSettingsMenuItemId[] = []
  for (const entry of value) {
    if (!isMenuItemId(entry) || seen.has(entry)) continue
    seen.add(entry)
    next.push(entry)
  }
  return next
}

/** Returns whether a control is currently visible in the main player bar. */
export const isBarControlVisible = (layout: PlayerBarLayout, id: PlayerBarControlId) =>
  !layout.hidden.includes(id)

/** Returns a new layout with the given control's main-bar visibility toggled. */
export const toggleBarControlVisibility = (layout: PlayerBarLayout, id: PlayerBarControlId): PlayerBarLayout => {
  const coerced = coercePlayerBarLayout(layout)
  const hidden = coerced.hidden.includes(id)
    ? coerced.hidden.filter(entry => entry !== id)
    : [...coerced.hidden, id]
  return { ...coerced, hidden }
}

/** Moves a control one slot earlier (`-1`) or later (`1`) within its current bar side. */
export const moveBarControlByStep = (layout: PlayerBarLayout, id: PlayerBarControlId, delta: -1 | 1): PlayerBarLayout => {
  const coerced = coercePlayerBarLayout(layout)
  const side: PlayerBarSide = coerced.left.includes(id) ? 'left' : 'right'
  const list = [...coerced[side]]
  const index = list.indexOf(id)
  if (index === -1) return coerced
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= list.length) return coerced
  const [item] = list.splice(index, 1)
  list.splice(nextIndex, 0, item!)
  return {
    ...coerced,
    [side]: list,
  }
}

/**
 * Moves a control to `targetSide`, inserting it at `targetIndex` (clamped) or appending to the end
 * when `targetIndex` is omitted. Handles both within-side and cross-side reordering without duplicates.
 */
export const moveBarControlToSide = (
  layout: PlayerBarLayout,
  id: PlayerBarControlId,
  targetSide: PlayerBarSide,
  targetIndex?: number,
): PlayerBarLayout => {
  const coerced = coercePlayerBarLayout(layout)
  const sourceSide: PlayerBarSide = coerced.left.includes(id) ? 'left' : 'right'
  const sourceIndex = coerced[sourceSide].indexOf(id)
  const left = coerced.left.filter(entry => entry !== id)
  const right = coerced.right.filter(entry => entry !== id)
  const dest = targetSide === 'left' ? left : right
  let insertAt = targetIndex ?? dest.length
  if (sourceSide === targetSide && sourceIndex !== -1 && targetIndex !== undefined && sourceIndex < targetIndex) {
    insertAt = targetIndex - 1
  }
  const clamped = Math.max(0, Math.min(dest.length, insertAt))
  dest.splice(clamped, 0, id)
  return {
    left,
    right,
    hidden: coerced.hidden,
  }
}

/** Toggles visibility of a player settings menu item inside `hidden`, returning a new list. */
export const toggleSettingsMenuItem = (
  hidden: readonly PlayerSettingsMenuItemId[],
  id: PlayerSettingsMenuItemId,
): PlayerSettingsMenuItemId[] => {
  const coerced = coercePlayerMenuHidden(hidden)
  return coerced.includes(id)
    ? coerced.filter(entry => entry !== id)
    : [...coerced, id]
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((item, index) => item === b[index])

/** Returns true when `layout` matches `DEFAULT_PLAYER_BAR_LAYOUT` in both order and visibility. */
export const isPlayerBarLayoutDefault = (layout: PlayerBarLayout) =>
  sameList(layout.left, DEFAULT_PLAYER_BAR_LAYOUT.left)
  && sameList(layout.right, DEFAULT_PLAYER_BAR_LAYOUT.right)
  && layout.hidden.length === 0

/** Returns true when every player settings menu entry is visible. */
export const isPlayerMenuHiddenDefault = (hidden: readonly PlayerSettingsMenuItemId[]) =>
  hidden.length === 0
