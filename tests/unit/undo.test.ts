import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const shownToasts = vi.hoisted(() => [] as { id: number, message: string, onExpire?: () => void }[])
const dismissedIds = vi.hoisted(() => [] as number[])
const mockState = vi.hoisted(() => ({ nextId: 0 }))

vi.mock('../../src/components/ui/toast', () => ({
  TOAST_DISMISS_MS: 5_000,
  showToast: vi.fn((message: string, _action?: unknown, options?: { onExpire?: () => void }) => {
    const id = ++mockState.nextId
    shownToasts.push({ id, message, onExpire: options?.onExpire })
    return id
  }),
  dismissToast: vi.fn((id: number) => {
    dismissedIds.push(id)
  }),
}))

import { bindUndoShortcut, canUndo, clearUndo, expireUndo, flushPendingUndoCommits, MAX_UNDO, pushUndo, runUndo, setUndoAccountScope, showUndoableToast } from '../../src/undo'

const makeWindow = () => {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>()
  return {
    addEventListener: (type: string, fn: (event: KeyboardEvent) => void) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener: (type: string, fn: (event: KeyboardEvent) => void) => {
      listeners.get(type)?.delete(fn)
    },
    dispatch: (type: string, init: Partial<KeyboardEvent> & { target?: EventTarget | null } = {}) => {
      let defaultPrevented = Boolean(init.defaultPrevented)
      const event = {
        key: 'z',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        repeat: false,
        target: null,
        ...init,
        get defaultPrevented() {
          return defaultPrevented
        },
        preventDefault() {
          defaultPrevented = true
        },
      } as unknown as KeyboardEvent
      for (const fn of listeners.get(type) ?? []) fn(event)
      return defaultPrevented
    },
  }
}

describe('undo stack and shortcut', () => {
  beforeEach(() => {
    clearUndo()
    shownToasts.length = 0
    dismissedIds.length = 0
    mockState.nextId = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearUndo()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs undone entries in LIFO order and refuses double execution', async () => {
    const order: string[] = []
    const first = pushUndo({ label: 'first', undo: () => { order.push('first') } })
    const second = pushUndo({ label: 'second', undo: () => { order.push('second') } })

    expect(canUndo()).toBe(true)
    expect(await runUndo()).toBe(true)
    expect(order).toEqual(['second'])
    // Clicking toast Undo for an already-undone entry is a no-op
    expect(await runUndo(second)).toBe(false)
    expect(await runUndo(first)).toBe(true)
    expect(order).toEqual(['second', 'first'])
    expect(canUndo()).toBe(false)
    expect(await runUndo()).toBe(false)
  })

  it('caps the stack at MAX_UNDO entries', async () => {
    const called: number[] = []
    for (let i = 0; i < MAX_UNDO + 5; i++) {
      pushUndo({ label: `item-${i}`, undo: () => { called.push(i) } })
    }
    let count = 0
    while (await runUndo()) count++
    expect(count).toBe(MAX_UNDO)
    expect(called.at(-1)).toBe(5)
    expect(called[0]).toBe(MAX_UNDO + 4)
  })

  it('guards against concurrent undo runs and surfaces errors without crashing', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    pushUndo({ label: 'async', undo: () => pending })
    pushUndo({ label: 'fail', undo: () => { throw new Error('boom') } })

    expect(await runUndo()).toBe(false)

    const running = runUndo()
    expect(await runUndo()).toBe(false)
    release()
    expect(await running).toBe(true)
  })

  it('supports Ctrl+Z and Cmd+Z on non-editable targets and ignores inputs/textareas/contenteditable', async () => {
    const targetWindow = makeWindow()
    const unbind = bindUndoShortcut(targetWindow as unknown as Window)
    try {
      // Empty stack must not consume browser/input undo
      expect(targetWindow.dispatch('keydown', { key: 'z', ctrlKey: true })).toBe(false)

      const calls: string[] = []
      showUndoableToast('Added to Tech', {
        label: 'Add Beta to Tech',
        undo: () => { calls.push('undid') },
        undoneMessage: 'Removed from Tech',
      })

      const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null } as unknown as EventTarget
      const textarea = { tagName: 'TEXTAREA', isContentEditable: false, closest: () => null } as unknown as EventTarget
      const select = { tagName: 'SELECT', isContentEditable: false, closest: () => null } as unknown as EventTarget
      const editable = { tagName: 'DIV', isContentEditable: true, closest: () => null } as unknown as EventTarget

      expect(targetWindow.dispatch('keydown', { key: 'z', ctrlKey: true, target: input })).toBe(false)
      expect(targetWindow.dispatch('keydown', { key: 'z', metaKey: true, target: textarea })).toBe(false)
      expect(targetWindow.dispatch('keydown', { key: 'z', ctrlKey: true, target: select })).toBe(false)
      expect(targetWindow.dispatch('keydown', { key: 'z', metaKey: true, target: editable })).toBe(false)
      expect(targetWindow.dispatch('keydown', { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false)
      expect(targetWindow.dispatch('keydown', { key: 'z', ctrlKey: true, altKey: true })).toBe(false)
      expect(calls).toEqual([])

      expect(targetWindow.dispatch('keydown', { key: 'z', metaKey: true })).toBe(true)
      vi.runAllTicks()
      expect(calls).toEqual(['undid'])
    } finally {
      unbind()
    }
  })

  it('isolates undo entries per accountKey and drops entries on clearUndo without committing', async () => {
    let scope = 'in:channel-a'
    setUndoAccountScope(() => scope)
    try {
      const committed: string[] = []
      const undone: string[] = []
      pushUndo({
        label: 'Dismiss A',
        undo: () => { undone.push('a') },
        onCommit: () => { committed.push('commit-a') },
      })
      expect(canUndo()).toBe(true)

      scope = 'in:channel-b'
      expect(canUndo()).toBe(false)
      await expect(runUndo()).resolves.toBe(false)
      expect(undone).toEqual([])
      expect(committed).toEqual([])

      pushUndo({
        label: 'Dismiss B',
        undo: () => { undone.push('b') },
        onCommit: () => { committed.push('commit-b') },
      })
      clearUndo()
      expect(canUndo()).toBe(false)
      expect(committed).toEqual([])
    } finally {
      setUndoAccountScope(() => '')
    }
  })

  it('expires toast undo entries after ttlMs and commits onCommit once only when not undone', async () => {
    setUndoAccountScope(() => 'in:')
    try {
      const committed: string[] = []
      const undone: string[] = []

      // Undoing before expiry cancels onCommit even if onExpire later arrives.
      showUndoableToast('Removed A', {
        label: 'Remove A',
        undo: () => { undone.push('a') },
        onCommit: () => { committed.push('commit-a') },
      })
      const toastA = shownToasts.at(-1)!
      await expect(runUndo()).resolves.toBe(true)
      toastA.onExpire?.()
      expect(undone).toEqual(['a'])
      expect(committed).toEqual([])

      // Natural toast expiry commits once and blocks subsequent undo or duplicate expiry.
      showUndoableToast('Removed B', {
        label: 'Remove B',
        undo: () => { undone.push('b') },
        onCommit: () => { committed.push('commit-b') },
      })
      const toastB = shownToasts.at(-1)!
      toastB.onExpire?.()
      toastB.onExpire?.()
      expect(canUndo()).toBe(false)
      await expect(runUndo()).resolves.toBe(false)
      expect(committed).toEqual(['commit-b'])

      // Elapsed ttlMs also self-prunes and commits on next check even without timer callback.
      const idC = pushUndo({
        label: 'Remove C',
        ttlMs: 250,
        undo: () => { undone.push('c') },
        onCommit: () => { committed.push('commit-c') },
      })
      vi.advanceTimersByTime(300)
      expect(canUndo()).toBe(false)
      expireUndo(idC)
      expect(committed).toEqual(['commit-b', 'commit-c'])
    } finally {
      setUndoAccountScope(() => '')
    }
  })

  it('flushes pending onCommit callbacks once when pagehide fires', async () => {
    setUndoAccountScope(() => 'in:')
    const targetWindow = makeWindow()
    const unbind = bindUndoShortcut(targetWindow as unknown as Window)
    try {
      const committed: string[] = []
      const undone: string[] = []
      showUndoableToast('Removed D', {
        label: 'Remove D',
        undo: () => { undone.push('d') },
        onCommit: () => { committed.push('commit-d') },
      })
      targetWindow.dispatch('pagehide')
      flushPendingUndoCommits()
      expect(committed).toEqual(['commit-d'])
      expect(canUndo()).toBe(false)
      await expect(runUndo()).resolves.toBe(false)
      expect(undone).toEqual([])
    } finally {
      unbind()
      setUndoAccountScope(() => '')
    }
  })
})
