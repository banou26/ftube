import type { Frame, WindowFrame } from '@fkn/lib'

import { showToast } from './components/ui/toast'
import { mountHiddenFrame, stopAgentHost } from './engine/agent-host'
import { resetEngine, startEngine } from './engine/client'
import { loadedLib, startPlatform } from './engine/platform'
import { clearSignedIn, markSignedIn, readChannel, readSignedIn, storeChannel } from './engine/signed-in'
import { mountSignInModal } from './sign-in-modal'
import { clearDismissedNotifications } from './notifications/dismissed'
import { clearSeenSubscriptions } from './subscriptions/seen'
import { clearUndo, setUndoAccountScope } from './undo'

setUndoAccountScope(() => (
  typeof localStorage === 'undefined'
    ? 'ssr'
    : `${readSignedIn() ? 'in' : 'out'}:${readChannel() ?? ''}`
))

/**
 * How a sign-in through FKN's window ended: `'authed'` once youtube.com showed its avatar there, the window closed
 * and its cookies committed to FKN's jar; `'closed'` when the window ended first; `'blocked'` when the browser opened
 * no window; `'unsupported'` when FKN refused a window.
 */
export type SignInOutcome = 'authed' | 'closed' | 'blocked' | 'unsupported'

// youtube.com first, where a click on its own Sign in link carries the hop to Google: a direct ServiceLogin entry
// does not get past the identifier (projects/mirage-google-login.md); ?app=desktop avoids m.youtube.com redirects
// on mobile UAs without setting a persistent desktop preference cookie, while m.youtube.com stays allowed as fallback
const SIGN_IN_URL = 'https://www.youtube.com/?app=desktop'
const SIGN_IN_DOMAINS = ['www.youtube.com', 'm.youtube.com']
const SIGN_IN_LINK = 'a[href*="ServiceLogin"]'
const MOBILE_YOU_TAB = '[role="tab"].pivot-you'
// youtube.com's signed-in header; a SAPISID left in the jar by an ended session would read as signed in
const AVATAR = '#avatar-btn, button.topbar-menu-button-avatar-button'
const POLL_MS = 1_000
// a read across a redirect can wait on the lib's own retry for tens of seconds, so each one is bounded
const READ_TIMEOUT_MS = 5_000
// Inline attachFrame shares the persistent jar without WindowFrame's close flush, so pause briefly after authed
// navigation for Mirage's scheduled IndexedDB cookie commit before removing the iframe.
const INLINE_COOKIE_COMMIT_MS = 250
const MODAL_ABORTED = Symbol('modal-aborted')
const REFUSALS = new Set(['ExtensionOperationUnsupportedError', 'FrameWindowRefusedError'])

// every tab's engine reads the session and the channel once at boot, so a sign-in, a sign-out or a switch in any tab reloads them all
const SIGNED_IN_CHANNEL = 'yt-client-signed-in'
const SIGNED_IN = 'signed-in'
const SIGNED_OUT = 'signed-out'
const SWITCHED = 'switched'
const SIGNING_OUT = 'signing-out'

type AttachLib = Pick<typeof import('@fkn/lib'), 'attachFrame'>
type SignInSession = Pick<WindowFrame, 'goto' | 'locator' | 'evaluate' | 'closed'> & {
  close(commitCookies?: boolean): Promise<void>
}

let openWindow: Pick<SignInSession, 'close'> | undefined
let opening = false
let finishing = false

/** Returns whether FTube is running inside an installed standalone home-screen WebApp. */
export const isStandalonePwa = (): boolean =>
  (typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true)
  || (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(display-mode: standalone)').matches === true)

const hasDomHost = () => typeof document !== 'undefined' && Boolean(document.body)

const isJarUnreachable = (error: unknown) => {
  const err = error as { name?: unknown, reason?: unknown } | null
  return err?.name === 'FrameWindowRefusedError' && err.reason === 'jar-unreachable'
}

// the /signin page has nothing left for a signed-in person
const landSignedIn = () => {
  if (location.pathname === '/signin') location.assign('/')
  else location.reload()
}

const tabs = new BroadcastChannel(SIGNED_IN_CHANNEL)
tabs.addEventListener('message', (event: MessageEvent) => {
  if (event.data === SIGNING_OUT) {
    clearSeenSubscriptions()
    clearDismissedNotifications()
    clearUndo()
    resetEngine()
    stopAgentHost()
    return
  }
  if (event.data === SIGNED_OUT || event.data === SWITCHED) {
    clearSeenSubscriptions()
    clearDismissedNotifications()
    clearUndo()
    location.reload()
    return
  }
  if (event.data !== SIGNED_IN || finishing) return
  finishing = true
  clearUndo()
  void openWindow?.close()
  landSignedIn()
})

const finishSignIn = async () => {
  if (finishing) return
  finishing = true
  markSignedIn()
  clearUndo()
  await startEngine().then((engine) => engine.resetIdentity()).catch(() => {})
  tabs.postMessage(SIGNED_IN)
  landSignedIn()
}

const bounded = <T>(read: () => Promise<T>) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    read().catch(() => undefined),
    new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), READ_TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))
}

// every read is a severity-0 count, which asks no card; a host outside the attachment rejects it, which reads as not yet
const present = async (login: Pick<SignInSession, 'locator'>, selector: string) => await login.locator(selector).count() > 0

const signedInThere = (login: Pick<SignInSession, 'locator'>) => present(login, AVATAR)

const showsSignInLink = (login: Pick<SignInSession, 'locator'>) => present(login, SIGN_IN_LINK)

// a timer, so the call settles before the click takes the page away; the person can still click it themselves
const clickInWindow = (login: Pick<SignInSession, 'evaluate'>, selector: string) => {
  void login.evaluate((target) => { setTimeout(() => document.querySelector<HTMLElement>(target)?.click(), 0) }, selector).catch(() => {})
}

const isTerminal = (error: unknown) => loadedLib()?.isTerminalError(error) ?? false

const outcomeOf = (error: unknown): SignInOutcome => {
  if (error === MODAL_ABORTED) return 'closed'
  const name = (error as Error | null)?.name
  if (name === 'FrameWindowBlockedError') return 'blocked'
  if (name && REFUSALS.has(name)) return 'unsupported'
  // the lib's terminal detach error: the window closed or went away before it connected
  if (isTerminal(error)) return 'closed'
  throw error
}

const waitInSession = async (
  attaching: Promise<SignInSession>,
  onJarUnreachable?: () => Promise<SignInOutcome>,
): Promise<SignInOutcome> => {
  let login: SignInSession
  try {
    login = await attaching
  } catch (error) {
    if (onJarUnreachable && isJarUnreachable(error)) return onJarUnreachable()
    return outcomeOf(error)
  }
  openWindow = login
  try {
    // at 'commit': youtube.com's home page holds its load past the 30 s deadline (stub, measured 2026-09-27)
    await login.goto(SIGN_IN_URL, { waitUntil: 'commit' })
  } catch (error) {
    if (!isTerminal(error)) {
      await login.close()
      throw error
    }
  }
  const closed = login.closed.then(() => 'closed' as const)
  let clicked = false
  let openedYouTab = false
  for (;;) {
    const tick = await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(resolve, POLL_MS)).then(() => bounded(() => signedInThere(login))),
    ])
    if (tick === 'closed') return 'closed'
    if (tick === true) {
      await login.close(true)
      return 'authed'
    }
    if (!clicked && await bounded(() => showsSignInLink(login))) {
      clicked = true
      clickInWindow(login, SIGN_IN_LINK)
    } else if (!clicked && !openedYouTab && await bounded(() => present(login, MOBILE_YOU_TAB))) {
      openedYouTab = true
      clickInWindow(login, MOBILE_YOU_TAB)
    }
  }
}

const openInlineSignIn = (lib: AttachLib): Promise<SignInOutcome> => {
  const modal = mountSignInModal()
  let settled = false
  let attached: Frame | undefined
  const waitClosed = modal.closed.then(() => 'closed' as const)
  const attaching = lib.attachFrame({
    iframe: modal.iframe,
    domains: SIGN_IN_DOMAINS,
    cookies: 'persistent',
    permissions: [{ category: 'evaluation', reason: 'Use your YouTube account in FTube' }],
  }).then((frame) => {
    attached = frame
    return frame
  })
  void attaching.catch(() => {})
  const session = Promise.race([attaching, waitClosed]).then((value): SignInSession => {
    if (value === 'closed') throw MODAL_ABORTED
    return {
      goto: value.goto.bind(value),
      locator: value.locator.bind(value),
      evaluate: value.evaluate.bind(value),
      closed: modal.closed,
      close: async (commitCookies = false) => {
        if (settled) return
        settled = true
        if (commitCookies && attached) await new Promise((resolve) => setTimeout(resolve, INLINE_COOKIE_COMMIT_MS))
        modal.close()
      },
    }
  })
  return waitInSession(session).finally(() => {
    settled = true
    openWindow = undefined
    modal.close()
  })
}

/**
 * Opens youtube.com on the jar every fkn.app app shares ('persistent'), clicks its Sign in link, and
 * resolves once youtube.com shows the account there, the popup/modal ended, or FKN refused a window. Uses an
 * inline modal iframe directly when running as a standalone PWA (or on `jar-unreachable`) so iOS Home Screen
 * apps keep the app's persistent cookie partition. Call directly in the click handler without an await first so
 * non-standalone browsers preserve popup activation.
 */
export const openSignInWindow = (lib: AttachLib): Promise<SignInOutcome> => {
  if (isStandalonePwa() && hasDomHost()) return openInlineSignIn(lib)
  // first statement on purpose
  const attaching = lib.attachFrame({
    window: {},
    domains: SIGN_IN_DOMAINS,
    cookies: 'persistent',
    permissions: [{ category: 'evaluation', reason: 'Use your YouTube account in FTube' }],
  })
  return waitInSession(attaching, hasDomHost() ? () => openInlineSignIn(lib) : undefined)
    .finally(() => { openWindow = undefined })
}

/** What every Sign in control calls on its click. While a window is open, a click does nothing more. */
export const signIn = () => {
  if (finishing || opening) return
  const lib = loadedLib()
  if (!lib) {
    void startPlatform().then(
      () => showToast('Sign-in is ready.', { label: 'Sign in', onAction: signIn }),
      () => showToast('Sign-in could not start.', { label: 'Try again', onAction: signIn }),
    )
    return
  }
  opening = true
  void openSignInWindow(lib).then(
    (outcome) => {
      opening = false
      if (outcome === 'blocked') showToast('The browser blocked the sign-in window. Allow pop-ups for this site.', { label: 'Try again', onAction: signIn })
      else if (outcome === 'unsupported') showToast('Sign-in could not open.', { label: 'Try again', onAction: signIn })
      else if (outcome === 'authed') void finishSignIn()
    },
    (error: unknown) => {
      opening = false
      console.warn('[yt-client] sign-in failed:', error instanceof Error ? error.message : String(error))
      showToast('Sign-in could not open.', { label: 'Try again', onAction: signIn })
    },
  )
}

/**
 * Makes every tab act as another channel of the signed-in Google account: a brand channel's page ID, or none for the
 * account's own channel. The next engine of each tab sends it (lanes.ts), so every tab loads again.
 */
export const switchChannel = (brandPageId?: string) => {
  storeChannel(brandPageId)
  clearSeenSubscriptions()
  clearDismissedNotifications()
  clearUndo()
  tabs.postMessage(SWITCHED)
  location.assign('/')
}

/**
 * The domains whose sites sign-out clears in FKN's jar: `clearCookies` reaches each one's whole site, so every
 * youtube.com and every google.com cookie.
 */
export const SIGN_OUT_DOMAINS = ['www.youtube.com', 'accounts.google.com']

/**
 * Signs out of YouTube and Google in FKN's jar, the one every fkn.app app shares, so all of them are signed out on this
 * device. The engine is reset and the FKN page detached first, in this tab and every other, so no request in flight sets
 * a cookie again; then the cookies go, and every tab loads again. Google is not told. Rejects when the cookies could not be cleared, with the
 * page still signed in: its next engine attaches the FKN page on the session's jar again.
 */
export const signOut = async () => {
  await startPlatform()
  const lib = loadedLib()!
  await startEngine().then((engine) => engine.resetIdentity()).catch(() => {})
  const channel = readChannel()
  // cleared first, so an engine started meanwhile attaches its page on a jar of its own
  clearSignedIn()
  clearSeenSubscriptions()
  clearDismissedNotifications()
  clearUndo()
  resetEngine()
  stopAgentHost()
  tabs.postMessage(SIGNING_OUT)
  const iframe = mountHiddenFrame()
  try {
    const frame = await lib.attachFrame({ iframe, cookies: 'persistent', domains: SIGN_OUT_DOMAINS })
    await frame.clearCookies()
  } catch (error) {
    markSignedIn()
    storeChannel(channel)
    // an engine or page started while the attach was awaited read the cleared flag and runs signed out
    resetEngine()
    stopAgentHost()
    throw error
  } finally {
    iframe.remove()
  }
  tabs.postMessage(SIGNED_OUT)
  location.assign('/')
}
