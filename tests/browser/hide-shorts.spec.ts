import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/hide-shorts-harness.tsx'

const holdPlayback = () => {
  if (window.top !== window) return
  const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (this: MessagePort, message: unknown, ...rest: unknown[]) => void
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    if ((message as { method?: string } | null)?.method === 'openPlayback') return
    return post.call(this, message, ...rest)
  } as typeof MessagePort.prototype.postMessage
}

const seedHideShorts = (page: Page) => page.addInitScript(() => {
  if (window !== top || localStorage.getItem('yt-client:settings')) return
  localStorage.setItem('yt-client:settings', JSON.stringify({ hideShorts: true }))
})

const openReadySettings = async (page: Page) => {
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })
}

const mountSurface = async (
  page: Page,
  surface: 'home' | 'search' | 'channel' | 'watch' | 'subscriptions' | 'history',
  mount: 'mountHome' | 'mountSearch' | 'mountChannel' | 'mountWatch' | 'mountSubscriptions' | 'mountHistory',
  readySelector: string,
) => {
  const container = page.locator(`[data-hide-shorts-harness="${surface}"]`)
  await expect(async () => {
    if (await container.count() === 0) {
      await page.evaluate(async ({ path, mount }) => {
        const harness = await import(path) as Record<string, () => void>
        harness[mount]!()
      }, { path: HARNESS, mount })
    }
    await expect(container.locator(readySelector).first()).toBeVisible({ timeout: 15_000 })
  }).toPass({ timeout: 120_000 })
  return container
}

const setHarnessHideShorts = async (page: Page, value: boolean) => {
  await page.evaluate(async ({ path, value }) => {
    const harness = await import(path) as { setHideShorts: (value: boolean) => void }
    harness.setHideShorts(value)
  }, { path: HARNESS, value })
}

test('Settings Hide Shorts toggle persists across reload and updates expanded and mini guides immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings')

  const checkbox = page.getByRole('checkbox', { name: 'Hide Shorts', exact: true })
  const guide = page.getByRole('navigation', { name: 'Guide' })

  await expect(checkbox).not.toBeChecked()
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toBeVisible()

  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toHaveCount(0)

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { hideShorts?: boolean })
  expect(saved.hideShorts).toBe(true)

  await page.reload()
  await expect(checkbox).toBeChecked()
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 1100, height: 900 })
  await expect(guide.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await expect(guide.getByRole('link', { name: 'Subscriptions', exact: true })).toBeVisible()
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toHaveCount(0)

  await checkbox.uncheck()
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(guide.getByRole('link', { name: 'Shorts', exact: true })).toBeVisible()
})

test('Hide Shorts redirects /shorts and channel Shorts tab routes cleanly', async ({ page }) => {
  await seedHideShorts(page)

  await page.goto('/shorts')
  await expect(page).toHaveURL('/')

  await page.goto('/shorts/y2Vqj-59Hqc?t=12')
  await expect(page).toHaveURL('/watch?v=y2Vqj-59Hqc&t=12')

  await page.goto('/@mkbhd/shorts')
  await expect(page).toHaveURL('/@mkbhd')

  await page.goto('/@mkbhd?tab=SHORTS')
  await expect(page).toHaveURL('/@mkbhd')
})

test('Hide Shorts removes Shorts from Home, Search, Channel, Watch, Subscriptions, and History and restores them when turned off', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: Error[] = []
  page.on('pageerror', error => errors.push(error))
  await page.addInitScript(holdPlayback)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openReadySettings(page)

  const home = await mountSurface(page, 'home', 'mountHome', 'a[href="/watch?v=home-video"]')
  await expect(home.getByText('Home Feed Short')).toBeVisible()
  await expect(home.getByText('Home Shelf Short')).toBeVisible()

  await setHarnessHideShorts(page, true)
  await expect(home.getByText('Home Regular Video')).toBeVisible()
  await expect(home.getByText('Home Feed Short')).toHaveCount(0)
  await expect(home.getByText('Home Shelf Short')).toHaveCount(0)
  await expect(home.locator('a[href^="/shorts/"]')).toHaveCount(0)

  await setHarnessHideShorts(page, false)
  await expect(home.getByText('Home Feed Short')).toBeVisible()
  await expect(home.getByText('Home Shelf Short')).toBeVisible()

  const search = await mountSurface(page, 'search', 'mountSearch', 'a[href="/watch?v=search-video"]')
  await expect(search.getByRole('button', { name: 'Shorts', exact: true })).toBeVisible()
  await expect(search.getByText('Search Feed Short')).toBeVisible()
  await expect(search.getByText('Search Shelf Short')).toBeVisible()
  await expect(search.getByText('Carousel Short')).toBeVisible()
  await expect(search.getByText('Card Short')).toBeVisible()

  await setHarnessHideShorts(page, true)
  await expect(search.getByRole('button', { name: 'Shorts', exact: true })).toHaveCount(0)
  await expect(search.getByText('Search Regular Video')).toBeVisible()
  await expect(search.getByText('Carousel Regular Video')).toBeVisible()
  await expect(search.getByText('Card Regular Video')).toBeVisible()
  await expect(search.getByText('Search Feed Short')).toHaveCount(0)
  await expect(search.getByText('Search Shelf Short')).toHaveCount(0)
  await expect(search.getByText('Carousel Short')).toHaveCount(0)
  await expect(search.getByText('Card Short')).toHaveCount(0)
  await expect(search.locator('a[href^="/shorts/"]')).toHaveCount(0)

  await search.getByRole('button', { name: 'Filters', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search filters' })
  await expect(dialog.locator('.filters > div').first().getByRole('button')).toHaveText(['Videos', 'Channels', 'Playlists', 'Movies'])
  await page.keyboard.press('Escape')

  await page.evaluate(async (path) => {
    const harness = await import(path) as { mountSearch: (search?: string) => void }
    harness.mountSearch('?search_query=test&type=SHORTS')
  }, HARNESS)
  await expect(search.getByText('Search Regular Video')).toBeVisible()
  await expect(search.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(search.getByText('Search Feed Short')).toHaveCount(0)

  await setHarnessHideShorts(page, false)
  await expect(search.getByRole('button', { name: 'Shorts', exact: true })).toBeVisible()
  await expect(search.getByText('Search Shelf Short')).toBeVisible()

  const channel = await mountSurface(page, 'channel', 'mountChannel', 'section[aria-label="Shorts"]')
  const tabs = channel.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Shorts', exact: true })).toBeVisible()
  await expect(channel.locator('section[aria-label="Shorts"]')).toBeVisible()

  await setHarnessHideShorts(page, true)
  await expect(tabs.getByRole('link', { name: 'Shorts', exact: true })).toHaveCount(0)
  await expect(tabs.getByRole('link', { name: 'Videos', exact: true })).toBeVisible()
  await expect(channel.locator('section[aria-label="Shorts"]')).toHaveCount(0)
  await expect(channel.locator('a[href^="/shorts/"]')).toHaveCount(0)

  const watch = await mountSurface(page, 'watch', 'mountWatch', 'a[href="/watch?v=watch-related-video"]')
  await expect(watch.getByText('Related Regular Video')).toBeVisible()
  await expect(watch.getByText('Related Short Video')).toHaveCount(0)

  await page.setViewportSize({ width: 900, height: 900 })
  await expect(watch.locator('.related-grid')).toBeVisible()
  await expect(watch.locator('.related-grid').getByText('Related Regular Video')).toBeVisible()
  await expect(watch.locator('.related-grid').getByText('Related Short Video')).toHaveCount(0)

  await setHarnessHideShorts(page, false)
  await expect(watch.locator('.related-grid').getByText('Related Short Video')).toBeVisible()
  await expect(watch.locator('.related-grid article', { hasText: 'Related Short Video' })).not.toHaveClass(/\bshort\b/)

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(watch.getByText('Related Short Video')).toBeVisible()

  const subs = await mountSurface(page, 'subscriptions', 'mountSubscriptions', 'a[href="/watch?v=sub-video"]')
  await expect(subs.getByText('Subscription Short')).toBeVisible()

  await setHarnessHideShorts(page, true)
  await expect(subs.getByText('Subscription Regular Video')).toBeVisible()
  await expect(subs.getByText('Subscription Short')).toHaveCount(0)

  const hist = await mountSurface(page, 'history', 'mountHistory', 'a[href="/watch?v=hist-video"]')
  await expect(hist.getByText('History Regular Video')).toBeVisible()
  await expect(hist.getByText('History Short', { exact: true })).toHaveCount(0)
  await expect(hist.getByText('Yesterday')).toHaveCount(0)

  await setHarnessHideShorts(page, false)
  await expect(hist.getByText('History Short', { exact: true })).toBeVisible()
  await expect(hist.getByText('Yesterday')).toBeVisible()

  expect(errors).toEqual([])
})
