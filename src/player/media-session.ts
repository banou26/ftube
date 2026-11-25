import { clampToWindow } from './seek-window'

const MEDIA_SESSION_SEEK_OFFSET = 10

export type MediaSessionLike = {
  metadata: unknown
  playbackState: 'none' | 'paused' | 'playing'
  setActionHandler: (action: string, handler: ((details: MediaSessionActionDetails) => void) | null) => void
  setPositionState?: (state?: MediaPositionState) => void
}

export type MediaSessionTarget = {
  paused: boolean
  currentTime: number
  duration: number
  playbackRate: number
  play: () => Promise<void>
  pause: () => void
  fastSeek?: (time: number) => void
  seekRange?: () => { start: number, end: number }
}

const TRACKED_ACTIONS = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const

const defaultMediaSession = (): MediaSessionLike | undefined => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined
  return navigator.mediaSession as unknown as MediaSessionLike
}

const createMetadata = (
  { videoId, title, artist }: { videoId: string, title?: string, artist?: string },
): MediaMetadata | undefined => {
  if (typeof MediaMetadata === 'undefined' || !videoId) return undefined
  return new MediaMetadata({
    title: title ?? 'FTube',
    artist: artist ?? '',
    artwork: [
      {
        src: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
        sizes: '480x360',
        type: 'image/jpeg',
      },
    ],
  })
}

const setHandler = (
  session: MediaSessionLike,
  action: string,
  handler: ((details: MediaSessionActionDetails) => void) | null,
) => {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // Some browsers reject newer MediaSession actions with TypeError.
  }
}

/** Updates `MediaSession.metadata` from video identity and optional creator name. */
export const updateMediaSessionMetadata = (
  metadata: { videoId: string, title?: string, artist?: string },
  options: {
    session?: MediaSessionLike
    buildMetadata?: (input: { videoId: string, title?: string, artist?: string }) => unknown
  } = {},
): void => {
  const session = options.session ?? defaultMediaSession()
  if (!session) return
  const built = (options.buildMetadata ?? createMetadata)(metadata)
  if (built !== undefined) session.metadata = built
}

/** Syncs `MediaSession.playbackState` and clamped position state for active playback. */
export const syncMediaSessionState = (
  target: Pick<MediaSessionTarget, 'paused' | 'currentTime' | 'duration' | 'playbackRate'>,
  session: MediaSessionLike | undefined = defaultMediaSession(),
): void => {
  if (!session) return
  session.playbackState = target.paused ? 'paused' : 'playing'
  if (typeof session.setPositionState !== 'function') return
  const duration = target.duration
  if (!Number.isFinite(duration) || duration <= 0) return
  const position = Number.isFinite(target.currentTime)
    ? Math.min(duration, Math.max(0, target.currentTime))
    : 0
  const playbackRate = Number.isFinite(target.playbackRate) && target.playbackRate > 0 ? target.playbackRate : 1
  try {
    session.setPositionState({ duration, position, playbackRate })
  } catch {
    // Guard against engines throwing if state changes mid-transition.
  }
}

/** Binds Media Session action handlers for playback, seeking, and track navigation. */
export const bindMediaSession = (
  target: MediaSessionTarget,
  actions: {
    onPrevious?: () => void
    onNext?: () => void
    session?: MediaSessionLike
  } = {},
): (() => void) => {
  const session = actions.session ?? defaultMediaSession()
  if (!session) return () => {}

  const windowRange = () => target.seekRange?.() ?? {
    start: 0,
    end: Number.isFinite(target.duration) ? target.duration : 0,
  }

  const seekBy = (delta: number) => {
    const range = windowRange()
    if (range.end <= range.start) return
    target.currentTime = clampToWindow(range, target.currentTime + delta)
  }

  setHandler(session, 'play', () => {
    void target.play().catch(() => {})
  })
  setHandler(session, 'pause', () => {
    target.pause()
  })
  setHandler(session, 'seekbackward', (details) => {
    seekBy(-(details.seekOffset ?? MEDIA_SESSION_SEEK_OFFSET))
  })
  setHandler(session, 'seekforward', (details) => {
    seekBy(details.seekOffset ?? MEDIA_SESSION_SEEK_OFFSET)
  })
  setHandler(session, 'seekto', (details) => {
    if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return
    const range = windowRange()
    if (range.end <= range.start) return
    const clamped = clampToWindow(range, details.seekTime)
    if (details.fastSeek && typeof target.fastSeek === 'function') {
      target.fastSeek(clamped)
      return
    }
    target.currentTime = clamped
  })
  setHandler(session, 'previoustrack', actions.onPrevious ? () => actions.onPrevious?.() : null)
  setHandler(session, 'nexttrack', actions.onNext ? () => actions.onNext?.() : null)

  syncMediaSessionState(target, session)

  return () => {
    for (const action of TRACKED_ACTIONS) setHandler(session, action, null)
    session.playbackState = 'none'
  }
}
