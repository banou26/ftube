import { expect, test } from './test'

const SEED_PATH = '/__seed-scramjet'
const GROUPS = JSON.stringify([{ id: 'g1', name: 'Kept', emoji: '', channels: [] }])

// what a visit before the native engine left in this origin, seeded from a page of the origin before the app loads
const seed = async (groups: string) => {
  const registration = await navigator.serviceWorker.register('/__yt_scramjet__/sw.js', { scope: '/__yt_scramjet__/' })
  await new Promise<void>((resolve) => {
    const worker = registration.installing ?? registration.waiting ?? registration.active
    if (!worker || worker.state === 'activated') return resolve()
    worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve() })
  })
  const create = (name: string) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
  await Promise.all(['__scramjet_controller', 'https://www.youtube.com@youtubei.js', 'yt-client-history'].map(create))
  await caches.open('https://www.youtube.com@yt-cache')
  localStorage.setItem('yt-client:groups', groups)
  localStorage.setItem('www.youtube.com@yt-client:visitor-data', 'visitor')
  localStorage.setItem('www.youtube.com@yt-player-bandwidth', '{}')
  localStorage.setItem('accounts.google.com@ACCOUNT_CHOOSER', 'x')
}

const read = async () => ({
  registered: !!(await navigator.serviceWorker.getRegistration('/__yt_scramjet__/')),
  databases: (await indexedDB.databases()).map(({ name }) => name ?? '').sort((a, b) => a.localeCompare(b)),
  caches: await caches.keys(),
  keys: Object.keys(localStorage).sort(),
  groups: localStorage.getItem('yt-client:groups'),
})

test("one load removes Scramjet's worker, jar, prefixed databases, caches and keys, and keeps the app's own", async ({ page }) => {
  test.setTimeout(180_000)
  await page.route(`**${SEED_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.context().route('**/__yt_scramjet__/sw.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'self.addEventListener("fetch", () => {})' }))
  await page.goto(SEED_PATH)
  await page.evaluate(seed, GROUPS)
  const before = await page.evaluate(read)
  // the control: the seed is there for the cleanup to find
  expect(before.registered).toBe(true)
  expect(before.databases).toEqual(expect.arrayContaining(['__scramjet_controller', 'https://www.youtube.com@youtubei.js']))
  expect(before.caches).toContain('https://www.youtube.com@yt-cache')
  expect(before.keys).toContain('www.youtube.com@yt-player-bandwidth')

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })
  await expect.poll(() => page.evaluate(read), { timeout: 30_000 }).toMatchObject({
    registered: false,
    caches: [],
    groups: GROUPS,
  })
  const after = await page.evaluate(read)
  expect(after.databases).not.toContain('__scramjet_controller')
  expect(after.databases).not.toContain('https://www.youtube.com@youtubei.js')
  expect(after.databases).toContain('yt-client-history')
  expect(after.keys).toContain('yt-client:groups')
  expect(after.keys).toContain('www.youtube.com@yt-client:visitor-data')
  expect(after.keys).not.toContain('www.youtube.com@yt-player-bandwidth')
  expect(after.keys).not.toContain('accounts.google.com@ACCOUNT_CHOOSER')
})

test("the old sign-in window's address tells the tab that opened it that it is from another build", async ({ page }) => {
  await page.route(`**${SEED_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(SEED_PATH)
  const hello = await page.evaluate(() => new Promise((resolve) => {
    addEventListener('message', (event) => resolve({ data: event.data as unknown, origin: event.origin }), { once: true })
    open('/__yt_scramjet__/signin.html', '_blank', 'popup')
  }))
  expect(hello).toEqual({ data: { type: 'yt-client-signin-hello', build: 'scramjet-removed' }, origin: new URL(page.url()).origin })
})
