import type { WatchHarnessOptions } from './fixtures/watch-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'
const DESCRIPTION_HARNESS = '/tests/browser/fixtures/description-harness.tsx'

const mountWatch = async (page: import('@playwright/test').Page, options: WatchHarnessOptions) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
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
  }).toPass({ timeout: 120_000 })
  await expect(host.locator('.about')).toBeVisible({ timeout: 15_000 })
  return host
}

test('hides Video details when collapsed and renders formatted rows above Show less when expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mountWatch(page, {
    publishedDateText: 'Nov 26, 2026',
    viewCountText: '99,962 views',
    likeCount: 3746,
    likeCountText: '3.7K',
  })

  const about = host.locator('.about')
  const details = about.getByRole('region', { name: 'Video details' })
  await expect(details).toHaveCount(0)

  await about.getByRole('button', { name: '...more', exact: true }).click()
  await expect(details).toBeVisible()

  const summary = await details.evaluate((section) => {
    const less = section.nextElementSibling
    const rows = [...section.querySelectorAll('.detail-row')].map((row) => {
      const label = row.querySelector('.detail-label')!.textContent!.trim()
      const valueEl = row.querySelector<HTMLElement>('.detail-value')!
      const style = getComputedStyle(valueEl)
      const rowRect = row.getBoundingClientRect()
      const valueRect = valueEl.getBoundingClientRect()
      return {
        label,
        value: valueEl.textContent!.trim(),
        weight: Number(style.fontWeight),
        variantNumeric: style.fontVariantNumeric,
        rightAligned: valueRect.right <= rowRect.right + 1 && valueRect.left > rowRect.left,
      }
    })
    return {
      heading: section.querySelector('h2')?.textContent?.trim(),
      nextSiblingClass: less?.className,
      nextSiblingText: less?.textContent?.trim(),
      rows,
    }
  })

  expect(summary.heading).toBe('Video details')
  expect(summary.nextSiblingClass).toBe('less')
  expect(summary.nextSiblingText).toBe('Show less')
  expect(summary.rows).toEqual([
    { label: 'Date', value: 'Nov 26, 2026', weight: 700, variantNumeric: 'tabular-nums', rightAligned: true },
    { label: 'Views', value: '99,962', weight: 700, variantNumeric: 'tabular-nums', rightAligned: true },
    { label: 'Likes', value: '3,746', weight: 700, variantNumeric: 'tabular-nums', rightAligned: true },
  ])

  await about.getByRole('button', { name: 'Show less', exact: true }).click()
  await expect(details).toHaveCount(0)
})

test('omits missing Likes row and shows Video details immediately inside open panel mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mountWatch(page, {
    publishedDateText: 'Nov 26, 2026',
    viewCountText: '99,962 views',
    likeCount: null,
    likeCountText: null,
  })

  const about = host.locator('.about')
  await about.getByRole('button', { name: '...more', exact: true }).click()
  const details = about.getByRole('region', { name: 'Video details' })
  await expect(details).toBeVisible()
  await expect(details.locator('.detail-row')).toHaveCount(2)
  await expect(details.locator('.detail-label')).toHaveText(['Date', 'Views'])
  await expect(details.locator('.detail-value')).toHaveText(['Nov 26, 2026', '99,962'])

  await page.evaluate(async ([path]) => {
    const mod = await import(path) as typeof import('./fixtures/description-harness')
    mod.mountPanelDescription(4, {
      publishedDateText: 'Nov 26, 2026',
      viewCountText: '99,962 views',
      likeCount: 3746,
      likeCountText: '3.7K',
    })
  }, [DESCRIPTION_HARNESS] as const)

  const panel = page.locator('[data-description-harness]').last()
  const panelDetails = panel.getByRole('region', { name: 'Video details' })
  await expect(panelDetails).toBeVisible()
  await expect(panelDetails.locator('.detail-value')).toHaveText(['Nov 26, 2026', '99,962', '3,746'])
})
