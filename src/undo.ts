import { dismissToast, showToast, TOAST_DISMISS_MS } from './components/ui/toast'

export const MAX_UNDO = 30

export type UndoEntryInput = {
  label: string
  undo: () => void | Promise<void>
  undoneMessage?: string
  toastId?: number
  /** Lifetime in ms before the undo entry expires; defaults to unbounded unless set. */
  ttlMs?: number
  /** Runs once when the undo window expires (or flushes on pagehide) if not undone or cleared. */
  onCommit?: () => void | Promise<void>
}

type UndoEntry = UndoEntryInput & {
  id: number
  accountKey: string
  expiresAt?: number
}

let stack: UndoEntry[] = []
let nextId = 0
let running = false
let readAccountScope = () => ''

const commitEntry = (entry: UndoEntry | undefined) => {
  const fn = entry?.onCommit
  if (!fn) return
  entry.onCommit = undefined
  void Promise.resolve(fn()).catch(() => {})
}

/** Drops entries from other accounts and commits any expired entries for the active account. */
const pruneUndo = () => {
  if (stack.length === 0) return
  const scope = readAccountScope()
  const now = Date.now()
  const kept: UndoEntry[] = []
  for (const entry of stack) {
    if (entry.accountKey !== scope) {
      if (entry.toastId !== undefined) dismissToast(entry.toastId)
      continue
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      if (entry.toastId !== undefined) dismissToast(entry.toastId)
      commitEntry(entry)
      continue
    }
    kept.push(entry)
  }
  stack = kept
}

/** Binds the active account/channel scope reader used to isolate undo history across auth changes. */
export const setUndoAccountScope = (reader: () => string) => {
  readAccountScope = reader
}

/** Records an undoable action on the LIFO stack (bounded at `MAX_UNDO`) and returns its ID. */
export const pushUndo = (entry: UndoEntryInput): number => {
  pruneUndo()
  const id = ++nextId
  const expiresAt = entry.ttlMs !== undefined && Number.isFinite(entry.ttlMs)
    ? Date.now() + Math.max(0, entry.ttlMs)
    : undefined
  stack.push({
    ...entry,
    id,
    accountKey: readAccountScope(),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  })
  while (stack.length > MAX_UNDO) {
    const evicted = stack.shift()
    if (evicted?.accountKey === readAccountScope()) commitEntry(evicted)
  }
  return id
}

/** Returns true when an active undo entry exists in the current account scope. */
export const canUndo = () => {
  pruneUndo()
  return !running && stack.length > 0
}

/** Drops all queued undo entries (and pending deferred commits) without executing them. */
export const clearUndo = () => {
  for (const entry of stack) {
    if (entry.toastId !== undefined) dismissToast(entry.toastId)
  }
  stack = []
  running = false
}

/** Commits and removes pending deferred callbacks in the active account scope (e.g. on pagehide). */
export const flushPendingUndoCommits = () => {
  pruneUndo()
  const scope = readAccountScope()
  const remaining: UndoEntry[] = []
  for (const entry of stack) {
    if (entry.accountKey !== scope) continue
    if (entry.onCommit) {
      if (entry.toastId !== undefined) dismissToast(entry.toastId)
      commitEntry(entry)
    } else {
      remaining.push(entry)
    }
  }
  stack = remaining
}

/** Expires one undo entry when its toast timer fires, committing any deferred side effect once. */
export const expireUndo = (id: number) => {
  const index = stack.findIndex(item => item.id === id)
  if (index === -1) return
  const [entry] = stack.splice(index, 1)
  if (!entry || entry.accountKey !== readAccountScope()) return
  commitEntry(entry)
}

/**
 * Executes the matching (or latest) undoable entry once, dismissing any linked toast
 * and surfacing a confirmation or error toast. Returns true when an entry ran cleanly.
 */
export const runUndo = async (id?: number): Promise<boolean> => {
  pruneUndo()
  if (running || stack.length === 0) return false
  const index = id === undefined ? stack.length - 1 : stack.findIndex(item => item.id === id)
  if (index === -1) return false
  const [entry] = stack.splice(index, 1)
  if (!entry) return false
  entry.onCommit = undefined
  if (entry.toastId !== undefined) dismissToast(entry.toastId)

  running = true
  try {
    await entry.undo()
    showToast(entry.undoneMessage ?? `Undid: ${entry.label}`)
    return true
  } catch {
    showToast('Could not undo')
    return false
  } finally {
    running = false
  }
}

/** Pushes an undoable action and displays an expiring toast with an `Undo` action button. */
export const showUndoableToast = (message: string, entry: Omit<UndoEntryInput, 'toastId'>): number => {
  const ttlMs = entry.ttlMs ?? TOAST_DISMISS_MS
  const undoId = pushUndo({ ...entry, ttlMs })
  const toastId = showToast(
    message,
    {
      label: 'Undo',
      onAction: () => {
        void runUndo(undoId)
      },
    },
    {
      durationMs: ttlMs,
      onExpire: () => expireUndo(undoId),
    },
  )
  const stored = stack.find(item => item.id === undoId)
  if (stored) stored.toastId = toastId
  return toastId
}

const isNodeEditable = (candidate: unknown): boolean => {
  if (!candidate || typeof candidate !== 'object') return false
  const node = candidate as {
    tagName?: string
    isContentEditable?: boolean
    parentElement?: unknown
    closest?: (selector: string) => unknown
  }
  const el = node.tagName ? node : (node.parentElement as typeof node | undefined)
  if (!el || typeof el !== 'object') return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function') {
    return Boolean(el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]'))
  }
  return false
}

/** Returns true when keyboard focus or the event target sits inside an editable text field. */
export const isEditableTarget = (target: EventTarget | null): boolean =>
  isNodeEditable(target) || (typeof document !== 'undefined' && isNodeEditable(document.activeElement))

/** Binds global Ctrl+Z / Cmd+Z undo shortcut while respecting editable inputs and flushes pending commits on pagehide. */
export const bindUndoShortcut = (target: Window = window): (() => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== 'z') return
    if (isEditableTarget(event.target) || !canUndo()) return
    event.preventDefault()
    void runUndo()
  }
  const onPageHide = () => {
    // Best effort: worker-backed onCommit mutations may abort if the tab finishes unloading mid-flight.
    flushPendingUndoCommits()
  }
  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('pagehide', onPageHide)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('pagehide', onPageHide)
  }
}
