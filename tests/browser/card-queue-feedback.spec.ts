import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/card-menu-harness.tsx'

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__cardMenuHarness?.cleanup())
})

test('adds to queue with panel management and applies Not interested and Don\'t recommend channel with Undo', async ({ page }) => {
  await page.route('**/youtubei/v1/player*', route => route.abort())
  await page.goto('/privacy')
  const harness = page.locator('[data-card-menu-harness]')
  await expect(async () => {
    if (await harness.count() === 0) {
      await page.evaluate(async (path) => {
        const mod = await import(path) as typeof import('./fixtures/card-menu-harness')
        mod.mountCardMenuHarness()
      }, HARNESS)
    }
    await expect(harness).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  await harness.getByRole('button', { name: 'More actions for Alpha Video' }).click()
  await page.getByRole('menuitem', { name: 'Add to queue' }).click()
  await expect(page.getByText('Added to queue')).toBeVisible()

  const queue = harness.getByRole('region', { name: 'Queue' })
  await expect(queue).toBeVisible()
  await expect(queue.getByText('Alpha Video')).toBeVisible()

  await harness.getByRole('button', { name: 'More actions for Beta Video' }).click()
  await page.getByRole('menuitem', { name: 'Add to queue' }).click()
  await expect(queue.getByText('Beta Video')).toBeVisible()

  await queue.getByRole('button', { name: 'Move Beta Video up' }).click()
  const titlesAfterMove = await queue.locator('.video-title').allTextContents()
  expect(titlesAfterMove).toEqual(['Beta Video', 'Alpha Video'])

  await queue.getByRole('button', { name: 'Remove Alpha Video from queue' }).click()
  await expect(queue.locator('.video-title')).toHaveText(['Beta Video'])

  await queue.getByRole('button', { name: 'Clear queue' }).click()
  await expect(queue).toBeHidden()

  await harness.getByRole('button', { name: 'More actions for Alpha Video' }).click()
  await expect(page.getByRole('menuitem', { name: 'Save to Watch later' })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Not interested' }).click()
  await expect(harness.getByRole('link', { name: 'Alpha Video' })).toBeHidden()
  await expect(harness.getByRole('link', { name: 'Alpha Followup' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__cardMenuHarness?.feedbackTokens ?? [])).toContain('tok-ni-alpha')

  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(harness.getByRole('link', { name: 'Alpha Video' })).toBeVisible()

  await harness.getByRole('button', { name: 'More actions for Alpha Video' }).click()
  await page.getByRole('menuitem', { name: "Don't recommend channel" }).click()
  await expect(harness.getByRole('link', { name: 'Alpha Video' })).toBeHidden()
  await expect(harness.getByRole('link', { name: 'Alpha Followup' })).toBeHidden()
  await expect(harness.getByRole('link', { name: 'Beta Video' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__cardMenuHarness?.feedbackTokens ?? [])).toContain('tok-dr-alpha')

  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(harness.getByRole('link', { name: 'Alpha Video' })).toBeVisible()
  await expect(harness.getByRole('link', { name: 'Alpha Followup' })).toBeVisible()
})
