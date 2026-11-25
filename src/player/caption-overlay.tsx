import type { CaptionPosition } from '../settings'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { updateSettings, useSetting } from '../settings'
import { DEFAULT_CAPTION_POSITION, extractCueLines, positionFromPointer } from './caption-position'

const DRAG_THRESHOLD_PX = 2

const layerStyle = css`
  position: absolute;
  top: 1.2rem;
  right: 1.2rem;
  bottom: 1.2rem;
  left: 1.2rem;
  overflow: hidden;
  pointer-events: none;
  transition: bottom 0.2s ease;

  &.controls-visible {
    bottom: 8rem;
  }

  &.docked {
    top: 0.8rem;
    right: 0.8rem;
    bottom: 0.8rem;
    left: 0.8rem;
  }

  &.dragging {
    transition: none;
  }

  @container player (max-width: 600px) {
    &.controls-visible {
      bottom: 7.2rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  .caption-window,
  .caption-sample {
    position: absolute;
    left: calc(var(--caption-x) * 100%);
    top: calc(var(--caption-y) * 100%);
    width: max-content;
    max-width: 85%;
    transform: translate(calc(var(--caption-x) * -100%), calc(var(--caption-y) * -100%));
    text-align: center;
  }

  .caption-window {
    pointer-events: auto;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .caption-window[data-dragging] {
    cursor: grabbing;
  }

  &.docked .caption-window {
    pointer-events: none;
    cursor: default;
  }

  .caption-cue {
    display: inline;
    padding: 0 0.25em;
    border-radius: 0.12em;
    line-height: 1.35;
    white-space: pre-wrap;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .caption-sample {
    white-space: nowrap;
    pointer-events: none;
  }
`

const cueLookStyle = (declarations: string) => css`
  .caption-cue,
  .caption-sample {
    ${declarations};
  }
`

const sameLines = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((line, index) => line === b[index])

type DragState = {
  pointerId: number
  grabOffsetX: number
  grabOffsetY: number
  startClientX: number
  startClientY: number
  windowSize: { width: number, height: number }
  moved: boolean
  latestPos?: CaptionPosition
}

/**
 * Renders active WebVTT cues in a draggable overlay inside the video player, keeping clear of visible controls and
 * persisting normalized `{ x, y }` coordinates in settings.
 */
export const CaptionOverlay = ({
  video,
  cueStyle,
  baseSize,
  controlsVisible,
  docked,
  sample,
  onDragStart,
  onClick,
  onDblClick,
}: {
  video: HTMLVideoElement
  cueStyle: string
  baseSize: number
  controlsVisible: boolean
  docked: boolean
  sample?: number
  onDragStart?: () => void
  onClick?: () => void
  onDblClick?: () => void
}) => {
  const storedPos = useSetting('captionPosition')
  const [lines, setLines] = useState<string[]>(() => extractCueLines(video.textTracks))
  const [dragPos, setDragPos] = useState<CaptionPosition | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | undefined>(undefined)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const attached = new Set<TextTrack>()
    const updateLines = () => {
      const next = extractCueLines(video.textTracks)
      setLines((current) => (sameLines(current, next) ? current : next))
    }
    const syncTracks = () => {
      const current = new Set<TextTrack>()
      for (const track of video.textTracks) {
        current.add(track)
        if (!attached.has(track)) {
          attached.add(track)
          track.addEventListener('cuechange', updateLines)
        }
      }
      for (const track of attached) {
        if (!current.has(track)) {
          track.removeEventListener('cuechange', updateLines)
          attached.delete(track)
        }
      }
      updateLines()
    }

    syncTracks()
    const list = video.textTracks
    list.addEventListener('addtrack', syncTracks)
    list.addEventListener('removetrack', syncTracks)
    list.addEventListener('change', updateLines)
    video.addEventListener('seeked', updateLines)
    video.addEventListener('emptied', updateLines)
    return () => {
      list.removeEventListener('addtrack', syncTracks)
      list.removeEventListener('removetrack', syncTracks)
      list.removeEventListener('change', updateLines)
      video.removeEventListener('seeked', updateLines)
      video.removeEventListener('emptied', updateLines)
      for (const track of attached) track.removeEventListener('cuechange', updateLines)
      attached.clear()
    }
  }, [video])

  useEffect(() => {
    if (!docked) return
    dragRef.current = undefined
    suppressClickRef.current = false
    setDragging(false)
    setDragPos(undefined)
  }, [docked])

  const pos = dragPos ?? storedPos ?? DEFAULT_CAPTION_POSITION
  const posVars = { '--caption-x': pos.x, '--caption-y': pos.y }

  const onPointerDown = (event: PointerEvent) => {
    if (docked || event.button !== 0) return
    const windowEl = windowRef.current
    if (!windowEl) return
    event.preventDefault()
    suppressClickRef.current = false
    const winRect = windowEl.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      grabOffsetX: event.clientX - winRect.left,
      grabOffsetY: event.clientY - winRect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      windowSize: { width: winRect.width, height: winRect.height },
      moved: false,
    }
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {}
    setDragging(true)
    onDragStart?.()
  }

  const finishDrag = (event: PointerEvent, commit: boolean) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // Clear dragRef before releasePointerCapture so any synchronous lostpointercapture is a no-op.
    dragRef.current = undefined
    suppressClickRef.current = drag.moved
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    } catch {}
    setDragging(false)
    setDragPos(undefined)
    if (commit && drag.moved && drag.latestPos) {
      updateSettings({ captionPosition: drag.latestPos })
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      finishDrag(event, true)
      return
    }
    const layerEl = layerRef.current
    const windowEl = windowRef.current
    if (!layerEl || !windowEl) return
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) <= DRAG_THRESHOLD_PX) return
      drag.moved = true
    }
    const measured = windowEl.getBoundingClientRect()
    const next = positionFromPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: drag.grabOffsetX,
      grabOffsetY: drag.grabOffsetY,
      layerRect: layerEl.getBoundingClientRect(),
      // Fall back to the size measured at pointerdown when active cues empty mid-drag.
      windowRect: measured.width > 0 && measured.height > 0 ? measured : drag.windowSize,
    })
    drag.latestPos = next
    setDragPos(next)
  }

  const classNames = [
    'caption-layer',
    controlsVisible && !docked ? 'controls-visible' : undefined,
    docked ? 'docked' : undefined,
    dragging ? 'dragging' : undefined,
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={layerRef}
      css={[layerStyle, cueLookStyle(cueStyle)]}
      className={classNames}
      data-caption-overlay=''
      style={{ fontSize: `${baseSize}px` }}
    >
      {lines.length > 0 || dragging
        ? (
          <div
            ref={windowRef}
            className='caption-window'
            data-caption-window=''
            data-dragging={dragging ? '' : undefined}
            style={posVars}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event: PointerEvent) => finishDrag(event, true)}
            onPointerCancel={(event: PointerEvent) => finishDrag(event, false)}
            onLostPointerCapture={(event: PointerEvent) => finishDrag(event, true)}
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              const suppressed = suppressClickRef.current
              suppressClickRef.current = false
              if (suppressed) return
              onClick?.()
            }}
            onDblClick={(event: MouseEvent) => {
              event.stopPropagation()
              onDblClick?.()
            }}
          >
            {lines.map((line, index) => (
              <div key={index} className='caption-line'>
                <span className='caption-cue' data-caption-cue=''>{line}</span>
              </div>
            ))}
          </div>
        )
        : sample !== undefined
          ? (
            <span className='caption-sample' style={{ ...posVars, fontSize: `${sample}px` }}>
              Captions look like this
            </span>
          )
          : undefined}
    </div>
  )
}
