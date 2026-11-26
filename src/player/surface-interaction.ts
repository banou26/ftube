export type SurfaceClickInput = {
  pointerType?: string
  activeAtPress: boolean
  paused: boolean
  settingsOpen: boolean
  menuAtPress: boolean
}

export type SurfaceClickAction = 'ignore' | 'toggle-play' | 'show-controls' | 'hide-controls'

/** Returns whether a pointer event came from touch input, whose taps toggle controls rather than playback. */
export const isTouchPointer = (pointerType?: string) => pointerType === 'touch'

/** Hover wake/hide only tracks non-touch pointers so a tap's move/leave cannot hide controls right away. */
export const shouldIgnoreHoverPointer = (pointerType?: string) => isTouchPointer(pointerType)

/**
 * Decides what tapping or clicking the video surface does: touch reveals hidden controls or hides visible
 * controls while playing (never pausing playback), whereas mouse/pen toggles play/pause.
 */
export const decideSurfaceClick = (
  { pointerType, activeAtPress, paused, settingsOpen, menuAtPress }: SurfaceClickInput,
): SurfaceClickAction => {
  if (menuAtPress) return 'ignore'
  if (isTouchPointer(pointerType)) {
    if (!activeAtPress) return 'show-controls'
    return !paused && !settingsOpen ? 'hide-controls' : 'show-controls'
  }
  return 'toggle-play'
}
