import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-links-harness.tsx'

const mountHarness = async (page: Page, initialPath: string) => {
  await page.goto('/privacy')
  await expect(page.locator('#app main')).toBeVisible({ timeout: 30_000 })
  const harness = page.locator('[data-watch-links-harness]')
  await expect(async () => {
    if (await harness.count() === 0) {
      await page.evaluate(async ([path, entry]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-links-harness')
        mod.mountWatchLinksHarness(entry)
      }, [HARNESS, initialPath] as const)
    }
    await expect(harness.locator('section[aria-label="Playlist queue"]')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return harness
}

test('selects the indexed duplicate video occurrence across /embed, /watch/:id, and /live/:id redirects and advances to the following item (APP-1106)', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport)

    const harness = await mountHarness(page, '/embed/dup-video?list=PL-DUP&index=3&start=30')
    await expect(page).toHaveURL('/watch?v=dup-video&list=PL-DUP&index=3&t=30')

    const panel = harness.locator('section[aria-label="Playlist queue"]')
    await expect(panel.locator('.count')).toHaveText('3 / 4')
    const rows = panel.locator('li.row')
    await expect(rows.nth(2)).toHaveAttribute('data-current', 'true')
    await expect(rows.nth(2).locator('a')).toHaveAttribute('aria-current', 'true')
    await expect(rows.nth(0)).not.toHaveAttribute('data-current', 'true')

    await panel.getByRole('button', { name: 'Next video', exact: true }).click()
    await expect(page).toHaveURL('/watch?v=track-four&list=PL-DUP&index=4')
    await expect(panel.locator('.count')).toHaveText('4 / 4')
    await expect(rows.nth(3)).toHaveAttribute('data-current', 'true')
    await expect(rows.nth(3)).toContainText('Fourth Track')
  }

  // Verify shared /watch/:id and /live/:id redirects also preserve index=3 & t=30 and advance to index=4
  const harness = page.locator('[data-watch-links-harness]')
  const panel = harness.locator('section[aria-label="Playlist queue"]')
  for (const path of [
    '/watch/dup-video?list=PL-DUP&index=3&t=30',
    '/live/dup-video?list=PL-DUP&index=3&t=30&si=shared',
  ]) {
    await page.evaluate((next) => window.__watchLinksHarness?.navigate(next), path)
    await expect(page).toHaveURL('/watch?v=dup-video&list=PL-DUP&index=3&t=30')
    await expect(panel.locator('.count')).toHaveText('3 / 4')
    await panel.getByRole('button', { name: 'Next video', exact: true }).click()
    await expect(page).toHaveURL('/watch?v=track-four&list=PL-DUP&index=4')
    await expect(panel.locator('.count')).toHaveText('4 / 4')
  }

  // Control: without index, upstream resolves to the first occurrence (1 / 4) and advances to index=2
  await page.evaluate(() => window.__watchLinksHarness?.navigate('/watch?v=dup-video&list=PL-DUP'))
  await expect(panel.locator('.count')).toHaveText('1 / 4')
  await panel.getByRole('button', { name: 'Next video', exact: true }).click()
  await expect(page).toHaveURL('/watch?v=track-two&list=PL-DUP&index=2')
  await expect(panel.locator('.count')).toHaveText('2 / 4')
})
