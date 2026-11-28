import type { OverlayEmojiAnimation, OverlayTextAnimation } from './over-screen-messages'

import { css, keyframes } from '@emotion/react'
import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { getFullscreenElement } from '../player/fullscreen'
import { useDismiss } from './ui/popup'

export type PreviewSelectOption<T extends string = string> = {
  value: T
  label: string
  previewAnimation?: OverlayTextAnimation | OverlayEmojiAnimation
  fontFamily?: string
}

const previewScroll = keyframes`
  0% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
  45% {
    opacity: 1;
    transform: translate3d(-115%, 0, 0);
  }
  46% {
    opacity: 0;
    transform: translate3d(115%, 0, 0);
  }
  55% {
    opacity: 1;
    transform: translate3d(100%, 0, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
`

const previewShake = keyframes`
  0%, 55%, 100% {
    transform: translate3d(0, 0, 0);
  }
  10% {
    transform: translate3d(-4px, -1px, 0);
  }
  20% {
    transform: translate3d(4px, 1px, 0);
  }
  30% {
    transform: translate3d(-3px, 1px, 0);
  }
  40% {
    transform: translate3d(3px, -1px, 0);
  }
`

const previewPop = keyframes`
  0% {
    opacity: 0.45;
    transform: scale(0.7);
  }
  22% {
    opacity: 1;
    transform: scale(1.12);
  }
  38% {
    opacity: 1;
    transform: scale(0.96);
  }
  52%, 85% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0.75;
    transform: scale(0.86);
  }
`

const previewBounce = keyframes`
  0% {
    opacity: 0.5;
    transform: translate3d(0, 5px, 0) scale(0.92);
  }
  22% {
    opacity: 1;
    transform: translate3d(0, -6px, 0) scale(1.03);
  }
  40% {
    opacity: 1;
    transform: translate3d(0, 2px, 0) scale(0.99);
  }
  56% {
    opacity: 1;
    transform: translate3d(0, -3px, 0) scale(1.01);
  }
  72%, 100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
`

const previewFade = keyframes`
  0%, 100% {
    opacity: 0.22;
  }
  35%, 65% {
    opacity: 1;
  }
`

const previewBurst = keyframes`
  0% {
    opacity: 0.4;
    transform: scale(0.55) rotate(-6deg);
  }
  24% {
    opacity: 1;
    transform: scale(1.16) rotate(4deg);
  }
  42% {
    opacity: 1;
    transform: scale(0.97) rotate(-2deg);
  }
  62%, 86% {
    opacity: 1;
    transform: scale(1.02) translate3d(0, -2px, 0) rotate(0deg);
  }
  100% {
    opacity: 0.55;
    transform: scale(0.88) rotate(-3deg);
  }
`

const previewShatter = keyframes`
  0% {
    opacity: 1;
    transform: scale(1.1) translate3d(0, 0, 0) rotate(0deg);
  }
  22% {
    opacity: 1;
    transform: scale(1.02) translate3d(-2px, -2px, 0) rotate(-4deg);
  }
  46% {
    opacity: 1;
    transform: scale(0.98) translate3d(3px, 2px, 0) rotate(4deg);
  }
  72% {
    opacity: 0.55;
    transform: scale(0.86) translate3d(-4px, 5px, 0) rotate(-7deg);
  }
  88%, 100% {
    opacity: 1;
    transform: scale(1) translate3d(0, 0, 0) rotate(0deg);
  }
`

const rootStyle = css`
  position: relative;
  display: inline-flex;
  flex: none;

  &.full-width {
    display: flex;
    width: 100%;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 12.6rem;
    min-height: 3.1rem;
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.7rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.25rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  &.full-width .trigger {
    width: 100%;
    min-height: 3.4rem;
    padding: 0 1rem;
    border-radius: 0.8rem;
    font-size: 1.35rem;
  }

  .trigger:hover {
    background: var(--bg-hover);
  }

  .trigger:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 2px;
  }

  .trigger-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trigger-chevron {
    flex: none;
    color: var(--text-secondary);
  }
`

const listboxStyle = css`
  position: fixed;
  z-index: calc(var(--z-dialog, 2300) + 1);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-width: min(28rem, calc(100vw - 1.6rem));
  max-height: 28rem;
  overflow-y: auto;
  padding: 0.4rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.8rem;
  background: var(--bg-menu);
  color: var(--text-primary);
  box-shadow: var(--shadow-menu);

  .option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 3.2rem;
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 0.55rem;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .option:hover,
  .option:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }

  .option:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-focus);
  }

  .option.selected {
    background: var(--bg-chip);
    font-weight: 500;
  }

  .check-slot {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    color: var(--accent);
  }

  .preview-stage {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 0.2rem 0.1rem;
  }

  .preview-label {
    display: inline-block;
    white-space: nowrap;
    will-change: transform, opacity;
    transform-origin: left center;
  }

  .preview-label.anim-preview-scroll {
    animation: ${previewScroll} 2.4s linear infinite;
  }

  .preview-label.anim-preview-shake {
    animation: ${previewShake} 1.8s ease-out infinite;
  }

  .preview-label.anim-preview-pop {
    animation: ${previewPop} 1.8s ease-out infinite;
  }

  .preview-label.anim-preview-bounce {
    animation: ${previewBounce} 1.9s ease-out infinite;
  }

  .preview-label.anim-preview-fade {
    animation: ${previewFade} 2.2s ease-in-out infinite;
  }

  .preview-label.anim-preview-burst {
    animation: ${previewBurst} 1.9s ease-out infinite;
  }

  .preview-label.anim-preview-shatter {
    animation: ${previewShatter} 2.0s ease-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .preview-label,
    .preview-label.anim-preview-scroll,
    .preview-label.anim-preview-shake,
    .preview-label.anim-preview-pop,
    .preview-label.anim-preview-bounce,
    .preview-label.anim-preview-fade,
    .preview-label.anim-preview-burst,
    .preview-label.anim-preview-shatter {
      animation: none;
      transform: none;
      opacity: 1;
    }
  }
`

const GAP = 8
const TYPEAHEAD_RESET_MS = 500

const placeListbox = (panel: HTMLElement, trigger: HTMLElement, align: 'start' | 'end') => {
  const rect = trigger.getBoundingClientRect()
  const { clientWidth: width, clientHeight: height } = document.documentElement
  panel.style.minWidth = `${Math.max(150, Math.round(rect.width))}px`
  const wanted = Math.min(panel.scrollHeight || 220, 280, height * 0.6)
  const roomBelow = height - rect.bottom - GAP
  const roomAbove = rect.top - GAP
  const chosen = wanted <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above'
  const available = chosen === 'below' ? roomBelow : roomAbove
  panel.style.maxHeight = `${Math.max(Math.min(280, height * 0.6, available), 120)}px`
  panel.style.top = chosen === 'below' ? `${rect.bottom + GAP}px` : 'auto'
  panel.style.bottom = chosen === 'above' ? `${height - rect.top + GAP}px` : 'auto'

  const startLeft = rect.left
  const endLeft = rect.right - panel.offsetWidth
  const left = align === 'start'
    ? (startLeft + panel.offsetWidth <= width - GAP ? startLeft : endLeft)
    : (endLeft >= GAP ? endLeft : startLeft)
  panel.style.left = `${Math.max(GAP, Math.min(left, width - panel.offsetWidth - GAP))}px`
}

/**
 * Accessible portalled combobox/listbox whose options render inline animation previews
 * or their own font families directly in the menu.
 */
export const PreviewSelect = <T extends string,>({
  ariaLabel,
  value,
  options,
  onChange,
  align = 'end',
  fullWidth = false,
  className,
}: {
  ariaLabel: string
  value: T
  options: readonly PreviewSelectOption<T>[]
  onChange: (value: T) => void
  align?: 'start' | 'end'
  fullWidth?: boolean
  className?: string
}) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<'selected' | 'first' | 'last'>('selected')
  const typeaheadRef = useRef({ buffer: '', at: 0 })
  const listId = useId()

  const selectedOption = options.find(option => option.value === value) ?? options[0]

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useDismiss({ open, onClose: () => setOpen(false), rootRef, panelRef, triggerRef })

  // Capture Escape ahead of parent dialogs (OverScreen settings, FeedSettingsPanel) so only this listbox closes.
  useLayoutEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [open, close])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = triggerRef.current
    if (!open || !panel || !trigger) return

    const position = () => placeListbox(panel, trigger, align)
    position()

    const optionButtons = [...panel.querySelectorAll<HTMLElement>('[role="option"]')]
    const selectedIdx = Math.max(0, options.findIndex(option => option.value === value))
    const targetIdx = entryRef.current === 'first'
      ? 0
      : entryRef.current === 'last'
        ? Math.max(0, optionButtons.length - 1)
        : selectedIdx
    const targetBtn = optionButtons[targetIdx]
    targetBtn?.focus({ preventScroll: true })
    targetBtn?.scrollIntoView({ block: 'nearest' })

    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        position()
      })
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [open, align, options, value])

  const choose = (nextValue: T) => {
    onChange(nextValue)
    close(true)
  }

  const moveFocus = (delta: number) => {
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (buttons.length === 0) return
    const currentIdx = buttons.indexOf(document.activeElement as HTMLElement)
    const nextIdx = currentIdx === -1
      ? (delta > 0 ? 0 : buttons.length - 1)
      : (currentIdx + delta + buttons.length) % buttons.length
    buttons[nextIdx]?.focus()
    buttons[nextIdx]?.scrollIntoView({ block: 'nearest' })
  }

  const focusEdge = (edge: 'first' | 'last') => {
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const target = edge === 'first' ? buttons[0] : buttons.at(-1)
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  }

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      entryRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
      setOpen(true)
    }
  }

  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusEdge(event.key === 'Home' ? 'first' : 'last')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return

    const now = Date.now()
    typeaheadRef.current.buffer = now - typeaheadRef.current.at > TYPEAHEAD_RESET_MS
      ? event.key.toLowerCase()
      : typeaheadRef.current.buffer + event.key.toLowerCase()
    typeaheadRef.current.at = now

    const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (buttons.length === 0) return
    const currentIdx = buttons.indexOf(document.activeElement as HTMLElement)
    const start = typeaheadRef.current.buffer.length === 1 ? currentIdx + 1 : Math.max(currentIdx, 0)
    const match = buttons
      .map((_, offset) => buttons[(start + offset + buttons.length) % buttons.length]!)
      .find(button => (button.textContent ?? '').trim().toLowerCase().startsWith(typeaheadRef.current.buffer))
    if (!match) return
    event.preventDefault()
    match.focus()
    match.scrollIntoView({ block: 'nearest' })
  }

  const rootClasses = [fullWidth ? 'full-width' : undefined, className].filter(Boolean).join(' ')

  return (
    <div ref={rootRef} css={rootStyle} className={rootClasses || undefined}>
      <button
        ref={triggerRef}
        type='button'
        role='combobox'
        className='trigger'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-value={value}
        onClick={() => {
          entryRef.current = 'selected'
          setOpen(prev => !prev)
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className='trigger-label'
          style={selectedOption?.fontFamily ? { fontFamily: selectedOption.fontFamily } : undefined}
        >
          {selectedOption?.label ?? value}
        </span>
        <ChevronDown size={14} strokeWidth={2} className='trigger-chevron' aria-hidden='true' />
      </button>

      {open
        ? createPortal(
          <div
            ref={panelRef}
            id={listId}
            css={listboxStyle}
            role='listbox'
            aria-label={ariaLabel}
            onKeyDown={onListKeyDown}
          >
            {options.map((option) => {
              const selected = option.value === value
              return (
                <button
                  key={option.value}
                  type='button'
                  role='option'
                  aria-selected={selected}
                  data-option-value={option.value}
                  tabIndex={-1}
                  className={selected ? 'option selected' : 'option'}
                  onClick={() => choose(option.value)}
                >
                  <span className='check-slot' aria-hidden='true'>
                    {selected ? <Check size={14} strokeWidth={2} /> : undefined}
                  </span>
                  <span className='preview-stage'>
                    <span
                      className={option.previewAnimation ? `preview-label anim-preview-${option.previewAnimation}` : 'preview-label'}
                      data-preview-animation={option.previewAnimation}
                      data-font-family={option.fontFamily ? option.value : undefined}
                      style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                    >
                      {option.label}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>,
          getFullscreenElement() ?? document.body,
        )
        : undefined}
    </div>
  )
}
