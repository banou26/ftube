import { expect, test } from './test'

test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
})

test('toggles Annotations in Player settings and /settings to show or hide cards and end screen elements', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/annotations-harness')
    harness.mountAnnotationsHarness()
  }, '/tests/browser/fixtures/annotations-harness.tsx')

  const harness = page.locator('[data-annotations-harness]')
  const showCards = harness.getByRole('button', { name: 'Show cards', exact: true })
  const endScreenTile = harness.getByRole('link', { name: 'Recommended end screen video, video', exact: true })
  const hideEndScreen = harness.getByRole('button', { name: 'Hide endscreen cards', exact: true })

  await expect(showCards).toBeVisible()
  await expect(endScreenTile).toBeVisible()
  await expect(hideEndScreen).toBeVisible()

  await harness.getByRole('button', { name: 'Settings', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Player settings' })
  const annotationsRow = menu.getByRole('menuitemcheckbox', { name: /^Annotations/ })
  await expect(annotationsRow).toHaveAttribute('aria-checked', 'true')
  await expect(annotationsRow).toHaveText('AnnotationsOn')

  await annotationsRow.click()
  await expect(annotationsRow).toHaveAttribute('aria-checked', 'false')
  await expect(annotationsRow).toHaveText('AnnotationsOff')
  await expect(showCards).toHaveCount(0)
  await expect(endScreenTile).toHaveCount(0)
  await expect(hideEndScreen).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').annotations)).toBe(false)

  await annotationsRow.click()
  await expect(annotationsRow).toHaveAttribute('aria-checked', 'true')
  await expect(annotationsRow).toHaveText('AnnotationsOn')
  await expect(showCards).toBeVisible()
  await expect(endScreenTile).toBeVisible()
  await expect(hideEndScreen).toBeVisible()

  // Leaving annotations off syncs with /settings
  await annotationsRow.click()
  await expect(showCards).toHaveCount(0)

  await page.goto('/settings')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Playback and performance', exact: true }).click()
  const settingsToggle = page.getByRole('checkbox', { name: 'Annotations', exact: true })
  await expect(settingsToggle).not.toBeChecked()
  await settingsToggle.check()
  await expect(settingsToggle).toBeChecked()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').annotations)).toBe(true)
  expect(pageErrors).toEqual([])
})
