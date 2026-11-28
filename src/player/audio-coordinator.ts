/** Minimal media element surface needed to coordinate audible playback ownership. */
export type AudioMediaLike = {
  readonly paused: boolean
  readonly ended: boolean
  readonly muted: boolean
  readonly volume: number
  play: () => Promise<void> | void
  pause: () => void
}

type PrimaryPlayer = {
  id: string
  video: AudioMediaLike
  docked: boolean
}

type ActivePreview = {
  token: number
  mute: () => void
}

type RestoreScheduler = (callback: () => void) => () => void

/**
 * Delay before resuming a suspended docked player on preview unmount so
 * direct pointer handoffs across neighboring cards keep the dock quiet.
 */
export const PREVIEW_HANDOFF_MS = 300

const defaultScheduleRestore: RestoreScheduler = (callback) => {
  const timer = setTimeout(callback, PREVIEW_HANDOFF_MS)
  return () => clearTimeout(timer)
}

/** Returns true when a media element is actively playing audible output. */
export const isMediaAudible = (media: Pick<AudioMediaLike, 'paused' | 'ended' | 'muted' | 'volume'>): boolean =>
  !media.paused && !media.ended && !media.muted && media.volume > 0

/**
 * Coordinates audio exclusivity between the primary Watch/Miniplayer video and
 * transient card hover previews so at most one surface plays audibly at once.
 */
export const createAudioCoordinator = (options?: { scheduleRestore?: RestoreScheduler }) => {
  const scheduleRestore = options?.scheduleRestore ?? defaultScheduleRestore
  let primary: PrimaryPlayer | undefined
  let activePreview: ActivePreview | undefined
  let pendingPreviewToken: number | undefined
  let suspendedPrimary: { id: string, video: AudioMediaLike } | undefined
  let cancelRestore: (() => void) | undefined

  const cancelPendingRestore = () => {
    if (!cancelRestore) return
    cancelRestore()
    cancelRestore = undefined
  }

  const resumeSuspendedIfSame = (target: PrimaryPlayer) => {
    if (!suspendedPrimary || suspendedPrimary.video !== target.video || suspendedPrimary.id !== target.id) return
    suspendedPrimary = undefined
    if (target.video.paused && !target.video.ended) {
      void Promise.resolve(target.video.play()).catch(() => {})
    }
  }

  const muteActivePreview = () => {
    if (!activePreview) return
    const preview = activePreview
    activePreview = undefined
    preview.mute()
  }

  const registerPrimaryPlayer = (next: PrimaryPlayer): (() => void) => {
    cancelPendingRestore()
    if (suspendedPrimary && (suspendedPrimary.video !== next.video || suspendedPrimary.id !== next.id)) {
      suspendedPrimary = undefined
    }
    primary = { ...next }
    if (!primary.docked) {
      pendingPreviewToken = undefined
      muteActivePreview()
      resumeSuspendedIfSame(primary)
    }
    return () => {
      if (primary?.video !== next.video) return
      cancelPendingRestore()
      if (suspendedPrimary?.video === next.video) suspendedPrimary = undefined
      primary = undefined
    }
  }

  const setPrimaryDocked = (video: AudioMediaLike, docked: boolean) => {
    if (!primary || primary.video !== video) return
    primary.docked = docked
    if (docked) return
    cancelPendingRestore()
    pendingPreviewToken = undefined
    muteActivePreview()
    resumeSuspendedIfSame(primary)
  }

  const notifyPrimaryAudible = (video: AudioMediaLike) => {
    if (!primary || primary.video !== video) return
    if (isMediaAudible(video)) {
      cancelPendingRestore()
      pendingPreviewToken = undefined
      if (suspendedPrimary?.video === video) suspendedPrimary = undefined
      muteActivePreview()
      return
    }
    if ((video.muted || video.volume === 0) && suspendedPrimary?.video === video) {
      cancelPendingRestore()
      suspendedPrimary = undefined
    }
  }

  const reservePreviewAudio = (token: number) => {
    cancelPendingRestore()
    pendingPreviewToken = token
  }

  const claimPreviewAudio = (token: number, mute: () => void) => {
    cancelPendingRestore()
    if (pendingPreviewToken !== undefined && pendingPreviewToken <= token) {
      pendingPreviewToken = undefined
    }
    if (activePreview && activePreview.token !== token) {
      activePreview.mute()
    }
    activePreview = { token, mute }
    if (primary && isMediaAudible(primary.video)) {
      suspendedPrimary = { id: primary.id, video: primary.video }
      primary.video.pause()
    }
  }

  const releasePreviewAudio = (token: number) => {
    let released = false
    if (activePreview?.token === token) {
      activePreview = undefined
      released = true
    }
    if (pendingPreviewToken === token) {
      pendingPreviewToken = undefined
      released = true
    }
    if (!released) return
    if (activePreview || pendingPreviewToken !== undefined) return
    if (!suspendedPrimary || !primary) return
    if (suspendedPrimary.video !== primary.video || suspendedPrimary.id !== primary.id) return
    const target = suspendedPrimary
    cancelPendingRestore()
    cancelRestore = scheduleRestore(() => {
      cancelRestore = undefined
      if (activePreview || pendingPreviewToken !== undefined) return
      if (!suspendedPrimary || suspendedPrimary.video !== target.video || suspendedPrimary.id !== target.id) return
      if (!primary || primary.video !== target.video || primary.id !== target.id) return
      suspendedPrimary = undefined
      if (target.video.paused && !target.video.ended) {
        void Promise.resolve(target.video.play()).catch(() => {})
      }
    })
  }

  const reset = () => {
    cancelPendingRestore()
    primary = undefined
    activePreview = undefined
    pendingPreviewToken = undefined
    suspendedPrimary = undefined
  }

  return {
    registerPrimaryPlayer,
    setPrimaryDocked,
    notifyPrimaryAudible,
    reservePreviewAudio,
    claimPreviewAudio,
    releasePreviewAudio,
    reset,
  }
}

const defaultCoordinator = createAudioCoordinator()

export const registerPrimaryPlayer = (next: PrimaryPlayer) => defaultCoordinator.registerPrimaryPlayer(next)
export const setPrimaryDocked = (video: AudioMediaLike, docked: boolean) => defaultCoordinator.setPrimaryDocked(video, docked)
export const notifyPrimaryAudible = (video: AudioMediaLike) => defaultCoordinator.notifyPrimaryAudible(video)
export const reservePreviewAudio = (token: number) => defaultCoordinator.reservePreviewAudio(token)
export const claimPreviewAudio = (token: number, mute: () => void) => defaultCoordinator.claimPreviewAudio(token, mute)
export const releasePreviewAudio = (token: number) => defaultCoordinator.releasePreviewAudio(token)
export const resetAudioCoordinator = () => defaultCoordinator.reset()
