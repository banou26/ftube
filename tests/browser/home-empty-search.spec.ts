import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/home-harness.tsx'

const openHomeHarness = async (page: Page, populated: boolean) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/privacy')
  const root = page.locator(`[data-home-app-harness="${populated ? 'populated' : 'empty'}"]`)
  await expect(async () => {
    await page.evaluate(async ([harnessPath, isPopulated]) => {
      const mod = await import(harnessPath) as typeof import('./fixtures/home-harness')
      mod.mountHomeApp(isPopulated)
    }, [HARNESS, populated] as const)
    await expect(root).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  return root
}

test('empty guest Home hides display controls and Search videos focuses search for immediate typing by keyboard across desktop and phone', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      const root = await openHomeHarness(page, false)

      await expect(root.getByRole('heading', { name: 'Try searching to get started', exact: true })).toBeVisible()
      await expect(root.getByRole('group', { name: 'Feed view controls' })).toHaveCount(0)

      const searchAction = root.getByRole('button', { name: 'Search videos', exact: true })
      await expect(searchAction).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `empty Home overflows at ${viewport.width}px (${scheme})`).toBe(0)

      await searchAction.focus()
      await expect(searchAction).toBeFocused()
      const activationKey = scheme === 'dark' ? 'Enter' : 'Space'
      await page.keyboard.press(activationKey)

      const searchInput = root.locator('header form[role="search"] input[name="search_query"]')
      await expect(searchInput).toBeVisible()
      await expect(searchInput).toBeFocused()
      await expect(searchInput).toHaveValue('')
      if (viewport.width <= 656) {
        await expect(root.locator('header')).toHaveClass(/search-open/)
      }

      const query = `fkn-${scheme}-${viewport.width}`
      await page.keyboard.type(query)
      await page.keyboard.press('Enter')

      await expect(root.locator(`[data-home-search-result="${query}"]`)).toBeVisible()
    }
  }

  expect(errors).toEqual([])
})

test('touch/click activation of Search videos focuses search cleanly on phone and desktop while populated feeds retain display controls', async ({ browser }) => {
  test.setTimeout(120_000)
  const errors: string[] = []

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  })
  try {
    const phonePage = await touchContext.newPage()
    phonePage.on('pageerror', error => errors.push(error.message))
    const phoneRoot = await openHomeHarness(phonePage, false)
    const phoneAction = phoneRoot.getByRole('button', { name: 'Search videos', exact: true })
    await phoneAction.tap()

    const phoneInput = phoneRoot.locator('header form[role="search"] input[name="search_query"]')
    await expect(phoneRoot.locator('header')).toHaveClass(/search-open/)
    await expect(phoneInput).toBeVisible()
    await expect(phoneInput).toBeFocused()

    await phoneRoot.getByRole('button', { name: 'Back', exact: true }).tap()
    await expect(phoneRoot.locator('header')).not.toHaveClass(/search-open/)

    await phoneAction.tap()
    await expect(phoneInput).toBeFocused()
    await phonePage.keyboard.type('touch query')
    await phonePage.keyboard.press('Enter')
    await expect(phoneRoot.locator('[data-home-search-result="touch query"]')).toBeVisible()
  } finally {
    await touchContext.close()
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const desktopPage = await desktopContext.newPage()
    desktopPage.on('pageerror', error => errors.push(error.message))

    const emptyDesktop = await openHomeHarness(desktopPage, false)
    await emptyDesktop.getByRole('button', { name: 'Search videos', exact: true }).click()
    const desktopInput = emptyDesktop.locator('header form[role="search"] input[name="search_query"]')
    await expect(desktopInput).toBeFocused()
    await desktopPage.keyboard.type('desktop query')
    await desktopPage.keyboard.press('Enter')
    await expect(emptyDesktop.locator('[data-home-search-result="desktop query"]')).toBeVisible()

    const populatedDesktop = await openHomeHarness(desktopPage, true)
    await expect(populatedDesktop.getByRole('group', { name: 'Feed view controls' })).toBeVisible()
    await expect(populatedDesktop.getByRole('button', { name: 'Grid view', exact: true })).toBeVisible()
    await expect(populatedDesktop.getByRole('button', { name: 'List view', exact: true })).toBeVisible()
    await expect(populatedDesktop.getByRole('button', { name: 'Feed display settings', exact: true })).toBeVisible()
    await expect(populatedDesktop.getByRole('button', { name: 'All', exact: true })).toBeVisible()
    await expect(populatedDesktop.getByRole('button', { name: 'Music', exact: true })).toBeVisible()
  } finally {
    await desktopContext.close()
  }

  expect(errors).toEqual([])
})
