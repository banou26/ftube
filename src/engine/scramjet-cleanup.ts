// Scramjet named every storage key its realms wrote `<host>@<key>`, and every database and cache `<origin>@<name>`
const PREFIXED_KEY = /^[^:@/]+@/
const PREFIXED_NAME = /^https?:\/\/[^@/]+@/
// the engine's own keys from its time in Scramjet's www.youtube.com realm, which it still reads under these names
const ENGINE_KEY = /^www\.youtube\.com@yt-client:/
const SCRAMJET_SCOPE = '/__yt_scramjet__/'
// its cookie jar, Google's HttpOnly cookies included
const JAR_DATABASE = '__scramjet_controller'
const KNOWN_DATABASES = [JAR_DATABASE, 'https://www.youtube.com@youtubei.js']

type CleanupScope = {
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistration'>
  indexedDB?: Pick<IDBFactory, 'deleteDatabase'> & Partial<Pick<IDBFactory, 'databases'>>
  caches?: Pick<CacheStorage, 'keys' | 'delete'>
  storage?: Pick<Storage, 'length' | 'key' | 'removeItem'>
}

const deleteDatabase = (factory: NonNullable<CleanupScope['indexedDB']>, name: string) => new Promise<void>((resolve) => {
  try {
    const request = factory.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    // an old tab still holding it open: the delete finishes once that tab lets go
    request.onblocked = () => resolve()
  } catch {
    resolve()
  }
})

/**
 * Removes what Scramjet left in this origin from before the engine ran natively: its service worker, its cookie jar
 * and the databases, caches and storage keys of the pages it ran. Keeps everything of the app's own (`yt-client:*`,
 * IndexedDB `yt-client-history`, youtubei.js's cache) and the engine's `www.youtube.com@yt-client:*` keys. Idempotent
 * and cheap when there is nothing left, so it runs on every load, with no marker of its own; each step that fails is
 * skipped.
 */
export const cleanUpScramjet = async ({
  serviceWorker = globalThis.navigator?.serviceWorker,
  indexedDB = globalThis.indexedDB,
  caches = globalThis.caches,
  storage = globalThis.localStorage,
}: CleanupScope = {}) => {
  await serviceWorker?.getRegistration(SCRAMJET_SCOPE)
    .then((registration) => registration && new URL(registration.scope).pathname === SCRAMJET_SCOPE ? registration.unregister() : undefined)
    .catch(() => {})

  if (indexedDB) {
    const listed = await indexedDB.databases?.().then((databases) => databases.map(({ name }) => name ?? ''), () => undefined)
    const names = (listed ?? KNOWN_DATABASES).filter((name) => name === JAR_DATABASE || PREFIXED_NAME.test(name))
    await Promise.all(names.map((name) => deleteDatabase(indexedDB, name)))
  }

  await caches?.keys()
    .then((names) => Promise.all(names.filter((name) => PREFIXED_NAME.test(name)).map((name) => caches.delete(name))))
    .catch(() => {})

  try {
    if (storage) {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
      for (const key of keys) if (PREFIXED_KEY.test(key) && !ENGINE_KEY.test(key)) storage.removeItem(key)
    }
  } catch {}
}
