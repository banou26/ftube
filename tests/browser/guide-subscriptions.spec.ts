import type { Page } from '@playwright/test'
import type { GuideSubscriptionFixture } from './fixtures/guide-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/guide-harness.tsx'

const CHANNELS: GuideSubscriptionFixture[] = [
  { id: 'UC01', name: 'Plain Alpha' },
  { id: 'UC02', name: 'New Beta', hasNewContent: true },
  { id: 'UC03', name: 'Live Gamma', isLive: true },
  { id: 'UC04', name: 'Plain Delta' },
  { id: 'UC05', name: 'New Epsilon', hasNewContent: true },
  { id: 'UC06', name: 'Live Zeta', isLive: true },
  { id: 'UC07', name: 'Plain Eta' },
  { id: 'UC08', name: 'Plain Theta' },
  { id: 'UC09', name: 'Plain Iota' },
  { id: 'UC10', name: 'Plain Kappa' },
]

const mountSubscriptions = async (page: Page) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator('[data-guide-harness="subscriptions"]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, list]) => {
        const mod = await import(path) as typeof import('./fixtures/guide-harness')
        mod.mountGuideWithSubscriptions(list)
      }, [HARNESS, CHANNELS] as const)
    }
    await expect(host.getByRole('link', { name: /Live Gamma/ })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('caps subscriptions at 7, sorts live then new-content first, renders indicators, and toggles Show more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const host = await mountSubscriptions(page)

  const subsSection = host.locator('.section').filter({
    has: page.locator('a[href="/feed/subscriptions"]'),
  })
  const subsLinks = subsSection.locator('a[href^="/channel/"]')
  await expect(subsLinks).toHaveCount(7)

  const initialNames = await subsLinks.locator('.channel-name').allTextContents()
  expect(initialNames).toEqual([
    'Live Gamma',
    'Live Zeta',
    'New Beta',
    'New Epsilon',
    'Plain Alpha',
    'Plain Delta',
    'Plain Eta',
  ])

  const liveRow = host.locator('a[href="/channel/UC03"]')
  await expect(liveRow.locator('.sub-live-icon')).toBeVisible()
  await expect(liveRow.getByRole('img', { name: 'Live' })).toBeVisible()
  await expect(liveRow.locator('.sub-new-dot')).toHaveCount(0)

  const freshRow = host.locator('a[href="/channel/UC02"]')
  await expect(freshRow.locator('.sub-new-dot')).toBeVisible()
  await expect(freshRow.getByRole('img', { name: 'New content' })).toBeVisible()
  await expect(freshRow.locator('.sub-live-icon')).toHaveCount(0)

  const plainRow = host.locator('a[href="/channel/UC01"]')
  await expect(plainRow.locator('.sub-live-icon')).toHaveCount(0)
  await expect(plainRow.locator('.sub-new-dot')).toHaveCount(0)

  const toggle = subsSection.getByRole('button', { name: 'Show more' })
  await expect(toggle).toBeVisible()
  await toggle.click()

  await expect(subsLinks).toHaveCount(10)
  await expect(subsSection.getByRole('button', { name: 'Show fewer' })).toBeVisible()
  await subsSection.getByRole('button', { name: 'Show fewer' }).click()
  await expect(subsLinks).toHaveCount(7)
})

test('orders Home/Shorts, Subscriptions, collapsible Groups, and collapsible You items in signed-in guide', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')

  const host = page.locator('[data-guide-harness="subscriptions"]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, list]) => {
        localStorage.removeItem('yt-client:groups')
        const mod = await import(path) as typeof import('./fixtures/guide-harness')
        mod.mountGuideWithSubscriptions(list)
      }, [HARNESS, CHANNELS] as const)
    }
    await expect(host.getByRole('link', { name: 'You', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const sections = host.locator('.section')
  await expect(sections.nth(0).locator('a.item')).toHaveCount(2)
  await expect(sections.nth(0).locator('a.item .label')).toHaveText(['Home', 'Shorts'])
  await expect(sections.nth(1).locator('a.section-link')).toHaveAttribute('href', '/feed/subscriptions')
  await expect(host.getByRole('button', { name: 'Groups', exact: true })).toHaveCount(0)

  await page.evaluate(async ([path, list]) => {
    localStorage.setItem('yt-client:groups', JSON.stringify([
      { id: 'grp-a', name: 'Group A', emoji: '🎬', channels: [], updatedAt: Date.now() },
      { id: 'grp-a1', name: 'Inner A1', emoji: '🎵', parentId: 'grp-a', channels: [], updatedAt: Date.now() },
      { id: 'grp-b', name: 'Group B', emoji: '🎮', channels: [], updatedAt: Date.now() },
    ]))
    window.dispatchEvent(new StorageEvent('storage', { key: 'yt-client:groups' }))
    const mod = await import(path) as typeof import('./fixtures/guide-harness')
    mod.mountGuideWithSubscriptions(list)
  }, [HARNESS, CHANNELS] as const)

  await expect(sections.nth(2).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(sections.nth(2).getByRole('link', { name: /Group A/ })).toHaveCount(0)
  await sections.nth(2).getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(sections.nth(2).getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(sections.nth(2).getByRole('link', { name: /Group A/ })).toBeVisible()
  await expect(sections.nth(2).getByRole('link', { name: /Inner A1/ })).toBeVisible()
  await expect(sections.nth(2).getByRole('link', { name: /Group B/ })).toBeVisible()

  const youSection = sections.nth(3)
  await expect(youSection.locator('a.section-link')).toHaveAttribute('href', '/feed/you')
  await expect(youSection.locator('a.item .label')).toHaveText(['Groups', 'History', 'Watch later', 'Downloads'])
  for (const hidden of ['Your channel', 'Playlists', 'Liked videos', 'Your videos', 'Clips']) {
    await expect(youSection.getByRole('link', { name: hidden, exact: true })).toHaveCount(0)
  }

  const youMore = youSection.getByRole('button', { name: 'Show more', exact: true })
  await expect(youMore).toHaveAttribute('aria-expanded', 'false')
  await youMore.click()

  await expect(youSection.locator('a.item .label')).toHaveText([
    'Your channel',
    'Groups',
    'History',
    'Playlists',
    'Watch later',
    'Liked videos',
    'Your videos',
    'Downloads',
    'Clips',
  ])
  await expect(youSection.getByRole('link', { name: 'Your channel', exact: true })).toHaveAttribute('href', '/channel/@viewer')
  await expect(youSection.getByRole('link', { name: 'Groups', exact: true })).toHaveAttribute('href', '/feed/groups')
  await expect(youSection.getByRole('link', { name: 'Your videos', exact: true })).toHaveAttribute('href', '/channel/@viewer/videos')
  await expect(youSection.getByRole('link', { name: 'Clips', exact: true })).toHaveAttribute('href', '/feed/clips')

  const youLess = youSection.getByRole('button', { name: 'Show less', exact: true })
  await expect(youLess).toHaveAttribute('aria-expanded', 'true')
  await youLess.click()
  await expect(youSection.locator('a.item .label')).toHaveText(['Groups', 'History', 'Watch later', 'Downloads'])
})
