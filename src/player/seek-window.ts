import type shaka from 'shaka-player'

/** Where the playhead can go: a video's whole length, or a live stream's DVR window up to the edge it plays at. */
export type SeekWindow = { start: number, end: number }

/** Normalized progress-bar state for both VOD and live DVR streams. */
export type LiveBarState = {
  base: number
  duration: number
  position: number
  behind: boolean
  pinnedFull: boolean
  buffered: number
}

// youtube.com still counts a playhead one 5 s step behind the head as live, and not one two steps behind (measured 2026-11-11)
const LIVE_EDGE_SLACK = 8

/** A live stream's window is Shaka's seek range, whose end is the edge Shaka opens the stream at; a video's is 0 to its duration. */
export const seekWindow = (video: HTMLVideoElement, player: shaka.Player | undefined): SeekWindow =>
  player?.isLive()
    ? player.seekRange()
    : { start: 0, end: Number.isFinite(video.duration) ? video.duration : 0 }

export const clampToWindow = ({ start, end }: SeekWindow, time: number) => Math.max(start, Math.min(end, time))

/** The time a share of the way through the window, as a number key seeks. */
export const timeAtShare = ({ start, end }: SeekWindow, share: number) => start + (end - start) * share

/** Whether a live playhead is at the edge, as youtube.com's Live badge tells it apart from one behind. */
export const atLiveEdge = ({ end }: SeekWindow, time: number) => end - time < LIVE_EDGE_SLACK

/** Where a live stream reopens after a restart: 0, the edge, when it played at the edge, or the time it played at. */
export const liveResumeTime = (window: SeekWindow, time: number) => (atLiveEdge(window, time) ? 0 : time)

/** Computes clamped progress position, buffered extent, and edge pinning for the seek bar. */
export const liveBarState = ({
  isLive,
  liveWindow,
  currentTime,
  duration,
  buffered,
  preview,
}: {
  isLive: boolean
  liveWindow?: SeekWindow
  currentTime: number
  duration: number
  buffered: number
  preview?: number
}): LiveBarState => {
  if (!isLive) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
    const rawPos = preview ?? currentTime
    const position = safeDuration > 0 ? Math.max(0, Math.min(safeDuration, rawPos)) : 0
    const safeBuffered = safeDuration > 0 ? Math.max(0, Math.min(safeDuration, buffered)) : 0
    return { base: 0, duration: safeDuration, position, behind: false, pinnedFull: false, buffered: safeBuffered }
  }
  const validWindow = liveWindow
    && Number.isFinite(liveWindow.start)
    && Number.isFinite(liveWindow.end)
    && liveWindow.end > liveWindow.start
    ? liveWindow
    : undefined
  if (!validWindow) {
    return {
      base: liveWindow?.start ?? 0,
      duration: 0,
      position: 0,
      behind: false,
      pinnedFull: preview === undefined,
      buffered: 0,
    }
  }
  const base = validWindow.start
  const windowDuration = Math.max(0, validWindow.end - validWindow.start)
  const behind = !atLiveEdge(validWindow, currentTime)
  if (preview !== undefined) {
    const clampedPreview = Math.max(0, Math.min(windowDuration, preview))
    return {
      base,
      duration: windowDuration,
      position: clampedPreview,
      behind,
      pinnedFull: false,
      buffered: Math.max(0, Math.min(windowDuration, buffered - base)),
    }
  }
  if (!behind) {
    return {
      base,
      duration: windowDuration,
      position: windowDuration,
      behind: false,
      pinnedFull: true,
      buffered: windowDuration,
    }
  }
  const position = Math.max(0, Math.min(windowDuration, currentTime - base))
  return {
    base,
    duration: windowDuration,
    position,
    behind: true,
    pinnedFull: false,
    buffered: Math.max(position, Math.min(windowDuration, buffered - base)),
  }
}

/** Formats a seek-bar position as a live offset ('Live' at the edge, never '-0:00') or elapsed clock. */
export const liveBarClock = (
  time: number,
  duration: number,
  isLive: boolean,
  formatClock: (seconds: number) => string,
): string => {
  if (!isLive) return formatClock(time)
  if (duration <= 0) return 'Live'
  const behindSeconds = Math.max(0, duration - time)
  if (behindSeconds < 1) return 'Live'
  return `-${formatClock(behindSeconds)}`
}
