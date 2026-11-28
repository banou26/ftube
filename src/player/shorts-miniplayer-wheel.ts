export type ShortsWheelStep = -1 | 1

export type ShortsWheelInput = {
  deltaY: number
  deltaX?: number
  deltaMode?: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export type ShortsWheelOptions = {
  thresholdPx?: number
  cooldownMs?: number
  idleResetMs?: number
  now?: () => number
}

const LINE_DELTA_PX = 40
const PAGE_DELTA_PX = 300

const toPixelDelta = (deltaY: number, deltaMode = 0) => {
  if (deltaMode === 1) return deltaY * LINE_DELTA_PX
  if (deltaMode === 2) return deltaY * PAGE_DELTA_PX
  return deltaY
}

/**
 * Debounces mouse-wheel and trackpad momentum events into discrete -1/+1 Short steps.
 *
 * After emitting a step, same-direction momentum events stay locked until both `cooldownMs`
 * after the step AND `idleResetMs` since the previous wheel event have elapsed, preventing a
 * single trackpad flick from skipping through multiple Shorts.
 *
 * Returns `null` when the event should not be intercepted (horizontal scroll or modifier keys),
 * `0` when consumed without stepping yet, or `-1` / `1` when a step triggers.
 */
export const createShortsWheelNavigator = (
  { thresholdPx = 30, cooldownMs = 450, idleResetMs = 180, now = Date.now }: ShortsWheelOptions = {},
) => {
  let accumulated = 0
  let lockedDirection: ShortsWheelStep | 0 = 0
  let lockedAt = Number.NEGATIVE_INFINITY
  let lastEventAt = Number.NEGATIVE_INFINITY

  const handle = (input: ShortsWheelInput): ShortsWheelStep | 0 | null => {
    if (input.ctrlKey || input.metaKey || input.altKey) return null
    const deltaX = input.deltaX ?? 0
    if (input.deltaY === 0 || !Number.isFinite(input.deltaY)) return null
    if (Math.abs(deltaX) > Math.abs(input.deltaY)) return null

    const t = now()
    const px = toPixelDelta(input.deltaY, input.deltaMode)
    const dir: ShortsWheelStep = px > 0 ? 1 : -1

    if (lockedDirection !== 0) {
      const sinceStep = t - lockedAt
      const sinceLast = t - lastEventAt
      const unlockedSame = sinceStep >= cooldownMs && sinceLast >= idleResetMs
      const unlockedOpposite = dir !== lockedDirection && (sinceStep >= cooldownMs || sinceLast >= idleResetMs)
      lastEventAt = t
      if (!unlockedSame && !unlockedOpposite) {
        return 0
      }
      lockedDirection = 0
      accumulated = 0
    } else if (t - lastEventAt >= idleResetMs) {
      accumulated = 0
    }

    lastEventAt = t
    if (accumulated !== 0 && Math.sign(accumulated) !== dir) accumulated = 0
    accumulated += px

    if ((input.deltaMode ?? 0) !== 0 || Math.abs(accumulated) >= thresholdPx) {
      lockedDirection = dir
      lockedAt = t
      accumulated = 0
      return dir
    }
    return 0
  }

  const reset = () => {
    accumulated = 0
    lockedDirection = 0
    lockedAt = Number.NEGATIVE_INFINITY
    lastEventAt = Number.NEGATIVE_INFINITY
  }

  return { handle, reset }
}

/**
 * Attaches a non-passive wheel listener to a docked Shorts player surface so vertical wheel
 * gestures step between Shorts without scrolling the underlying page, while skipping volume or
 * scrub targets.
 */
export const bindShortsMiniplayerWheel = (
  target: HTMLElement,
  { onStep, shouldIgnore, options }: {
    onStep: (delta: ShortsWheelStep) => void
    shouldIgnore?: (event: WheelEvent) => boolean
    options?: ShortsWheelOptions
  },
): (() => void) => {
  const nav = createShortsWheelNavigator(options)
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || shouldIgnore?.(event)) return
    const step = nav.handle(event)
    if (step === null) return
    event.preventDefault()
    if (step !== 0) onStep(step)
  }
  target.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    target.removeEventListener('wheel', onWheel)
    nav.reset()
  }
}
