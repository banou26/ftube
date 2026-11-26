import type { MiniplayerResizeEdge } from './miniplayer-size'
import type { UpNext } from './up-next'

import { css } from '@emotion/react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { getSettings, subscribeSettings, updateSettings, useSetting } from '../settings'
import { isAllowedWithHideShorts } from '../shorts-filter'
import { clampMiniplayerWidth, draggedMiniplayerWidth, miniplayerWidthBounds, stepMiniplayerWidth } from './miniplayer-size'
import { getPlayerSession, openPlayer, playerHost, registerPlayerDock, setTheater, usePlayerSession } from './session'
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
  z-index: 60;
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
    height: 7.6rem;
    padding: 1.2rem 1.6rem;
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
    bottom: 0;
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

  .resize-corner {
    top: 0;
    left: 0;
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

  &:hover .resize-corner::after {
    opacity: 0.65;
  }

  .resize-corner:hover::after,
  .resize-corner:focus-visible::after,
  &.resizing[data-resize-edge='top-left'] .resize-corner::after {
    opacity: 1;
    border-color: var(--accent);
  }

  .resize-left::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .resize-left:hover::after,
  &.resizing[data-resize-edge='left'] .resize-left::after {
    opacity: 0.9;
  }

  .resize-top::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .resize-top:hover::after,
  &.resizing[data-resize-edge='top'] .resize-top::after {
    opacity: 0.9;
  }
`

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
  const storedMiniplayerWidth = useSetting('miniplayerWidth')
  const asideRef = useRef<HTMLElement>(null)
  const [viewport, setViewport] = useState(readViewport)
  const [drag, setDrag] = useState<{ edge: MiniplayerResizeEdge, width: number } | undefined>(undefined)
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
  const renderedWidth = drag
    ? drag.width
    : clampMiniplayerWidth(storedMiniplayerWidth, viewport.width, viewport.height)

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
    const startWidth = Math.round(asideRef.current?.getBoundingClientRect().width ?? renderedWidth)
    let lastWidth = startWidth
    let moved = false

    try {
      handle.setPointerCapture?.(pointerId)
    } catch {
      // ignore synthetic events that cannot capture pointers
    }

    const computeWidth = (point: PointerEvent) => {
      const nextViewport = readViewport()
      return draggedMiniplayerWidth({
        edge,
        startWidth,
        dx: startX - point.clientX,
        dy: startY - point.clientY,
        viewportWidth: nextViewport.width,
        viewportHeight: nextViewport.height,
      })
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
        lastWidth = computeWidth(finalEvent)
      }
      setDrag(undefined)
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      } catch {
        // ignore if capture was already released
      }
      if (commit && moved) updateSettings({ miniplayerWidth: lastWidth })
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) moved = true
      lastWidth = computeWidth(moveEvent)
      setDrag({ edge, width: lastWidth })
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
    setDrag({ edge, width: startWidth })
  }, [docked, renderedWidth])

  const resetMiniplayerWidth = useCallback((event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    stopDragRef.current?.()
    updateSettings({ miniplayerWidth: undefined })
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
        className={[!docked && 'hidden', drag && 'resizing'].filter(Boolean).join(' ') || undefined}
        data-resize-edge={drag?.edge}
        style={docked ? { width: `${renderedWidth}px` } : undefined}
        aria-label='Miniplayer'
        aria-hidden={!docked}
      >
        <div className='dock-slot' ref={registerPlayerDock} />
        {docked
          ? (
            <>
              <div className='dock-meta'>
                <Link
                  className='dock-title'
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
              <div
                className='resize-handle resize-left'
                data-resize='left'
                aria-hidden='true'
                onPointerDown={startResize('left')}
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
                  onTheater={() => setTheater(!session.theater)}
                  onMiniplayer={toggleMiniplayer}
                  ambientMode={ambientMode}
                  onAmbientMode={() => updateSettings({ ambientMode: !ambientMode })}
                  onVideoElement={setAmbientVideo}
                  chapters={watch?.chapters}
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
