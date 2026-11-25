import { exitFullscreen, requestFullscreen } from '@banou/ponyfill/fullscreen'

type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
}

type WebKitElement = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type WebKitVideo = HTMLVideoElement & {
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture'
  webkitDisplayingFullscreen?: boolean
  webkitSupportsPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => boolean
  webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void
  webkitEnterFullscreen?: () => void
  webkitEnterFullScreen?: () => void
}

/** Returns the active element in standard or WebKit-prefixed fullscreen, if any. */
export const getFullscreenElement = (doc: Document = document): Element | null =>
  doc.fullscreenElement ?? (doc as WebKitDocument).webkitFullscreenElement ?? null

/** Reports whether `video` is currently in WebKit native or presentation fullscreen. */
export const isVideoFullscreen = (video: HTMLVideoElement | null | undefined): boolean => {
  if (!video) return false
  const webkit = video as WebKitVideo
  if (webkit.webkitPresentationMode !== undefined) {
    return webkit.webkitPresentationMode === 'fullscreen'
  }
  return webkit.webkitDisplayingFullscreen === true
}

/** Reports whether either an HTML fullscreen element or WebKit video fullscreen is active. */
export const isPlayerFullscreen = (
  video?: HTMLVideoElement | null,
  doc: Document = document,
): boolean => getFullscreenElement(doc) !== null || isVideoFullscreen(video)

const canElementFullscreen = (element: Element | null | undefined, doc: Document): element is Element => {
  if (!element) return false
  const webkitDoc = doc as WebKitDocument
  // On iPhone Safari, document fullscreenEnabled is false while div.requestFullscreen may be absent or reject async,
  // so check synchronously before picking container vs video to keep iOS user activation intact.
  if (!doc.fullscreenEnabled && !webkitDoc.webkitFullscreenEnabled) return false
  const el = element as WebKitElement
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

const canVideoFullscreen = (video: HTMLVideoElement | null | undefined): video is HTMLVideoElement => {
  if (!video) return false
  const el = video as WebKitElement
  const webkit = video as WebKitVideo
  if (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function') return true
  if (typeof webkit.webkitSetPresentationMode === 'function') {
    return webkit.webkitSupportsPresentationMode?.('fullscreen') ?? true
  }
  return typeof webkit.webkitEnterFullscreen === 'function' || typeof webkit.webkitEnterFullScreen === 'function'
}

/**
 * Toggles fullscreen for a player container, falling back synchronously to `<video>`
 * when the browser disallows element fullscreen (such as iPhone Safari).
 */
export const togglePlayerFullscreen = (
  container: Element | null | undefined,
  video: HTMLVideoElement | null | undefined,
  doc: Document = document,
): Promise<void> => {
  if (isPlayerFullscreen(video, doc)) return exitFullscreen(doc)
  if (canElementFullscreen(container, doc)) return requestFullscreen(container)
  if (canVideoFullscreen(video)) return requestFullscreen(video)
  return Promise.resolve()
}

/** Subscribes to standard and WebKit fullscreen state changes on `document` and an optional `<video>`. */
export const subscribeFullscreen = (
  onChange: () => void,
  video?: HTMLVideoElement | null,
  doc: Document = document,
): (() => void) => {
  doc.addEventListener('fullscreenchange', onChange)
  doc.addEventListener('webkitfullscreenchange', onChange)
  if (video) {
    video.addEventListener('webkitbeginfullscreen', onChange)
    video.addEventListener('webkitendfullscreen', onChange)
    video.addEventListener('webkitpresentationmodechanged', onChange)
  }
  return () => {
    doc.removeEventListener('fullscreenchange', onChange)
    doc.removeEventListener('webkitfullscreenchange', onChange)
    if (video) {
      video.removeEventListener('webkitbeginfullscreen', onChange)
      video.removeEventListener('webkitendfullscreen', onChange)
      video.removeEventListener('webkitpresentationmodechanged', onChange)
    }
  }
}
