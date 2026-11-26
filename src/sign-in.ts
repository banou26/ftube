import type { WindowFrame } from '@fkn/lib'

import { showToast } from './components/ui/toast'
import { mountHiddenFrame, stopAgentHost } from './engine/agent-host'
import { resetEngine, startEngine } from './engine/client'
import { loadedLib, startPlatform } from './engine/platform'
import { clearSignedIn, markSignedIn, readChannel, storeChannel } from './engine/signed-in'

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
const AVATAR = '#avatar-btn, button.topbar-menu-button-avatar-button, ytm-mobile-topbar-renderer img.profile-icon-img'
const POLL_MS = 1_000
// a read across a redirect can wait on the lib's own retry for tens of seconds, so each one is bounded
const READ_TIMEOUT_MS = 5_000
const REFUSALS = new Set(['ExtensionOperationUnsupportedError', 'FrameWindowRefusedError'])

// every tab's engine reads the session and the channel once at boot, so a sign-in, a sign-out or a switch in any tab reloads them all
const SIGNED_IN_CHANNEL = 'yt-client-signed-in'
const SIGNED_IN = 'signed-in'
const SIGNED_OUT = 'signed-out'
const SWITCHED = 'switched'
const SIGNING_OUT = 'signing-out'

let openWindow: WindowFrame | undefined
let opening = false
let finishing = false

// the /signin page has nothing left for a signed-in person
const landSignedIn = () => {
  if (location.pathname === '/signin') location.assign('/')
  else location.reload()
}

const tabs = new BroadcastChannel(SIGNED_IN_CHANNEL)
tabs.addEventListener('message', (event: MessageEvent) => {
  if (event.data === SIGNING_OUT) {
    resetEngine()
    stopAgentHost()
    return
  }
  if (event.data === SIGNED_OUT || event.data === SWITCHED) {
    location.reload()
    return
  }
  if (event.data !== SIGNED_IN || finishing) return
  finishing = true
  void openWindow?.close()
  landSignedIn()
})

const finishSignIn = async () => {
  if (finishing) return
  finishing = true
  markSignedIn()
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
const present = async (login: WindowFrame, selector: string) => await login.locator(selector).count() > 0

const signedInThere = (login: WindowFrame) => present(login, AVATAR)

const showsSignInLink = (login: WindowFrame) => present(login, SIGN_IN_LINK)

// a timer, so the call settles before the click takes the page away; the person can still click it themselves
const clickInWindow = (login: WindowFrame, selector: string) => {
  void login.evaluate((target) => { setTimeout(() => document.querySelector<HTMLElement>(target)?.click(), 0) }, selector).catch(() => {})
}

const isTerminal = (error: unknown) => loadedLib()?.isTerminalError(error) ?? false

const outcomeOf = (error: unknown): SignInOutcome => {
  const name = (error as Error | null)?.name
  if (name === 'FrameWindowBlockedError') return 'blocked'
  if (name && REFUSALS.has(name)) return 'unsupported'
  // the lib's terminal detach error: the window closed or went away before it connected
  if (isTerminal(error)) return 'closed'
  throw error
}

const waitInWindow = async (attaching: Promise<WindowFrame>): Promise<SignInOutcome> => {
  let login: WindowFrame
  try {
    login = await attaching
  } catch (error) {
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
      await login.close()
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

/**
 * Opens youtube.com in FKN's window on the jar every fkn.app app shares ('persistent'), clicks its Sign in link, and
 * resolves once youtube.com shows the account there, or the window ended. Asks for the Evaluation grant up front,
 * which the FKN page that later reads the session needs too. Call it directly in the click handler, with the lib the
 * platform loaded: an await before it would open the window without the click's activation.
 */
export const openSignInWindow = (lib: Pick<typeof import('@fkn/lib'), 'attachFrame'>): Promise<SignInOutcome> => {
  // first statement on purpose
  const attaching = lib.attachFrame({
    window: {},
    domains: SIGN_IN_DOMAINS,
    cookies: 'persistent',
    permissions: [{ category: 'evaluation', reason: 'Use your YouTube account in FTube' }],
  })
  return waitInWindow(attaching).finally(() => { openWindow = undefined })
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
