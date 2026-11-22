import type { Page, Route } from '@playwright/test'

import { readFileSync } from 'node:fs'

import { BUILD, startBuildServer } from './built-server'
import { expect, test } from './test'

/* These run on the built app (`npm run build` first), served as Cloudflare Pages serves it, since the dev server
   writes no list of the code to download. */

let origin = ''
let closeServer: (() => Promise<void>) | undefined

test.beforeAll(async () => {
  const started = await startBuildServer()
  origin = started.origin
  closeServer = started.close
})

test.afterAll(() => closeServer?.())

const drop = (route: Route) => route.abort('internetdisconnected')
const deploy = (route: Route) => route.fulfill({
  status: 404,
  contentType: 'text/html; charset=utf-8',
  body: readFileSync(`${BUILD}assets/404.html`),
})

// records each modulepreload link that loaded, and marks the document, so a reload, which would also show every page,
// cannot pass for a recovery
const open = async (page: Page, path: string) => {
  await page.addInitScript(() => {
    const preloaded = new Set<string>()
    Object.assign(window, { preloaded })
    document.addEventListener('load', ({ target }) => {
      if (target instanceof HTMLLinkElement && target.rel === 'modulepreload') preloaded.add(new URL(target.href).pathname)
    }, true)
  })
  await page.goto(origin + path)
  await page.evaluate(() => Object.assign(window, { sameDocument: true }))
}

// every listed file in the document: its link fired load, which a fetch alone never does
const warmedUp = async (page: Page) => {
  const list = JSON.parse(await page.locator('#lazy-code').textContent({ timeout: 10_000 }) ?? '[]') as string[]
  expect(list.length).toBeGreaterThan(30)
  await expect.poll(
    () => page.evaluate(hrefs => hrefs.filter(href => !(window as unknown as { preloaded: Set<string> }).preloaded.has(href)), list),
    { timeout: 60_000, message: 'files whose link never loaded' },
  ).toEqual([])
}

const failedLine = (page: Page) => page.getByRole('alert').filter({ has: page.getByRole('button', { name: /^(Try again|Reload)$/ }) })

const expectPage = async (page: Page, heading: string) => {
  const title = page.getByRole('heading', { name: heading, level: 1, exact: true })
  await expect(title.or(failedLine(page))).toBeVisible({ timeout: 30_000 })
  await expect(failedLine(page)).toHaveCount(0)
  await expect(title).toBeVisible()
  expect(await page.evaluate(() => 'sameDocument' in window), 'the page reloaded').toBe(true)
}

const visit = async (page: Page, path: string, heading: string) => {
  await page.evaluate((path) => {
    history.pushState(null, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expectPage(page, heading)
}

const visitEveryKind = async (page: Page) => {
  await visit(page, '/settings', 'Settings')
  await visit(page, '/feed/history', 'Watch history')
  await visit(page, '/privacy', 'Privacy')
  const input = page.getByRole('combobox', { name: 'Search' })
  await input.fill('rick astley')
  await input.press('Enter')
  await expectPage(page, 'Results for rick astley')
}

test('a page opened during a network drop still loads, once the app downloaded every page\'s code', async ({ page }) => {
  await open(page, '/')
  await warmedUp(page)
  await page.route(`${origin}/assets/**`, drop)
  await visitEveryKind(page)
})

test('a page opened after a deploy removed its files still loads', async ({ page }) => {
  await open(page, '/')
  await warmedUp(page)
  await page.route(`${origin}/assets/**`, deploy)
  await visitEveryKind(page)
})

test('a docked video keeps playing while a page opens during a network drop', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await open(page, '/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  const time = () => video.evaluate(element => (element as HTMLVideoElement).currentTime)
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(time, { timeout: 120_000, message: 'playback did not start' }).toBeGreaterThan(1)

  const dock = page.getByRole('complementary', { name: 'Miniplayer' })
  await visit(page, '/settings', 'Settings')
  await expect(dock).toBeVisible()
  await warmedUp(page)
  await page.route(`${origin}/assets/**`, drop)
  await visit(page, '/privacy', 'Privacy')
  const before = await time()
  await expect.poll(time, { timeout: 30_000 }).toBeGreaterThan(before + 1)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false)
  await expect(dock).toBeVisible()
})

test('recovers playback when the engine resets during a network drop', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'yt-client-engine-ready' && event.ports[0]) {
        Object.assign(window, { lastEnginePort: event.ports[0] })
      }
    })
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await open(page, '/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  const time = () => video.evaluate(element => (element as HTMLVideoElement).currentTime)
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(time, { timeout: 120_000, message: 'playback did not start' }).toBeGreaterThan(1)

  // Drop the app's own engine page and assets, then force an engine reset
  await page.route(`${origin}/__yt_engine__/**`, drop)
  await page.route(`${origin}/assets/**`, drop)
  await page.evaluate(() => {
    const port = (window as unknown as { lastEnginePort?: MessagePort }).lastEnginePort
    if (!port) throw new Error('missing engine port')
    port.dispatchEvent(new MessageEvent('messageerror'))
  })

  // Stay dropped long enough for the first reset attempt to fail before connectivity returns
  await page.waitForTimeout(7_000)
  const before = await time()
  await page.unroute(`${origin}/__yt_engine__/**`, drop)
  await page.unroute(`${origin}/assets/**`, drop)

  await expect.poll(time, { timeout: 120_000, message: 'playback did not recover after the drop ended' }).toBeGreaterThan(before + 1)
  expect(await page.evaluate(() => 'sameDocument' in window), 'the page reloaded').toBe(true)
})
