import type { TargetedFocusEvent, TargetedKeyboardEvent, TargetedMouseEvent } from 'preact'
import type { RefObject } from 'preact'

import { css } from '@emotion/react'
import { Play, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

// Keeps at most one keyboard-activated preview running across the page at once.
let stopActiveKeyboardPreview: (() => void) | undefined

/** Resets active keyboard preview tracking (intended for tests). */
export const resetPreviewTriggerState = () => {
  stopActiveKeyboardPreview = undefined
}

const previewToggleStyle = css`
  position: absolute;
  top: 0.8rem;
  left: 0.8rem;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.2rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, background-color 0.12s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.88);
  }

  &:focus-visible,
  &[aria-pressed='true'] {
    opacity: 1;
    pointer-events: auto;
  }

  &:focus-visible {
    outline: 2px solid var(--accent-focus, var(--accent));
    outline-offset: 2px;
  }
`

/**
 * Coordinates hover vs keyboard activation of a card's HoverPreview so assistive
 * technology users can open, operate, and Escape out of a preview without relying on pointer hover.
 */
export const usePreviewActivation = ({ canPreview, hovered }: {
  canPreview: boolean
  hovered: boolean
}) => {
  const [keyboardActive, setKeyboardActive] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stopperRef = useRef<(() => void) | undefined>(undefined)

  const stopKeyboard = useCallback((refocus = false) => {
    if (stopperRef.current && stopActiveKeyboardPreview === stopperRef.current) {
      stopActiveKeyboardPreview = undefined
    }
    stopperRef.current = undefined
    setKeyboardActive(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!canPreview && keyboardActive) stopKeyboard(false)
  }, [canPreview, keyboardActive, stopKeyboard])

  useEffect(() => {
    if (canPreview && hovered && !keyboardActive && stopActiveKeyboardPreview) {
      stopActiveKeyboardPreview()
    }
  }, [canPreview, hovered, keyboardActive])

  useEffect(() => {
    if (!keyboardActive) return
    const onPointerDown = (event: PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      if (event.target instanceof Node && !container.contains(event.target)) {
        stopKeyboard(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [keyboardActive, stopKeyboard])

  useEffect(() => () => {
    if (stopperRef.current && stopActiveKeyboardPreview === stopperRef.current) {
      stopActiveKeyboardPreview = undefined
    }
  }, [])

  const startKeyboard = useCallback(() => {
    if (!canPreview) return
    const prev = stopActiveKeyboardPreview
    const stopper = () => {
      stopperRef.current = undefined
      setKeyboardActive(false)
    }
    if (prev && prev !== stopperRef.current) prev()
    stopperRef.current = stopper
    stopActiveKeyboardPreview = stopper
    setKeyboardActive(true)
  }, [canPreview])

  const toggleKeyboard = useCallback(() => {
    if (keyboardActive) stopKeyboard(false)
    else startKeyboard()
  }, [keyboardActive, startKeyboard, stopKeyboard])

  const containerProps = {
    ref: containerRef,
    onFocusOut: (event: TargetedFocusEvent<HTMLDivElement>) => {
      if (!keyboardActive) return
      const related = event.relatedTarget
      // Guard against null relatedTarget (WebKit omits it on button clicks).
      if (related instanceof Node && !event.currentTarget.contains(related)) {
        stopKeyboard(false)
      }
    },
    onKeyDown: (event: TargetedKeyboardEvent<HTMLDivElement>) => {
      if (!keyboardActive || event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      stopKeyboard(true)
    },
  }

  return {
    active: canPreview && (hovered || keyboardActive),
    keyboardActive,
    triggerRef,
    toggleKeyboard,
    stopKeyboard,
    containerProps,
  }
}

/** Accessible toggle button rendered alongside the thumbnail link to start or stop preview playback via keyboard. */
export const PreviewTriggerButton = (
  { title, active, onToggle, buttonRef }: {
    title: string
    active: boolean
    onToggle: () => void
    buttonRef: RefObject<HTMLButtonElement>
  },
) => (
  <button
    ref={buttonRef}
    type='button'
    className='preview-toggle'
    css={previewToggleStyle}
    aria-label={active ? `Stop preview for ${title}` : `Preview ${title}`}
    aria-pressed={active}
    onClick={(event: TargetedMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      onToggle()
    }}
    onKeyDown={(event: TargetedKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === ' ') event.stopPropagation()
    }}
  >
    {active ? <Square size={14} strokeWidth={2} aria-hidden='true' /> : <Play size={14} strokeWidth={2} aria-hidden='true' />}
  </button>
)
