const MODAL_ID = 'yt-sign-in-modal'
const STYLE_ID = 'yt-sign-in-modal-style'

const STYLE_CSS = `
#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog, 2300);
  display: grid;
  place-items: center;
  padding: 2.4rem;
}

#${MODAL_ID} .yt-signin-scrim {
  position: absolute;
  inset: 0;
  background: var(--bg-scrim, rgba(0, 0, 0, 0.5));
}

#${MODAL_ID} .yt-signin-panel {
  position: relative;
  width: 100%;
  max-width: 56rem;
  height: min(90dvh, 76rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border, #303030);
  border-radius: 1.2rem;
  background: var(--bg-menu, #282828);
  box-shadow: var(--shadow-menu, 0 0.4rem 3.2rem rgba(0, 0, 0, 0.4));
}

#${MODAL_ID} .yt-signin-head {
  display: flex;
  align-items: center;
  gap: 1.6rem;
  padding: 1.2rem 1.2rem 1.2rem 2rem;
  border-bottom: 1px solid var(--border, #303030);
}

#${MODAL_ID} .yt-signin-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1.8rem;
  font-weight: 500;
  color: var(--text-primary, #f1f1f1);
}

#${MODAL_ID} .yt-signin-close {
  flex: none;
  width: 3.6rem;
  height: 3.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-primary, #f1f1f1);
  cursor: pointer;
  transition: background 0.15s ease;
}

#${MODAL_ID} .yt-signin-close:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.1));
}

#${MODAL_ID} .yt-signin-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
  background: var(--bg-base, #0f0f0f);
}

@media (max-width: 720px) {
  #${MODAL_ID} {
    padding: 0;
  }

  #${MODAL_ID} .yt-signin-panel {
    max-width: none;
    width: 100%;
    height: 100dvh;
    border: none;
    border-radius: 0;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
}
`

const CLOSE_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

export type SignInModal = {
  iframe: HTMLIFrameElement
  closed: Promise<void>
  close: () => void
}

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_CSS
  ;(document.head ?? document.documentElement ?? document.body).appendChild(style)
}

/**
 * Mounts an in-app modal dialog containing a connected iframe for inline FKN sign-in.
 * Used in standalone PWA environments where `window.open` isolates the popup jar.
 */
export const mountSignInModal = (): SignInModal => {
  document.getElementById(MODAL_ID)?.remove()
  ensureStyle()

  const previousFocus = document.activeElement as HTMLElement | null
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  const overlay = document.createElement('div')
  overlay.id = MODAL_ID

  const scrim = document.createElement('div')
  scrim.className = 'yt-signin-scrim'

  const panel = document.createElement('div')
  panel.className = 'yt-signin-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', 'Sign in to YouTube')
  panel.tabIndex = -1

  const head = document.createElement('div')
  head.className = 'yt-signin-head'

  const heading = document.createElement('h2')
  heading.className = 'yt-signin-title'
  heading.textContent = 'Sign in to YouTube'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'yt-signin-close'
  closeButton.setAttribute('aria-label', 'Close')
  closeButton.innerHTML = CLOSE_SVG

  const iframe = document.createElement('iframe')
  iframe.className = 'yt-signin-frame'
  iframe.title = 'Sign in to YouTube'

  head.append(heading, closeButton)
  panel.append(head, iframe)
  overlay.append(scrim, panel)
  document.body.appendChild(overlay)
  closeButton.focus?.()

  let done = false
  let resolveClosed = () => {}
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    close()
  }

  const close = () => {
    if (done) return
    done = true
    document.removeEventListener('keydown', onKeyDown)
    document.body.style.overflow = previousOverflow
    overlay.remove()
    previousFocus?.focus?.()
    resolveClosed()
  }

  scrim.addEventListener('click', close)
  closeButton.addEventListener('click', close)
  document.addEventListener('keydown', onKeyDown)

  return { iframe, closed, close }
}
