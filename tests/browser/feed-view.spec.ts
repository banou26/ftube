import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/feed-view-harness.tsx'

const openSurface = async (page: Page, url: string) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/privacy')
  const root = page.locator('[data-feed-view-harness="app"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async ({ path, url }) => {
        const harness = await import(path) as typeof import('./fixtures/feed-view-harness')
        harness.mountApp(url)
      }, { path: HARNESS, url })
    }
    await expect(root.locator('article, main').first()).toBeVisible({ timeout: 15_000 })
  }).toPass({ timeout: 120_000 })
  return root
}

const openFeedPage = async (page: Page, url: string) => {
  const root = await openSurface(page, url)
  await expect(root.locator('article').first()).toBeVisible({ timeout: 15_000 })
  return root
}

test('places Grid/List/Settings buttons on the right opposite filters and persists separate Subscriptions vs Channel layouts', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const root = await openSurface(page, '/feed/subscriptions')

  const filterBar = root.locator('.filters .chips')
  const viewButtons = root.getByRole('group', { name: 'Feed view controls' })
  await expect(viewButtons).toBeVisible()

  const filterBox = (await filterBar.boundingBox())!
  const buttonsBox = (await viewButtons.boundingBox())!
  expect(buttonsBox.x).toBeGreaterThan(filterBox.x + filterBox.width)

  // Grid by default on Subscriptions.
  const gridButton = root.getByRole('button', { name: 'Grid view', exact: true })
  const listButton = root.getByRole('button', { name: 'List view', exact: true })
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true')
  await expect(root.locator('article.list')).toHaveCount(0)

  // Switch Subscriptions to List and verify persistence across reload.
  await listButton.click()
  await expect(listButton).toHaveAttribute('aria-pressed', 'true')
  await expect(root.locator('article.list').first()).toBeVisible()

  await page.reload()
  const reloadedSubs = await openSurface(page, '/feed/subscriptions')
  await expect(reloadedSubs.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(reloadedSubs.locator('article.list').first()).toBeVisible()

  // Channel Videos stays in Grid (separate layout storage), opposite .sorts.
  const channelRoot = await openSurface(page, '/channel/UC_DEMO/videos')
  await expect(channelRoot.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(channelRoot.locator('article.list')).toHaveCount(0)
  const sortsBox = (await channelRoot.locator('.sorts').boundingBox())!
  const channelButtonsBox = (await channelRoot.getByRole('group', { name: 'Feed view controls' }).boundingBox())!
  expect(channelButtonsBox.x).toBeGreaterThan(sortsBox.x + sortsBox.width)

  const channelOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(channelOverflow).toBeLessThanOrEqual(0)

  // Subscriptions List view must also avoid horizontal overflow on desktop and mobile.
  await openSurface(page, '/feed/subscriptions')
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(desktopOverflow).toBeLessThanOrEqual(0)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOverflow = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth
    const diff = document.documentElement.scrollWidth - clientWidth
    const offenders = [...document.querySelectorAll('*')]
      .filter(el => el.getBoundingClientRect().right > clientWidth + 0.5)
      .map(el => `${el.tagName}.${el.className || el.getAttribute('title') || ''}:${Math.round(el.getBoundingClientRect().right)}`)
      .slice(0, 10)
    return { diff, offenders }
  })
  expect(mobileOverflow.diff, `Offenders: ${mobileOverflow.offenders.join(', ')}`).toBeLessThanOrEqual(0)
})

test('opens the live side panel to customize Grid and List cards, toggle duration, and show channel descriptions', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const root = await openSurface(page, '/feed/subscriptions')

  await root.getByRole('button', { name: 'List view', exact: true }).click()
  await root.getByRole('button', { name: 'Feed display settings', exact: true }).click()

  const panel = root.getByRole('complementary', { name: 'Feed display settings' })
  await expect(panel).toBeVisible()

  // Edit List card properties live.
  await panel.getByRole('button', { name: 'Right', exact: true }).click()
  await expect(root.locator('article.list.thumb-end').first()).toBeVisible()

  await panel.getByLabel('Title size').fill('22')
  await panel.getByLabel('Title size').dispatchEvent('input')
  await panel.getByLabel('Bold titles').check()
  await panel.getByLabel('Card font').selectOption('serif')
  await panel.getByLabel('Title color').fill('#3ea6ff')
  await panel.getByLabel('Title color').dispatchEvent('input')
  await panel.getByLabel('Metadata color').fill('#cccccc')
  await panel.getByLabel('Metadata color').dispatchEvent('input')
  await panel.getByLabel('Rounded corners').fill('0')
  await panel.getByLabel('Rounded corners').dispatchEvent('input')
  await panel.getByLabel('Row spacing').fill('32')
  await panel.getByLabel('Row spacing').dispatchEvent('input')
  await panel.getByLabel('Thumbnail size').fill('320')
  await panel.getByLabel('Thumbnail size').dispatchEvent('input')

  const firstListCard = root.locator('article.list').first()
  await expect(firstListCard.locator('.description')).toBeVisible()
  const styles = await firstListCard.evaluate((card) => {
    const title = card.querySelector('.title')!
    const thumb = card.querySelector('.thumb')!
    return {
      fontSize: getComputedStyle(title).fontSize,
      fontWeight: getComputedStyle(title).fontWeight,
      fontFamily: getComputedStyle(title).fontFamily,
      color: getComputedStyle(title).color,
      thumbWidth: thumb.getBoundingClientRect().width,
      radius: getComputedStyle(thumb).borderRadius,
    }
  })
  expect(styles.fontSize).toBe('22px')
  expect(Number(styles.fontWeight)).toBeGreaterThanOrEqual(700)
  expect(styles.fontFamily.toLowerCase()).toContain('georgia')
  expect(styles.color).toBe('rgb(62, 166, 255)')
  expect(Math.round(styles.thumbWidth)).toBe(320)
  expect(styles.radius).toBe('0px')

  // Toggle video duration badges off and back on.
  await expect(firstListCard.locator('.badge', { hasText: '12:00' })).toBeVisible()
  await panel.getByLabel('Show video durations').uncheck()
  await expect(firstListCard.locator('.badge', { hasText: '12:00' })).toHaveCount(0)
  await panel.getByLabel('Show video durations').check()
  await expect(firstListCard.locator('.badge', { hasText: '12:00' })).toBeVisible()

  // Edit Grid card styles live via "Grid cards" target and switch to Grid view.
  await panel.getByRole('button', { name: 'Grid cards', exact: true }).click()
  await panel.getByRole('button', { name: 'Bottom', exact: true }).click()
  await root.getByRole('button', { name: 'Grid view', exact: true }).click()
  await expect(root.locator('article.thumb-end:not(.list)').first()).toBeVisible()

  // Close with Escape and reopen Channel Videos to verify Show descriptions toggle.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  const channelRoot = await openSurface(page, '/channel/UC_DEMO/videos')
  await expect(channelRoot.locator('article .description')).toHaveCount(0)
  await channelRoot.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  await channelRoot.getByLabel('Show descriptions on channel Videos').check()
  await expect(channelRoot.locator('article .description').first()).toContainText('First channel description')
})

test('applies hide toggles, duration and upload date filters, custom filter buttons, and blocklists across Subscriptions and Search', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const root = await openSurface(page, '/feed/subscriptions')

  await root.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  const panel = root.getByRole('complementary', { name: 'Feed display settings' })

  await panel.getByRole('tab', { name: 'Filters' }).click()
  await panel.getByLabel('Shorts', { exact: true }).check()
  await panel.getByLabel('Live streams', { exact: true }).check()
  await panel.getByLabel('Premieres', { exact: true }).check()
  await panel.getByLabel('Upcoming videos', { exact: true }).check()
  await panel.getByLabel('Past streams', { exact: true }).check()
  await panel.getByLabel('Watched videos', { exact: true }).check()
  await panel.getByLabel('"Most relevant" shelf').check()

  await expect(root.getByText('Quick Clip Short')).toHaveCount(0)
  await expect(root.getByText('Live Coding Session')).toHaveCount(0)
  await expect(root.getByText('Premiere Release Trailer')).toHaveCount(0)
  await expect(root.getByText('Upcoming Architecture Talk')).toHaveCount(0)
  await expect(root.getByText('Weekend Q&A Replay')).toHaveCount(0)
  await expect(root.getByText('Already Watched Video')).toHaveCount(0)
  await expect(root.getByText('Most Relevant Pick')).toHaveCount(0)
  await expect(root.getByText('Regular Tutorial Today')).toBeVisible()

  // Hide Shorts syncs to global settings store.
  const syncedHideShorts = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').hideShorts)
  expect(syncedHideShorts).toBe(true)

  // Blocklist applies to Subscriptions and Search.
  await panel.getByRole('tab', { name: 'Blocklist' }).click()
  await panel.getByLabel('Blocked keyword').fill('spoiler')
  await panel.getByRole('button', { name: 'Block', exact: true }).first().click()
  await panel.getByLabel('Blocked channel').fill('Spam Channel')
  await panel.getByRole('button', { name: 'Block', exact: true }).nth(1).click()

  await expect(root.getByText('Secret Spoiler Review')).toHaveCount(0)
  await expect(root.getByText('Channel Block Target Video')).toHaveCount(0)

  // Duration + Upload date filters.
  await panel.getByRole('tab', { name: 'Filters' }).click()
  await panel.getByLabel('Upload date filter').selectOption('today')
  await expect(root.getByText('Deep Systems Over 20 Minutes')).toHaveCount(0)
  await expect(root.getByText('Regular Tutorial Today')).toBeVisible()

  await panel.getByLabel('Upload date filter').selectOption('any')
  await expect(root.getByText('Deep Systems Over 20 Minutes')).toBeVisible()

  // Create custom filter button, toggle it in toolbar, then delete it.
  await panel.getByLabel('Custom filter name').fill('Long Systems')
  await panel.getByLabel('Custom filter keyword').fill('systems')
  await panel.getByLabel('Custom filter duration').selectOption('over20')
  await panel.getByRole('button', { name: 'Add filter button' }).click()

  const customChip = root.locator('.feed-custom-chips').getByRole('button', { name: 'Long Systems' })
  await expect(customChip).toBeVisible()
  await customChip.click()
  await expect(root.getByText('Regular Tutorial Today')).toHaveCount(0)
  await expect(root.getByText('Deep Systems Over 20 Minutes')).toBeVisible()
  await customChip.click()
  await expect(root.getByText('Regular Tutorial Today')).toBeVisible()

  await panel.getByRole('button', { name: 'Delete filter Long Systems' }).click()
  await expect(customChip).toHaveCount(0)

  // Navigate to Search: keyword block, channel block, and Most relevant shelf stay hidden across YouTube.
  const searchRoot = await openFeedPage(page, '/results?search_query=demo')
  await expect(searchRoot.getByText('Normal Search Video')).toBeVisible()
  await expect(searchRoot.getByText('Live Stream In Search')).toHaveCount(0)
  await expect(searchRoot.getByText('Watched Video In Search')).toHaveCount(0)
  await expect(searchRoot.getByText('Hidden Spoiler Result')).toHaveCount(0)
  await expect(searchRoot.getByText('Channel Blocked In Search')).toHaveCount(0)
  await expect(searchRoot.getByText('Most Relevant Shelf Item')).toHaveCount(0)
})

test('keeps Subscriptions toggles local, skips channel block on own channel, avoids filtering Hashtag Shorts, caps empty auto-paging, and navigates panel tabs via keyboard', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const root = await openFeedPage(page, '/feed/subscriptions')

  // Local Subscriptions checkboxes stay local and do not write global feedSettings.hide.
  await root.getByLabel('Hide live', { exact: true }).check()
  await root.getByLabel('Hide watched', { exact: true }).check()
  await expect(root.getByText('Live Coding Session')).toHaveCount(0)
  await expect(root.getByText('Already Watched Video')).toHaveCount(0)
  const storedHide = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:feed-view') ?? '{}').hide)
  expect(storedHide?.live ?? false).toBe(false)
  expect(storedHide?.watched ?? false).toBe(false)

  // Search still shows live and watched items when only Subscriptions local toggles were checked.
  const searchRoot = await openFeedPage(page, '/results?search_query=demo')
  await expect(searchRoot.getByText('Live Stream In Search')).toBeVisible()
  await expect(searchRoot.getByText('Watched Video In Search')).toBeVisible()

  // Keyboard navigation + ARIA tabpanel in FeedSettingsPanel, and add Spam Channel + Today + Over 20 minutes filters.
  const subsRoot = await openFeedPage(page, '/feed/subscriptions')
  await subsRoot.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  const panel = subsRoot.getByRole('complementary', { name: 'Feed display settings' })
  const cardTab = panel.getByRole('tab', { name: 'Card', exact: true })
  await cardTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByRole('tab', { name: 'Filters', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('tabpanel', { name: 'Filters', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByRole('tab', { name: 'Blocklist', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(panel.getByRole('tab', { name: 'Filters', exact: true })).toHaveAttribute('aria-selected', 'true')
  await panel.getByRole('tab', { name: 'Blocklist', exact: true }).click()
  await panel.getByLabel('Blocked channel').fill('Spam Channel')
  await panel.getByRole('button', { name: 'Block', exact: true }).nth(1).click()
  await panel.getByRole('tab', { name: 'Filters', exact: true }).click()
  await panel.getByLabel('Duration filter').selectOption('over20')
  await panel.getByLabel('Upload date filter').selectOption('today')

  // Visiting blocked channel's own page still shows its uploads.
  const spamChannelRoot = await openSurface(page, '/channel/UC_SPAM/videos')
  await spamChannelRoot.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  await spamChannelRoot.getByRole('tab', { name: 'Filters' }).click()
  await spamChannelRoot.getByLabel('Duration filter').selectOption('any')
  await spamChannelRoot.getByLabel('Upload date filter').selectOption('any')
  await expect(spamChannelRoot.getByText('Channel Video Alpha')).toBeVisible()

  // Hashtag Shorts tab stays visible even with Over 20 minutes + Today filters active.
  await spamChannelRoot.getByLabel('Duration filter').selectOption('over20')
  await spamChannelRoot.getByLabel('Upload date filter').selectOption('today')
  const hashtagShortsRoot = await openSurface(page, '/hashtag/demo/shorts')
  await expect(hashtagShortsRoot.getByText('Hashtag Short Without Date')).toBeVisible()

  // Home stops auto-paging after EMPTY_PAGES_LIMIT (5) pages when filters hide everything and exposes Load more.
  const homeRoot = await openSurface(page, '/')
  await expect(homeRoot.getByText('Filters hide everything on this page.')).toBeVisible({ timeout: 30_000 })
  await expect(homeRoot.getByRole('button', { name: 'Load more', exact: true })).toBeVisible()
  const requestCount = await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/feed-view-harness')
    return harness.getHomeRequestCount()
  }, HARNESS)
  expect(requestCount).toBe(5)
})

test('lazily loads missing video descriptions only when descriptions are enabled on Subscriptions and Channel Videos', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const root = await openFeedPage(page, '/feed/subscriptions')

  await expect(root.locator('article .description')).toHaveCount(0)
  expect(await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/feed-view-harness')
    return harness.getVideoDescriptionRequests()
  }, HARNESS)).toEqual([])

  await root.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  const panel = root.getByRole('complementary', { name: 'Feed display settings' })
  await panel.getByRole('group', { name: 'Description length' }).getByRole('button', { name: '2', exact: true }).click()

  const premiereCard = root.locator('article', { hasText: 'Premiere Release Trailer' })
  await premiereCard.scrollIntoViewIfNeeded()
  await expect(premiereCard.locator('.description')).toContainText('Lazy description for sub-premiere with normalized whitespace.')
  expect(await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/feed-view-harness')
    return harness.getVideoDescriptionRequests()
  }, HARNESS)).toContain('sub-premiere')

  // Reset global Description length back to Off before verifying Channel Videos' own toggle.
  await panel.getByRole('group', { name: 'Description length' }).getByRole('button', { name: 'Off', exact: true }).click()

  const channelRoot = await openFeedPage(page, '/channel/UC_DEMO/videos')
  await expect(channelRoot.getByText('Channel Video Gamma')).toBeVisible()
  await expect(channelRoot.locator('article .description')).toHaveCount(0)
  expect(await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/feed-view-harness')
    return harness.getVideoDescriptionRequests()
  }, HARNESS)).toEqual([])

  await channelRoot.getByRole('button', { name: 'Feed display settings', exact: true }).click()
  await channelRoot.getByLabel('Show descriptions on channel Videos').check()

  const gammaCard = channelRoot.locator('article', { hasText: 'Channel Video Gamma' })
  await expect(gammaCard.locator('.description')).toContainText('Lazy description for ch-video-3 with normalized whitespace.')
})
