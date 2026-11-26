import type { Page } from '@playwright/test'
import type { GuideSubscriptionFixture } from './fixtures/guide-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/guide-harness.tsx'

const CHANNELS: GuideSubscriptionFixture[] = [
  { id: 'UC01', name: 'Plain Alpha' },
  { id: 'UC02', name: 'New Beta', hasNewContent: true },
  { id: 'UC03', name: 'Live Gamma', isLive: true },
  { id: 'UC04', name: 'Plain Delta' },
  { id: 'UC05', name: 'New Epsilon', hasNewContent: true },
  { id: 'UC06', name: 'Live Zeta', isLive: true },
  { id: 'UC07', name: 'Plain Eta' },
  { id: 'UC08', name: 'Plain Theta' },
  { id: 'UC09', name: 'Plain Iota' },
  { id: 'UC10', name: 'Plain Kappa' },
]

const mountSubscriptions = async (page: Page) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator('[data-guide-harness="subscriptions"]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, list]) => {
        const mod = await import(path) as typeof import('./fixtures/guide-harness')
        mod.mountGuideWithSubscriptions(list)
      }, [HARNESS, CHANNELS] as const)
    }
    await expect(host.getByRole('link', { name: /Live Gamma/ })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('caps subscriptions at 7, sorts live then new-content first, renders indicators, and toggles Show more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountSubscriptions(page)

  const subsSection = host.locator('.section').filter({
    has: page.locator('a[href="/feed/channels"]'),
  })
  const subsLinks = subsSection.locator('a[href^="/channel/"]')
  await expect(subsLinks).toHaveCount(7)

  const initialNames = await subsLinks.locator('.channel-name').allTextContents()
  expect(initialNames).toEqual([
    'Live Gamma',
    'Live Zeta',
    'New Beta',
    'New Epsilon',
    'Plain Alpha',
    'Plain Delta',
    'Plain Eta',
  ])

  const liveRow = host.locator('a[href="/channel/UC03"]')
  await expect(liveRow.locator('.sub-live-icon')).toBeVisible()
  await expect(liveRow.locator('.sub-new-dot')).toHaveCount(0)

  const freshRow = host.locator('a[href="/channel/UC02"]')
  await expect(freshRow.locator('.sub-new-dot')).toBeVisible()
  await expect(freshRow.locator('.sub-live-icon')).toHaveCount(0)

  const plainRow = host.locator('a[href="/channel/UC01"]')
  await expect(plainRow.locator('.sub-live-icon')).toHaveCount(0)
  await expect(plainRow.locator('.sub-new-dot')).toHaveCount(0)

  const toggle = host.getByRole('button', { name: 'Show more' })
  await expect(toggle).toBeVisible()
  await toggle.click()

  await expect(subsLinks).toHaveCount(10)
  await expect(host.getByRole('button', { name: 'Show fewer' })).toBeVisible()
  await host.getByRole('button', { name: 'Show fewer' }).click()
  await expect(subsLinks).toHaveCount(7)
})
