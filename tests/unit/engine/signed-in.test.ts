import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { CHANNEL_KEY, clearSignedIn, forgetChannel, markSignedIn, readChannel, SIGNED_IN_KEY, storeChannel } from '../../../src/engine/signed-in'
import { BRAND_PAGE_ID, OTHER_PAGE_ID } from '../fixtures/accounts-list'

const stubStorage = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  return store
}

describe('the stored channel', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = stubStorage()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reads back the page ID it stored, and nothing once the account\'s own channel is picked', () => {
    storeChannel(BRAND_PAGE_ID)
    expect(store.get(CHANNEL_KEY)).toBe(BRAND_PAGE_ID)
    expect(readChannel()).toBe(BRAND_PAGE_ID)
    storeChannel()
    expect(store.has(CHANNEL_KEY)).toBe(false)
    expect(readChannel()).toBeUndefined()
  })

  it('reads a value that is not all digits as no channel', () => {
    for (const value of ['', 'abc', `${BRAND_PAGE_ID}\r\nx-other: 1`, ' 1']) {
      store.set(CHANNEL_KEY, value)
      expect(readChannel()).toBeUndefined()
    }
  })

  it('goes with the signed-in flag: a sign-out removes both, and a sign-in starts on the account\'s own channel', () => {
    markSignedIn()
    storeChannel(BRAND_PAGE_ID)
    clearSignedIn()
    expect(store.has(SIGNED_IN_KEY)).toBe(false)
    expect(store.has(CHANNEL_KEY)).toBe(false)

    storeChannel(BRAND_PAGE_ID)
    markSignedIn()
    expect(store.get(SIGNED_IN_KEY)).toBe('1')
    expect(store.has(CHANNEL_KEY)).toBe(false)
  })

  it('is forgotten only while it is still the one named, so a pick made since in another tab stays', () => {
    storeChannel(OTHER_PAGE_ID)
    forgetChannel(BRAND_PAGE_ID)
    expect(readChannel()).toBe(OTHER_PAGE_ID)
    forgetChannel(OTHER_PAGE_ID)
    expect(readChannel()).toBeUndefined()
  })
})

describe('the stored channel without storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads as no channel, and writing it throws nothing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') },
      removeItem: () => { throw new Error('SecurityError') },
    })
    expect(readChannel()).toBeUndefined()
    expect(() => storeChannel(BRAND_PAGE_ID)).not.toThrow()
    expect(() => storeChannel()).not.toThrow()
    expect(() => forgetChannel(BRAND_PAGE_ID)).not.toThrow()
  })
})
