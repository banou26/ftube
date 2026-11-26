import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/post-card-harness.tsx'

const mountVariant = async (page: Page, variant: 'single' | 'multi' | 'members') => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator(`[data-post-card-harness="${variant}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, kind]) => {
        const mod = await import(path) as typeof import('./fixtures/post-card-harness')
        mod.mountPostCardHarness(kind)
      }, [HARNESS, variant] as const)
    }
    await expect(host.locator('article.post')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('clicking a post single image opens full-size lightbox and closes via Escape, close button, and backdrop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'single')

  const trigger = host.getByRole('button', { name: 'View image full size' })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const viewer = page.getByRole('dialog', { name: 'Post image viewer' })
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('img')).toHaveAttribute('src', /Single%20Full%20Size/)
  await expect(viewer.getByRole('button', { name: 'Next image' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)

  await trigger.click()
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: 'Close image' }).click()
  await expect(viewer).toHaveCount(0)

  await trigger.click()
  await expect(viewer).toBeVisible()
  await viewer.click({ position: { x: 8, y: 8 } })
  await expect(viewer).toHaveCount(0)
})

test('clicking a multi-image post thumbnail opens lightbox and navigates with buttons and arrow keys', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'multi')

  await host.getByRole('button', { name: 'View image 2 of 3 full size' }).click()
  const viewer = page.getByRole('dialog', { name: 'Post image viewer' })
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('img')).toHaveAttribute('src', /Slide%20Two/)
  await expect(viewer).toContainText('2 / 3')

  await viewer.getByRole('button', { name: 'Next image' }).click()
  await expect(viewer.locator('img')).toHaveAttribute('src', /Slide%20Three/)
  await expect(viewer).toContainText('3 / 3')

  await page.keyboard.press('ArrowLeft')
  await expect(viewer.locator('img')).toHaveAttribute('src', /Slide%20Two/)
  await expect(viewer).toContainText('2 / 3')

  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('img')).toHaveAttribute('src', /Slide%20Three/)
})

test('displays members-only badge pill on members-only posts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountVariant(page, 'members')
  await expect(host.locator('.members-only-pill')).toContainText('Members only')
})
