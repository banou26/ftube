import type { TheaterMode } from './theater'

import { useEffect, useState } from 'preact/hooks'

import { clearQueue } from './queue'

import { getSettings, subscribeSettings, updateSettings } from '../settings'

export type PlayerKind = 'video' | 'short'

export type DockedShortItem = {
  id: string
  title?: string | null
  poster?: string | null
  channelName?: string | null
}

export type DockedShortsFeed = {
  items: readonly DockedShortItem[]
  cursor?: string | null
  seed?: string
  sequence?: string
  /** True when the user docked before the initial ShortsFeed query answered. */
  needsInitialFeed?: boolean
}

export type PlayerSession = {
  videoId?: string
  startAt?: number
  title?: string
  poster?: string
  channelName?: string
  kind: PlayerKind
  // Ordered Shorts feed carried across docked playback and Expand back to /shorts/<id>.
  shortsFeed?: DockedShortsFeed
  // the playlist the video is playing from, with its 0-based position, so the end of the video can move along the queue
  list?: string
  index?: number
  // the inline playback params of the card the video was opened from, which its playback reads the watch page with
  playerParams?: string
  theater: TheaterMode
  claimed: boolean
  // the index of the chapter playing, which the player publishes for the watch page's list and cards
  chapter: number
  // the list open beside the player, or over it in full screen
  panel?: VideoPanel
  // true while the live/video element is paused or ended so overlays suppress stale live chat
  paused: boolean
}

export type VideoPanel = 'chapters' | 'transcript'

let session: PlayerSession = { kind: 'video', theater: 'default', claimed: false, chapter: -1, paused: false }
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of Array.from(listeners)) listener()
}

export const getPlayerSession = () => session

const update = (next: Partial<PlayerSession>) => {
  session = { ...session, ...next }
  emit()
}

/**
 * Show a video in the persistent player.
 *
 * Re-opening the video already playing never restarts it, and only takes its
 * title and its queue: the watch route calls this on every render pass that
 * has an id, and treating each one as a fresh open would restart playback
 * whenever the page re-rendered for an unrelated reason.
 */
export const openPlayer = (
  { videoId, startAt, title, poster, channelName, kind, shortsFeed, list, index, playerParams }: {
    videoId: string
    startAt?: number
    title?: string
    poster?: string
    channelName?: string
    kind?: PlayerKind
    shortsFeed?: DockedShortsFeed
    list?: string
    index?: number
    playerParams?: string
  },
) => {
  const nextKind = kind ?? 'video'
  const nextShortsFeed = nextKind === 'short'
    ? (shortsFeed ?? (session.kind === 'short' ? session.shortsFeed : undefined))
    : undefined
  if (session.videoId === videoId) {
    const retitled = title !== undefined && title !== session.title
    const retyped = nextKind !== session.kind
    const repostered = poster !== undefined && poster !== session.poster
    const rechanneled = channelName !== undefined && channelName !== session.channelName
    const refeed = nextShortsFeed !== session.shortsFeed
    if (retitled || retyped || repostered || rechanneled || refeed || list !== session.list || index !== session.index) {
      update({
        title: title ?? session.title,
        poster: poster ?? session.poster,
        channelName: channelName ?? session.channelName,
        kind: nextKind,
        shortsFeed: nextShortsFeed,
        list,
        index,
      })
    }
    return
  }
  update({
    videoId, startAt, title, poster, channelName, kind: nextKind, shortsFeed: nextShortsFeed, list, index, playerParams,
    theater: getSettings().theater, chapter: -1, panel: undefined, paused: false,
  })
}

export const updateShortsFeed = (shortsFeed: DockedShortsFeed) => {
  if (session.kind === 'short') update({ shortsFeed })
}

// the ONLY thing that closes the frame's SABR session: route unmount deliberately does not
/**
 * Stop playback entirely.
 *
 * This is the ONLY thing that closes the frame's SABR session now. Route
 * unmount deliberately does not, which is the whole point of the dock.
 */
export const closePlayer = () => {
  clearQueue()
  update({
    videoId: undefined, startAt: undefined, title: undefined, poster: undefined, channelName: undefined, kind: 'video',
    shortsFeed: undefined, list: undefined, index: undefined, playerParams: undefined, theater: 'default',
    chapter: -1, panel: undefined, paused: false,
  })
}

export const setTheater = (theater: TheaterMode) => {
  update({ theater })
  if (getSettings().theater !== theater) updateSettings({ theater })
}

subscribeSettings((next) => {
  if (session.videoId && next.theater !== session.theater) update({ theater: next.theater })
})

export const setPlayingChapter = (chapter: number) => {
  if (chapter !== session.chapter) update({ chapter })
}

export const setPanel = (panel: VideoPanel | undefined) => {
  if (panel !== session.panel) update({ panel })
}

export const setPlayerPaused = (paused: boolean) => {
  if (paused !== session.paused) update({ paused })
}

export const usePlayerSession = () => {
  const [value, setValue] = useState(session)
  useEffect(() => {
    const listener = () => setValue(session)
    listeners.add(listener)
    // the store can have moved between the initial read and this effect
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}

// MOVED with appendChild, never createPortal: a container change remounts a FRESH <video> and loses the MediaSource
let host: HTMLDivElement | undefined
let dock: HTMLElement | undefined

const ensureHost = () => {
  host ??= Object.assign(document.createElement('div'), { className: 'player-host' })
  return host
}

export const registerPlayerDock = (element: HTMLElement | null) => {
  dock = element ?? undefined
  if (dock && host && host.parentElement === null) dock.append(host)
}

/**
 * Move the player into `slot`, or back to the dock when it is null.
 *
 * Called from a ref callback, so it runs with the element on mount and with
 * null on unmount, which is exactly the claim/release pair the dock needs.
 */
export const claimPlayer = (slot: HTMLElement | null) => {
  const element = ensureHost()
  const target = slot ?? dock
  if (target && element.parentElement !== target) target.append(element)
  if (session.claimed !== Boolean(slot)) update({ claimed: Boolean(slot) })
}

/** Moves the unclaimed player host back to the dock container (e.g., when closing Document PiP). */
export const returnPlayerToDock = () => {
  const element = ensureHost()
  if (dock && !session.claimed && element.parentElement !== dock) dock.append(element)
}

export const playerHost = ensureHost
