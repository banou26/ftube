import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/filmstrip-harness.tsx'

const openHarness = async (page: import('@playwright/test').Page) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')

  const root = page.locator('[data-filmstrip-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/filmstrip-harness')
        const state = harness.mountFilmstripHarness()
        ;(window as unknown as { __filmstripHarness?: typeof state }).__filmstripHarness = state
      }, HARNESS)
    }
    await expect(root.locator('.scrubber')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return root
}

const currentTime = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __filmstripHarness: { currentTime: () => number } }).__filmstripHarness.currentTime())

test('enters filmstrip mode on scrubber pull-up, scrubs finely, and commits seek on release', async ({ page }) => {
  const root = await openHarness(page)
  const scrubber = root.locator('.scrubber')
  const box = (await scrubber.boundingBox())!

  const startX = box.x + box.width * 0.25
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 44, { steps: 6 })

  const strip = root.locator('[data-filmstrip="true"]')
  await expect(strip).toBeVisible()
  await expect(root.locator('.bar')).toHaveCount(0)
  await expect(strip.locator('.filmstrip-playhead')).toBeVisible()
  await expect(root.locator('.filmstrip-time')).toBeVisible()
  await expect(root.getByRole('button', { name: 'Close fine scrubbing', exact: true })).toBeVisible()
  expect(await strip.locator('.filmstrip-tile').count()).toBeGreaterThan(3)

  const initialLabel = (await root.locator('.filmstrip-time').textContent())?.trim() ?? ''
  await page.mouse.move(startX + 180, startY - 44, { steps: 6 })
  await expect(root.locator('.filmstrip-time')).not.toHaveText(initialLabel)

  await page.mouse.up()
  await expect(strip).toHaveCount(0)
  await expect(root.locator('.bar')).toBeVisible()
  const sought = await currentTime(page)
  expect(sought).toBeGreaterThan(31)
  expect(sought).toBeLessThan(45)
})

test('cancels filmstrip fine scrubbing on Escape without seeking', async ({ page }) => {
  const root = await openHarness(page)
  const scrubber = root.locator('.scrubber')
  const box = (await scrubber.boundingBox())!

  const startX = box.x + box.width * 0.25
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 44, { steps: 6 })
  await page.mouse.move(startX + 180, startY - 44, { steps: 6 })
  await expect(root.locator('[data-filmstrip="true"]')).toBeVisible()

  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(root.locator('[data-filmstrip="true"]')).toHaveCount(0)
  expect(await currentTime(page)).toBe(30)
})

test('pins filmstrip after tap pull-up, closes without seeking on X, and seeks via strip drag or tile click', async ({ page }) => {
  const root = await openHarness(page)
  const scrubber = root.locator('.scrubber')
  const box = (await scrubber.boundingBox())!
  const startX = box.x + box.width * 0.25
  const startY = box.y + box.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 44, { steps: 6 })
  await page.mouse.up()

  const strip = root.locator('[data-filmstrip="true"]')
  await expect(strip).toBeVisible()
  await root.getByRole('button', { name: 'Close fine scrubbing', exact: true }).click()
  await expect(strip).toHaveCount(0)
  expect(await currentTime(page)).toBe(30)

  // Reopen pinned filmstrip, drag horizontally along the strip to scrub forward
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 44, { steps: 6 })
  await page.mouse.up()
  await expect(strip).toBeVisible()

  const stripBox = (await strip.boundingBox())!
  await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(stripBox.x + stripBox.width / 2 - 140, stripBox.y + stripBox.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect(strip).toHaveCount(0)
  expect(await currentTime(page)).toBeGreaterThan(31)

  // Reopen and click a specific frame tile to jump directly to its timestamp
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 44, { steps: 6 })
  await page.mouse.up()
  await expect(strip).toBeVisible()
  const rightTile = strip.locator('.filmstrip-tile').last()
  await rightTile.click()
  await expect(strip).toHaveCount(0)
  expect(await currentTime(page)).toBeGreaterThan(33)
})
