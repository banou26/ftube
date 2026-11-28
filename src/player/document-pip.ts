type DocumentPipApi = {
  requestWindow: (options?: { width?: number, height?: number }) => Promise<Window>
}

type WindowWithDocumentPip = Window & {
  documentPictureInPicture?: DocumentPipApi
  MutationObserver?: typeof MutationObserver
}

export type DocumentPipHandle = {
  window: Window
  close: () => void
  syncStyles: () => void
}

const DEFAULT_PIP_WIDTH = 320
const DEFAULT_PIP_HEIGHT = 568

const BASE_CSS = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000000;
}
.pip-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000000;
}
.pip-stage .player-host {
  width: 100%;
  height: 100%;
}
.pip-stage [data-player-root] {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  overflow: visible;
}
.pip-stage .bar {
  display: none;
}
.pip-stage div:has(> .scrubber) {
  padding: 0;
  opacity: 1;
  pointer-events: auto;
}
.pip-stage .scrubber {
  padding-bottom: 0;
}
.pip-stage .rail {
  height: 0.3rem;
}
.pip-stage .preview-chapter {
  display: none;
}
`

const readStyleSheetText = (style: HTMLStyleElement): { text: string, ruleCount: number } => {
  try {
    const rules = style.sheet?.cssRules
    if (rules && rules.length > 0) {
      let text = ''
      for (let i = 0; i < rules.length; i += 1) {
        text += `${rules[i]!.cssText}\n`
      }
      return { text, ruleCount: rules.length }
    }
  } catch {
    // Cross-origin or detached stylesheets fall back to textContent below.
  }
  const text = style.textContent ?? ''
  return { text, ruleCount: -1 }
}

const syncRootAttributes = (sourceDoc: Document, pipDoc: Document) => {
  const srcRoot = sourceDoc.documentElement
  const dstRoot = pipDoc.documentElement
  if (srcRoot.dataset.theme !== undefined) dstRoot.dataset.theme = srcRoot.dataset.theme
  else delete dstRoot.dataset.theme
  dstRoot.className = srcRoot.className
  dstRoot.style.cssText = srcRoot.style.cssText
}

/** Reports whether the Document Picture-in-Picture API is available on `win`. */
export const isDocumentPipSupported = (
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean => Boolean(win && typeof (win as WindowWithDocumentPip).documentPictureInPicture?.requestWindow === 'function')

/**
 * Opens a Document Picture-in-Picture window, mirrors the page's active styles (including
 * CSSOM-inserted rules), moves `host` into it without remounting the player, and invokes `onClose`
 * when the PiP window closes.
 */
export const openDocumentPipWindow = async ({
  host,
  width = DEFAULT_PIP_WIDTH,
  height = DEFAULT_PIP_HEIGHT,
  title = 'FTube Shorts',
  onClose,
  onKeyDown,
  sourceWindow = window,
}: {
  host: HTMLElement
  width?: number
  height?: number
  title?: string
  onClose: () => void
  onKeyDown?: (event: KeyboardEvent) => void
  sourceWindow?: Window
}): Promise<DocumentPipHandle | undefined> => {
  const api = (sourceWindow as WindowWithDocumentPip).documentPictureInPicture
  if (!api || typeof api.requestWindow !== 'function') return undefined

  const pipWin = await api.requestWindow({ width, height })
  const sourceDoc = sourceWindow.document
  const pipDoc = pipWin.document
  pipDoc.title = title

  const baseStyle = pipDoc.createElement('style')
  baseStyle.dataset.ftubePipBase = 'true'
  baseStyle.textContent = BASE_CSS
  pipDoc.head.append(baseStyle)

  const linkMirrors = new WeakMap<HTMLLinkElement, HTMLLinkElement>()
  const styleMirrors = new WeakMap<HTMLStyleElement, { mirror: HTMLStyleElement, ruleCount: number, text: string }>()

  const syncStyles = () => {
    syncRootAttributes(sourceDoc, pipDoc)

    for (const node of sourceDoc.head.children) {
      if (node.tagName === 'LINK') {
        const link = node as HTMLLinkElement
        if (link.rel !== 'stylesheet') continue
        const href = link.href || link.getAttribute('href') || ''
        let mirror = linkMirrors.get(link)
        if (!mirror) {
          mirror = pipDoc.createElement('link')
          mirror.rel = 'stylesheet'
          if (link.media) mirror.media = link.media
          if (href) mirror.href = href
          pipDoc.head.append(mirror)
          linkMirrors.set(link, mirror)
        } else if (href && mirror.getAttribute('href') !== href) {
          mirror.href = href
        }
      } else if (node.tagName === 'STYLE') {
        const style = node as HTMLStyleElement
        const existing = styleMirrors.get(style)
        if (existing && existing.ruleCount > 0) {
          try {
            if (style.sheet?.cssRules?.length === existing.ruleCount) continue
          } catch {
            // Ignore cross-origin sheets.
          }
        }
        const snapshot = readStyleSheetText(style)
        if (!existing) {
          const mirror = pipDoc.createElement('style')
          if (style.dataset.emotion) mirror.dataset.emotion = style.dataset.emotion
          mirror.textContent = snapshot.text
          pipDoc.head.append(mirror)
          styleMirrors.set(style, { mirror, ruleCount: snapshot.ruleCount, text: snapshot.text })
        } else if (existing.ruleCount !== snapshot.ruleCount || existing.text !== snapshot.text) {
          existing.mirror.textContent = snapshot.text
          existing.ruleCount = snapshot.ruleCount
          existing.text = snapshot.text
        }
      }
    }
  }

  syncStyles()

  const stage = pipDoc.createElement('div')
  stage.className = 'pip-stage'
  pipDoc.body.append(stage)
  stage.append(host)

  let pendingSync = false
  const scheduleSync = () => {
    if (closed || pendingSync) return
    pendingSync = true
    queueMicrotask(() => {
      pendingSync = false
      if (!closed) syncStyles()
    })
  }

  let closed = false
  let headObserver: MutationObserver | undefined
  let rootObserver: MutationObserver | undefined
  let stageObserver: MutationObserver | undefined

  const Observer = (sourceWindow as WindowWithDocumentPip).MutationObserver
  if (typeof Observer === 'function') {
    const nextHeadObserver = new Observer(scheduleSync)
    nextHeadObserver.observe(sourceDoc.head, { childList: true, subtree: true, characterData: true })
    headObserver = nextHeadObserver

    const nextRootObserver = new Observer(() => {
      if (!closed) syncRootAttributes(sourceDoc, pipDoc)
    })
    nextRootObserver.observe(sourceDoc.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    })
    rootObserver = nextRootObserver

    const nextStageObserver = new Observer(scheduleSync)
    nextStageObserver.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    stageObserver = nextStageObserver
  }

  // Production Emotion inserts rules via CSSStyleSheet.insertRule without mutating DOM nodes.
  const rulePoll = sourceWindow.setInterval(() => {
    if (!closed) syncStyles()
  }, 250)

  const handleKeyDown = (event: KeyboardEvent) => {
    onKeyDown?.(event)
  }
  if (onKeyDown) pipWin.addEventListener('keydown', handleKeyDown)

  const cleanup = () => {
    if (closed) return
    closed = true
    headObserver?.disconnect()
    rootObserver?.disconnect()
    stageObserver?.disconnect()
    sourceWindow.clearInterval(rulePoll)
    pipWin.removeEventListener('pagehide', onPipPageHide)
    sourceWindow.removeEventListener('pagehide', close)
    if (onKeyDown) pipWin.removeEventListener('keydown', handleKeyDown)
    onClose()
  }

  const onPipPageHide = () => cleanup()
  const close = () => {
    cleanup()
    try {
      if (!pipWin.closed) pipWin.close()
    } catch {
      // Ignore windows already torn down by the host browser.
    }
  }

  pipWin.addEventListener('pagehide', onPipPageHide)
  sourceWindow.addEventListener('pagehide', close)

  return { window: pipWin, close, syncStyles }
}
