import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const NARROW_VIEWPORTS = [
  { label: '310x640 (320px minus 10px classic scrollbar)', width: 310, height: 640 },
  { label: '305x640 (320px minus 15px classic scrollbar)', width: 305, height: 640 },
  { label: '320x640', width: 320, height: 640 },
  { label: '390x844', width: 390, height: 844 },
  { label: '412x915', width: 412, height: 915 },
] as const

const expectNoDocumentOverflow = async (page: Page, context: string) => {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const root = document.documentElement
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }
    })
  }, { message: `expected scrollWidth === clientWidth on ${context}` }).toEqual({
    scrollWidth: await page.evaluate(() => document.documentElement.clientWidth),
    clientWidth: await page.evaluate(() => document.documentElement.clientWidth),
  })
}

const expectHeaderInsideClientWidth = async (page: Page) => {
  await expect(page.locator('header .end')).toBeVisible()
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  const bounds = await page.evaluate(() => {
    const header = document.querySelector('header')
    if (!header) return null
    const end = header.querySelector('.end')
    const search = header.querySelector('button.open-search')
    return {
      headerRight: header.getBoundingClientRect().right,
      searchRight: search?.getBoundingClientRect().right ?? 0,
      endLeft: end?.getBoundingClientRect().left ?? 0,
      endRight: end?.getBoundingClientRect().right ?? 0,
    }
  })
  expect(bounds).not.toBeNull()
  expect(bounds!.headerRight).toBeLessThanOrEqual(clientWidth + 0.5)
  expect(bounds!.endRight).toBeLessThanOrEqual(clientWidth + 0.5)
  expect(bounds!.searchRight).toBeLessThanOrEqual(bounds!.endLeft + 0.5)
}

const keepHeaderOverHarness = async (page: Page) => {
  await page.evaluate(() => {
    const app = document.getElementById('app')
    if (!app) return
    app.hidden = false
    const routePage = app.querySelector<HTMLElement>('.page')
    if (routePage) routePage.hidden = true
  })
}

for (const vp of NARROW_VIEWPORTS) {
  test(`Search, Watch, and Appearance fit without horizontal scroll at ${vp.label} (APP-1105)`, async ({ page }) => {
    await page.route('https://*.sdbx.app/**', route => route.abort())
    await page.route('https://www.youtube.com/**', route => route.abort())
    await hideFknNotice(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })

    // 1. Settings -> Customization (Appearance, Player, Emoji picker) with visible fixed header.
    await page.goto('/settings?section=customization')
    const settingsMain = page.getByRole('main')
    await expect(settingsMain.getByRole('navigation', { name: 'Settings' })).toBeVisible({ timeout: 30_000 })
    await expect(settingsMain.locator('#custom-appearance')).toBeVisible()
    await expectNoDocumentOverflow(page, `Settings Appearance at ${vp.label}`)
    await expectHeaderInsideClientWidth(page)

    // Settings side-nav still scrolls locally inside its own container.
    const sideNavMetrics = await settingsMain.locator('.side-nav').evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(sideNavMetrics.scrollWidth).toBeGreaterThan(sideNavMetrics.clientWidth)

    // Controls remain reachable across Appearance, Player, and Emoji picker sub-tabs.
    await expect(settingsMain.getByRole('button', { name: 'Dark', exact: true })).toBeVisible()
    await settingsMain.getByRole('tab', { name: 'Player', exact: true }).click()
    await expect(settingsMain.getByRole('region', { name: 'Left controls', exact: true }).or(settingsMain.locator('.side-title').first())).toBeVisible()
    await expectNoDocumentOverflow(page, `Settings Player at ${vp.label}`)
    await settingsMain.getByRole('tab', { name: 'Emoji picker', exact: true }).click()
    await expect(settingsMain.getByRole('group', { name: 'Default skin tone', exact: true })).toBeVisible()
    await expectNoDocumentOverflow(page, `Settings Emoji picker at ${vp.label}`)

    // 2. Search at narrow width with mixed results, filter chips, Filters dialog, and Shorts shelf.
    await page.goto('/privacy?search_query=NASA')
    await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const harness = '/tests/browser/fixtures/mobile-search-harness.tsx'
      const { mountMobileSearch } = await import(harness) as { mountMobileSearch: () => void }
      mountMobileSearch()
    })
    await keepHeaderOverHarness(page)
    const searchRoot = page.locator('[data-mobile-search-harness]')
    await expect(searchRoot.locator('article.result').first()).toBeVisible({ timeout: 30_000 })
    await expectNoDocumentOverflow(page, `Search at ${vp.label}`)
    await expectHeaderInsideClientWidth(page)

    const filterTrackMetrics = await searchRoot.locator('.filter-chips').evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(filterTrackMetrics.scrollWidth).toBeGreaterThan(filterTrackMetrics.clientWidth)

    const shortsTrackMetrics = await searchRoot.getByRole('region', { name: 'Shorts', exact: true }).locator('.track').first().evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(shortsTrackMetrics.scrollWidth).toBeGreaterThan(shortsTrackMetrics.clientWidth)

    const filtersBtn = searchRoot.getByRole('button', { name: 'Filters', exact: true })
    await filtersBtn.click()
    await expect(page.getByRole('dialog', { name: 'Search filters', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    // 3. Watch at narrow width with mobile actions and scrollable related chips rail.
    const mountWatch = async () => {
      await page.goto('/privacy')
      await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })
      await expect(async () => {
        if (await page.locator('[data-watch-harness]').count() === 0) {
          await page.evaluate(async () => {
            const harness = '/tests/browser/fixtures/watch-harness.tsx'
            const { mountWatchHarness } = await import(harness) as { mountWatchHarness: (opts: Record<string, unknown>) => void }
            mountWatchHarness({ withChips: true, longDescription: true, likeCountText: '1.2M' })
          })
        }
        await expect(page.locator('[data-watch-harness] h1.title')).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 20_000 })
    }
    await mountWatch()
    await keepHeaderOverHarness(page)
    await expectNoDocumentOverflow(page, `Watch at ${vp.label}`)
    await expectHeaderInsideClientWidth(page)

    const watchRoot = page.locator('[data-watch-harness]')
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    for (const btn of [
      watchRoot.getByRole('button', { name: 'Like', exact: true }),
      watchRoot.getByRole('button', { name: 'Share', exact: true }),
      watchRoot.getByRole('button', { name: 'More actions', exact: true }),
    ]) {
      const box = await btn.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x + box!.width).toBeLessThanOrEqual(clientWidth + 0.5)
    }

    const relatedTrackMetrics = await watchRoot.getByRole('region', { name: 'Related video filters', exact: true }).locator('.track').first().evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(relatedTrackMetrics.scrollWidth).toBeGreaterThan(relatedTrackMetrics.clientWidth)
  })
}
