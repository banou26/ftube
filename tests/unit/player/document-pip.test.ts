import { describe, expect, it, vi } from 'vite-plus/test'

import { isDocumentPipSupported, openDocumentPipWindow } from '../../../src/player/document-pip'

type MockEl = {
  tagName: string
  rel?: string
  href?: string
  media?: string
  className: string
  textContent: string
  dataset: Record<string, string>
  style: { cssText: string }
  children: MockEl[]
  sheet?: { cssRules: { cssText: string }[] }
  getAttribute: (name: string) => string | null
  append: (...nodes: MockEl[]) => void
}

const createMockElement = (tag: string): MockEl => {
  const el: MockEl = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    dataset: {},
    style: { cssText: '' },
    children: [],
    getAttribute (name: string) {
      return name === 'href' ? (this.href ?? null) : null
    },
    append (...nodes: MockEl[]) {
      this.children.push(...nodes)
    },
  }
  return el
}

const createMockDocument = () => ({
  title: '',
  documentElement: createMockElement('html'),
  head: createMockElement('head'),
  body: createMockElement('body'),
  createElement: createMockElement,
})

const createMockWindow = (doc: ReturnType<typeof createMockDocument>) => {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  let closed = false
  let nextTimer = 1
  const clearedIntervals: number[] = []
  const win = {
    document: doc,
    get closed () {
      return closed
    },
    setInterval: () => nextTimer++,
    clearInterval: (id: number) => clearedIntervals.push(id),
    addEventListener (type: string, listener: (event: unknown) => void) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    removeEventListener (type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener)
    },
    dispatch (type: string, event: Record<string, unknown> = {}) {
      for (const listener of Array.from(listeners.get(type) ?? [])) listener({ type, ...event })
    },
    close () {
      if (closed) return
      closed = true
      this.dispatch('pagehide')
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    clearedIntervals,
  }
  return win
}

describe('document picture-in-picture helpers', () => {
  it('detects documentPictureInPicture support only when requestWindow is available', () => {
    expect(isDocumentPipSupported({} as Window)).toBe(false)
    expect(isDocumentPipSupported({ documentPictureInPicture: {} } as unknown as Window)).toBe(false)
    expect(isDocumentPipSupported({
      documentPictureInPicture: { requestWindow: async () => ({} as Window) },
    } as unknown as Window)).toBe(true)
  })

  it('mirrors links and CSSOM style rules, mounts host, forwards keydown, and cleans up once', async () => {
    const srcDoc = createMockDocument()
    srcDoc.documentElement.dataset.theme = 'dark'
    srcDoc.documentElement.className = 'custom-root'
    srcDoc.documentElement.style.cssText = '--accent: #fff;'

    const link = createMockElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://youtube.fkn.app/assets/index.css'
    const speedyStyle = createMockElement('style')
    speedyStyle.dataset.emotion = 'css'
    speedyStyle.textContent = ''
    speedyStyle.sheet = { cssRules: [{ cssText: '.css-abc { color: red; }' }] }
    srcDoc.head.append(link, speedyStyle)

    const pipDoc = createMockDocument()
    const pipWin = createMockWindow(pipDoc)
    const srcWin = createMockWindow(srcDoc) as ReturnType<typeof createMockWindow> & {
      documentPictureInPicture?: { requestWindow: (opts?: { width?: number, height?: number }) => Promise<unknown> }
    }
    const requestWindow = vi.fn().mockResolvedValue(pipWin)
    srcWin.documentPictureInPicture = { requestWindow }

    const host = createMockElement('div') as unknown as HTMLElement
    const onClose = vi.fn()
    const onKeyDown = vi.fn()

    const handle = await openDocumentPipWindow({
      host,
      width: 320,
      height: 568,
      title: 'Vertical Short One',
      onClose,
      onKeyDown,
      sourceWindow: srcWin as unknown as Window,
    })

    expect(requestWindow).toHaveBeenCalledWith({ width: 320, height: 568 })
    expect(handle).toBeDefined()
    expect(pipDoc.title).toBe('Vertical Short One')
    expect(pipDoc.documentElement.dataset.theme).toBe('dark')
    expect(pipDoc.documentElement.className).toBe('custom-root')
    expect(pipDoc.head.children.some(el => el.tagName === 'LINK' && el.href === 'https://youtube.fkn.app/assets/index.css')).toBe(true)
    expect(pipDoc.head.children.some(el => el.tagName === 'STYLE' && el.textContent.includes('.css-abc { color: red; }'))).toBe(true)

    const stage = pipDoc.body.children[0]
    expect(stage?.className).toBe('pip-stage')
    expect(stage?.children[0]).toBe(host)

    // Newly inserted Emotion CSSOM rules propagate on syncStyles().
    speedyStyle.sheet.cssRules.push({ cssText: '.css-def { opacity: 1; }' })
    handle!.syncStyles()
    expect(pipDoc.head.children.some(el => el.tagName === 'STYLE' && el.textContent.includes('.css-def { opacity: 1; }'))).toBe(true)

    pipWin.dispatch('keydown', { key: 'ArrowDown' })
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'ArrowDown' }))

    handle!.close()
    handle!.close()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(pipWin.closed).toBe(true)
    expect(pipWin.listenerCount('keydown')).toBe(0)
    expect(srcWin.clearedIntervals.length).toBe(1)
  })
})
