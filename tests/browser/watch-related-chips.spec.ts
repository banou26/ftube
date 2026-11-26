import type { WatchHarnessOptions } from './fixtures/watch-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'

const mount = async (page: import('@playwright/test').Page, options: WatchHarnessOptions = {}) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const videoId = options.videoId ?? 'watch-chips-1'
  const host = page.locator(`[data-watch-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness(opts)
      }, [HARNESS, { ...options, videoId }] as const)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  await expect(host.locator('h1')).toContainText(`Harness Video ${videoId}`, { timeout: 15_000 })
  return host
}

test('hides related filter chips when the video has none', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, { withChips: false })
  await expect(host.getByText('All Related Video 1')).toBeVisible()
  await expect(host.getByRole('region', { name: 'Related video filters' })).toHaveCount(0)
})

test('renders filter chips above related videos, filters with pagination, and restores All', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, { withChips: true })

  const rail = host.getByRole('region', { name: 'Related video filters' })
  await expect(rail).toBeVisible()

  const firstCard = host.locator('aside.secondary').getByText('All Related Video 1').first()
  await expect(firstCard).toBeVisible()
  const railBox = await rail.boundingBox()
  const cardBox = await firstCard.boundingBox()
  expect(railBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(cardBox!.y + 2)

  const allChip = rail.getByRole('button', { name: 'All', exact: true })
  const musicChip = rail.getByRole('button', { name: 'Music', exact: true })
  await expect(allChip).toHaveAttribute('aria-pressed', 'true')
  await expect(musicChip).toHaveAttribute('aria-pressed', 'false')

  await musicChip.click()
  await expect(musicChip).toHaveAttribute('aria-pressed', 'true')
  await expect(allChip).toHaveAttribute('aria-pressed', 'false')
  await expect(host.getByText('Music Filtered Video 1')).toBeVisible()
  await expect(host.getByText('Music Filtered Video 2')).toBeVisible()
  // In 2-column mode FeedSentinel loads page 2 when brought into view.
  await expect(host.getByText('Music Page 2 Video')).toBeVisible()
  await expect(host.getByText('All Related Video 1')).toHaveCount(0)

  await allChip.click()
  await expect(allChip).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('All Related Video 1')).toBeVisible()
  await expect(host.getByText('Music Filtered Video 1')).toHaveCount(0)
})

test('paginates filtered and restored related lists via Show more in single-column layout', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 })
  const host = await mount(page, { withChips: true })

  const rail = host.getByRole('region', { name: 'Related video filters' })
  const allChip = rail.getByRole('button', { name: 'All', exact: true })
  const musicChip = rail.getByRole('button', { name: 'Music', exact: true })

  await musicChip.click()
  await expect(musicChip).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('Music Filtered Video 1')).toBeVisible()
  await expect(host.getByRole('button', { name: 'Show more' })).toBeVisible()
  await host.getByRole('button', { name: 'Show more' }).click()
  await expect(host.getByText('Music Page 2 Video')).toBeVisible()

  await allChip.click()
  await expect(allChip).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('All Related Video 1')).toBeVisible()
  await expect(host.getByText('Music Filtered Video 1')).toHaveCount(0)
  await host.getByRole('button', { name: 'Show more' }).click()
  await expect(host.getByText('All Related Page 2')).toBeVisible()
})

test('scrolls overflowing chip rails horizontally without overflowing the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, { withChips: true })

  const rail = host.getByRole('region', { name: 'Related video filters' })
  const nextArrow = rail.getByRole('button', { name: 'More filters' })
  await expect(nextArrow).toBeVisible()

  const beforeScroll = await rail.evaluate((el) => el.querySelector('.track')?.scrollLeft ?? 0)
  await nextArrow.click()
  await expect.poll(async () => rail.evaluate((el) => el.querySelector('.track')?.scrollLeft ?? 0)).toBeGreaterThan(beforeScroll)
  await expect(rail.getByRole('button', { name: 'Previous filters' })).toBeVisible()

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(pageOverflow).toBe(false)
})

test('discards stale slower chip responses and resets active chip when navigating to another video', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, {
    withChips: true,
    chipDelays: {
      'chip:music': 300,
      'chip:coding': 10,
    },
  })

  const rail = host.getByRole('region', { name: 'Related video filters' })
  await rail.getByRole('button', { name: 'Music', exact: true }).click()
  await rail.getByRole('button', { name: 'Coding', exact: true }).click()

  await expect(rail.getByRole('button', { name: 'Coding', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('Coding Filtered Video 1')).toBeVisible()

  // Wait past Music's delayed response and ensure Coding still owns the list.
  await page.waitForTimeout(450)
  await expect(rail.getByRole('button', { name: 'Coding', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('Coding Filtered Video 1')).toBeVisible()
  await expect(host.getByText('Music Filtered Video 1')).toHaveCount(0)

  // Clicking a related video navigates WatchPage in place to a new videoId and resets the active chip to All.
  await host.locator('aside.secondary a[href^="/watch?v=rel-code-1"]').first().click()
  await expect(host.locator('h1')).toContainText('Harness Video rel-code-1')
  await expect(rail.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(host.getByText('All Related Video 1')).toBeVisible()
})
