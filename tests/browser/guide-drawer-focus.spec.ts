import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const openWatchForGuideFocus = async (page: Page, viewport: { width: number, height: number }) => {
  await page.setViewportSize(viewport)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/watch?v=guide-focus-test')

  const guideButton = page.locator('header').getByRole('button', { name: 'Guide', exact: true })
  await expect(guideButton).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.page a[href], .page button').first()).toBeVisible({ timeout: 30_000 })
  return guideButton
}

for (const { label, viewport } of [
  { label: 'desktop Watch', viewport: { width: 1280, height: 800 } },
  { label: 'mobile 412x915 Watch', viewport: { width: 412, height: 915 } },
]) {
  test(`moves focus inside modal Guide drawer, traps Tab/Shift+Tab, makes background inert, and restores focus on ${label}`, async ({ page }) => {
    const guideButton = await openWatchForGuideFocus(page, viewport)

    await guideButton.focus()
    await expect(guideButton).toBeFocused()
    await page.keyboard.press('Enter')

    const drawer = page.getByRole('dialog', { name: 'Guide', exact: true })
    await expect(drawer).toBeVisible()

    const closeButton = drawer.getByRole('button', { name: 'Close guide', exact: true })
    await expect(closeButton).toBeFocused()

    const backgroundBlocked = await page.evaluate(() => {
      const header = document.querySelector('header')
      const content = document.querySelector('.content') as HTMLElement | null
      return {
        headerInert: header?.inert ?? false,
        headerAriaHidden: header?.getAttribute('aria-hidden'),
        contentInert: content?.inert ?? false,
        contentAriaHidden: content?.getAttribute('aria-hidden'),
      }
    })
    expect(backgroundBlocked).toEqual({
      headerInert: true,
      headerAriaHidden: 'true',
      contentInert: true,
      contentAriaHidden: 'true',
    })

    // Shift+Tab from the first control wraps to the last visible focusable control inside the drawer.
    await page.keyboard.press('Shift+Tab')
    const wrappedLastState = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Guide"]')
      const closeBtn = dialog?.querySelector('[aria-label="Close guide"]')
      const active = document.activeElement
      return {
        inside: Boolean(dialog && active instanceof HTMLElement && dialog.contains(active)),
        movedOffClose: active !== closeBtn,
      }
    })
    expect(wrappedLastState).toEqual({ inside: true, movedOffClose: true })

    // Tab from the last control wraps back to the first control inside the drawer.
    await page.keyboard.press('Tab')
    await expect(closeButton).toBeFocused()

    // Forward Tab never reaches the background header or Watch page behind the modal drawer.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      const activeInsideDrawer = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Guide"]')
        return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement))
      })
      expect(activeInsideDrawer).toBe(true)
    }

    // Escape closes the drawer, restores background interactivity, and returns focus to header Guide button.
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(guideButton).toBeFocused()

    const backgroundRestored = await page.evaluate(() => {
      const header = document.querySelector('header')
      const content = document.querySelector('.content') as HTMLElement | null
      return {
        headerInert: header?.inert ?? false,
        headerAriaHidden: header?.getAttribute('aria-hidden'),
        contentInert: content?.inert ?? false,
        contentAriaHidden: content?.getAttribute('aria-hidden'),
      }
    })
    expect(backgroundRestored).toEqual({
      headerInert: false,
      headerAriaHidden: null,
      contentInert: false,
      contentAriaHidden: null,
    })

    // Reopening with Enter and closing via Close guide also returns focus to header Guide button.
    await page.keyboard.press('Enter')
    await expect(drawer).toBeVisible()
    await expect(closeButton).toBeFocused()
    await closeButton.press('Enter')
    await expect(drawer).toHaveCount(0)
    await expect(guideButton).toBeFocused()
  })
}
