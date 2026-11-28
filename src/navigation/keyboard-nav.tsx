import type { RefObject } from 'preact'
import type { KeyboardChordSpec, NavCandidate, NavDirection } from './spatial'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { useSetting } from '../settings'
import { findSpatialTarget, KEYBOARD_NAV_CHORDS } from './spatial'

export { findSpatialTarget, KEYBOARD_NAV_CHORDS }
export type { KeyboardChordSpec, NavCandidate, NavDirection }

export const KB_NAV_FOCUS_ATTR = 'data-kb-nav-focus'
const CHORD_TIMEOUT_MS = 1_200
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset'])
const WATCH_PLAYBACK_KEYS = new Set([
  ' ',
  'k',
  'j',
  'l',
  'm',
  'c',
  'f',
  't',
  'i',
  '<',
  '>',
  ',',
  '.',
  '+',
  '=',
  '-',
  '_',
  '?',
  'Home',
  'End',
  'N',
  'P',
])

const isTypingElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  if (target.tagName === 'INPUT') {
    const inputType = (target as HTMLInputElement).type.toLowerCase()
    if (inputType === 'range') return true
    return !NON_TEXT_INPUT_TYPES.has(inputType)
  }
  return false
}

const isElementVisible = (element: HTMLElement): boolean => {
  if (element.closest('[aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return false
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true })
  }
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

const isFocusableCandidate = (element: HTMLElement): boolean => {
  if (element.tabIndex < 0) return false
  if ((element as HTMLButtonElement).disabled) return false
  return isElementVisible(element)
}

const hasOpenOverlay = (): boolean => {
  for (const node of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"]')) {
    if (isElementVisible(node)) return true
  }
  return false
}

const isFullscreenActive = (): boolean => {
  const webkitDoc = document as Document & { webkitFullscreenElement?: Element | null }
  return Boolean(document.fullscreenElement ?? webkitDoc.webkitFullscreenElement)
}

const collectFocusableCandidates = (
  root: ParentNode,
  excludeContainer?: Element | null,
): NavCandidate<HTMLElement>[] => {
  const candidates: NavCandidate<HTMLElement>[] = []
  for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (excludeContainer?.contains(node)) continue
    if (!isFocusableCandidate(node)) continue
    const rect = node.getBoundingClientRect()
    candidates.push({
      item: node,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    })
  }
  return candidates
}

const chordStyle = css`
  position: fixed;
  right: 1.6rem;
  bottom: 1.6rem;
  z-index: calc(var(--z-toast, 2400) - 10);
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.8rem;
  background: var(--bg-menu);
  color: var(--text-primary);
  font-size: 1.3rem;
  font-weight: 500;
  box-shadow: var(--shadow-menu);
  pointer-events: none;

  kbd {
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-chip);
    font: inherit;
    font-size: 1.2rem;
  }
`

const directionForKey = (key: string, allowHjkl: boolean): NavDirection | undefined => {
  if (key === 'ArrowLeft') return 'left'
  if (key === 'ArrowDown') return 'down'
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowRight') return 'right'
  if (!allowHjkl) return undefined
  if (key === 'h') return 'left'
  if (key === 'j') return 'down'
  if (key === 'k') return 'up'
  if (key === 'l') return 'right'
  return undefined
}

/** Provides opt-in spatial UI navigation, Escape-out-of-player on /watch, and `g` route chords. */
export const KeyboardNavigationHost = (
  { location, navigate, pageRef, onOpenGuide }: {
    location: string
    navigate: (to: string) => void
    pageRef: RefObject<HTMLDivElement>
    onOpenGuide: () => void
  },
) => {
  const enabled = useSetting('keyboardNavigation')
  const [pendingPrefix, setPendingPrefix] = useState<'g' | undefined>(undefined)
  const pendingRef = useRef<'g' | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const markedRef = useRef<HTMLElement | null>(null)
  const latestRef = useRef({ location, navigate, onOpenGuide })
  latestRef.current = { location, navigate, onOpenGuide }

  const clearMarkedFocus = () => {
    markedRef.current?.removeAttribute(KB_NAV_FOCUS_ATTR)
    markedRef.current = null
  }

  const focusMarked = (element: HTMLElement | null) => {
    if (!element) return false
    clearMarkedFocus()
    element.setAttribute(KB_NAV_FOCUS_ATTR, 'true')
    markedRef.current = element
    element.focus({ preventScroll: false })
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return true
  }

  const clearChord = () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    pendingRef.current = undefined
    setPendingPrefix(undefined)
  }

  useEffect(() => {
    clearMarkedFocus()
  }, [location])

  useEffect(() => {
    if (!enabled) {
      clearMarkedFocus()
      clearChord()
      return undefined
    }

    const startChord = () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      pendingRef.current = 'g'
      setPendingPrefix('g')
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        pendingRef.current = undefined
        setPendingPrefix(undefined)
      }, CHORD_TIMEOUT_MS)
    }

    const runChordAction = (spec: KeyboardChordSpec) => {
      const { navigate: nav, onOpenGuide: openGuide } = latestRef.current
      if (spec.route) {
        clearMarkedFocus()
        nav(spec.route)
        return
      }
      if (spec.action === 'search') {
        clearMarkedFocus()
        const input = document.querySelector<HTMLInputElement>('header form[role="search"] input[name="search_query"]')
        input?.focus()
        return
      }
      if (spec.action === 'guide') {
        const findGuideTarget = () =>
          document.querySelector<HTMLElement>('nav[aria-label="Guide"] a[href], nav[aria-label="Guide"] button:not([disabled])')
        const existing = findGuideTarget()
        if (existing) {
          focusMarked(existing)
          return
        }
        openGuide()
        requestAnimationFrame(() => {
          focusMarked(findGuideTarget())
        })
        return
      }
      if (spec.action === 'player') {
        const playerRoot = document.querySelector<HTMLElement>('[data-player-root]')
        if (!playerRoot) return
        const innerTarget = collectFocusableCandidates(playerRoot)[0]?.item
        if (innerTarget) {
          focusMarked(innerTarget)
          return
        }
        playerRoot.tabIndex = -1
        focusMarked(playerRoot)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isFullscreenActive() || isTypingElement(event.target) || hasOpenOverlay()) return

      const key = event.key
      const currentPath = latestRef.current.location
      const isWatch = currentPath.startsWith('/watch')
      const isShorts = currentPath === '/shorts' || currentPath.startsWith('/shorts/')
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const playerRoot = isWatch ? document.querySelector<HTMLElement>('[data-player-root]') : null
      const insidePlayer = Boolean(isWatch && (
        !active
        || active === document.body
        || active === document.documentElement
        || playerRoot?.contains(active)
      ))

      if (pendingRef.current === 'g') {
        clearChord()
        if (key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const match = KEYBOARD_NAV_CHORDS.find((item) => item.key === key.toLowerCase())
        if (match) {
          event.preventDefault()
          event.stopPropagation()
          runChordAction(match)
        }
        return
      }

      if (key === 'g' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        startChord()
        return
      }

      if (isWatch && insidePlayer) {
        if (key === 'Escape') {
          const watchScope = pageRef.current ?? document.querySelector('main') ?? document.body
          const outerCandidates = collectFocusableCandidates(watchScope, playerRoot)
          if (outerCandidates.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            focusMarked(outerCandidates[0]!.item)
          }
        }
        return
      }

      if (isWatch && (WATCH_PLAYBACK_KEYS.has(key) || /^[0-9]$/.test(key))) {
        return
      }

      if (isShorts && (key === 'ArrowUp' || key === 'ArrowDown')) {
        return
      }

      const direction = directionForKey(key, !isWatch)
      if (!direction) return

      const candidates = collectFocusableCandidates(document)
      if (candidates.length === 0) return

      event.preventDefault()
      event.stopPropagation()

      const activeCandidate = active ? candidates.find((entry) => entry.item === active) : undefined
      if (!activeCandidate) {
        const scope = pageRef.current ?? document.querySelector('main') ?? document
        const preferred = collectFocusableCandidates(scope)[0] ?? candidates[0]
        if (preferred) focusMarked(preferred.item)
        return
      }

      const nextTarget = findSpatialTarget(activeCandidate.rect, candidates.filter((entry) => entry.item !== active), direction)
      if (nextTarget) {
        focusMarked(nextTarget)
      }
    }

    const onPointerDown = () => {
      clearMarkedFocus()
      clearChord()
    }

    const onBlur = () => {
      clearChord()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
      clearMarkedFocus()
      clearChord()
    }
  }, [enabled, pageRef])

  if (!enabled || !pendingPrefix) return null

  return (
    <div css={chordStyle} role='status' aria-live='polite' data-kb-nav-chord={pendingPrefix}>
      <span>Go to</span>
      <kbd>{pendingPrefix}</kbd>
    </div>
  )
}
