import { beforeEach, describe, expect, it } from 'vite-plus/test'

import {
  clearDismissedNotifications,
  DISMISSED_NOTIFICATIONS_KEY,
  DISMISSED_NOTIFICATIONS_MAX,
  dismissNotificationIds,
  isNotificationDismissed,
  readDismissedNotifications,
} from '../../../src/notifications/dismissed'

const createStorage = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage
}

describe('dismissed notifications store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorage(),
      configurable: true,
      writable: true,
    })
    clearDismissedNotifications()
  })

  it('persists dismissed ids, deduplicates them, and ignores blank values', () => {
    dismissNotificationIds(['n1', ' ', 'n2', 'n1'])
    expect([...readDismissedNotifications()]).toEqual(['n1', 'n2'])
    expect(isNotificationDismissed('n1')).toBe(true)
    expect(isNotificationDismissed('n3')).toBe(false)
    expect(JSON.parse(localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY) ?? '[]')).toEqual(['n1', 'n2'])
  })

  it('caps stored ids at DISMISSED_NOTIFICATIONS_MAX keeping the most recent ones', () => {
    const batch = Array.from({ length: DISMISSED_NOTIFICATIONS_MAX + 25 }, (_, index) => `n-${index}`)
    dismissNotificationIds(batch)
    const saved = readDismissedNotifications()
    expect(saved.size).toBe(DISMISSED_NOTIFICATIONS_MAX)
    expect(saved.has('n-0')).toBe(false)
    expect(saved.has('n-24')).toBe(false)
    expect(saved.has('n-25')).toBe(true)
    expect(saved.has(`n-${DISMISSED_NOTIFICATIONS_MAX + 24}`)).toBe(true)
  })

  it('clears persisted dismissed ids on sign-out or channel switch', () => {
    dismissNotificationIds(['n1', 'n2'])
    clearDismissedNotifications()
    expect(readDismissedNotifications().size).toBe(0)
    expect(localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY)).toBeNull()
  })
})
