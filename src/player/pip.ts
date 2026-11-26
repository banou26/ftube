type WebKitPresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture'

type WebKitPipVideo = HTMLVideoElement & {
  webkitPresentationMode?: WebKitPresentationMode
  webkitSupportsPresentationMode?: (mode: WebKitPresentationMode) => boolean
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void
}

const hasStandardPip = (video: HTMLVideoElement, doc: Document): boolean =>
  doc.pictureInPictureEnabled === true && typeof video.requestPictureInPicture === 'function'

const hasWebKitPip = (video: HTMLVideoElement): video is WebKitPipVideo => {
  const webkit = video as WebKitPipVideo
  return typeof webkit.webkitSetPresentationMode === 'function'
    && webkit.webkitSupportsPresentationMode?.('picture-in-picture') === true
}

/** Reports whether W3C or WebKit Picture-in-Picture is supported for `video`. */
export const isPipSupported = (
  video: HTMLVideoElement | null | undefined,
  doc: Document = document,
): boolean => {
  if (!video || video.disablePictureInPicture) return false
  return hasStandardPip(video, doc) || hasWebKitPip(video)
}

/** Reports whether `video` is currently presented in W3C or WebKit Picture-in-Picture. */
export const isVideoInPip = (
  video: HTMLVideoElement | null | undefined,
  doc: Document = document,
): boolean => {
  if (!video) return false
  if (doc.pictureInPictureElement === video) return true
  return (video as WebKitPipVideo).webkitPresentationMode === 'picture-in-picture'
}

/**
 * Toggles Picture-in-Picture for `video`, keeping WebKit `webkitSetPresentationMode`
 * calls synchronous inside the user gesture for iOS Safari.
 */
export const toggleVideoPip = (
  video: HTMLVideoElement | null | undefined,
  doc: Document = document,
): Promise<void> => {
  if (!video) return Promise.resolve()
  if (doc.pictureInPictureElement) {
    return doc.exitPictureInPicture().catch(() => {})
  }
  const webkit = video as WebKitPipVideo
  if (webkit.webkitPresentationMode === 'picture-in-picture' && typeof webkit.webkitSetPresentationMode === 'function') {
    try {
      webkit.webkitSetPresentationMode('inline')
    } catch {
      // Ignore synchronous Safari InvalidStateError outside active transition.
    }
    return Promise.resolve()
  }
  if (video.disablePictureInPicture) return Promise.resolve()
  if (hasWebKitPip(video)) {
    try {
      webkit.webkitSetPresentationMode?.('picture-in-picture')
      return Promise.resolve()
    } catch {
      // Ignore synchronous Safari InvalidStateError before media metadata is ready.
    }
  }
  if (hasStandardPip(video, doc)) {
    return video.requestPictureInPicture().then(() => undefined, () => {})
  }
  return Promise.resolve()
}

/** Subscribes to W3C and WebKit Picture-in-Picture changes plus metadata readiness for `video`. */
export const subscribeVideoPip = (
  video: HTMLVideoElement,
  onChange: () => void,
): (() => void) => {
  video.addEventListener('enterpictureinpicture', onChange)
  video.addEventListener('leavepictureinpicture', onChange)
  video.addEventListener('webkitpresentationmodechanged', onChange)
  video.addEventListener('loadedmetadata', onChange)
  return () => {
    video.removeEventListener('enterpictureinpicture', onChange)
    video.removeEventListener('leavepictureinpicture', onChange)
    video.removeEventListener('webkitpresentationmodechanged', onChange)
    video.removeEventListener('loadedmetadata', onChange)
  }
}
