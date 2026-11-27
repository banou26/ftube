import type { Page } from '@playwright/test'

import { expect, test } from './test'

const VIDEO = '/watch?v=dQw4w9WgXcQ'

type RgbPixel = { r: number, g: number, b: number, a: number }

const sampleScreenshotPixels = async (
  page: Page,
  points: readonly { x: number, y: number }[],
): Promise<RgbPixel[]> => {
  const png = await page.screenshot()
  const url = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async ({ imageUrl, coords }) => {
    const img = new Image()
    img.src = imageUrl
    await img.decode()
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return coords.map(({ x, y }) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * dpr)))
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * dpr)))
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(px, py, 1, 1).data
      return { r, g, b, a }
    })
  }, { imageUrl: url, coords: points })
}

const maxChannel = (pixel: RgbPixel) => Math.max(pixel.r, pixel.g, pixel.b)

test('ambient glow fills video bars in theater mode, glows outside the frame, avoids overflow, and toggles in settings', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(VIDEO)

  const glow = page.locator('[data-ambient-glow]')
  const bars = page.locator('[data-ambient-bars]')
  await expect(glow).toBeAttached({ timeout: 30_000 })
  await expect(glow).toHaveAttribute('data-active', 'true')
  await expect(bars).toBeAttached({ timeout: 30_000 })

  const video = page.locator('video')
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(2)

  await expect(bars).toHaveAttribute('data-active', 'true')
  // Wait a beat for the ambient crossfade to settle on live video colors.
  await page.waitForTimeout(450)

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

  // Outer watch-stage halo tints the dark watch background below the default player frame.
  const playerBox = (await page.locator('[data-player-root]').boundingBox())!
  const [belowDefault] = await sampleScreenshotPixels(page, [
    { x: Math.round(playerBox.x + playerBox.width * 0.85), y: Math.round(playerBox.y + playerBox.height + 6) },
  ])
  expect(
    Math.max(Math.abs(belowDefault!.r - 15), Math.abs(belowDefault!.g - 15), Math.abs(belowDefault!.b - 15)),
    `expected outer halo above background rgb(15,15,15), got ${JSON.stringify(belowDefault)}`,
  ).toBeGreaterThan(3)

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

  // In theater mode on a wide viewport, left and right bars next to the video display a blurred video-colored gradient.
  await page.setViewportSize({ width: 1600, height: 800 })
  await page.keyboard.press('t')
  await expect(page.locator('main')).toHaveClass(/\btheater\b/)
  await page.waitForTimeout(350)

  const theaterBox = (await page.locator('[data-player-root]').boundingBox())!
  const midY = Math.round(theaterBox.y + theaterBox.height * 0.5)
  const leftBarPoint = { x: Math.round(theaterBox.x + 24), y: midY }
  const rightBarPoint = { x: Math.round(theaterBox.x + theaterBox.width - 24), y: midY }
  await expect.poll(async () => {
    const [leftBar, rightBar] = await sampleScreenshotPixels(page, [leftBarPoint, rightBarPoint])
    return Math.min(maxChannel(leftBar!), maxChannel(rightBar!))
  }, { timeout: 10_000, message: 'left and right bars remained black instead of ambient gradient' }).toBeGreaterThan(15)

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
  await expect(bars).toHaveAttribute('data-active', 'false')

  await expect.poll(async () => {
    const [leftBar, rightBar] = await sampleScreenshotPixels(page, [leftBarPoint, rightBarPoint])
    return Math.max(maxChannel(leftBar!), maxChannel(rightBar!))
  }, { timeout: 10_000, message: 'bars did not return to black after disabling ambient mode' }).toBeLessThanOrEqual(4)

  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  const settingsToggle = page.getByRole('checkbox', { name: 'Ambient mode', exact: true })
  await expect(settingsToggle).not.toBeChecked()
  await settingsToggle.check()
  await expect(settingsToggle).toBeChecked()
})
