import { dismissToast, showToast } from './components/ui/toast'

export const MAX_UNDO = 30

export type UndoEntryInput = {
  label: string
  undo: () => void | Promise<void>
  undoneMessage?: string
  toastId?: number
}

type UndoEntry = UndoEntryInput & { id: number }

let stack: UndoEntry[] = []
let nextId = 0
let running = false

/** Records an undoable action on the LIFO stack (bounded at `MAX_UNDO`) and returns its ID. */
export const pushUndo = (entry: UndoEntryInput): number => {
  const id = ++nextId
  if (stack.length >= MAX_UNDO) stack = stack.slice(stack.length - MAX_UNDO + 1)
  stack.push({ ...entry, id })
  return id
}

export const canUndo = () => !running && stack.length > 0

export const clearUndo = () => {
  stack = []
  running = false
}

/**
 * Executes the matching (or latest) undoable entry once, dismissing any linked toast
 * and surfacing a confirmation or error toast. Returns true when an entry ran cleanly.
 */
export const runUndo = async (id?: number): Promise<boolean> => {
  if (running || stack.length === 0) return false
  const index = id === undefined ? stack.length - 1 : stack.findIndex(item => item.id === id)
  if (index === -1) return false
  const [entry] = stack.splice(index, 1)
  if (!entry) return false
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

/** Pushes an undoable action and displays a toast with an `Undo` action button. */
export const showUndoableToast = (message: string, entry: Omit<UndoEntryInput, 'toastId'>): number => {
  const undoId = pushUndo(entry)
  const toastId = showToast(message, {
    label: 'Undo',
    onAction: () => {
      void runUndo(undoId)
    },
  })
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

/** Binds global Ctrl+Z / Cmd+Z undo shortcut while respecting editable inputs and native browser undo when empty. */
export const bindUndoShortcut = (target: Window = window): (() => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== 'z') return
    if (isEditableTarget(event.target) || !canUndo()) return
    event.preventDefault()
    void runUndo()
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}
