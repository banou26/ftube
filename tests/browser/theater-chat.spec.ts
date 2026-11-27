import type { WatchHarnessOptions } from './fixtures/watch-harness'
import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'

const mountTheaterWatch = async (
  page: Page,
  videoId: string,
  viewport: { width: number, height: number },
  options: Omit<WatchHarnessOptions, 'videoId' | 'longDescription'> = {},
) => {
  await page.setViewportSize(viewport)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  await expect(page.locator('#app main')).toBeVisible({ timeout: 30_000 })
  const host = page.locator(`[data-watch-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness(opts)
      }, [HARNESS, { ...options, theater: options.theater ?? 'fullscreen', videoId, longDescription: true }] as const)
    }
    await expect(host.locator('main.theater .stage [data-player-root]')).toBeVisible({ timeout: 5_000 })
    await expect(host.getByRole('heading', { name: `Harness Video ${videoId}` })).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

const expectRailClearOfPlayer = async (host: ReturnType<Page['locator']>) => {
  const metrics = await host.evaluate((el) => {
    const rail = el.querySelector<HTMLElement>('aside.theater-chat-rail')!.getBoundingClientRect()
    const player = el.querySelector<HTMLElement>('main.theater .stage [data-player-root]')!.getBoundingClientRect()
    const columns = el.querySelector<HTMLElement>('main.theater .columns')!.getBoundingClientRect()
    return {
      top: rail.top,
      bottom: rail.bottom,
      left: rail.left,
      right: rail.right,
      playerRight: player.right,
      columnsRight: columns.right,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
  expect(metrics.playerRight).toBeLessThanOrEqual(metrics.left + 1)
  expect(metrics.columnsRight).toBeLessThanOrEqual(metrics.left + 1)
  expect(Math.abs(metrics.right - metrics.innerWidth)).toBeLessThanOrEqual(2)
  expect(Math.abs(metrics.top - 56)).toBeLessThanOrEqual(2)
  expect(Math.abs(metrics.bottom - metrics.innerHeight)).toBeLessThanOrEqual(2)
  return metrics
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1000, height: 800 },
]) {
  test(`docks live chat full-height on the right in theater mode without overlapping player or horizontal overflow (${viewport.width}x${viewport.height})`, async ({ page }) => {
    const host = await mountTheaterWatch(page, `theater-live-${viewport.width}`, viewport, { isLive: true })

    const rail = host.locator('aside.theater-chat-rail')
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('region', { name: 'Live chat' })).toBeVisible()
    await expect(host.locator('aside.secondary [aria-label="Live chat"]')).toHaveCount(0)

    await expectRailClearOfPlayer(host)

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(400)

    await expectRailClearOfPlayer(host)

    await rail.getByRole('button', { name: 'Hide chat' }).click()
    await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
    const showBtn = host.locator('aside.secondary').getByRole('button', { name: 'Show chat' })
    await expect(showBtn).toBeVisible()
    await showBtn.click()
    await expect(host.locator('aside.theater-chat-rail')).toBeVisible()
  })
}

test('docks live chat replay full-height on the right in theater mode without overlapping player', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-replay-1280', { width: 1280, height: 800 }, {
    isLive: false,
    hasChatReplay: true,
  })

  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
  const openBtn = host.getByRole('region', { name: 'Live chat replay' }).getByRole('button', { name: 'Open panel' })
  await openBtn.scrollIntoViewIfNeeded()
  await openBtn.click()

  const rail = host.locator('aside.theater-chat-rail')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('region', { name: 'Chat replay' })).toBeVisible()
  await expect(host.locator('aside.secondary [aria-label="Chat replay"]')).toHaveCount(0)
  await expectRailClearOfPlayer(host)

  await rail.getByRole('button', { name: 'Close' }).click()
  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
})

test('docks live chat full-height on the right in normal YouTube theater mode too', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-yt-live-1280', { width: 1280, height: 800 }, {
    isLive: true,
    theater: 'theater',
  })

  await expect(host.locator('main')).toHaveClass(/\btheater\b/)
  await expect(host.locator('main')).not.toHaveClass(/\btheater-fullscreen\b/)
  const rail = host.locator('aside.theater-chat-rail')
  await expect(rail).toBeVisible()
  await expectRailClearOfPlayer(host)
})
