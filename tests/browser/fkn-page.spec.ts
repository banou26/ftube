import type { Frame, Page } from '@playwright/test'

import { expect, test } from './test'

import { ENGINE_PATH } from '../../src/engine/protocol'

const engineFrame = (page: Page) => page.frames().find((frame) => new URL(frame.url(), 'http://base.invalid').pathname === ENGINE_PATH)

// a request through the FKN page's own fetch, from the engine's own module (the dev server serves it at this path)
const readThroughPage = (frame: Frame) => frame.evaluate(async (path) => {
  const agent = await import(path) as typeof import('../../src/frame/agent')
  return (await agent.pageFetch('https://www.youtube.com/generate_204', { method: 'GET' })).status
}, '/src/frame/agent.ts')

/* Chrome stops an idle service worker after 30 s, and one Playwright is attached to never idles out, so the stop is
   forced. The FKN page reads through mirage's service worker on sdbx.app, which signed in is every account
   request; after the stop a read must still answer, from a worker that started again. */
test("a read through the FKN page answers after the page's service worker was stopped", async ({ page }) => {
  test.setTimeout(180_000)
  const workers: string[] = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) workers.push(`${new URL(version.scriptURL).hostname} ${version.runningStatus}`)
  })
  await cdp.send('ServiceWorker.enable')
  await page.goto('/watch?v=dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-yt-mint', 'session', { timeout: 120_000 })
  const frame = engineFrame(page)!
  expect(await readThroughPage(frame)).toBe(204)

  const before = workers.length
  await cdp.send('ServiceWorker.stopAllWorkers')
  await expect.poll(() => workers.slice(before).some((entry) => entry.endsWith('sdbx.app stopped')), { timeout: 15_000 }).toBe(true)
  expect(await readThroughPage(frame)).toBe(204)
  expect(workers.slice(before).filter((entry) => /sdbx\.app (starting|running)$/.test(entry)), 'the worker never started again, so the stop proved nothing').not.toEqual([])

  // and its VM builds a new BotGuard session from scratch
  await page.evaluate(() => { document.documentElement.dataset.ytMint = 'none' })
  await frame.evaluate(async (path) => {
    const botguard = await import(path) as typeof import('../../src/frame/botguard')
    await botguard.recoverPoTokenSession()
    await botguard.mintPoToken('dQw4w9WgXcQ')
  }, '/src/frame/botguard.ts')
  await expect(page.locator('html')).toHaveAttribute('data-yt-mint', 'session')
})

// the FKN page's first attach fails (its document never loads); the next call attaches it again and is answered
test('after a failed first attach, the next playback attaches the FKN page again and mints a live session', async ({ page }) => {
  test.setTimeout(240_000)
  let refused = 0
  await page.route((url) => url.hostname.endsWith('.sdbx.app'), (route) => {
    if (refused === 0 && route.request().resourceType() === 'document' && route.request().frame().parentFrame()) {
      refused++
      return route.abort('connectionrefused')
    }
    return route.continue()
  })
  const unavailable = page.waitForEvent('console', { predicate: (message) => message.text().includes('the FKN page is unavailable'), timeout: 120_000 })
  await page.goto('/')
  await unavailable
  expect(refused).toBe(1)
  await page.evaluate(() => {
    history.pushState(null, '', '/watch?v=dQw4w9WgXcQ')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('html')).toHaveAttribute('data-yt-mint', 'session', { timeout: 120_000 })
  const video = page.locator('[data-player-root] video')
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 60_000 }).toBeGreaterThan(1)
})
