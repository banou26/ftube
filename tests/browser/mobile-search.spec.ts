import type { Page } from '@playwright/test'

import { expect, test } from './test'

const mountMobileSearch = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/privacy?search_query=NASA')
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/mobile-search-harness.tsx'
    const { mountMobileSearch } = await import(harness) as { mountMobileSearch: () => void }
    mountMobileSearch()
  })
  const root = page.locator('[data-mobile-search-harness]')
  await expect(root.locator('article.result').first()).toBeVisible({ timeout: 60_000 })
  return root
}

const docHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const width of [320, 390, 412] as const) {
  test(`mobile search constrains layout at ${width}px while keeping filter and shelf horizontal scrolling`, async ({ page }) => {
    const root = await mountMobileSearch(page, width)

    expect(await docHorizontalOverflow(page), `document overflows horizontally at ${width}px`).toBe(0)

    // Expanding a ChapterStrip on a mobile row must also stay inside the viewport.
    const chapterToggle = root.locator('article.result').first().getByRole('button', { name: /chapters/i })
    await chapterToggle.scrollIntoViewIfNeeded()
    await chapterToggle.click()
    await expect(root.locator('.cards .track').first()).toBeVisible()
    expect(await docHorizontalOverflow(page), `expanded chapters caused horizontal overflow at ${width}px`).toBe(0)

    // The filter chip row scrolls horizontally so the last chip ("Live") stays reachable.
    const filterTrack = root.locator('.filter-chips')
    const filterMetrics = await filterTrack.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(filterMetrics.scrollWidth).toBeGreaterThan(filterMetrics.clientWidth)
    await filterTrack.evaluate((el) => {
      el.scrollTo({ left: el.scrollWidth, behavior: 'instant' })
    })
    const liveChip = filterTrack.getByRole('button', { name: 'Live', exact: true })
    const liveBox = (await liveChip.boundingBox())!
    expect(liveBox.x).toBeGreaterThanOrEqual(0)
    expect(liveBox.x + liveBox.width).toBeLessThanOrEqual(width + 1)

    // Horizontal shelves (carousel, Shorts shelf, SearchCard rail) scroll internally without widening the page.
    for (const regionName of ['People also search for', 'Shorts', 'DeepSpaceObservatoryContinuousChannelTitle']) {
      const region = root.getByRole('region', { name: regionName, exact: true })
      const track = region.locator('.track').first()
      await track.scrollIntoViewIfNeeded()
      const trackMetrics = await track.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      expect(trackMetrics.scrollWidth, `${regionName} should scroll horizontally at ${width}px`).toBeGreaterThan(trackMetrics.clientWidth)
      await track.evaluate((el) => {
        el.scrollTo({ left: el.scrollWidth, behavior: 'instant' })
      })
      const lastItem = track.locator('> *').last()
      const box = (await lastItem.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    }

    // Touch-clickable after scrolling to the last filter chip and last carousel card.
    const liveChipBox = (await liveChip.boundingBox())!
    expect(liveChipBox.width).toBeGreaterThan(20)
    await liveChip.click()
    await expect(page).toHaveURL(/features=LIVE/)

    expect(await docHorizontalOverflow(page)).toBe(0)
  })
}

test('preserves 360px carousel card width and 364px step at 412, 632 and 1280px', async ({ page }) => {
  for (const width of [412, 632, 1280] as const) {
    const root = await mountMobileSearch(page, width)
    const carousel = root.getByRole('region', { name: 'People also search for', exact: true })
    const cards = carousel.locator('article')
    const [first, second] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()])
    expect(first!.width).toBe(360)
    expect(second!.x - first!.x).toBe(364)
  }
})
