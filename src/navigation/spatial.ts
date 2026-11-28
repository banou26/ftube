export type NavDirection = 'left' | 'down' | 'up' | 'right'

export type NavRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type NavCandidate<T> = {
  item: T
  rect: NavRect
}

export type KeyboardChordSpec = {
  key: string
  label: string
  shortcut: string
  route?: string
  action?: 'guide' | 'player' | 'search'
}

export const KEYBOARD_NAV_CHORDS: readonly KeyboardChordSpec[] = [
  { key: 'h', label: 'Go to Home', shortcut: 'g h', route: '/' },
  { key: 's', label: 'Go to Subscriptions', shortcut: 'g s', route: '/feed/subscriptions' },
  { key: 'r', label: 'Go to Shorts', shortcut: 'g r', route: '/shorts' },
  { key: 'y', label: 'Go to You', shortcut: 'g y', route: '/feed/you' },
  { key: 'i', label: 'Go to History', shortcut: 'g i', route: '/feed/history' },
  { key: 'c', label: 'Go to All subscriptions', shortcut: 'g c', route: '/feed/channels' },
  { key: 'd', label: 'Go to Downloads', shortcut: 'g d', route: '/downloads' },
  { key: ',', label: 'Go to Settings', shortcut: 'g ,', route: '/settings' },
  { key: 'g', label: 'Focus Guide sidebar', shortcut: 'g g', action: 'guide' },
  { key: 'p', label: 'Focus video player', shortcut: 'g p', action: 'player' },
  { key: '/', label: 'Focus search box', shortcut: 'g /', action: 'search' },
]

const rectCenter = (rect: NavRect): [number, number] => [
  (rect.left + rect.right) / 2,
  (rect.top + rect.bottom) / 2,
]

/** Selects the nearest focusable candidate in `direction` using weighted spatial projection. */
export const findSpatialTarget = <T>(
  currentRect: NavRect,
  candidates: readonly NavCandidate<T>[],
  direction: NavDirection,
): T | undefined => {
  const [cx, cy] = rectCenter(currentRect)
  let bestItem: T | undefined
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const { rect } = candidate
    const [nx, ny] = rectCenter(rect)

    let primary = 0
    let perp = 0
    let aligned = false

    if (direction === 'left') {
      if (nx >= cx - 2) continue
      primary = cx - nx
      perp = Math.abs(ny - cy)
      aligned = rect.bottom > currentRect.top + 2 && rect.top < currentRect.bottom - 2
    } else if (direction === 'right') {
      if (nx <= cx + 2) continue
      primary = nx - cx
      perp = Math.abs(ny - cy)
      aligned = rect.bottom > currentRect.top + 2 && rect.top < currentRect.bottom - 2
    } else if (direction === 'up') {
      if (ny >= cy - 2) continue
      primary = cy - ny
      perp = Math.abs(nx - cx)
      aligned = rect.right > currentRect.left + 2 && rect.left < currentRect.right - 2
    } else {
      if (ny <= cy + 2) continue
      primary = ny - cy
      perp = Math.abs(nx - cx)
      aligned = rect.right > currentRect.left + 2 && rect.left < currentRect.right - 2
    }

    const score = Math.max(0, primary + perp * 2.5 - (aligned ? 16 : 0))
    if (score < bestScore) {
      bestScore = score
      bestItem = candidate.item
    }
  }

  return bestItem
}
