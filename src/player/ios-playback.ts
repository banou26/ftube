const DEFAULT_TRANSITION_WINDOW_MS = 600
const DEFAULT_RETRY_DELAY_MS = 100

const VIDEO_TRANSITION_EVENTS = [
  'webkitpresentationmodechanged',
  'webkitbeginfullscreen',
  'webkitendfullscreen',
  'enterpictureinpicture',
] as const

export interface NativeTransitionResumeTarget {
  paused: boolean
  ended: boolean
  play: () => unknown
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
}

export interface NativeTransitionVisibilityTarget {
  hidden: boolean
  visibilityState?: DocumentVisibilityState
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
}

export interface NativeTransitionResumeOptions {
  video: NativeTransitionResumeTarget
  doc?: NativeTransitionVisibilityTarget | null
  windowMs?: number
  retryMs?: number
  now?: () => number
  onResumeError?: (error: unknown) => void
}

export interface NativeTransitionController {
  markExplicitPause: () => void
  destroy: () => void
}

/**
 * Resumes playback when iOS Safari fires an involuntary `pause` across native fullscreen, PiP, presentation-mode, or
 * background transitions, while honoring explicit pauses and natural playback completion.
 */
export const bindNativeTransitionResume = (
  options: NativeTransitionResumeOptions,
): NativeTransitionController => {
  const { video, doc } = options
  const windowMs = options.windowMs ?? DEFAULT_TRANSITION_WINDOW_MS
  const retryMs = options.retryMs ?? DEFAULT_RETRY_DELAY_MS
  const now = options.now ?? (() => Date.now())

  let destroyed = false
  let explicitPause = false
  let wasPlaying = !video.paused && !video.ended
  let lastTransitionAt: number | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const clearRetry = () => {
    if (retryTimer === null) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  const attemptPlay = () => {
    try {
      void Promise.resolve(video.play()).catch((error) => {
        options.onResumeError?.(error)
      })
    } catch (error) {
      options.onResumeError?.(error)
    }
  }

  const onTransition = () => {
    lastTransitionAt = now()
  }

  const onVisibilityChange = () => {
    if (doc && (doc.hidden || doc.visibilityState === 'hidden')) onTransition()
  }

  const onPlaybackActive = () => {
    explicitPause = false
    wasPlaying = true
    clearRetry()
  }

  const onPause = () => {
    if (destroyed || explicitPause || video.ended || !wasPlaying) {
      explicitPause = false
      wasPlaying = false
      clearRetry()
      return
    }
    if (lastTransitionAt === null || now() - lastTransitionAt > windowMs) {
      wasPlaying = false
      clearRetry()
      return
    }
    attemptPlay()
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (destroyed || explicitPause || video.ended || !video.paused) return
      attemptPlay()
    }, retryMs)
  }

  for (const event of VIDEO_TRANSITION_EVENTS) video.addEventListener(event, onTransition)
  video.addEventListener('play', onPlaybackActive)
  video.addEventListener('playing', onPlaybackActive)
  video.addEventListener('pause', onPause)
  doc?.addEventListener('visibilitychange', onVisibilityChange)

  return {
    markExplicitPause () {
      explicitPause = true
      wasPlaying = false
      clearRetry()
    },
    destroy () {
      if (destroyed) return
      destroyed = true
      clearRetry()
      for (const event of VIDEO_TRANSITION_EVENTS) video.removeEventListener(event, onTransition)
      video.removeEventListener('play', onPlaybackActive)
      video.removeEventListener('playing', onPlaybackActive)
      video.removeEventListener('pause', onPause)
      doc?.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
