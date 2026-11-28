import type { WatchHarnessOptions } from './fixtures/watch-harness'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'
const CRIMSON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e11d48"/></svg>'
const BLUE_THUMB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>')}`

const mountWatch = async (page: import('@playwright/test').Page, options: WatchHarnessOptions) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.route('https://i.ytimg.com/vi/*/hqdefault.jpg', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: CRIMSON_SVG,
    }))
  await hideFknNotice(page)
  await page.goto('/privacy')
  const host = page.locator('[data-watch-harness]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness(opts)
      }, [HARNESS, options] as const)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await expect(host.locator('.about')).toBeVisible({ timeout: 15_000 })
  return host
}

test('tints collapsed description and compact related card on hover and shows exact description details tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mountWatch(page, {
    videoId: 'watch-hover-1',
    viewCountText: '42,258 views',
    publishedDateText: 'Nov 26, 2026',
    relatedThumbnail: BLUE_THUMB,
  })

  const desc = host.locator('.about > div.collapsed')
  const meta = desc.locator('.meta')
  const countsWrap = desc.locator('.counts-wrap')
  const tooltip = desc.locator('.counts-tooltip')

  await expect(desc).toBeVisible()
  expect(Math.round((await meta.boundingBox())!.height)).toBe(20)
  await expect(tooltip).toHaveText('42,258 views • Nov 26, 2026')
  expect(await tooltip.evaluate(el => getComputedStyle(el).visibility)).toBe('hidden')

  await countsWrap.hover()
  await expect.poll(() => tooltip.evaluate(el => getComputedStyle(el).visibility)).toBe('visible')
  await expect.poll(() => desc.evaluate(el => el.style.getPropertyValue('--card-hover-bg'))).toMatch(/^rgba\(\d+, \d+, \d+,/)

  const relatedCard = host.locator('aside.secondary article').first()
  await expect(relatedCard).toBeVisible()
  await relatedCard.hover()
  await expect.poll(() => relatedCard.evaluate(el => el.style.getPropertyValue('--card-hover-bg'))).toMatch(/^rgba\(\d+, \d+, \d+,/)
  await expect.poll(() =>
    relatedCard.evaluate(el => getComputedStyle(el, '::before').backgroundColor),
  ).toMatch(/^rgba\(\d+, \d+, \d+,/)

  // Expanding removes collapsed hover tint and hover tooltip.
  await desc.getByRole('button', { name: '...more', exact: true }).click()
  await expect(host.locator('.about .counts-tooltip')).toHaveCount(0)
  await expect(host.locator('.about > div.collapsed')).toHaveCount(0)
})
