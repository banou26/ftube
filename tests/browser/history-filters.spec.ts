import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/history-harness.tsx'

test('filters watch history by type, channel group, search query, and clears history via confirmation dialog', async ({ page }) => {
  await page.goto('/privacy')
  const harness = page.locator('[data-history-harness]')
  await expect(async () => {
    if (await harness.count() === 0) {
      await page.evaluate(async (path) => {
        const mod = await import(path) as typeof import('./fixtures/history-harness')
        mod.mountHistoryHarness()
      }, HARNESS)
    }
    await expect(harness).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  await expect(harness.getByRole('heading', { name: 'Watch history' })).toBeVisible()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeVisible()

  const typeGroup = harness.getByRole('group', { name: 'Filter by type' })
  await typeGroup.getByRole('button', { name: 'Shorts', exact: true }).click()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeVisible()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeHidden()

  await typeGroup.getByRole('button', { name: 'Videos', exact: true }).click()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeHidden()

  await typeGroup.getByRole('button', { name: 'All', exact: true }).click()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeVisible()

  const groupsBar = harness.getByRole('group', { name: 'Groups' })
  await groupsBar.getByRole('button', { name: /Tech/ }).click()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeHidden()

  await groupsBar.getByRole('button', { name: 'All channels', exact: true }).click()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeVisible()

  const searchInput = harness.getByRole('searchbox', { name: 'Search watch history' })
  await searchInput.fill('Deep Dive')
  await searchInput.press('Enter')
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeHidden()

  const queries = await page.evaluate(() => window.__historyHarness?.queries ?? [])
  expect(queries).toContain('Deep Dive')

  await harness.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(harness.getByText('Quick CSS Grid Trick')).toBeVisible()

  await harness.getByRole('button', { name: 'Clear all watch history' }).click()
  const dialog = page.getByRole('dialog', { name: 'Clear watch history?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(harness.getByText('Vulkan Engine Deep Dive')).toBeVisible()

  await harness.getByRole('button', { name: 'Clear all watch history' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear watch history', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(harness.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible()
  await expect(page.getByText('Watch history cleared')).toBeVisible()
  expect(await page.evaluate(() => window.__historyHarness?.cleared)).toBe(1)

  await searchInput.fill('Deep Dive')
  await searchInput.press('Enter')
  await expect(harness.getByRole('heading', { name: 'No matching videos' })).toBeVisible()
  await harness.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(harness.getByRole('heading', { name: 'Nothing watched yet' })).toBeVisible()
})
