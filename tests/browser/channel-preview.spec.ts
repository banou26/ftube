import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/channel-preview-harness.tsx'

test('clamps long channel preview descriptions without bleeding into preview thumbnails', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')

  await page.evaluate(async (path) => {
    const harness = await import(path) as typeof import('./fixtures/channel-preview-harness')
    harness.mountChannelPreview()
  }, HARNESS)

  const card = page.locator('[data-channel-preview="UCpreview1"]')
  const description = card.locator('.description')
  const videos = card.locator('.videos')
  await expect(description).toBeVisible()
  await expect(videos).toBeVisible()

  const geometry = await card.evaluate((element) => {
    const desc = element.querySelector('.description')!
    const grid = element.querySelector('.videos')!
    const cs = getComputedStyle(desc)
    const lineHeight = Number.parseFloat(cs.lineHeight)
    const paddingBottom = Number.parseFloat(cs.paddingBottom)
    const descBox = desc.getBoundingClientRect()
    const gridBox = grid.getBoundingClientRect()
    return {
      paddingBottom,
      descHeight: descBox.height,
      maxTwoLineHeight: lineHeight * 2 + 1,
      descBottom: descBox.bottom,
      gridTop: gridBox.top,
    }
  })

  expect(geometry.paddingBottom).toBe(0)
  expect(geometry.descHeight).toBeLessThanOrEqual(geometry.maxTwoLineHeight)
  expect(geometry.gridTop - geometry.descBottom).toBeGreaterThanOrEqual(8)
})
