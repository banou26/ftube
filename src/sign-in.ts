import type { AttachFrameOptions, Frame, WindowFrame } from '@fkn/lib'
import type { AuthAdapter, AuthOutcome, AuthStepContext, ClientSource, FknClient } from '@banou/fkn-3p-auth'

import { createSessionSync, openAuthWindow, signOutFromCloud } from '@banou/fkn-3p-auth'
import { youtubeAuthAdapter } from '@banou/fkn-3p-auth/google'

import { showToast } from './components/ui/toast'
import { mountHiddenFrame, stopAgentHost } from './engine/agent-host'
import { resetEngine, startEngine } from './engine/client'
import { loadedLib, startPlatform } from './engine/platform'
import { clearSignedIn, markSignedIn, readChannel, readSignedIn, storeChannel } from './engine/signed-in'
import { clearDismissedNotifications } from './notifications/dismissed'
import { mountSignInModal } from './sign-in-modal'
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
const SIGN_IN_DOMAINS = ['www.youtube.com', 'm.youtube.com', 'accounts.google.com']
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'm.youtube.com'])
const MOBILE_YOUTUBE_HOST = 'm.youtube.com'
const SIGN_IN_LINK = 'a[href*="ServiceLogin"]'
const MOBILE_YOU_TAB = '[role="tab"].pivot-you'
// youtube.com's signed-in header; a SAPISID left in the jar by an ended session would read as signed in
const AVATAR = '#avatar-btn, button.topbar-menu-button-avatar-button'
const SIGN_IN_INTERACTION_REASON = 'Use your YouTube account in FTube'
const IS_VISIBLE_TIMEOUT_MS = 250
// Inline attachFrame shares the persistent jar without WindowFrame's close flush, so pause briefly after authed
// navigation for Mirage's scheduled IndexedDB cookie commit before removing the iframe.
const INLINE_COOKIE_COMMIT_MS = 250
const MODAL_ABORTED = Symbol('modal-aborted')

// every tab's engine reads the session and the channel once at boot, so a sign-in, a sign-out or a switch in any tab reloads them all
const SIGNED_IN_CHANNEL = 'yt-client-signed-in'
const SIGNED_IN = 'signed-in'
const SIGNED_OUT = 'signed-out'
const SWITCHED = 'switched'
const SIGNING_OUT = 'signing-out'

type TabMessage = typeof SIGNED_IN | typeof SIGNED_OUT | typeof SWITCHED | typeof SIGNING_OUT

let opening = false
let finishing = false

/** Returns whether FTube is running inside an installed standalone home-screen WebApp. */
export const isStandalonePwa = (): boolean =>
  (typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true)
  || (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(display-mode: standalone)').matches === true)

const hasDomHost = () => typeof document !== 'undefined' && Boolean(document.body)

// the /signin page has nothing left for a signed-in person
const landSignedIn = () => {
  if (location.pathname === '/signin') location.assign('/')
  else location.reload()
}

const sessionSync = createSessionSync<TabMessage>({
  channelName: SIGNED_IN_CHANNEL,
  closeOnMessage: (message) => message === SIGNED_IN && !finishing,
  onMessage: (message) => {
    if (message === SIGNING_OUT) {
      clearSeenSubscriptions()
      clearDismissedNotifications()
      clearUndo()
      resetEngine()
      stopAgentHost()
      return
    }
    if (message === SIGNED_OUT || message === SWITCHED) {
      clearSeenSubscriptions()
      clearDismissedNotifications()
      clearUndo()
      location.reload()
      return
    }
    if (message !== SIGNED_IN || finishing) return
    finishing = true
    clearUndo()
    landSignedIn()
  },
})

const finishSignIn = async () => {
  if (finishing) return
  finishing = true
  markSignedIn()
  clearUndo()
  await startEngine().then((engine) => engine.resetIdentity()).catch(() => {})
  sessionSync.post(SIGNED_IN)
  landSignedIn()
}

const originHost = (origin: string): string | undefined => {
  if (!origin) return ''
  try {
    return new URL(origin).hostname
  } catch {
    return undefined
  }
}

const isYouTubeOrigin = (origin: string): boolean => {
  const host = originHost(origin)
  return host === '' || (host !== undefined && YOUTUBE_HOSTS.has(host))
}

const isLocatorVisible = async (frame: Pick<WindowFrame, 'locator'>, selector: string): Promise<boolean> => {
  const locator = frame.locator(selector)
  if (await locator.count() === 0) return false
  try {
    return await locator.first().isVisible({ timeout: IS_VISIBLE_TIMEOUT_MS })
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return false
    throw error
  }
}

const isAssistDenied = (clientSource: ClientSource, error: unknown): boolean => {
  if (resolveClient(clientSource)?.isPermissionDenied?.(error)) return true
  const fullLib = loadedLib()
  if (fullLib?.isPermissionDenied?.(error) || fullLib?.isLocatorDenied?.(error)) return true
  const name = (error as { name?: unknown } | null)?.name
  return name === 'PermissionDeniedError' || name === 'LocatorDeniedError'
}

const isLocatorUnsupported = (clientSource: ClientSource, error: unknown): boolean =>
  resolveClient(clientSource)?.isLocatorUnsupported?.(error)
  || loadedLib()?.isLocatorUnsupported?.(error)
  || (error as { name?: unknown } | null)?.name === 'LocatorUnsupportedError'

// Cover 5 one-second polls (isSignedIn + onTick) for frame/document mount; fail after that if locator stays unsupported.
const MAX_TRANSIENT_LOCATOR_UNSUPPORTED = 10

const createYouTubeSignInAdapter = (clientSource: ClientSource): AuthAdapter<void> => {
  const base = youtubeAuthAdapter({
    entryUrl: SIGN_IN_URL,
    domains: SIGN_IN_DOMAINS,
    signedInSelector: AVATAR,
    cookies: 'persistent',
    interactionReason: SIGN_IN_INTERACTION_REASON,
  })
  const baseOnTick = base.onTick
  let assistDisabled = false
  let consecutiveLocatorUnsupported = 0

  const tolerateLocatorUnsupported = (error: unknown): boolean => {
    if (!isLocatorUnsupported(clientSource, error)) return false
    consecutiveLocatorUnsupported += 1
    return consecutiveLocatorUnsupported <= MAX_TRANSIENT_LOCATOR_UNSUPPORTED
  }

  return {
    ...base,
    isSignedIn: async (frame, ctx) => {
      try {
        const signedIn = await base.isSignedIn(frame, ctx)
        consecutiveLocatorUnsupported = 0
        return signedIn
      } catch (error) {
        if (tolerateLocatorUnsupported(error)) return false
        throw error
      }
    },
    onTick: async (ctx: AuthStepContext) => {
      if (assistDisabled || ctx.signal.aborted) return
      try {
        await baseOnTick?.(ctx)
        if (ctx.signal.aborted || !isYouTubeOrigin(ctx.origin)) {
          consecutiveLocatorUnsupported = 0
          return
        }
        if (await isLocatorVisible(ctx.frame, SIGN_IN_LINK)) {
          consecutiveLocatorUnsupported = 0
          if (originHost(ctx.origin) === MOBILE_YOUTUBE_HOST) {
            await ctx.once('click-service-login', async () => {
              await ctx.frame.locator(SIGN_IN_LINK).first().click({ reason: SIGN_IN_INTERACTION_REASON })
            })
          }
          return
        }
        if (await isLocatorVisible(ctx.frame, MOBILE_YOU_TAB)) {
          await ctx.once('open-mobile-you-tab', async () => {
            await ctx.frame.locator(MOBILE_YOU_TAB).first().click({ reason: SIGN_IN_INTERACTION_REASON })
          })
        }
        consecutiveLocatorUnsupported = 0
      } catch (error) {
        if (tolerateLocatorUnsupported(error)) return
        if (isAssistDenied(clientSource, error)) {
          assistDisabled = true
          return
        }
        throw error
      }
    },
  }
}

const isTerminal = (error: unknown) => loadedLib()?.isTerminalError?.(error) ?? false

const resolveClient = (source: ClientSource): FknClient | undefined =>
  typeof source === 'function' ? source() : source

const mapOutcome = (outcome: AuthOutcome<void>): SignInOutcome => {
  if (outcome.status === 'authed') return 'authed'
  if (outcome.status === 'closed') return 'closed'
  if (outcome.status === 'blocked') return 'blocked'
  if (outcome.status === 'unsupported' || outcome.status === 'not-ready') return 'unsupported'
  if (outcome.error === MODAL_ABORTED || isTerminal(outcome.error)) return 'closed'
  throw outcome.error
}

const openInlineSignIn = (lib: FknClient): Promise<SignInOutcome> => {
  const modal = mountSignInModal()
  let settled = false
  let shouldCommit = false
  let attached: Frame | undefined
  const waitClosed = modal.closed.then(() => 'closed' as const)

  const closeModal = async () => {
    if (settled) return
    settled = true
    if (shouldCommit && attached) {
      await new Promise((resolve) => setTimeout(resolve, INLINE_COOKIE_COMMIT_MS))
    }
    modal.close()
  }

  const inlineClient: FknClient = {
    isLocatorInvalid: (error) => lib.isLocatorInvalid(error),
    isLocatorUnsupported: (error) => lib.isLocatorUnsupported(error),
    isPermissionDenied: (error) => lib.isPermissionDenied(error),
    attachFrame: ((options: AttachFrameOptions) => {
      const attaching = lib.attachFrame({
        iframe: modal.iframe,
        domains: options.domains,
        cookies: options.cookies,
        ...(options.permissions ? { permissions: options.permissions } : {}),
      }).then((frame) => {
        attached = frame
        return frame
      })
      void attaching.catch(() => {})
      return Promise.race([attaching, waitClosed]).then((value): WindowFrame => {
        if (value === 'closed') throw MODAL_ABORTED
        // `@fkn/lib` builds Frame handles from closure-backed object literals with no private class fields.
        return Object.assign(Object.create(value) as Frame, {
          closed: modal.closed,
          close: closeModal,
        })
      })
    }) as FknClient['attachFrame'],
  }

  const baseAdapter = createYouTubeSignInAdapter(lib)
  const inlineAdapter: AuthAdapter<void> = {
    ...baseAdapter,
    isSignedIn: async (frame, ctx) => {
      const signedIn = await baseAdapter.isSignedIn(frame, ctx)
      if (signedIn) shouldCommit = true
      return signedIn
    },
  }

  return openAuthWindow(inlineAdapter, {
    client: inlineClient,
    cookies: 'persistent',
    onOpen: (frame) => {
      sessionSync.registerWindow(frame)
    },
  })
    .then(mapOutcome)
    .finally(() => {
      settled = true
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
export const openSignInWindow = (clientSource: ClientSource = () => loadedLib()): Promise<SignInOutcome> => {
  if (isStandalonePwa() && hasDomHost()) {
    const lib = resolveClient(clientSource)
    return lib ? openInlineSignIn(lib) : Promise.resolve('unsupported')
  }
  // first statement on purpose so popup activation stays intact
  return openAuthWindow(createYouTubeSignInAdapter(clientSource), {
    client: clientSource,
    cookies: 'persistent',
    onOpen: (frame) => {
      sessionSync.registerWindow(frame)
    },
  }).then((outcome) => {
    if (
      outcome.status === 'unsupported'
      && outcome.reason === 'refused'
      && outcome.refusalReason === 'jar-unreachable'
      && hasDomHost()
    ) {
      const lib = resolveClient(clientSource)
      if (lib) return openInlineSignIn(lib)
    }
    return mapOutcome(outcome)
  })
}

/** What every Sign in control calls on its click. While a window is open, a click does nothing more. */
export const signIn = () => {
  if (finishing || opening) return
  if (!loadedLib()) {
    void startPlatform().then(
      () => showToast('Sign-in is ready.', { label: 'Sign in', onAction: signIn }),
      () => showToast('Sign-in could not start.', { label: 'Try again', onAction: signIn }),
    )
    return
  }
  opening = true
  void openSignInWindow(() => loadedLib()).then(
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
  sessionSync.post(SWITCHED)
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
  sessionSync.post(SIGNING_OUT)
  try {
    await signOutFromCloud({
      client: lib,
      domains: SIGN_OUT_DOMAINS,
      mountHiddenFrame: () => {
        const iframe = mountHiddenFrame()
        return { iframe, remove: () => iframe.remove() }
      },
      throwOnError: true,
    })
  } catch (error) {
    markSignedIn()
    storeChannel(channel)
    // an engine or page started while the attach was awaited read the cleared flag and runs signed out
    resetEngine()
    stopAgentHost()
    throw error
  }
  sessionSync.post(SIGNED_OUT)
  location.assign('/')
}
