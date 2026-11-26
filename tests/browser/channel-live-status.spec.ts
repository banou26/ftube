import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/channel-live-status-harness.tsx'

type ChannelLiveVariant = 'live-linked' | 'live-unlinked' | 'offline'

const mountVariant = async (page: Page, variant: ChannelLiveVariant) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator(`[data-channel-live-status-harness="${variant}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, kind]) => {
        const mod = await import(path) as typeof import('./fixtures/channel-live-status-harness')
        mod.mountChannelLiveHarness(kind)
      }, [HARNESS, variant] as const)
    }
    await expect(host.locator('header.header')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('renders crimson live ring, LIVE badge, and watch link when a channel is live with liveVideoId', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'live-linked')

  const wrap = host.locator('header.header a.avatar-wrap.live')
  await expect(wrap).toBeVisible()
  await expect(wrap).toHaveAttribute('href', '/watch?v=live-vid-956')
  const badge = wrap.locator('.avatar-live-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText('LIVE')

  const boxShadow = await wrap.evaluate(el => getComputedStyle(el).boxShadow)
  expect(boxShadow).toContain('225, 0, 45')
})

test('renders live ring and LIVE badge without link when liveVideoId is absent', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'live-unlinked')

  const wrap = host.locator('header.header .avatar-wrap.live')
  await expect(wrap).toBeVisible()
  await expect(host.locator('header.header a.avatar-wrap')).toHaveCount(0)
  await expect(wrap.locator('.avatar-live-badge')).toHaveText('LIVE')
})

test('omits live ring and LIVE badge when channel is offline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'offline')

  await expect(host.locator('header.header .avatar-live-badge')).toHaveCount(0)
  await expect(host.locator('header.header .avatar-wrap.live')).toHaveCount(0)
})
