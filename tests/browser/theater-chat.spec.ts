import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'

const mountTheaterLive = async (page: Page, videoId: string, viewport: { width: number, height: number }) => {
  await page.setViewportSize(viewport)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator(`[data-watch-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, vid]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness({ videoId: vid, isLive: true, theater: true, longDescription: true })
      }, [HARNESS, videoId] as const)
    }
    await expect(host.getByRole('heading', { name: `Harness Video ${videoId}` })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`docks live chat full-height on the right in theater mode without horizontal overflow (${viewport.width}x${viewport.height})`, async ({ page }) => {
    const host = await mountTheaterLive(page, `theater-live-${viewport.width}`, viewport)

    const rail = host.locator('aside.theater-chat-rail')
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('region', { name: 'Live chat' })).toBeVisible()
    await expect(host.locator('aside.secondary [aria-label="Live chat"]')).toHaveCount(0)

    const metrics = await rail.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        top: rect.top,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
    expect(Math.abs(metrics.right - metrics.innerWidth)).toBeLessThanOrEqual(2)
    expect(Math.abs(metrics.top - 56)).toBeLessThanOrEqual(2)
    expect(Math.abs(metrics.bottom - metrics.innerHeight)).toBeLessThanOrEqual(2)

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(400)

    const afterScroll = await rail.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, right: rect.right, innerWidth: window.innerWidth, innerHeight: window.innerHeight }
    })
    expect(Math.abs(afterScroll.top - 56)).toBeLessThanOrEqual(2)
    expect(Math.abs(afterScroll.bottom - afterScroll.innerHeight)).toBeLessThanOrEqual(2)
    expect(Math.abs(afterScroll.right - afterScroll.innerWidth)).toBeLessThanOrEqual(2)

    await rail.getByRole('button', { name: 'Hide chat' }).click()
    await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
    const showBtn = host.locator('aside.secondary').getByRole('button', { name: 'Show chat' })
    await expect(showBtn).toBeVisible()
    await showBtn.click()
    await expect(host.locator('aside.theater-chat-rail')).toBeVisible()
  })
}
