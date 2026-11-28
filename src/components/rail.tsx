import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

const style = css`
  position: relative;
  min-width: 0;
  max-width: 100%;

  & > .track {
    --card-hover-inset: 0;
    --card-hover-radius: 1.2rem;
    display: flex;
    gap: var(--rail-gap, 0.8rem);
    overflow-x: auto;
    scroll-behavior: smooth;
    /* The scrollbar is hidden because the arrows are the affordance; without
       them the overflow would be unreachable on a mouse-only desktop, which is
       why they are rendered rather than left to the trackpad. */
    scrollbar-width: none;
    scroll-snap-type: x proximity;
  }

  & > .track::-webkit-scrollbar {
    display: none;
  }

  & > .track:has(> .tile) {
    --card-hover-inset: -1rem;
    --card-hover-radius: 1.6rem;
    gap: var(--rail-gap, 2rem);
    padding: 1rem;
    margin: -1rem;
    scroll-padding-inline: 1rem;
  }

  @media (max-width: 792px) {
    overflow-x: clip;
  }

  & > .track > * {
    flex: none;
    scroll-snap-align: start;
  }

  .arrow {
    position: absolute;
    top: var(--rail-arrow-top, calc(50% - 6rem));
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border: none;
    border-radius: 50%;
    background: var(--bg-menu);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    z-index: 1;
  }

  .arrow.left {
    left: -2rem;
  }

  .arrow.right {
    right: var(--rail-arrow-right, -2rem);
  }

  /* Without the guide a page's gutter can be narrower than the overhang,
     which would scroll the whole page sideways. */
  @media (max-width: 792px) {
    .arrow.left {
      left: 0;
    }

    .arrow.right {
      right: 0;
    }
  }

  /* Full-height edge gradient arrows match Home/Subscriptions chip bars cleanly without snap fight or overhanging cards. */
  &[data-variant='edge'] > .track {
    scroll-snap-type: none;
  }

  &[data-variant='edge'] > .track > * {
    scroll-snap-align: none;
  }

  &[data-variant='edge'] .arrow {
    top: 0;
    bottom: 0;
    width: 5.6rem;
    height: auto;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }

  &[data-variant='edge'] .arrow.left {
    left: 0;
    justify-content: flex-start;
    background: linear-gradient(to right, var(--bg-base) 55%, transparent);
  }

  &[data-variant='edge'] .arrow.right {
    right: 0;
    justify-content: flex-end;
    background: linear-gradient(to left, var(--bg-base) 55%, transparent);
  }

  &[data-variant='edge'] .arrow-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 50%;
    transition: background 0.15s ease;
  }

  &[data-variant='edge'] .arrow:hover .arrow-circle {
    background: var(--bg-hover);
  }
`

// Roughly a screenful, so a click advances the rail rather than nudging it.
const SCROLL_BY = 0.8
const EDGE_SCROLL_BY = 0.7
const EDGE_SNAP_PX = 24

/**
 * A horizontal row that scrolls by its arrows. `label` names the items in the
 * arrows' labels ("More shorts"), and `count` is how many there are, so the
 * arrows are measured again when the row grows. With `wholeCards` an arrow
 * moves the row by whole items, as many as its width holds rounded, at least
 * one: youtube.com's search carousels, measured from 512 to 735px on 2026-11-10.
 * `variant='edge'` draws flush edge-gradient arrows matching Home/Subscriptions,
 * and `resetKey` resets scroll position when switching entities with the same count.
 */
export const Rail = (
  { label, count, wholeCards = false, variant = 'floating', resetKey, children }: {
    label: string
    count: number
    wholeCards?: boolean
    variant?: 'floating' | 'edge'
    resetKey?: string | number
    children: ComponentChildren
  },
) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const prevResetKeyRef = useRef(resetKey)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey
      track.scrollLeft = 0
    }
    let alive = true
    const measure = () => {
      if (!alive) return
      const max = Math.max(0, track.scrollWidth - track.clientWidth)
      setAtStart(track.scrollLeft <= 1)
      setAtEnd(track.scrollLeft >= max - 1)
    }
    measure()
    track.addEventListener('scroll', measure, { passive: true })
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(track)
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(track, { childList: true, characterData: true, subtree: true })
    void document.fonts?.ready.then(measure)
    return () => {
      alive = false
      track.removeEventListener('scroll', measure)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [count, resetKey, variant])

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    const [first, second] = [...track.children] as HTMLElement[]
    const pitch = variant === 'floating' && wholeCards && first && second ? second.offsetLeft - first.offsetLeft : 0
    const step = pitch > 0
      ? Math.max(1, Math.round(track.clientWidth / pitch)) * pitch
      : variant === 'edge'
        ? Math.max(120, Math.round(track.clientWidth * EDGE_SCROLL_BY))
        : track.clientWidth * SCROLL_BY
    const max = Math.max(0, track.scrollWidth - track.clientWidth)
    let next = track.scrollLeft + direction * step
    if (variant === 'edge') {
      if (direction === 1 && max - next <= EDGE_SNAP_PX) next = max
      else if (direction === -1 && next <= EDGE_SNAP_PX) next = 0
    }
    next = Math.max(0, Math.min(max, next))
    track.scrollTo({ left: next, behavior: 'smooth' })
  }

  return (
    <div css={style} data-variant={variant}>
      {!atStart
        ? (
          <button type='button' className='arrow left' aria-label={`Previous ${label}`} onClick={() => scrollBy(-1)}>
            {variant === 'edge'
              ? <span className='arrow-circle'><ChevronLeft size={20} strokeWidth={1.75} /></span>
              : <ChevronLeft size={24} strokeWidth={2} />}
          </button>
        )
        : undefined}
      <div className='track' ref={trackRef}>
        {children}
      </div>
      {!atEnd
        ? (
          <button type='button' className='arrow right' aria-label={`More ${label}`} onClick={() => scrollBy(1)}>
            {variant === 'edge'
              ? <span className='arrow-circle'><ChevronRight size={20} strokeWidth={1.75} /></span>
              : <ChevronRight size={24} strokeWidth={2} />}
          </button>
        )
        : undefined}
    </div>
  )
}

export default Rail
