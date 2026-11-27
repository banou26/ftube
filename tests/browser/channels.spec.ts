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

  // 2. Left "Subscriptions" category heading links to /feed/subscriptions
  const guide = harness.getByRole('navigation', { name: 'Guide' })
  const categoryLink = guide.locator('a.section-link', { hasText: 'Subscriptions' })
  await expect(categoryLink).toHaveAttribute('href', '/feed/subscriptions')

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

  // 8. Custom upload date range picker filters channels, warns on inverted range, and clears cleanly
  const ymdAgo = (days: number) => {
    const d = new Date(Date.now() - days * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  await harness.getByLabel('Filter by last video posted').selectOption('custom')
  const fromInput = harness.getByLabel('Upload date from')
  const toInput = harness.getByLabel('Upload date to')
  await expect(fromInput).toBeVisible()
  await expect(toInput).toBeVisible()

  await fromInput.fill(ymdAgo(25))
  await toInput.fill(ymdAgo(15))
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Beta Music')

  await fromInput.fill(ymdAgo(5))
  await toInput.fill(ymdAgo(25))
  await expect(harness.getByRole('alert')).toContainText('Start date must be on or before end date')
  await expect(rows).toHaveCount(0)

  await harness.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(rows).toHaveCount(3)
})

test('own channel page hides Subscribe and shows Customize channel and Manage videos', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [mode, id] of [
    ['own-flag', 'UCown1111111111111111111'],
    ['own-handle', 'UCown2222222222222222222'],
  ] as const) {
    await page.goto('/privacy')
    await page.evaluate(async ([path, currentMode]) => {
      const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
      harness.mountChannelHeader(currentMode)
    }, ['/tests/browser/fixtures/menu-data-harness.tsx', mode] as const)
    const harness = page.locator(`[data-channel-header-harness="${mode}"]`)
    await expect(harness.getByRole('link', { name: 'Customize channel' })).toHaveAttribute(
      'href',
      `https://studio.youtube.com/channel/${id}/editing`,
    )
    await expect(harness.getByRole('link', { name: 'Manage videos' })).toHaveAttribute(
      'href',
      `https://studio.youtube.com/channel/${id}/videos`,
    )
    await expect(harness.getByRole('button', { name: /^Subscribe/ })).toHaveCount(0)
    await expect(harness.getByRole('button', { name: 'Groups' })).toHaveCount(0)
  }

  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
    harness.mountChannelHeader('other')
  }, '/tests/browser/fixtures/menu-data-harness.tsx')
  const other = page.locator('[data-channel-header-harness="other"]')
  await expect(other.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
  await expect(other.getByRole('button', { name: 'Groups', exact: true })).toBeVisible()
  await expect(other.getByRole('link', { name: 'Customize channel' })).toHaveCount(0)
})

test('keeps the subscription list populated and updates matches dynamically while checking upload dates', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/feed/channels')
  await expect(async () => {
    const host = page.locator('[data-channels-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelsSurface({ delayedUploads: true })
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const harness = page.locator('[data-channels-harness]')
  const rows = harness.locator('.list .row')
  await expect(rows).toHaveCount(3)

  // Selecting an upload-date filter while dates are still pending keeps channels visible instead of blanking out.
  await harness.getByLabel('Filter by last video posted').selectOption('inactive-365d')
  const progress = harness.getByRole('progressbar', { name: 'Checking channel upload dates' })
  await expect(progress).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '0')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Checking upload date…')
  await expect(harness.locator('.count')).toContainText('0 matched • checking 0 of 3')

  // Non-matching resolved channel disappears immediately.
  await page.evaluate(() => {
    ;(window as unknown as { __resolveChannelUpload: (id: string) => void }).__resolveChannelUpload('UCaaaaaaaaaaaaaaaaaaaaaa')
  })
  await expect(rows).toHaveCount(2)
  await expect(progress).toHaveAttribute('aria-valuenow', '1')
  await expect(harness.locator('.count')).toContainText('0 matched • checking 1 of 3')

  // Matching resolved channel promotes above still-pending channels and updates its metadata immediately.
  await page.evaluate(() => {
    ;(window as unknown as { __resolveChannelUpload: (id: string) => void }).__resolveChannelUpload('UCcccccccccccccccccccccc')
  })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Old Archive')
  await expect(rows.nth(0)).toContainText(/Last video \d+/)
  await expect(rows.nth(1)).toContainText('Beta Music')
  await expect(rows.nth(1)).toContainText('Checking upload date…')
  await expect(progress).toHaveAttribute('aria-valuenow', '2')
  await expect(harness.locator('.count')).toContainText('1 matched • checking 2 of 3')

  // Final channel resolves: only confirmed match remains and progress bar clears.
  await page.evaluate(() => {
    ;(window as unknown as { __resolveChannelUpload: (id: string) => void }).__resolveChannelUpload('UCbbbbbbbbbbbbbbbbbbbbbb')
  })
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Old Archive')
  await expect(progress).toHaveCount(0)
  await expect(harness.locator('.count')).toHaveText('1 of 3 channels')
})
