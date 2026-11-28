import type { MiniplayerRect, MiniplayerResizeEdge } from './miniplayer-size'
import type { UpNext } from './up-next'

import { css } from '@emotion/react'
import { GripHorizontal } from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { getSettings, subscribeSettings, updateSettings, useSetting } from '../settings'
import { isAllowedWithHideShorts } from '../shorts-filter'
import {
  clampMiniplayerWidth,
  draggedMiniplayerWidth,
  MINIPLAYER_META_HEIGHT,
  MINIPLAYER_MOVE_LARGE_STEP,
  MINIPLAYER_MOVE_STEP,
  miniplayerBoxHeight,
  miniplayerPositionBounds,
  miniplayerWidthBounds,
  nudgeMiniplayerPosition,
  positionFromCoords,
  resizedMiniplayerRect,
  resolveMiniplayerRect,
  stepMiniplayerWidth,
} from './miniplayer-size'
import { getPlayerSession, openPlayer, playerHost, registerPlayerDock, setTheater, usePlayerSession } from './session'
import { nextTheaterMode } from './theater'
import { upNextHref } from './end-screen'
import { AmbientGlow } from './ambient-glow'
import { getFullscreenElement, subscribeFullscreen } from './fullscreen'
import { PlayerFrame } from './player-frame'
import { useSponsorSegments } from './sponsorblock'
import { hasNextInQueue, markPlayed, nextQueueIndex, pickAutoplay, previousQueueIndex } from './up-next'
import { nextInQueueIndex, previousInQueueIndex, syncQueueVideo, useQueue } from './queue'
import VideoPlayer from './video-player'
import { descriptionOf, WATCH_META_QUERY } from './watch-query'

const style = css`
  /* The dock is always mounted so the player's DOM home has somewhere to live
     even before a route claims it. It only becomes VISIBLE once a video is
     playing and no route is showing it. */
  position: fixed;
  right: 1.6rem;
  bottom: 1.6rem;
  z-index: 1500;
  width: 40rem;
  max-width: calc(100vw - 3.2rem);
  border-radius: 1.2rem;
  overflow: hidden;
  background: var(--bg-subtle);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.2);

  &.hidden {
    /* Moved off-screen rather than hidden with display none: the player lives
       in here, and a display-none ancestor gives the video element a zero-sized
       box. Shaka's restrictToElementSize then filters every variant away and
       the next quality decision picks the floor. Off-screen, the element keeps
       its real dimensions. */
    position: fixed;
    left: -20000px;
    top: 0;
    right: auto;
    bottom: auto;
    width: 40rem;
    box-shadow: none;
    pointer-events: none;
  }

  /* above the lines under it, which the knob overhangs as on youtube.com */
  .dock-slot {
    position: relative;
    z-index: 1;
  }

  /* youtube.com's miniplayer has none of the player bar's groups, only its seek bar, drawn all the time along the
     bottom edge of the video, 3 px tall */
  .dock-slot [data-player-root] {
    border-radius: 0;
    overflow: visible;
  }

  .dock-slot .bar {
    display: none;
  }

  .dock-slot div:has(> .scrubber) {
    padding: 0;
    opacity: 1;
    pointer-events: auto;
  }

  .dock-slot .scrubber {
    padding-bottom: 0;
  }

  .dock-slot .rail {
    height: 0.3rem;
  }

  /* youtube.com's miniplayer names no chapter under the frame its seek bar shows */
  .preview-chapter {
    display: none;
  }

  .dock-meta {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 7.6rem;
    padding: 1.2rem 1.2rem 1.2rem 1.6rem;
    cursor: grab;
    touch-action: none;
  }

  .dock-text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .dock-move {
    flex: none;
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    border: none;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--text-secondary);
    cursor: grab;
    touch-action: none;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .dock-move:hover,
  .dock-move:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dock-move:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 1px;
  }

  &.moving,
  &.moving .dock-meta,
  &.moving .dock-move,
  &.moving .dock-slot {
    cursor: grabbing;
    user-select: none;
  }

  &.moving .dock-slot,
  &.moving .dock-text {
    pointer-events: none;
  }

  .dock-title,
  .dock-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dock-title {
    display: block;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 2rem;
    text-decoration: none;
  }

  .dock-byline {
    display: flex;
    margin-top: 0.4rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    line-height: 1.8rem;
  }

  .dock-index {
    flex: none;
  }

  .dock-index::before {
    content: '•';
    margin: 0 0.4rem;
  }

  &.resizing .dock-slot,
  &.resizing .dock-meta {
    pointer-events: none;
    user-select: none;
  }

  .resize-handle {
    position: absolute;
    touch-action: none;
  }

  .resize-left {
    top: 1.4rem;
    left: 0;
    bottom: 0.8rem;
    width: 0.8rem;
    z-index: 3;
    cursor: ew-resize;
  }

  .resize-right {
    top: 4rem;
    right: 0;
    bottom: 1.4rem;
    width: 0.8rem;
    z-index: 3;
    cursor: ew-resize;
  }

  /* leave the top-right 4rem clear for the Close miniplayer button */
  .resize-top {
    top: 0;
    left: 1.4rem;
    right: 4rem;
    height: 0.8rem;
    z-index: 3;
    cursor: ns-resize;
  }

  .resize-bottom {
    left: 0.8rem;
    right: 1.4rem;
    bottom: 0;
    height: 0.8rem;
    z-index: 3;
    cursor: ns-resize;
  }

  .resize-corner {
    top: 0;
    left: 0;
    width: 1.4rem;
    height: 1.4rem;
    z-index: 4;
    cursor: nwse-resize;
  }

  .resize-bottom-right {
    right: 0;
    bottom: 0;
    width: 1.4rem;
    height: 1.4rem;
    z-index: 4;
    cursor: nwse-resize;
  }

  .resize-corner:focus-visible {
    outline: none;
  }

  .resize-corner::after {
    content: '';
    position: absolute;
    inset: 0;
    border-top: 2px solid #ffffff;
    border-left: 2px solid #ffffff;
    border-top-left-radius: 1.2rem;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .resize-bottom-right::after {
    content: '';
    position: absolute;
    inset: 0;
    border-right: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    border-bottom-right-radius: 1.2rem;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  &:hover .resize-corner::after,
  &:hover .resize-bottom-right::after {
    opacity: 0.65;
  }

  .resize-corner:hover::after,
  .resize-corner:focus-visible::after,
  &.resizing[data-resize-edge='top-left'] .resize-corner::after,
  .resize-bottom-right:hover::after,
  &.resizing[data-resize-edge='bottom-right'] .resize-bottom-right::after {
    opacity: 1;
    border-color: var(--accent);
  }

  .resize-left::after,
  .resize-right::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .resize-left::after {
    left: 0;
  }

  .resize-right::after {
    right: 0;
  }

  .resize-left:hover::after,
  &.resizing[data-resize-edge='left'] .resize-left::after,
  .resize-right:hover::after,
  &.resizing[data-resize-edge='right'] .resize-right::after {
    opacity: 0.9;
  }

  .resize-top::after,
  .resize-bottom::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .resize-top::after {
    top: 0;
  }

  .resize-bottom::after {
    bottom: 0;
  }

  .resize-top:hover::after,
  &.resizing[data-resize-edge='top'] .resize-top::after,
  .resize-bottom:hover::after,
  &.resizing[data-resize-edge='bottom'] .resize-bottom::after {
    opacity: 0.9;
  }
`

const DRAG_THRESHOLD = 5

const isInteractiveDragControl = (target: EventTarget | null) =>
  target instanceof Element
  && Boolean(target.closest('button:not(.dock-move), input, select, textarea, [role="slider"], [role="button"], .resize-handle, .scrubber, .mini-volume'))

const readViewport = () => (typeof document === 'undefined'
  ? { width: 1280, height: 800 }
  : {
      width: document.documentElement.clientWidth || window.innerWidth || 1280,
      height: document.documentElement.clientHeight || window.innerHeight || 800,
    })

/**
 * The one player instance, mounted above the router.
 *
 * It renders into a detached host node that `claimPlayer` moves between a
 * route's own layout and this dock. Nothing here re-renders when the player
 * moves: the host node's identity never changes, so the portal below keeps
 * targeting the same container wherever that container has been moved to.
 *
 * Closing is an explicit action. Leaving the watch page is not one, which is
 * the difference between this and the old in-route player.
 */
const PersistentPlayer = () => {
  const session = usePlayerSession()
  const docked = Boolean(session.videoId) && !session.claimed
  const [location, navigate] = useLocation()
  const search = useSearch()
  const [autoplay, setAutoplay] = useState(() => getSettings().autoplay)
  useEffect(() => subscribeSettings(settings => setAutoplay(settings.autoplay)), [])
  const ambientMode = useSetting('ambientMode')
  const annotations = useSetting('annotations')
  const storedMiniplayerWidth = useSetting('miniplayerWidth')
  const storedMiniplayerPosition = useSetting('miniplayerPosition')
  const asideRef = useRef<HTMLElement>(null)
  const metaRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(readViewport)
  const [drag, setDrag] = useState<{ edge: MiniplayerResizeEdge, width: number, rect?: MiniplayerRect } | undefined>(undefined)
  const [dragMove, setDragMove] = useState<MiniplayerRect | undefined>(undefined)
  const stopDragRef = useRef<(() => void) | undefined>(undefined)
  const [ambientVideo, setAmbientVideo] = useState<HTMLVideoElement | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!docked) {
      stopDragRef.current?.()
      return
    }
    const update = () => setViewport(readViewport())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [docked])

  useEffect(() => () => {
    stopDragRef.current?.()
  }, [])

  const bounds = miniplayerWidthBounds(viewport.width, viewport.height)
  const renderedWidth = dragMove
    ? dragMove.width
    : drag
      ? drag.width
      : clampMiniplayerWidth(storedMiniplayerWidth, viewport.width, viewport.height)

  const currentMetaHeight = () => metaRef.current?.offsetHeight || MINIPLAYER_META_HEIGHT
  const boxHeight = miniplayerBoxHeight(renderedWidth, MINIPLAYER_META_HEIGHT)

  const positionedRect = dragMove
    ?? drag?.rect
    ?? (storedMiniplayerPosition !== undefined
      ? resolveMiniplayerRect(storedMiniplayerPosition, renderedWidth, boxHeight, viewport.width, viewport.height)
      : undefined)

  const startMoveDrag = useCallback((event: PointerEvent) => {
    if (event.button !== 0 || !docked) return
    if (isInteractiveDragControl(event.target)) return
    const aside = asideRef.current
    if (!aside) return
    stopDragRef.current?.()

    const handle = event.currentTarget as HTMLElement
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const liveViewport = readViewport()
    setViewport(liveViewport)
    const measuredRect = aside.getBoundingClientRect()
    const startWidth = Math.round(measuredRect.width) || renderedWidth
    const startHeight = Math.round(measuredRect.height) || miniplayerBoxHeight(startWidth, currentMetaHeight())
    const startLeft = Math.round(measuredRect.left)
    const startTop = Math.round(measuredRect.top)
    let moved = false
    let latestRect: MiniplayerRect = { left: startLeft, top: startTop, width: startWidth, height: startHeight }
    let clickCleanupTimer: ReturnType<typeof setTimeout> | undefined

    const computeMovedRect = (point: PointerEvent): MiniplayerRect => {
      const nextViewport = readViewport()
      const moveBounds = miniplayerPositionBounds(nextViewport.width, nextViewport.height, startWidth, startHeight)
      return {
        left: Math.round(Math.min(moveBounds.maxLeft, Math.max(moveBounds.minLeft, startLeft + (point.clientX - startX)))),
        top: Math.round(Math.min(moveBounds.maxTop, Math.max(moveBounds.minTop, startTop + (point.clientY - startY)))),
        width: startWidth,
        height: startHeight,
      }
    }

    const suppressNextClick = (clickEvent: Event) => {
      clickEvent.preventDefault()
      clickEvent.stopPropagation()
      window.removeEventListener('click', suppressNextClick, true)
      if (clickCleanupTimer !== undefined) {
        clearTimeout(clickCleanupTimer)
        clickCleanupTimer = undefined
      }
    }

    let finished = false
    const finish = (commit: boolean, finalEvent?: PointerEvent) => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onBlur)
      stopDragRef.current = undefined
      if (finalEvent) {
        const dist = Math.hypot(finalEvent.clientX - startX, finalEvent.clientY - startY)
        if (moved || dist >= DRAG_THRESHOLD) {
          moved = true
          latestRect = computeMovedRect(finalEvent)
        }
      }
      setDragMove(undefined)
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      } catch {
        // ignore if capture was already released
      }
      if (moved) {
        window.addEventListener('click', suppressNextClick, true)
        clickCleanupTimer = setTimeout(() => {
          window.removeEventListener('click', suppressNextClick, true)
          clickCleanupTimer = undefined
        }, 50)
      }
      if (commit && moved) {
        const commitViewport = readViewport()
        const commitBounds = miniplayerPositionBounds(commitViewport.width, commitViewport.height, latestRect.width, latestRect.height)
        updateSettings({ miniplayerPosition: positionFromCoords(latestRect.left, latestRect.top, commitBounds) })
      }
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
      if (!moved && dist < DRAG_THRESHOLD) return
      if (!moved) {
        moved = true
        try {
          handle.setPointerCapture?.(pointerId)
        } catch {
          // ignore synthetic events that cannot capture pointers
        }
      }
      latestRect = computeMovedRect(moveEvent)
      setDragMove(latestRect)
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      finish(true, upEvent)
    }

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      finish(false)
    }

    const onBlur = () => finish(false)

    stopDragRef.current = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
  }, [docked, renderedWidth])

  const startResize = useCallback((edge: MiniplayerResizeEdge) => (event: PointerEvent) => {
    if (event.button !== 0 || !docked) return
    event.preventDefault()
    event.stopPropagation()
    stopDragRef.current?.()

    const handle = event.currentTarget as HTMLElement
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const liveViewport = readViewport()
    setViewport(liveViewport)
    const metaHeight = currentMetaHeight()
    const measuredRect = asideRef.current?.getBoundingClientRect()
    const startWidth = Math.round(measuredRect?.width ?? renderedWidth)
    const startHeight = Math.round(measuredRect?.height ?? miniplayerBoxHeight(startWidth, metaHeight))
    const anchoredMove = storedMiniplayerPosition !== undefined || edge === 'right' || edge === 'bottom' || edge === 'bottom-right'
    const startRect: MiniplayerRect = measuredRect
      ? {
          left: Math.round(measuredRect.left),
          top: Math.round(measuredRect.top),
          width: startWidth,
          height: startHeight,
        }
      : resolveMiniplayerRect(storedMiniplayerPosition, startWidth, startHeight, liveViewport.width, liveViewport.height)
    let lastWidth = startWidth
    let lastRect: MiniplayerRect | undefined = anchoredMove ? startRect : undefined
    let moved = false

    try {
      handle.setPointerCapture?.(pointerId)
    } catch {
      // ignore synthetic events that cannot capture pointers
    }

    const computeNext = (point: PointerEvent) => {
      const nextViewport = readViewport()
      if (anchoredMove) {
        const nextRect = resizedMiniplayerRect({
          startRect,
          edge,
          dx: point.clientX - startX,
          dy: point.clientY - startY,
          viewportWidth: nextViewport.width,
          viewportHeight: nextViewport.height,
          metaHeight,
        })
        return { width: nextRect.width, rect: nextRect }
      }
      return {
        width: draggedMiniplayerWidth({
          edge,
          startWidth,
          dx: startX - point.clientX,
          dy: startY - point.clientY,
          viewportWidth: nextViewport.width,
          viewportHeight: nextViewport.height,
        }),
        rect: undefined,
      }
    }

    let finished = false
    const finish = (commit: boolean, finalEvent?: PointerEvent) => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onBlur)
      stopDragRef.current = undefined
      if (finalEvent && (finalEvent.clientX !== startX || finalEvent.clientY !== startY)) {
        moved = true
        const next = computeNext(finalEvent)
        lastWidth = next.width
        lastRect = next.rect
      }
      setDrag(undefined)
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      } catch {
        // ignore if capture was already released
      }
      if (commit && moved) {
        if (anchoredMove && lastRect) {
          const commitViewport = readViewport()
          const commitBounds = miniplayerPositionBounds(commitViewport.width, commitViewport.height, lastRect.width, lastRect.height)
          updateSettings({
            miniplayerWidth: lastRect.width,
            miniplayerPosition: positionFromCoords(lastRect.left, lastRect.top, commitBounds),
          })
        } else {
          updateSettings({ miniplayerWidth: lastWidth })
        }
      }
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) moved = true
      const next = computeNext(moveEvent)
      lastWidth = next.width
      lastRect = next.rect
      setDrag({ edge, width: next.width, rect: next.rect })
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      finish(true, upEvent)
    }

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      finish(false)
    }

    const onBlur = () => finish(false)

    stopDragRef.current = () => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
    setDrag({ edge, width: startWidth, rect: lastRect })
  }, [docked, renderedWidth, storedMiniplayerPosition])

  const resetMiniplayerWidth = useCallback((event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    stopDragRef.current?.()
    updateSettings({ miniplayerWidth: undefined })
  }, [])

  const resetMiniplayerPosition = useCallback((event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    stopDragRef.current?.()
    updateSettings({ miniplayerPosition: undefined })
  }, [])

  const stopHandleClick = useCallback((event: MouseEvent) => {
    event.stopPropagation()
  }, [])

  const onCornerKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      updateSettings({ miniplayerWidth: stepMiniplayerWidth(renderedWidth, 1, event.shiftKey, viewport.width, viewport.height) })
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      updateSettings({ miniplayerWidth: stepMiniplayerWidth(renderedWidth, -1, event.shiftKey, viewport.width, viewport.height) })
      return
    }
    if (event.key === 'Home' || event.key === '0') {
      event.preventDefault()
      event.stopPropagation()
      updateSettings({ miniplayerWidth: undefined })
    }
  }, [renderedWidth, viewport.width, viewport.height])

  const onMoveKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const step = event.shiftKey ? MINIPLAYER_MOVE_LARGE_STEP : MINIPLAYER_MOVE_STEP
    const height = miniplayerBoxHeight(renderedWidth, currentMetaHeight())
    let dx = 0
    let dy = 0
    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault()
      event.stopPropagation()
      updateSettings({ miniplayerPosition: undefined })
      return
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    updateSettings({
      miniplayerPosition: nudgeMiniplayerPosition(
        storedMiniplayerPosition,
        dx,
        dy,
        renderedWidth,
        height,
        viewport.width,
        viewport.height,
      ),
    })
  }, [renderedWidth, storedMiniplayerPosition, viewport.width, viewport.height])

  const videoId = session.videoId
  // the same document and variables as the watch route, so on the watch page both share its one /next
  const [{ data }] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: videoId ?? '', playlistId: session.list, playlistIndex: session.index },
    pause: !videoId,
  })
  const watch = videoId !== undefined && data?.watch?.id === videoId ? data.watch : undefined
  const segments = useSponsorSegments(watch && !watch.isLive ? watch.id : undefined)

  useEffect(() => {
    if (videoId) markPlayed(videoId)
    syncQueueVideo(videoId)
  }, [videoId])

  const localQueue = useQueue()
  const playlist = session.list !== undefined && watch?.playlist?.id === session.list ? watch.playlist : undefined
  const count = playlist?.items.length ?? 0
  const current = Math.min(Math.max(playlist?.currentIndex ?? 0, 0), Math.max(count - 1, 0))
  const localNextIndex = !playlist ? nextInQueueIndex(localQueue) : undefined
  const localPrevIndex = !playlist ? previousInQueueIndex(localQueue) : undefined
  const localPick = localNextIndex !== undefined ? localQueue.items[localNextIndex] : undefined
  // read when the video ends, since loop and shuffle change without re-rendering this
  const queued = () =>
    (playlist !== undefined && hasNextInQueue(current, count))
    || (!playlist && nextInQueueIndex(localQueue) !== undefined)

  const hideShorts = useSetting('hideShorts')
  const suggestions = useMemo(
    () => (watch?.related ?? []).filter(video => video.id !== videoId && isAllowedWithHideShorts(video, hideShorts)),
    [watch, videoId, hideShorts],
  )
  const preferred = watch?.autoplayId
  const autoplayPick = useMemo(
    () => (videoId ? pickAutoplay(suggestions, videoId, { preferred }) : undefined),
    [suggestions, videoId, preferred],
  )
  const pick = localPick ?? autoplayPick

  // the page a full screen player left behind, since a navigation would move the player out of full screen
  const behind = useRef<string | undefined>(undefined)

  // the watch page navigates; the miniplayer, and the watch page in full screen, play in place and leave the page alone
  const open = (target: UpNext) => {
    if (getPlayerSession().claimed) {
      if (!getFullscreenElement()) {
        navigate(upNextHref(target))
        return
      }
      behind.current ??= `${window.location.pathname}${window.location.search}`
    }
    openPlayer({ videoId: target.id, title: target.title ?? undefined, list: target.list, index: target.index })
  }

  // once full screen ends, the watch page catches up with the video played in it, unless the page moved on meanwhile
  useEffect(() => {
    const follow = () => {
      if (getFullscreenElement()) return
      const left = behind.current
      behind.current = undefined
      const current = getPlayerSession()
      if (left !== `${window.location.pathname}${window.location.search}` || !current.videoId || !current.claimed) return
      if (new URLSearchParams(window.location.search).get('v') === current.videoId) return
      navigate(upNextHref({ id: current.videoId, list: current.list, index: current.index }))
    }
    return subscribeFullscreen(follow)
  }, [navigate])

  const queueEntry = (index: number | undefined) => {
    const item = index === undefined ? undefined : playlist?.items[index]
    return item && playlist ? { id: item.id, title: item.title, thumbnail: item.thumbnail, list: playlist.id, index } : undefined
  }

  // where i leaves the watch page for, as youtube.com returns to the page the video was opened from
  const lastPage = useRef('/')
  useEffect(() => {
    if (!location.startsWith('/watch')) lastPage.current = search ? `${location}?${search}` : location
  }, [location, search])
  const toggleMiniplayer = () => {
    const current = getPlayerSession()
    if (!current.videoId) return
    navigate(current.claimed ? lastPage.current : upNextHref({ id: current.videoId, list: current.list, index: current.index }))
  }

  const next = count > 1 || pick
    ? () => {
      const target = playlist
        ? queueEntry(nextQueueIndex(current, count)) ?? autoplayPick
        : localPick ?? autoplayPick
      if (target) open(target)
    }
    : undefined

  // youtube.com's Shift+P steps back through a playlist only, and does nothing on its first entry or outside one
  const previous = playlist
    ? () => {
      const target = queueEntry(previousQueueIndex(current, count))
      if (target) open(target)
    }
    : localPrevIndex !== undefined
    ? () => {
      const target = localQueue.items[localPrevIndex]
      if (target) open(target)
    }
    : undefined

  return (
    <>
      <aside
        ref={asideRef}
        css={style}
        className={[!docked && 'hidden', drag && 'resizing', dragMove && 'moving'].filter(Boolean).join(' ') || undefined}
        data-resize-edge={drag?.edge}
        style={docked
          ? positionedRect
            ? {
                left: `${positionedRect.left}px`,
                top: `${positionedRect.top}px`,
                right: 'auto',
                bottom: 'auto',
                width: `${positionedRect.width}px`,
              }
            : { width: `${renderedWidth}px` }
          : undefined}
        aria-label='Miniplayer'
        aria-hidden={!docked}
        onPointerDown={startMoveDrag}
      >
        <div className='dock-slot' ref={registerPlayerDock} />
        {docked
          ? (
            <>
              <div className='dock-meta' ref={metaRef}>
                <div className='dock-text'>
                  <Link
                    className='dock-title'
                    draggable={false}
                    href={upNextHref({ id: session.videoId!, list: session.list, index: session.index })}
                  >
                    {watch?.title ?? session.title ?? 'Now playing'}
                  </Link>
                  {/* youtube.com names the playlist and the place in it where it would name the channel */}
                  {playlist || localQueue.currentIndex >= 0 || watch?.channel?.name
                    ? (
                      <div className='dock-byline'>
                        <span className='dock-name'>
                          {playlist ? playlist.title ?? 'Playlist' : localQueue.currentIndex >= 0 ? 'Queue' : watch?.channel?.name}
                        </span>
                        {playlist && count > 0
                          ? <span className='dock-index'>{current + 1} / {count}</span>
                          : !playlist && localQueue.currentIndex >= 0
                            ? <span className='dock-index'>{localQueue.currentIndex + 1} / {localQueue.items.length}</span>
                            : undefined}
                      </div>
                    )
                    : undefined}
                </div>
                <button
                  type='button'
                  className='dock-move'
                  aria-label='Move miniplayer'
                  title='Drag to move miniplayer (double-click to reset)'
                  onDoubleClick={resetMiniplayerPosition}
                  onKeyDown={onMoveKeyDown}
                >
                  <GripHorizontal size={16} strokeWidth={1.75} />
                </button>
              </div>
              <div
                className='resize-handle resize-left'
                data-resize='left'
                aria-hidden='true'
                onPointerDown={startResize('left')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
              />
              <div
                className='resize-handle resize-right'
                data-resize='right'
                aria-hidden='true'
                onPointerDown={startResize('right')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
              />
              <div
                className='resize-handle resize-top'
                data-resize='top'
                aria-hidden='true'
                onPointerDown={startResize('top')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
              />
              <div
                className='resize-handle resize-bottom'
                data-resize='bottom'
                aria-hidden='true'
                onPointerDown={startResize('bottom')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
              />
              <div
                className='resize-handle resize-corner'
                data-resize='top-left'
                role='separator'
                aria-label='Resize miniplayer'
                aria-orientation='horizontal'
                aria-valuemin={bounds.min}
                aria-valuemax={bounds.max}
                aria-valuenow={renderedWidth}
                aria-valuetext={`${renderedWidth}px`}
                tabIndex={0}
                title='Drag to resize miniplayer (double-click to reset)'
                onPointerDown={startResize('top-left')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
                onKeyDown={onCornerKeyDown}
              />
              <div
                className='resize-handle resize-bottom-right'
                data-resize='bottom-right'
                aria-hidden='true'
                onPointerDown={startResize('bottom-right')}
                onClick={stopHandleClick}
                onDoubleClick={resetMiniplayerWidth}
              />
            </>
          )
          : undefined}
      </aside>
      {createPortal(
        session.videoId
          ? (
            <>
              <AmbientGlow
                video={ambientVideo}
                enabled={ambientMode}
                fullscreen={fullscreen}
                docked={docked}
              />
              <PlayerFrame
                onFullscreenChange={setFullscreen}
                details={{
                  videoId: session.videoId,
                  list: session.list,
                  title: watch?.title ?? session.title,
                  likeStatus: watch?.likeStatus,
                  commentsHidden: watch?.commentsHidden === true,
                  commentCountText: watch?.commentCountText,
                  videos: suggestions,
                  onOpen: open,
                  chapters: watch?.chapters ?? [],
                  chapter: session.chapter,
                  panel: session.panel,
                  transcript: watch?.transcriptPanel ?? undefined,
                  description: watch ? descriptionOf(watch) : undefined,
                }}
              >
                <VideoPlayer
                  key={`player:${session.videoId}`}
                  videoId={session.videoId}
                  playerParams={session.playerParams}
                  list={session.list}
                  title={watch?.title ?? session.title}
                  channelName={watch?.channel?.name ?? undefined}
                  startAt={session.startAt}
                  docked={docked}
                  theater={session.theater}
                  onTheater={() => setTheater(nextTheaterMode(session.theater))}
                  onMiniplayer={toggleMiniplayer}
                  ambientMode={ambientMode}
                  onAmbientMode={() => updateSettings({ ambientMode: !ambientMode })}
                  annotations={annotations}
                  onAnnotations={() => updateSettings({ annotations: !annotations })}
                  onVideoElement={setAmbientVideo}
                  chapters={watch?.chapters}
                  heatmap={watch?.heatmap}
                  segments={segments}
                  teasers={watch?.cardTeasers}
                  cardsAvatar={watch?.channelCard?.avatar}
                  upNext={{
                    autoplay,
                    onAutoplay: (value: boolean) => updateSettings({ autoplay: value }),
                    queued,
                    pick,
                    suggestions,
                    onNext: next,
                    onPrevious: previous,
                    onOpen: open,
                  }}
                />
              </PlayerFrame>
            </>
          )
          : null,
        playerHost(),
      )}
    </>
  )
}

export default PersistentPlayer
