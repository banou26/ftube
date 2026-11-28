import { expect, test } from './test'

/* youtube.com's Skip navigation, as measured on 2026-11-10: the Tab stop after the Guide button and the logo, off the
   page until focused, then a 40 px pill 12 px from the top and 6 px after the logo; Enter puts the focus on the page's
   first control, past the header and the guide */

test('Skip navigation shows on keyboard focus and moves the focus to the page\'s first control', async ({ page }) => {
  await page.goto('/settings')
  const main = page.getByRole('main')
  const nav = main.getByRole('navigation', { name: 'Settings' })
  const generalNav = nav.getByRole('link', { name: 'General', exact: true })
  await expect(generalNav).toBeVisible({ timeout: 30_000 })
  const skip = page.getByRole('button', { name: 'Skip navigation', exact: true })
  await expect(skip).not.toBeInViewport()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  const logo = page.getByRole('link', { name: 'FTube home', exact: true })
  await expect(logo).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  const [skipBox, logoBox] = [await skip.boundingBox(), await logo.boundingBox()]
  if (!skipBox || !logoBox) throw new Error('Skip navigation or the logo is not laid out')
  expect([skipBox.y, skipBox.height]).toEqual([12, 40])
  expect(skipBox.x - (logoBox.x + logoBox.width)).toBeCloseTo(6, 0)

  await page.keyboard.press('Enter')
  await expect(generalNav).toBeFocused()
  await expect(skip).not.toBeInViewport()
  await page.keyboard.press('Tab')
  await expect(nav.getByRole('link', { name: 'Notifications', exact: true })).toBeFocused()
})

test('Skip navigation puts the focus on the page when the page has no control', async ({ page }) => {
  await page.goto('/nope-page-xyz')
  const main = page.getByRole('main')
  await expect(main.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible({ timeout: 30_000 })
  await main.locator('.row').evaluate((row: HTMLElement) => { row.style.display = 'none' })
  const content = page.locator('.page')
  await expect(content).not.toHaveAttribute('tabindex')

  await page.getByRole('button', { name: 'Skip navigation', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(content).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(content).not.toBeFocused()
  await expect(content).not.toHaveAttribute('tabindex')
})

// a page that took focus on any click would send the next Tab back to its first control, and scroll there
test('Tab after a click in the page goes on from where the click landed', async ({ page }) => {
  await page.goto('/settings')
  const main = page.getByRole('main')
  await expect(main.getByRole('navigation', { name: 'Settings' })).toBeVisible({ timeout: 30_000 })
  await main.getByText('Hide Shorts', { exact: true }).click()
  await page.keyboard.press('Tab')
  await expect(main.getByRole('checkbox', { name: 'Hide Shorts', exact: true })).toBeFocused()
})
