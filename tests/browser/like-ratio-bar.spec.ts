import type { Page } from '@playwright/test'
import type { LikeHarnessOptions } from './fixtures/like-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/like-harness.tsx'
const RYD_VOTES_URL = 'https://returnyoutubedislikeapi.com/**'

const mountRatioHarness = async (page: Page, options: LikeHarnessOptions = {}) => {
  await page.goto('/privacy')
  const host = page.locator('[data-like-harness="INDIFFERENT"]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(
        async ([path, opts]) => (await import(path) as typeof import('./fixtures/like-harness')).mountLikes('INDIFFERENT', opts),
        [HARNESS, options] as const,
      )
    }
    await expect(host.locator('.like-pill')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('renders the like/dislike ratio bar directly below LikePill with exact tooltip on hover and focus', async ({ page }) => {
  await page.route(RYD_VOTES_URL, route =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { id: 'video-0', likes: 64000, dislikes: 2095, viewCount: 1_000_000, rating: 4.87, deleted: false },
    }),
  )

  const host = await mountRatioHarness(page, { likeCount: 64571, likeCountText: '64K' })
  const pill = host.locator('.like-pill')
  const bar = pill.locator('[data-ratio-bar="true"]')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('role', 'meter')
  await expect(bar).toHaveAttribute('data-like-percent', '96.86')

  // Bar sits directly underneath .like-pill with matching horizontal span and without inflating pill height.
  const [pillBox, barBox, trackBox, fillBox] = await Promise.all([
    pill.boundingBox(),
    bar.boundingBox(),
    bar.locator('.ratio-track').boundingBox(),
    bar.locator('.ratio-fill').boundingBox(),
  ])
  expect(pillBox!.height).toBeCloseTo(36, 1)
  expect(Math.abs(barBox!.x - pillBox!.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(barBox!.width - pillBox!.width)).toBeLessThanOrEqual(1)
  expect(barBox!.y).toBeGreaterThanOrEqual(pillBox!.y + pillBox!.height - 0.5)
  expect(fillBox!.width / trackBox!.width).toBeCloseTo(64571 / (64571 + 2095), 2)

  // Hovering reveals "64,571 / 2,095" above the bar; moving away hides it again; focus reveals it cleanly.
  const tooltip = bar.locator('.ratio-tooltip')
  await expect(tooltip).toHaveText('64,571 / 2,095')
  await expect(tooltip).toHaveCSS('opacity', '0')

  await page.mouse.move(trackBox!.x + trackBox!.width / 2, trackBox!.y + trackBox!.height / 2)
  await expect(tooltip).toHaveCSS('opacity', '1')
  const tipBox = (await tooltip.boundingBox())!
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(trackBox!.y)

  await page.mouse.move(500, 300)
  await expect(tooltip).toHaveCSS('opacity', '0')

  await pill.locator('.dislike').focus()
  await page.keyboard.press('Tab')
  await expect(bar).toBeFocused()
  await expect(tooltip).toHaveCSS('opacity', '1')
})

test('hides the ratio bar when Show dislike counts is off, video is unseen, or RYD fails', async ({ page }) => {
  await page.route(RYD_VOTES_URL, route =>
    route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*' }, json: {} }),
  )
  let host = await mountRatioHarness(page, { likeCount: 64571, likeCountText: '64K' })
  await expect(host.locator('.like-pill .like')).toContainText('64K')
  await expect(host.locator('[data-ratio-bar="true"]')).toHaveCount(0)

  await page.route(RYD_VOTES_URL, route =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { id: 'video-0', likes: 0, dislikes: 0, deleted: false },
    }),
  )
  host = await mountRatioHarness(page, { likeCount: 64571, likeCountText: '64K' })
  await expect(host.locator('.like-pill .like')).toContainText('64K')
  await expect(host.locator('[data-ratio-bar="true"]')).toHaveCount(0)

  await page.addInitScript(() => localStorage.setItem('yt-client:settings', JSON.stringify({ showDislikes: false })))
  await page.route(RYD_VOTES_URL, route =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { id: 'video-0', likes: 1000, dislikes: 100, deleted: false },
    }),
  )
  host = await mountRatioHarness(page, { likeCount: 1000, likeCountText: '1K' })
  await expect(host.locator('.like-pill .like')).toContainText('1K')
  await expect(host.locator('[data-ratio-bar="true"]')).toHaveCount(0)
})
