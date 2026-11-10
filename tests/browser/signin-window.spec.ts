import type { Page } from '@playwright/test'

import { expect, test } from './test'

// Google's form is read from the window's frame content: FKN's window page holds the site in frames of its own
const showsGoogleForm = async (page: Page) => {
  for (const frame of page.frames()) {
    const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (/Email or phone/.test(text)) return true
  }
  return false
}

const engineReady = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 90_000 }).toBe('ready')

// Google throttles sign-ins, so this is the run's one visit to its form, and nothing is ever typed there
test("Sign in opens FKN's window, which reaches Google's form from youtube.com's own link", async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await engineReady(page)
  const opened = page.context().waitForEvent('page')
  await page.locator('header button.sign-in').click()
  const popup = await opened
  // FKN's card, drawn in the window, asks for the Evaluation grant the sign-in and the session page need
  await popup.getByRole('button', { name: /^Allow/ }).first().click({ timeout: 60_000 })
  await expect.poll(() => showsGoogleForm(popup), { timeout: 120_000 }).toBe(true)
  expect(new URL(page.url()).pathname).toBe('/')

  // the engine is untouched by the window: a search still answers
  await page.locator('header input').fill('blender')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.locator('a[href^="/watch"]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(5)

  // a window closed before Google finished is no sign-in: the page stays as it was, signed out
  await popup.close()
  await page.waitForTimeout(3_000)
  expect(new URL(page.url()).pathname).toBe('/results')
  expect(await page.evaluate(() => localStorage.getItem('yt-client:signed-in'))).toBeNull()
  await expect(page.locator('header button.sign-in')).toBeVisible()
})

test('says how to get past a blocked window, and tries again from the toast', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await engineReady(page)
  await page.evaluate(() => {
    const opens = { count: 0 }
    ;(window as unknown as { opens: typeof opens }).opens = opens
    window.open = () => {
      opens.count++
      return null
    }
  })
  await page.locator('header button.sign-in').click()
  const toast = page.locator('.toast', { hasText: 'Allow pop-ups' })
  await expect(toast).toBeVisible({ timeout: 15_000 })
  await toast.getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { opens: { count: number } }).opens.count)).toBe(2)
})
