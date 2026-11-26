import type { GroupSync, GroupSyncOutcome } from './sync'

import { useEffect, useState } from 'preact/hooks'

import { startPlatform } from '../engine/platform'
import { groupStore } from './store'
import { FKN_BOUND_MS, groupSync, within } from './sync'

/**
 * @fkn/lib's account and cloud storage. Imported only once the platform has mounted the broker frame, which the lib
 * adopts as it loads: imported earlier, it would mount a second one that is not the overlay host.
 */
export const fknLib = async () => {
  await startPlatform()
  const [account, fs] = await Promise.all([import('@fkn/lib/account'), import('@fkn/lib/cloud/fs')])
  return { account, fs }
}

export type FknLib = Awaited<ReturnType<typeof fknLib>>

/**
 * `lib`, whether this page is signed in to FKN and whether it has to unlock its storage, or undefined when FKN did not
 * answer. `account.info()` cannot tell: it answers null for a sign out and for any failure alike.
 */
export const readFkn = async (lib: FknLib) => {
  const availability = await lib.fs.availability()
  if (availability === 'unknown') return undefined
  const encryption = availability === 'connected' ? await within(FKN_BOUND_MS, () => lib.fs.encryption(), () => undefined) : undefined
  return { lib, signedIn: availability === 'connected', locked: !!encryption && !encryption.unlocked && encryption.enrolled }
}

export type GroupSyncState = 'loading' | 'unavailable' | 'signed-out' | 'locked' | 'synced' | 'error'

export type GroupSyncStatus = {
  state: GroupSyncState
  syncing: boolean
  lib?: FknLib
}

const REFRESH_MS = 3 * 60_000
const STARTUP_RETRY_DELAYS_MS = [5_000, 15_000] as const

const STATE_BY_OUTCOME: Record<GroupSyncOutcome, GroupSyncState> = {
  unknown: 'unavailable',
  'signed-out': 'signed-out',
  locked: 'locked',
  synced: 'synced',
  error: 'error',
}

let status: GroupSyncStatus = { state: 'loading', syncing: false }
const statusListeners = new Set<(next: GroupSyncStatus) => void>()

const setStatus = (patch: Partial<GroupSyncStatus>) => {
  status = { ...status, ...patch }
  for (const listener of statusListeners) listener(status)
}

/** Returns the current live FKN group sync status snapshot. */
export const getGroupSyncStatus = () => status

/** Subscribes to live updates of the FKN group sync status snapshot. */
export const subscribeGroupSyncStatus = (listener: (next: GroupSyncStatus) => void) => {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

/** React/Preact hook reading the live FKN group sync status and loaded FKN lib handle. */
export const useGroupSyncStatus = () => {
  const [current, setCurrent] = useState(getGroupSyncStatus)
  useEffect(() => {
    setCurrent(getGroupSyncStatus())
    return subscribeGroupSyncStatus(setCurrent)
  }, [])
  return current
}

let started: Promise<GroupSync> | undefined

/**
 * Keeps the groups in step with the FKN account signed in, from now on. A start that could not load the lib is tried
 * again on the next call; one without navigator.locks never starts.
 */
export const startGroupSync = (): Promise<GroupSync> => started ??= fknLib().then(({ account, fs }) => {
  // only a secure context has navigator.locks, and without it two tabs' steps could undo each other's writes
  if (!('locks' in navigator)) throw new Error('groups: no navigator.locks, so no FKN account sync')
  const lib: FknLib = { account, fs }
  setStatus({ lib })

  let inFlight = 0
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let trigger = () => {}

  const onStatus = (outcome: GroupSyncOutcome) => {
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (outcome === 'unknown') {
      if (retryAttempt < STARTUP_RETRY_DELAYS_MS.length) {
        const delay = STARTUP_RETRY_DELAYS_MS[retryAttempt++]!
        retryTimer = setTimeout(trigger, delay)
      }
    } else {
      retryAttempt = 0
    }
    setStatus({ state: STATE_BY_OUTCOME[outcome] })
  }

  const sync = groupSync({
    store: groupStore,
    cloud: {
      availability: () => fs.availability(),
      unlocked: async () => (await fs.encryption()).unlocked,
      read: path => fs.promises.readFile(path, { encoding: 'utf8' }).then(
        text => typeof text === 'string' ? text : new TextDecoder().decode(text),
        (error: unknown) => {
          if (fs.isNotFound(error)) return null
          throw error
        },
      ),
      write: (path, text) => fs.promises.writeFile(path, text),
    },
    onAccountChange: account.onChange,
    lock: work => navigator.locks.request('yt-client:groups', work),
    onStatus,
  })

  const check = () => {
    inFlight += 1
    setStatus({ syncing: true })
    return sync.check().finally(() => {
      inFlight -= 1
      if (inFlight === 0) setStatus({ syncing: false })
    })
  }
  trigger = () => void check()

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger()
  })
  window.addEventListener('focus', trigger)
  window.addEventListener('online', trigger)
  // two windows both in view see each other's edits without either being hidden
  setInterval(() => {
    if (document.visibilityState === 'visible') trigger()
  }, REFRESH_MS)
  trigger()
  return { check }
}).catch((error: unknown) => {
  started = undefined
  setStatus({ state: 'unavailable', syncing: false })
  throw error
})

/** Runs a sync step now, starting the sync first when it has not started. */
export const checkGroups = () => startGroupSync().then(sync => sync.check())
