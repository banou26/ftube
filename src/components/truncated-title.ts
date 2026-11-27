import { useEffect } from 'preact/hooks'

const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'PRE', 'SVG'])
const BLOCK_CHILD_TAGS = new Set([
  'DIV', 'P', 'UL', 'OL', 'LI', 'SECTION', 'ARTICLE', 'NAV', 'MAIN',
  'HEADER', 'FOOTER', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FORM',
])
const AUTO_TITLE_ATTR = 'data-auto-title'
const MAX_ANCESTOR_DEPTH = 4

const isTruncatableElement = (node: unknown): node is HTMLElement => {
  if (!node || typeof node !== 'object') return false
  const el = node as { nodeType?: number, tagName?: unknown, namespaceURI?: unknown }
  return el.nodeType === 1
    && typeof el.tagName === 'string'
    && el.namespaceURI !== 'http://www.w3.org/2000/svg'
}

/** Reports whether an element's single-line or line-clamped text overflows its visible box. */
export const isElementTruncated = (el: HTMLElement): boolean => {
  const tag = el.tagName?.toUpperCase()
  if (!tag || SKIP_TAGS.has(tag)) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  for (const child of Array.from(el.children ?? [])) {
    if (BLOCK_CHILD_TAGS.has(child.tagName?.toUpperCase() ?? '')) return false
  }
  const text = el.textContent?.trim() ?? ''
  if (!text) return false

  const view = el.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined)
  const style = view?.getComputedStyle(el)
  if (!style) return false

  const horizontalClip = style.overflowX === 'hidden' || style.overflowX === 'clip'
  if (horizontalClip && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) return true

  const verticalClip = style.overflowY === 'hidden' || style.overflowY === 'clip'
  const clamp = style.webkitLineClamp || style.getPropertyValue?.('-webkit-line-clamp') || ''
  const clampedBox = Boolean(
    (clamp && clamp !== 'none' && clamp !== '0')
    || style.display === '-webkit-box'
    || style.textOverflow === 'ellipsis',
  )
  return Boolean(verticalClip && clampedBox && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1)
}

/** Walks up to 4 ancestors from an event target (or its text parent) returning the innermost truncated element. */
export const findTruncatedAncestor = (target: EventTarget | null): HTMLElement | null => {
  if (!target || typeof target !== 'object') return null
  const node = target as { nodeType?: number, parentElement?: HTMLElement | null }
  let current: HTMLElement | null = node.nodeType === 3 ? (node.parentElement ?? null) : (isTruncatableElement(target) ? target : null)
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (isTruncatableElement(current) && isElementTruncated(current)) return current
    current = current.parentElement
  }
  return null
}

/** Delegates hover and focus listeners on a root so truncated text reveals its full content in native tooltips. */
export const bindTruncatedTooltips = (root: Document | HTMLElement = document): () => void => {
  let activeEl: HTMLElement | null = null

  const clearAutoTitle = (el: HTMLElement | null) => {
    if (!el) return
    if (el.getAttribute(AUTO_TITLE_ATTR) === '1') {
      el.removeAttribute('title')
      el.removeAttribute(AUTO_TITLE_ATTR)
    }
    if (activeEl === el) activeEl = null
  }

  const updateForTarget = (target: EventTarget | null) => {
    const candidate = findTruncatedAncestor(target)
    if (activeEl && activeEl !== candidate) clearAutoTitle(activeEl)
    if (!candidate) return
    if (candidate.hasAttribute('title') && candidate.getAttribute(AUTO_TITLE_ATTR) !== '1') return
    const text = candidate.textContent?.trim() ?? ''
    if (!text) return
    if (candidate.getAttribute('title') !== text || candidate.getAttribute(AUTO_TITLE_ATTR) !== '1') {
      candidate.setAttribute(AUTO_TITLE_ATTR, '1')
      candidate.setAttribute('title', text)
    }
    activeEl = candidate
  }

  const onMouseOver = (event: Event) => updateForTarget(event.target)
  const onFocusIn = (event: Event) => updateForTarget(event.target)
  const onFocusOut = (event: Event) => {
    if (!activeEl) return
    const related = (event as FocusEvent).relatedTarget as Node | null
    if (!related || !activeEl.contains(related)) clearAutoTitle(activeEl)
  }
  const onMouseLeave = (event: Event) => {
    if (!activeEl) return
    if (!(event as MouseEvent).relatedTarget) clearAutoTitle(activeEl)
  }

  root.addEventListener('mouseover', onMouseOver, { capture: true, passive: true })
  root.addEventListener('focusin', onFocusIn, { capture: true, passive: true })
  root.addEventListener('focusout', onFocusOut, { capture: true, passive: true })
  root.addEventListener('mouseleave', onMouseLeave, { capture: true, passive: true })

  return () => {
    root.removeEventListener('mouseover', onMouseOver, { capture: true })
    root.removeEventListener('focusin', onFocusIn, { capture: true })
    root.removeEventListener('focusout', onFocusOut, { capture: true })
    root.removeEventListener('mouseleave', onMouseLeave, { capture: true })
    clearAutoTitle(activeEl)
  }
}

/** Attaches global hover/focus truncated-text tooltips for the mounted app. */
export const useTruncatedTooltips = () => {
  useEffect(() => bindTruncatedTooltips(document), [])
}
