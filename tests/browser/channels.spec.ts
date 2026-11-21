import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

test('navigates to /feed/channels from Subscriptions feed and left guide category, and filters by name and upload date', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:groups', JSON.stringify([{
      id: 'g-tech',
      name: 'Tech',
      emoji: '💻',
      channels: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Tech' }],
      updatedAt: Date.now(),
    }]))
  })
  await page.goto('/feed/subscriptions')

  await expect(async () => {
    const host = page.locator('[data-channels-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelsSurface()
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const harness = page.locator('[data-channels-harness]')

  // 1. "All subscriptions" button on /feed/subscriptions moves to /feed/channels
  const allSubs = harness.getByRole('link', { name: 'All subscriptions', exact: true })
  await expect(allSubs).toBeVisible()
  await allSubs.click()
  await expect(page).toHaveURL('/feed/channels')
  await expect(harness.getByRole('heading', { name: 'All subscriptions' })).toBeVisible()

  // 2. Left "Subscriptions" category heading links to /feed/channels
  const guide = harness.getByRole('navigation', { name: 'Guide' })
  const categoryLink = guide.locator('a.section-link', { hasText: 'Subscriptions' })
  await expect(categoryLink).toHaveAttribute('href', '/feed/channels')
  await expect(categoryLink).toHaveAttribute('aria-current', 'page')

  // 3. All 3 channels render with metadata
  const rows = harness.locator('.list .row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Alpha Tech')
  await expect(rows.nth(0)).toContainText('@alphatech')
  await expect(rows.nth(0)).toContainText('120K subscribers')

  // 4. Filter by name
  await harness.getByRole('searchbox', { name: 'Filter channels' }).fill('beta')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Beta Music')
  await harness.getByRole('searchbox', { name: 'Filter channels' }).fill('')
  await expect(rows).toHaveCount(3)

  // 5. Filter by group and ungrouped
  await harness.getByLabel('Filter by group').selectOption('g-tech')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Alpha Tech')
  await harness.getByLabel('Filter by group').selectOption('ungrouped')
  await expect(rows).toHaveCount(2)
  await harness.getByLabel('Filter by group').selectOption('all')

  // 6. Filter by last video posted date (loads upload dates automatically)
  await harness.getByLabel('Filter by last video posted').selectOption('7d')
  await expect(rows).toHaveCount(1, { timeout: 15_000 })
  await expect(rows.first()).toContainText('Alpha Tech')
  await expect(rows.first()).toContainText(/Last video 2 days ago/)

  await harness.getByLabel('Filter by last video posted').selectOption('inactive-365d')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Old Archive')

  // 7. Sort by most subscribers
  await harness.getByLabel('Filter by last video posted').selectOption('all')
  await harness.getByLabel('Sort channels').selectOption('subscribers')
  await expect(rows.nth(0)).toContainText('Beta Music')
  await expect(rows.nth(1)).toContainText('Alpha Tech')
  await expect(rows.nth(2)).toContainText('Old Archive')
})
