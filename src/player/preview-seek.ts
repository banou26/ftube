/**
 * Computes the next preview timestamp (in seconds) for a keyboard slider key press,
 * returning `undefined` when the key does not seek or duration is unavailable.
 */
export const previewSeekStep = (
  currentTime: number,
  duration: number,
  key: string,
  shiftKey = false,
): number | undefined => {
  if (!Number.isFinite(duration) || duration <= 0) return undefined
  const base = Number.isFinite(currentTime) ? Math.max(0, Math.min(duration, currentTime)) : 0
  const step = shiftKey ? 10 : 5
  const pageStep = Math.max(10, Math.round(duration * 0.1))

  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(duration, base + step)
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, base - step)
    case 'PageUp':
      return Math.min(duration, base + pageStep)
    case 'PageDown':
      return Math.max(0, base - pageStep)
    case 'Home':
      return 0
    case 'End':
      return duration
    default:
      return undefined
  }
}
