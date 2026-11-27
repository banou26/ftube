import { describe, expect, it } from 'vite-plus/test'

import { bindTruncatedTooltips, findTruncatedAncestor, isElementTruncated } from '../../../src/components/truncated-title'

type FakeStyle = {
  overflowX: string
  overflowY: string
  display: string
  textOverflow: string
  webkitLineClamp: string
  getPropertyValue: (name: string) => string
}

const makeFakeElement = ({
  tagName = 'DIV',
  textContent = 'Very long text that is truncated',
  clientWidth = 100,
  scrollWidth = 100,
  clientHeight = 20,
  scrollHeight = 20,
  style = {},
  attrs = {},
  children = [],
  parentElement = null,
}: {
  tagName?: string
  textContent?: string
  clientWidth?: number
  scrollWidth?: number
  clientHeight?: number
  scrollHeight?: number
  style?: Partial<FakeStyle>
  attrs?: Record<string, string>
  children?: { tagName: string }[]
  parentElement?: unknown
} = {}) => {
  const attrMap = new Map<string, string>(Object.entries(attrs))
  const computed: FakeStyle = {
    overflowX: 'visible',
    overflowY: 'visible',
    display: 'block',
    textOverflow: 'clip',
    webkitLineClamp: '',
    getPropertyValue: (name: string) => (name === '-webkit-line-clamp' ? computed.webkitLineClamp : ''),
    ...style,
  }
  const el = {
    nodeType: 1,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    tagName,
    textContent,
    clientWidth,
    scrollWidth,
    clientHeight,
    scrollHeight,
    children,
    parentElement,
    contains: (node: unknown) => node === el,
    getAttribute: (name: string) => attrMap.get(name) ?? null,
    hasAttribute: (name: string) => attrMap.has(name),
    setAttribute: (name: string, value: string) => {
      attrMap.set(name, value)
    },
    removeAttribute: (name: string) => {
      attrMap.delete(name)
    },
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => computed,
      },
    },
  }
  return el as unknown as HTMLElement
}

describe('truncated-title helpers', () => {
  it('detects single-line horizontal clipping and multi-line clamped truncation while ignoring non-truncated or excluded elements', () => {
    const singleLine = makeFakeElement({
      clientWidth: 100,
      scrollWidth: 180,
      style: { overflowX: 'hidden', textOverflow: 'ellipsis' },
    })
    expect(isElementTruncated(singleLine)).toBe(true)

    const lineClamp = makeFakeElement({
      clientHeight: 36,
      scrollHeight: 72,
      style: { overflowY: 'hidden', display: '-webkit-box', webkitLineClamp: '2' },
    })
    expect(isElementTruncated(lineClamp)).toBe(true)

    const fit = makeFakeElement({
      clientWidth: 200,
      scrollWidth: 200,
      style: { overflowX: 'hidden', textOverflow: 'ellipsis' },
    })
    expect(isElementTruncated(fit)).toBe(false)

    const containerWithBlocks = makeFakeElement({
      clientHeight: 40,
      scrollHeight: 120,
      style: { overflowY: 'hidden', display: '-webkit-box', webkitLineClamp: '2' },
      children: [{ tagName: 'DIV' }],
    })
    expect(isElementTruncated(containerWithBlocks)).toBe(false)

    const inputEl = makeFakeElement({
      tagName: 'INPUT',
      clientWidth: 80,
      scrollWidth: 160,
      style: { overflowX: 'hidden' },
    })
    expect(isElementTruncated(inputEl)).toBe(false)

    const hiddenEl = makeFakeElement({
      clientWidth: 80,
      scrollWidth: 160,
      style: { overflowX: 'hidden' },
      attrs: { 'aria-hidden': 'true' },
    })
    expect(isElementTruncated(hiddenEl)).toBe(false)
  })

  it('resolves truncated ancestors from text nodes and manages temporary title attributes cleanly', () => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    const root = {
      addEventListener: (type: string, fn: (event: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: (event: Event) => void) => {
        listeners.get(type)?.delete(fn)
      },
    } as unknown as Document

    const unbind = bindTruncatedTooltips(root)
    const truncated = makeFakeElement({
      textContent: 'Full Channel Title Here',
      clientWidth: 90,
      scrollWidth: 170,
      style: { overflowX: 'hidden' },
    })
    const innerSpan = makeFakeElement({ tagName: 'SPAN', parentElement: truncated, textContent: 'Full' })
    const textNode = { nodeType: 3, parentElement: innerSpan } as unknown as EventTarget

    expect(findTruncatedAncestor(textNode)).toBe(truncated)

    const fire = (type: string, target: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn({ target } as unknown as Event)
    }

    fire('mouseover', textNode)
    expect(truncated.getAttribute('title')).toBe('Full Channel Title Here')
    expect(truncated.getAttribute('data-auto-title')).toBe('1')

    const nativeEl = makeFakeElement({
      textContent: 'Overflowing native title',
      clientWidth: 90,
      scrollWidth: 170,
      style: { overflowX: 'hidden' },
      attrs: { title: 'Custom native title' },
    })
    fire('mouseover', nativeEl)
    expect(truncated.getAttribute('title')).toBeNull()
    expect(nativeEl.getAttribute('title')).toBe('Custom native title')
    expect(nativeEl.getAttribute('data-auto-title')).toBeNull()

    fire('mouseover', truncated)
    expect(truncated.getAttribute('title')).toBe('Full Channel Title Here')
    unbind()
    expect(truncated.getAttribute('title')).toBeNull()
    expect(nativeEl.getAttribute('title')).toBe('Custom native title')
  })
})
