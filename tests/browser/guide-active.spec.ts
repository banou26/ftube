import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/guide-harness.tsx'

const mountVariant = async (page: Page, variant: 'expanded' | 'mini', path: string) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/privacy')
  const host = page.locator(`[data-guide-harness="route-${variant}"]`)
  await expect(async () => {
    await page.evaluate(async ([harnessPath, guideVariant, routePath]) => {
      const mod = await import(harnessPath) as typeof import('./fixtures/guide-harness')
      mod.mountGuideRoute(guideVariant, routePath)
    }, [HARNESS, variant, path] as const)
    await expect(host.locator('a.item').first()).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  return host
}

const activeStateOf = async (link: ReturnType<Page['locator']>) => link.evaluate((el) => {
  const cs = getComputedStyle(el)
  const svg = el.querySelector('svg')
  return {
    ariaCurrent: el.getAttribute('aria-current'),
    activeClass: el.classList.contains('active'),
    backgroundColor: cs.backgroundColor,
    strokeWidth: svg?.getAttribute('stroke-width') ?? '',
    fontWeight: Number(getComputedStyle(el.querySelector('.label') ?? el).fontWeight),
  }
})

test('highlights active Home, Shorts, and Subscriptions icons visually in mini guide', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })

  const homeHost = await mountVariant(page, 'mini', '/')
  const homeState = await activeStateOf(homeHost.getByRole('link', { name: 'Home', exact: true }))
  const shortsOnHome = await activeStateOf(homeHost.getByRole('link', { name: 'Shorts', exact: true }))
  expect(homeState.ariaCurrent).toBe('page')
  expect(homeState.activeClass).toBe(true)
  expect(homeState.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(homeState.strokeWidth).toBe('2.25')
  expect(shortsOnHome.ariaCurrent).toBeNull()
  expect(shortsOnHome.activeClass).toBe(false)
  expect(shortsOnHome.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(shortsOnHome.strokeWidth).toBe('1.5')

  const shortsHost = await mountVariant(page, 'mini', '/shorts/dQw4w9WgXcQ')
  const shortsState = await activeStateOf(shortsHost.getByRole('link', { name: 'Shorts', exact: true }))
  const homeOnShorts = await activeStateOf(shortsHost.getByRole('link', { name: 'Home', exact: true }))
  expect(shortsState.ariaCurrent).toBe('page')
  expect(shortsState.activeClass).toBe(true)
  expect(shortsState.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(shortsState.strokeWidth).toBe('2.25')
  expect(homeOnShorts.ariaCurrent).toBeNull()
  expect(homeOnShorts.activeClass).toBe(false)
  expect(homeOnShorts.strokeWidth).toBe('1.5')

  const subsHost = await mountVariant(page, 'mini', '/feed/subscriptions')
  const subsState = await activeStateOf(subsHost.getByRole('link', { name: 'Subscriptions', exact: true }))
  expect(subsState.ariaCurrent).toBe('page')
  expect(subsState.activeClass).toBe(true)
  expect(subsState.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(subsState.strokeWidth).toBe('2.25')
})

test('marks Shorts active with thicker icon stroke in expanded guide', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const host = await mountVariant(page, 'expanded', '/shorts/abc12345678')
  const shortsState = await activeStateOf(host.getByRole('link', { name: 'Shorts', exact: true }))
  const homeState = await activeStateOf(host.getByRole('link', { name: 'Home', exact: true }))
  expect(shortsState.ariaCurrent).toBe('page')
  expect(shortsState.activeClass).toBe(true)
  expect(shortsState.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(shortsState.strokeWidth).toBe('2.25')
  expect(homeState.ariaCurrent).toBeNull()
  expect(homeState.strokeWidth).toBe('1.5')
})
