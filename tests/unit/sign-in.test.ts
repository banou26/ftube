import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { CHANNEL_KEY, SIGNED_IN_KEY } from '../../src/engine/signed-in'
import scramjetSignInStub from '../../public/__yt_scramjet__/signin.html?raw'
import { BRAND_PAGE_ID } from './fixtures/accounts-list'

const calls: string[] = []
const clickReasons: { selector: string, reason?: string }[] = []
const styleTags: string[] = []
const showToast = vi.fn()
// it records itself only after a real wait, or a reload announced before the reset would still read as after it
const resetIdentity = vi.fn(async () => {
  await new Promise((resolve) => setTimeout(resolve, 5))
  calls.push('reset')
})

type Options = Record<string, unknown>
type DocListener = (event: { origin: string }) => void

const createFakeFrame = () => {
  const page: {
    avatar: boolean
    mobileAvatar: boolean
    link: boolean
    mobileYouTab: boolean
    rejectedMarker: boolean
    rejectedRetry: boolean
    clickError: Error | undefined
  } = {
    avatar: false,
    mobileAvatar: false,
    link: true,
    mobileYouTab: false,
    rejectedMarker: false,
    rejectedRetry: false,
    clickError: undefined,
  }
  const docListeners = new Set<DocListener>()

  const countFor = (selector: string) => {
    if (selector.includes('#avatar-btn')) {
      return page.avatar || (selector.includes('topbar-menu-button-avatar-button') && page.mobileAvatar) ? 1 : 0
    }
    if (selector.includes('pivot-you')) return page.mobileYouTab ? 1 : 0
    if (selector.includes('ServiceLogin')) return page.link ? 1 : 0
    if (selector.includes('accounts/answer/7675428')) return page.rejectedMarker ? 1 : 0
    if (selector.includes('/restart')) return page.rejectedRetry ? 1 : 0
    return 0
  }

  const base = {
    page,
    backend: () => 'cloud' as const,
    goto: vi.fn(async (url: string, options: { waitUntil: string }) => { calls.push(`goto ${url} ${options.waitUntil}`) }),
    on: (event: string, listener: DocListener, options?: { signal?: AbortSignal }) => {
      if (event !== 'document') return
      docListeners.add(listener)
      options?.signal?.addEventListener('abort', () => { docListeners.delete(listener) }, { once: true })
    },
    emitDocument: (origin: string) => {
      for (const listener of docListeners) listener({ origin })
    },
    addStyleTag: vi.fn(async ({ content }: { content: string }) => {
      styleTags.push(content)
      calls.push('style')
    }),
    locator: (selector: string) => {
      const count = async () => countFor(selector)
      const handle = {
        count,
        isVisible: async () => countFor(selector) > 0,
        click: vi.fn(async (options?: { reason?: string }) => {
          clickReasons.push({ selector, reason: options?.reason })
          calls.push(`click ${selector}`)
          if (page.clickError) throw page.clickError
        }),
        first: () => handle,
      }
      return handle
    },
  }
  return base
}

// youtube.com in FKN's window: its header shows the Sign in link until the person signed in, then the avatar
const fakeLogin = () => {
  let end = () => {}
  const base = createFakeFrame()
  return {
    ...base,
    close: vi.fn(async () => {
      calls.push('close')
      end()
    }),
    closed: new Promise<void>((resolve) => { end = resolve }),
    end: () => end(),
  }
}

type Login = ReturnType<typeof fakeLogin>

const blocked = () => Object.assign(new Error('window.open returned null'), { name: 'FrameWindowBlockedError' })
const refused = () => Object.assign(new Error('the window refused to attach'), { name: 'FrameWindowRefusedError' })
const terminal = new Error('cloud.attachFrame: the attached window closed; attach a fresh window')

const lib = vi.hoisted(() => ({
  attachFrame: vi.fn<(options: Record<string, unknown>) => Promise<unknown>>(),
  isLocatorInvalid: () => false,
  isLocatorUnsupported: () => false,
  isPermissionDenied: vi.fn<(error: unknown) => boolean>(() => false),
  isLocatorDenied: vi.fn<(error: unknown) => boolean>(() => false),
  isTerminalError: (error: unknown) => (error as Error).message.includes('attach a fresh window'),
  loaded: true,
}))

vi.mock('../../src/components/ui/toast', () => ({ showToast, dismissToast: vi.fn(), TOAST_DISMISS_MS: 5_000 }))
vi.mock('../../src/engine/client', () => ({ startEngine: async () => ({ resetIdentity }), resetEngine: () => {} }))
vi.mock('../../src/engine/agent-host', () => ({ mountHiddenFrame: () => ({ remove: () => {} }), stopAgentHost: () => {} }))
const startPlatform = vi.fn(async () => ({}))
vi.mock('../../src/engine/platform', () => ({ startPlatform, loadedLib: () => (lib.loaded ? lib : undefined) }))

type Listener = (event: { data: unknown }) => void

// every module instance is a tab: a message reaches every other instance's channel of that name, a task later, as the real one does
const channels = new Set<{ name: string, listeners: Set<Listener> }>()
class FakeBroadcastChannel {
  readonly listeners = new Set<Listener>()
  constructor(readonly name: string) {
    channels.add(this)
  }
  addEventListener(_type: string, listener: Listener) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: string, listener: Listener) {
    this.listeners.delete(listener)
  }
  postMessage(data: unknown) {
    for (const channel of channels) {
      if (channel === this || channel.name !== this.name) continue
      setTimeout(() => { for (const listener of channel.listeners) listener({ data }) })
    }
  }
}

// each click attaches the next of `windows`, and the last one from then on
const install = (...windows: (Login | Error)[]) => {
  const stored: Record<string, string> = {}
  lib.attachFrame.mockImplementation(async () => {
    const next = windows.length > 1 ? windows.shift()! : windows[0]!
    if (next instanceof Error) throw next
    return next
  })
  const reload = vi.fn(() => { calls.push('reload') })
  const assign = vi.fn()
  const location = { origin: 'https://youtube.fkn.app', pathname: '/watch', reload, assign }
  vi.stubGlobal('location', location)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      calls.push(`store ${key}`)
      stored[key] = value
    },
    removeItem: (key: string) => { delete stored[key] },
  })
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  return { reload, assign, location, stored }
}

// the window's poll runs once a second; this moves it on by that much
const poll = async (times = 1) => {
  for (let index = 0; index < times; index++) await vi.advanceTimersByTimeAsync(1_000)
}

describe('the sign-in window', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    calls.length = 0
    clickReasons.length = 0
    styleTags.length = 0
    channels.clear()
    showToast.mockClear()
    resetIdentity.mockClear()
    startPlatform.mockClear()
    lib.attachFrame.mockReset()
    lib.isPermissionDenied.mockReset().mockReturnValue(false)
    lib.isLocatorDenied.mockReset().mockReturnValue(false)
    lib.loaded = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("attaches FKN's window inside the click, before anything is awaited, on the shared jar with Interaction permission only", async () => {
    install(fakeLogin())
    const { signIn } = await import('../../src/sign-in')
    signIn()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
    const [options] = lib.attachFrame.mock.calls[0]! as [Options]
    expect(options).toEqual({
      window: {},
      domains: ['www.youtube.com', 'm.youtube.com', 'accounts.google.com'],
      cookies: 'persistent',
      permissions: [{ category: 'interaction', reason: 'Use your YouTube account in FTube' }],
    })
  })

  it("opens youtube.com at commit, clicks its own Sign in link once, and is done when youtube.com shows the avatar: closed first, then signed in", async () => {
    const login = fakeLogin()
    const { reload, stored } = install(login)
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await poll(3)
    expect(calls).toEqual(['goto https://www.youtube.com/?app=desktop commit', 'click a[href*="ServiceLogin"]'])
    expect(clickReasons).toEqual([{ selector: 'a[href*="ServiceLogin"]', reason: 'Use your YouTube account in FTube' }])
    // Google's pages: nothing there reads as signed in, however long they take
    login.page.link = false
    await poll(5)
    expect(reload).not.toHaveBeenCalled()
    login.page.avatar = true
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(calls.slice(2)).toEqual(['close', `store ${SIGNED_IN_KEY}`, 'reset', 'reload'])
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })

  it('opens the mobile You tab on m.youtube.com, clicks Sign in there once, and finishes on mobile avatar', async () => {
    const login = fakeLogin()
    login.page.link = false
    login.page.mobileYouTab = true
    const { reload, stored } = install(login)
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await Promise.resolve()
    login.emitDocument('https://m.youtube.com')
    await poll(2)
    expect(calls).toEqual(['goto https://www.youtube.com/?app=desktop commit', 'click [role="tab"].pivot-you'])
    // You tab reveals the ServiceLogin link; does not re-click the pivot tab
    login.page.link = true
    await poll(2)
    expect(calls).toEqual([
      'goto https://www.youtube.com/?app=desktop commit',
      'click [role="tab"].pivot-you',
      'click a[href*="ServiceLogin"]',
    ])
    expect(clickReasons).toEqual([
      { selector: '[role="tab"].pivot-you', reason: 'Use your YouTube account in FTube' },
      { selector: 'a[href*="ServiceLogin"]', reason: 'Use your YouTube account in FTube' },
    ])
    login.page.link = false
    login.page.mobileAvatar = true
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })

  it('hides rejected-browser notice on accounts.google.com and clicks Try again', async () => {
    const login = fakeLogin()
    const { reload, stored } = install(login)
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await poll(1)
    login.page.link = false
    login.page.rejectedMarker = true
    login.page.rejectedRetry = true
    login.emitDocument('https://accounts.google.com')
    await poll(1)
    expect(styleTags.length).toBeGreaterThanOrEqual(1)
    expect(styleTags[0]).toContain('accounts/answer/7675428')
    expect(calls).toContain('click a[href*="/restart"]')
    login.page.rejectedMarker = false
    login.page.rejectedRetry = false
    login.page.avatar = true
    login.emitDocument('https://www.youtube.com')
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })

  it('ends at once as signed in for a jar another fkn.app app already signed in, with no click', async () => {
    const login = fakeLogin()
    login.page.avatar = true
    const { reload } = install(login)
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(calls).not.toContain('click a[href*="ServiceLogin"]')
  })

  it("starts a sign-in on the account's own channel, whatever channel an earlier session picked", async () => {
    const login = fakeLogin()
    login.page.avatar = true
    const { reload, stored } = install(login)
    stored[CHANNEL_KEY] = BRAND_PAGE_ID
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
    expect(stored[CHANNEL_KEY]).toBeUndefined()
  })

  it('goes home after a sign-in from /signin, which has nothing for a signed-in person', async () => {
    const login = fakeLogin()
    login.page.avatar = true
    const { reload, assign, location } = install(login)
    location.pathname = '/signin'
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await poll(1)
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing more when the person closes the window', async () => {
    const login = fakeLogin()
    const { reload, stored } = install(login)
    const { openSignInWindow } = await import('../../src/sign-in')
    const outcome = openSignInWindow(lib as unknown as Parameters<typeof openSignInWindow>[0])
    await poll(2)
    login.end()
    await expect(outcome).resolves.toBe('closed')
    expect(reload).not.toHaveBeenCalled()
    expect(resetIdentity).not.toHaveBeenCalled()
    expect(stored[SIGNED_IN_KEY]).toBeUndefined()
  })

  it('reads a window that went away before it connected as closed', async () => {
    install(terminal)
    const { openSignInWindow } = await import('../../src/sign-in')
    await expect(openSignInWindow(lib as unknown as Parameters<typeof openSignInWindow>[0])).resolves.toBe('closed')
  })

  it('answers a blocked window with a toast whose button tries again', async () => {
    install(blocked())
    const { openSignInWindow, signIn } = await import('../../src/sign-in')
    await expect(openSignInWindow(lib as unknown as Parameters<typeof openSignInWindow>[0])).resolves.toBe('blocked')
    signIn()
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce())
    const [message, action] = showToast.mock.calls[0]! as [string, { label: string, onAction: () => void }]
    expect(message).toMatch(/Allow pop-ups/)
    expect(action.label).toBe('Try again')
    action.onAction()
    expect(lib.attachFrame).toHaveBeenCalledTimes(3)
  })

  it('answers a window FKN refused with a toast whose button tries again', async () => {
    install(refused())
    const { signIn } = await import('../../src/sign-in')
    signIn()
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce())
    const [, action] = showToast.mock.calls[0]! as [string, { label: string, onAction: () => void }]
    action.onAction()
    expect(lib.attachFrame).toHaveBeenCalledTimes(2)
  })

  it('before the platform loaded the lib, opens nothing and offers Sign in once it has', async () => {
    install(fakeLogin())
    lib.loaded = false
    const { signIn } = await import('../../src/sign-in')
    signIn()
    expect(lib.attachFrame).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce())
    lib.loaded = true
    const [, action] = showToast.mock.calls[0]! as [string, { label: string, onAction: () => void }]
    action.onAction()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
  })

  it('settles one sign-in however many times Sign in is clicked', async () => {
    const login = fakeLogin()
    login.page.avatar = true
    const { reload } = install(login)
    const { signIn } = await import('../../src/sign-in')
    signIn()
    signIn()
    signIn()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalled())
    expect(resetIdentity).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    // the page is on its way to loading again, so a click now opens nothing
    signIn()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
  })

  it('keeps the sign-in window open when assist click hits PermissionDeniedError and lets manual sign-in succeed', async () => {
    const login = fakeLogin()
    login.page.clickError = Object.assign(new Error('Permission denied'), { name: 'PermissionDeniedError' })
    lib.isPermissionDenied.mockImplementation((err) => (err as { name?: string })?.name === 'PermissionDeniedError')
    const { reload, stored } = install(login)
    const { signIn } = await import('../../src/sign-in')

    signIn()
    await poll(4)
    expect(calls.filter((call) => call === 'click a[href*="ServiceLogin"]')).toHaveLength(1)
    expect(login.close).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()

    login.page.link = false
    login.page.avatar = true
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })

  it('keeps the sign-in window open when assist click hits LocatorDeniedError without retrying', async () => {
    const login = fakeLogin()
    login.page.clickError = Object.assign(new Error('Locator denied'), { name: 'LocatorDeniedError' })
    lib.isLocatorDenied.mockImplementation((err) => (err as { name?: string })?.name === 'LocatorDeniedError')
    const { reload, stored } = install(login)
    const { signIn } = await import('../../src/sign-in')

    signIn()
    await poll(4)
    expect(calls.filter((call) => call === 'click a[href*="ServiceLogin"]')).toHaveLength(1)
    expect(login.close).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()

    login.page.link = false
    login.page.avatar = true
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })

  it('reaches every open tab: another one closes its own window and loads again, signed in', async () => {
    const first = fakeLogin()
    const second = fakeLogin()
    const { reload } = install(first, second)
    const tab = await import('../../src/sign-in')
    vi.resetModules()
    const otherTab = await import('../../src/sign-in')
    tab.signIn()
    otherTab.signIn()
    await poll(1)
    first.page.avatar = true
    await poll(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
    expect(second.close).toHaveBeenCalledOnce()
    // the reset runs once, in the tab that signed in, and before any tab loads again
    expect(calls.filter((call) => call === 'reset' || call === 'reload')).toEqual(['reset', 'reload', 'reload'])
  })
})

const installDom = () => {
  type Listener = (event: { key?: string, stopPropagation?: () => void }) => void
  const docListeners = new Map<string, Set<Listener>>()
  const makeElement = (tagName: string) => {
    const children: FakeElement[] = []
    const attrs = new Map<string, string>()
    const listeners = new Map<string, Set<Listener>>()
    const element: FakeElement = {
      tagName: tagName.toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      title: '',
      type: '',
      tabIndex: 0,
      isConnected: false,
      style: { overflow: '' } as Record<string, string>,
      parentNode: null,
      get children() { return children },
      setAttribute: (name: string, value: string) => { attrs.set(name, value) },
      getAttribute: (name: string) => attrs.get(name) ?? null,
      appendChild: (child: FakeElement) => {
        child.parentNode = element
        const propagateConnect = (node: FakeElement, connected: boolean) => {
          node.isConnected = connected
          for (const grand of node.children) propagateConnect(grand, connected)
        }
        children.push(child)
        propagateConnect(child, element.isConnected || element === body || element === head)
        return child
      },
      append: (...nodes: FakeElement[]) => {
        for (const node of nodes) element.appendChild(node)
      },
      remove: () => {
        if (element.parentNode) {
          const siblings = element.parentNode.children
          const idx = siblings.indexOf(element)
          if (idx >= 0) siblings.splice(idx, 1)
          element.parentNode = null
        }
        const disconnect = (node: FakeElement) => {
          node.isConnected = false
          for (const child of node.children) disconnect(child)
        }
        disconnect(element)
      },
      focus: vi.fn(),
      addEventListener: (type: string, listener: Listener) => {
        let set = listeners.get(type)
        if (!set) listeners.set(type, (set = new Set()))
        set.add(listener)
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.get(type)?.delete(listener)
      },
      dispatch: (type: string, event: { key?: string, stopPropagation?: () => void } = {}) => {
        for (const listener of listeners.get(type) ?? []) listener(event)
      },
      querySelectorAll: (selector: string) => {
        const out: FakeElement[] = []
        const walk = (node: FakeElement) => {
          for (const child of node.children) {
            if ((selector === 'iframe' && child.tagName === 'IFRAME')
              || (selector === 'button' && child.tagName === 'BUTTON')) out.push(child)
            walk(child)
          }
        }
        walk(element)
        return out
      },
    }
    return element
  }
  type FakeElement = {
    tagName: string
    id: string
    className: string
    textContent: string
    innerHTML: string
    title: string
    type: string
    tabIndex: number
    isConnected: boolean
    style: Record<string, string>
    parentNode: FakeElement | null
    children: FakeElement[]
    setAttribute(name: string, value: string): void
    getAttribute(name: string): string | null
    appendChild(child: FakeElement): FakeElement
    append(...nodes: FakeElement[]): void
    remove(): void
    focus: ReturnType<typeof vi.fn>
    addEventListener(type: string, listener: Listener): void
    removeEventListener(type: string, listener: Listener): void
    dispatch(type: string, event?: { key?: string, stopPropagation?: () => void }): void
    querySelectorAll(selector: string): FakeElement[]
  }
  const head = makeElement('head')
  const body = makeElement('body')
  head.isConnected = true
  body.isConnected = true
  const previousFocus = makeElement('button')
  const doc = {
    head,
    body,
    activeElement: previousFocus,
    createElement: (tag: string) => makeElement(tag),
    getElementById: (id: string) => [...head.children, ...body.children].find((el) => el.id === id) ?? null,
    addEventListener: (type: string, listener: Listener) => {
      let set = docListeners.get(type)
      if (!set) docListeners.set(type, (set = new Set()))
      set.add(listener)
    },
    removeEventListener: (type: string, listener: Listener) => {
      docListeners.get(type)?.delete(listener)
    },
    dispatchKeyDown: (key: string) => {
      for (const listener of docListeners.get('keydown') ?? []) {
        listener({ key, stopPropagation: () => {} })
      }
    },
  }
  vi.stubGlobal('document', doc)
  return { doc, body, previousFocus }
}

const jarUnreachable = () => Object.assign(
  new Error('The app\'s session could not be reached'),
  { name: 'FrameWindowRefusedError', reason: 'jar-unreachable' },
)

describe('inline standalone PWA and jar-unreachable sign-in', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    calls.length = 0
    clickReasons.length = 0
    styleTags.length = 0
    channels.clear()
    showToast.mockClear()
    resetIdentity.mockClear()
    startPlatform.mockClear()
    lib.attachFrame.mockReset()
    lib.isPermissionDenied.mockReset().mockReturnValue(false)
    lib.isLocatorDenied.mockReset().mockReturnValue(false)
    lib.loaded = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens an inline FKN frame modal instead of a popup in iOS standalone WebApp mode', async () => {
    const inline = createFakeFrame()
    const { reload, stored } = install(inline as unknown as Login)
    const { body } = installDom()
    vi.stubGlobal('navigator', { standalone: true })
    const { signIn } = await import('../../src/sign-in')

    signIn()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
    const [options] = lib.attachFrame.mock.calls[0]! as [Options & { iframe?: { isConnected?: boolean } }]
    expect(options.window).toBeUndefined()
    expect(options.iframe?.isConnected).toBe(true)
    expect(options.domains).toEqual(['www.youtube.com', 'm.youtube.com', 'accounts.google.com'])
    expect(options.cookies).toBe('persistent')
    expect(options.permissions).toEqual([{ category: 'interaction', reason: 'Use your YouTube account in FTube' }])

    await poll(2)
    inline.page.link = false
    inline.page.mobileAvatar = true
    await poll(2)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
    expect(body.children).toHaveLength(0)
  })

  it('detects standalone display-mode via matchMedia', async () => {
    const inline = createFakeFrame()
    inline.page.avatar = true
    const { reload } = install(inline as unknown as Login)
    installDom()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }))
    const { signIn } = await import('../../src/sign-in')

    signIn()
    expect(lib.attachFrame).toHaveBeenCalledOnce()
    const [options] = lib.attachFrame.mock.calls[0]! as [Options]
    expect(options.iframe).toBeDefined()
    expect(options.window).toBeUndefined()
    await poll(2)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('falls back to the inline modal when attachWindow refuses with jar-unreachable', async () => {
    const inline = createFakeFrame()
    const { reload, stored } = install(jarUnreachable(), inline as unknown as Login)
    installDom()
    const { signIn } = await import('../../src/sign-in')

    signIn()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(2))
    expect((lib.attachFrame.mock.calls[0]![0] as Options).window).toEqual({})
    expect((lib.attachFrame.mock.calls[1]![0] as Options).iframe).toBeDefined()

    inline.page.avatar = true
    await poll(2)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stored[SIGNED_IN_KEY]).toBe('1')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('resolves closed without reloading when the user dismisses the inline modal', async () => {
    const inline = createFakeFrame()
    const { reload, stored } = install(inline as unknown as Login)
    const { body, doc } = installDom()
    vi.stubGlobal('navigator', { standalone: true })
    const { openSignInWindow } = await import('../../src/sign-in')

    const outcome = openSignInWindow(lib as unknown as Parameters<typeof openSignInWindow>[0])
    await poll(1)
    expect(body.children).toHaveLength(1)
    doc.dispatchKeyDown('Escape')
    await expect(outcome).resolves.toBe('closed')
    expect(body.children).toHaveLength(0)
    expect(reload).not.toHaveBeenCalled()
    expect(stored[SIGNED_IN_KEY]).toBeUndefined()
  })

  it('waits INLINE_COOKIE_COMMIT_MS before removing the inline modal after signed-in detection', async () => {
    const inline = createFakeFrame()
    inline.page.avatar = true
    const { reload, stored } = install(inline as unknown as Login)
    const { body } = installDom()
    vi.stubGlobal('navigator', { standalone: true })
    const { signIn } = await import('../../src/sign-in')

    signIn()
    await vi.advanceTimersByTimeAsync(0)
    expect(body.children).toHaveLength(1)

    // Poll interval (1,000 ms) detects the avatar and enters the 250 ms cookie commit grace period.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(body.children).toHaveLength(1)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(249)
    expect(body.children).toHaveLength(1)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(body.children).toHaveLength(0)
    expect(stored[SIGNED_IN_KEY]).toBe('1')
  })
})

describe('switching channel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    calls.length = 0
    channels.clear()
    resetIdentity.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stores the brand channel, then every other tab loads again and this one goes home', async () => {
    const { reload, assign, stored } = install(fakeLogin())
    const tab = await import('../../src/sign-in')
    vi.resetModules()
    await import('../../src/sign-in')
    tab.switchChannel(BRAND_PAGE_ID)
    expect(stored[CHANNEL_KEY]).toBe(BRAND_PAGE_ID)
    expect(assign).toHaveBeenCalledWith('/')
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).toHaveBeenCalledOnce()
    expect(calls).toEqual([`store ${CHANNEL_KEY}`, 'reload'])
    expect(resetIdentity).not.toHaveBeenCalled()
  })

  it("back to the account's own channel, keeps no channel", async () => {
    const { assign, stored } = install(fakeLogin())
    stored[CHANNEL_KEY] = BRAND_PAGE_ID
    const { switchChannel } = await import('../../src/sign-in')
    switchChannel()
    expect(stored[CHANNEL_KEY]).toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })
})

describe("the page left at Scramjet's old sign-in window path", () => {
  // the opener in a tab from before the deploy closes a window that names another build and reloads once into this one
  it('says hello to its opener as another build, the message that tab waits for', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(scramjetSignInStub)?.[1]
    expect(script).toBeDefined()
    const posted: { message: unknown, origin: string }[] = []
    // eslint-disable-next-line no-implied-eval
    new Function('opener', 'location', script!)({ postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) }, { origin: 'https://youtube.fkn.app' })
    expect(posted).toEqual([{ message: { type: 'yt-client-signin-hello', build: 'scramjet-removed' }, origin: 'https://youtube.fkn.app' }])
  })
})
