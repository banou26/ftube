import type { Page } from '@playwright/test'

import { expect, plainTest as test } from './test'

const VIDEO_ID = 'kJQP7kiw5Fk'

const video = (page: Page) => page.locator('[data-player-root] video')
const currentTime = (page: Page) => video(page).evaluate(element => (element as HTMLVideoElement).currentTime)

const playFrom = async (page: Page, seconds: number) => {
  await page.goto(`/watch?v=${VIDEO_ID}&t=${seconds}`)
  await expect.poll(() => currentTime(page), { timeout: 120_000, message: 'playback did not start' }).toBeGreaterThan(seconds)
}

const wake = async (page: Page) => {
  const surface = (await page.locator('[data-player-surface]').boundingBox())!
  await page.mouse.move(surface.x + 200, surface.y + 200)
  await page.mouse.move(surface.x + 240, surface.y + 220)
}

const showCards = (page: Page) => page.getByRole('button', { name: 'Show cards', exact: true })

test('toggles Annotations off and on in Player settings, persisting across reload and hiding both cards and end screen elements', async ({ page }) => {
  test.setTimeout(300_000)
  await playFrom(page, 271)

  const hide = page.getByRole('button', { name: 'Hide endscreen cards', exact: true })
  await expect(hide).toBeVisible({ timeout: 10_000 })
  await expect(async () => {
    await wake(page)
    await expect(showCards(page)).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 5_000 })

  // Pause before the end of the video so the end screen elements stay in range across toggling
  await video(page).evaluate(element => (element as HTMLVideoElement).pause())

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const annotations = page.getByRole('menu', { name: 'Player settings' }).getByRole('menuitemcheckbox', { name: /^Annotations/ })
  await expect(annotations).toHaveAttribute('aria-checked', 'true')
  await expect(annotations).toHaveText('AnnotationsOn')

  await annotations.click()
  await expect(annotations).toHaveAttribute('aria-checked', 'false')
  await expect(annotations).toHaveText('AnnotationsOff')
  await expect(showCards(page)).toHaveCount(0)
  await expect(hide).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').annotations)).toBe(false)

  await page.reload()
  await expect.poll(() => currentTime(page), { timeout: 120_000, message: 'playback did not start after reload' }).toBeGreaterThan(271.5)
  await video(page).evaluate(element => (element as HTMLVideoElement).pause())
  await wake(page)
  await expect(showCards(page)).toHaveCount(0)
  await expect(hide).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const reloadedToggle = page.getByRole('menu', { name: 'Player settings' }).getByRole('menuitemcheckbox', { name: /^Annotations/ })
  await expect(reloadedToggle).toHaveAttribute('aria-checked', 'false')
  await expect(reloadedToggle).toHaveText('AnnotationsOff')

  await reloadedToggle.click()
  await expect(reloadedToggle).toHaveAttribute('aria-checked', 'true')
  await expect(reloadedToggle).toHaveText('AnnotationsOn')
  await expect(hide).toBeVisible({ timeout: 5_000 })
  await wake(page)
  await expect(showCards(page)).toBeVisible({ timeout: 5_000 })
})
