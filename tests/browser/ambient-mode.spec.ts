import { expect, test } from './test'

const VIDEO = '/watch?v=dQw4w9WgXcQ'

test('ambient glow samples video frames, avoids horizontal overflow, and toggles in player settings and /settings', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto(VIDEO)

  const glow = page.locator('[data-ambient-glow]')
  await expect(glow).toBeAttached({ timeout: 30_000 })
  await expect(glow).toHaveAttribute('data-active', 'true')

  const video = page.locator('video')
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(1)

  await expect.poll(async () => {
    const canvas = glow.locator('canvas')
    return canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement
      const ctx = target.getContext('2d')
      if (!ctx) return 0
      const pixels = ctx.getImageData(0, 0, target.width, target.height).data
      let nonTransparent = 0
      for (let i = 3; i < pixels.length; i += 4) {
        if ((pixels[i] ?? 0) > 0) nonTransparent++
      }
      return nonTransparent
    })
  }, { timeout: 20_000, message: 'ambient canvas did not paint video pixels' }).toBeGreaterThan(0)

  const heading = page.locator('main h1')
  await expect(heading).toBeVisible()
  const headingHit = await heading.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + Math.min(20, box.width / 2), box.y + box.height / 2)
    return hit === element || element.contains(hit)
  })
  expect(headingHit).toBe(true)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)

  await page.locator('[data-player-root]').hover()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settingsMenu = page.getByRole('menu', { name: 'Player settings' })
  const ambientRow = settingsMenu.getByRole('menuitemcheckbox', { name: /^Ambient mode/ })
  await expect(ambientRow).toHaveAttribute('aria-checked', 'true')
  await expect(ambientRow).toHaveText('Ambient modeOn')

  await ambientRow.click()
  await expect(ambientRow).toHaveAttribute('aria-checked', 'false')
  await expect(ambientRow).toHaveText('Ambient modeOff')
  await expect(glow).toHaveAttribute('data-active', 'false')

  await page.goto('/settings')
  const settingsToggle = page.getByRole('checkbox', { name: 'Ambient mode', exact: true })
  await expect(settingsToggle).not.toBeChecked()
  await settingsToggle.check()
  await expect(settingsToggle).toBeChecked()
})
