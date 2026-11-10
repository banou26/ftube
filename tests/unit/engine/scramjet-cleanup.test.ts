import { describe, expect, it, vi } from 'vite-plus/test'

import { cleanUpScramjet } from '../../../src/engine/scramjet-cleanup'

// a browser as a visit before the native engine left it: Scramjet's worker, jar, prefixed databases, caches and keys,
// beside the app's own data
const leftovers = ({ listsDatabases = true } = {}) => {
  const databases = new Set(['__scramjet_controller', 'https://www.youtube.com@youtubei.js', 'https://accounts.google.com@ytidb', 'yt-client-history', 'youtubei.js'])
  const cacheNames = new Set(['https://www.youtube.com@yt-cache', 'yt-client-own-cache'])
  const keys = new Map([
    ['yt-client:groups', '[]'],
    ['yt-client:settings', '{}'],
    ['yt-client:signed-in', '1'],
    ['www.youtube.com@yt-client:visitor-data', 'visitor'],
    ['www.youtube.com@yt-client:po-tokens', '{}'],
    ['www.youtube.com@yt-player-bandwidth', '{}'],
    ['accounts.google.com@ACCOUNT_CHOOSER', 'x'],
  ])
  const unregister = vi.fn(async () => true)
  let registration: { scope: string, unregister: typeof unregister } | undefined = { scope: 'https://youtube.fkn.app/__yt_scramjet__/', unregister }
  const scope = {
    serviceWorker: { getRegistration: vi.fn(async (_url?: string) => registration as unknown as ServiceWorkerRegistration) },
    indexedDB: {
      ...listsDatabases ? { databases: async () => [...databases].map((name) => ({ name, version: 1 })) } : {},
      deleteDatabase: (name: string) => {
        const request = {} as IDBOpenDBRequest
        queueMicrotask(() => {
          databases.delete(name)
          request.onsuccess?.({} as Event)
        })
        return request
      },
    },
    caches: {
      keys: async () => [...cacheNames],
      delete: async (name: string) => cacheNames.delete(name),
    },
    storage: {
      get length() { return keys.size },
      key: (index: number) => [...keys.keys()][index] ?? null,
      removeItem: (key: string) => { keys.delete(key) },
    },
  }
  return { scope, databases, cacheNames, keys, unregister, unregistered: () => { registration = undefined } }
}

describe("cleaning up Scramjet's leftovers", () => {
  it("removes its worker, its jar, the databases, caches and keys of the pages it ran, and keeps the app's own data", async () => {
    const browser = leftovers()
    await cleanUpScramjet(browser.scope)
    expect(browser.scope.serviceWorker.getRegistration).toHaveBeenCalledWith('/__yt_scramjet__/')
    expect(browser.unregister).toHaveBeenCalledOnce()
    expect([...browser.databases]).toEqual(['yt-client-history', 'youtubei.js'])
    expect([...browser.cacheNames]).toEqual(['yt-client-own-cache'])
    expect([...browser.keys.keys()]).toEqual([
      'yt-client:groups',
      'yt-client:settings',
      'yt-client:signed-in',
      'www.youtube.com@yt-client:visitor-data',
      'www.youtube.com@yt-client:po-tokens',
    ])
  })

  it("deletes the jar and youtubei.js's prefixed cache by name where the browser cannot list databases", async () => {
    const browser = leftovers({ listsDatabases: false })
    await cleanUpScramjet(browser.scope)
    expect([...browser.databases]).toEqual(['https://accounts.google.com@ytidb', 'yt-client-history', 'youtubei.js'])
  })

  it('leaves a worker of another scope registered', async () => {
    const browser = leftovers()
    browser.scope.serviceWorker.getRegistration.mockResolvedValueOnce({ scope: 'https://youtube.fkn.app/', unregister: browser.unregister } as unknown as ServiceWorkerRegistration)
    await cleanUpScramjet(browser.scope)
    expect(browser.unregister).not.toHaveBeenCalled()
  })

  it('finds nothing to do on a second run', async () => {
    const browser = leftovers()
    await cleanUpScramjet(browser.scope)
    browser.unregistered()
    const keys = [...browser.keys.keys()]
    await cleanUpScramjet(browser.scope)
    expect([...browser.keys.keys()]).toEqual(keys)
    expect(browser.unregister).toHaveBeenCalledOnce()
  })
})
