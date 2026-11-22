import type { Page } from '@playwright/test'

import { expect, laneOrigin, plainTest, test } from './test'

const HARNESS = '/tests/browser/fixtures/home-harness.tsx'

test('a link click reads Home anew, and going back to it shows the feed it showed', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })
  const home = page.locator('[data-cached-home-harness]')
  const first = home.locator('a[href^="/watch?v="]').first()
  // the harness's first import can add a dependency for the dev server to bundle, which reloads the page under it
  await expect(async () => {
    if (await home.count() === 0) {
      await page.evaluate(async (path) => (await import(path) as typeof import('./fixtures/home-harness')).mountCachedHome(), HARNESS)
    }
    await expect(first).toHaveAttribute('href', '/watch?v=video-1', { timeout: 15_000 })
  }).toPass({ timeout: 120_000 })
  const reopen = (how: 'pushState' | 'popstate') => page.evaluate(async ({ path, how }) =>
    (await import(path) as typeof import('./fixtures/home-harness')).reopenHome(how), { path: HARNESS, how })

  await reopen('pushState')
  await expect(first).toHaveAttribute('href', '/watch?v=video-2')
  await reopen('popstate')
  await expect(first).toHaveAttribute('href', '/watch?v=video-2')
  // the third read answers video-3 only if going back read nothing
  await reopen('pushState')
  await expect(first).toHaveAttribute('href', '/watch?v=video-3')
})

const playedSeconds = (page: Page) => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)

type CatalogRequest = { url: string, method: string, visitor: string | null }

// captures every catalog-lane fetch the engine posts to the app's extension-fetch port, with its exact headers
const captureCatalogRequests = () => {
  if (window !== top) return
  const seen: CatalogRequest[] = []
  ;(window as unknown as { __catalogRequests: CatalogRequest[] }).__catalogRequests = seen
  const addListener = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener')!.value as (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (this instanceof MessagePort && type === 'message' && typeof listener === 'function') {
      const wrapped = function (this: EventTarget, event: Event) {
        const data = (event as MessageEvent).data as {
          type?: string
          url?: string
          options?: { method?: string, headers?: Record<string, string> }
        } | null
        if (data?.type === 'fetch' && typeof data.url === 'string' && data.options) {
          const headers = data.options.headers ?? {}
          const key = Object.keys(headers).find(name => name.toLowerCase() === 'x-goog-visitor-id')
          seen.push({ url: data.url, method: data.options.method ?? 'GET', visitor: key ? headers[key]! : null })
        }
        return listener.call(this, event)
      }
      return addListener.call(this, type, wrapped, options)
    }
    return addListener.call(this, type, listener, options)
  }
}

const catalogRequests = (page: Page) =>
  page.evaluate(() => (window as unknown as { __catalogRequests: CatalogRequest[] }).__catalogRequests)

const searchAndOpenCard = async (page: Page, query: string, videoId: string) => {
  const input = page.getByRole('combobox', { name: 'Search' })
  await input.fill(query)
  await input.press('Enter')
  const titleLink = page.locator(`article.result h2.title a[href="/watch?v=${videoId}"]`).first()
  await expect(titleLink).toBeVisible({ timeout: 90_000 })
  // follow by keyboard so hovering does not start an inline preview ahead of the click
  await titleLink.press('Enter')
  await expect(page).toHaveURL(new RegExp(`v=${videoId}`))
  expect(await page.evaluate(() => typeof (history.state as { playerParams?: unknown } | null)?.playerParams)).toBe('string')
}

const watchTwoThenOpenHome = async (page: Page, origin: string) => {
  await page.goto(`${origin}/`)
  await expect(page.getByRole('heading', { name: 'Try searching to get started' })).toBeVisible({ timeout: 90_000 })
  for (const [query, videoId, seconds] of [['jNQXAC9IVRw', 'jNQXAC9IVRw', 5], ['kJQP7kiw5Fk', 'kJQP7kiw5Fk', 20]] as const) {
    await searchAndOpenCard(page, query, videoId)
    await expect.poll(() => playedSeconds(page), { timeout: 90_000 }).toBeGreaterThan(seconds)
  }
  await page.getByRole('link', { name: 'yt-client home' }).click()
  const videos = page.locator('main a[href^="/watch"]')
  await expect.poll(() => videos.count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(10)
  await expect(page.getByRole('heading', { name: 'Try searching to get started' })).toHaveCount(0)
  return videos
}

plainTest('omits X-Goog-Visitor-Id on plain /watch reads while keeping it on warmup, card clicks and playback beacons', async ({ page, baseURL }) => {
  plainTest.setTimeout(240_000)
  const origin = laneOrigin(baseURL)
  await page.addInitScript(captureCatalogRequests)

  // plain /watch open (no card params): GET /watch omits X-Goog-Visitor-Id while /api/stats/playback carries it
  await page.goto(`${origin}/watch?v=dQw4w9WgXcQ`)
  await expect.poll(() => playedSeconds(page), { timeout: 90_000 }).toBeGreaterThan(1)
  await expect.poll(async () => (await catalogRequests(page)).some(req => req.url.includes('/api/stats/playback')), { timeout: 30_000 }).toBe(true)

  const plainSeen = await catalogRequests(page)
  const plainWatchReads = plainSeen.filter(req => req.url.startsWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ') && !req.url.includes('&pp='))
  const plainBeacons = plainSeen.filter(req => req.url.includes('/api/stats/playback'))
  expect(plainWatchReads.length).toBeGreaterThan(0)
  expect(plainWatchReads.every(req => req.visitor === null)).toBe(true)
  expect(plainBeacons.length).toBeGreaterThan(0)
  expect(plainBeacons.every(req => typeof req.visitor === 'string' && req.visitor.length > 0)).toBe(true)

  // card click with playerParams: GET /watch?v=...&pp=... and /api/stats/playback both carry X-Goog-Visitor-Id
  await searchAndOpenCard(page, 'jNQXAC9IVRw', 'jNQXAC9IVRw')
  await expect.poll(() => playedSeconds(page), { timeout: 90_000 }).toBeGreaterThan(1)
  await expect.poll(
    async () => (await catalogRequests(page)).some(req => req.url.includes('/api/stats/playback') && req.url.includes('docid=jNQXAC9IVRw')),
    { timeout: 30_000 },
  ).toBe(true)

  const afterCard = await catalogRequests(page)
  const cardWatchReads = afterCard.filter(req => req.url.startsWith('https://www.youtube.com/watch?v=jNQXAC9IVRw&pp='))
  const cardPlainPrefetch = afterCard.filter(req => req.url === 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
  const cardBeacons = afterCard.filter(req => req.url.includes('/api/stats/playback') && req.url.includes('docid=jNQXAC9IVRw'))
  expect(cardWatchReads.length).toBeGreaterThan(0)
  expect(cardWatchReads.every(req => typeof req.visitor === 'string' && req.visitor.length > 0)).toBe(true)
  expect(cardPlainPrefetch.every(req => req.visitor === null)).toBe(true)
  expect(cardBeacons.length).toBeGreaterThan(0)
  expect(cardBeacons.every(req => typeof req.visitor === 'string' && req.visitor.length > 0)).toBe(true)
})

plainTest('a signed-out Home fills once two videos were watched from cards, and going back to it keeps its feed', async ({ page, baseURL }) => {
  plainTest.setTimeout(300_000)
  const origin = laneOrigin(baseURL)
  await page.addInitScript(captureCatalogRequests)
  const videos = await watchTwoThenOpenHome(page, origin)

  const warmReads = (await catalogRequests(page)).filter(req => req.url === 'https://www.youtube.com/')
  expect(warmReads.length).toBeGreaterThan(0)
  expect(warmReads.every(req => typeof req.visitor === 'string' && req.visitor.length > 0)).toBe(true)

  const firstVideos = () => videos.evaluateAll(anchors => [...new Set(anchors.map(anchor => anchor.getAttribute('href')))].slice(0, 6))
  const shown = await firstVideos()
  await page.evaluate(() => scrollTo(0, 1000))
  const href = await videos.evaluateAll(anchors => anchors.find((anchor) => {
    const { top, bottom } = anchor.getBoundingClientRect()
    return top > 150 && bottom < innerHeight - 50
  })?.getAttribute('href'))
  const clicked = page.locator(`main a[href="${href}"]`).first()
  await clicked.click()
  await expect(page).toHaveURL(/\/watch\?v=/)
  await page.goBack()
  await expect(page).toHaveURL(`${origin}/`)
  await expect.poll(firstVideos).toEqual(shown)
  await expect(clicked).toBeInViewport()
})

plainTest('through the relay too, a signed-out Home fills once two videos were watched from cards', async ({ page, baseURL }) => {
  plainTest.setTimeout(300_000)
  await page.addInitScript(() => localStorage.setItem('yt-client:step:direct', '0'))
  await watchTwoThenOpenHome(page, laneOrigin(baseURL))
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'off')
})
