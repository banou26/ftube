import { expect, test } from './test'

test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
})

test('moves miniplayer via drag and keyboard, clamps under header, stays above page rails, resizes from any corner, and persists across reload', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })

  await page.evaluate(async (path) => {
    const { openPlayer } = await import(path) as typeof import('../../src/player/session')
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Offline miniplayer move verification' })
  }, '/src/player/session.ts')

  const mini = page.getByRole('complementary', { name: 'Miniplayer', exact: true })
  await expect(mini).toBeVisible({ timeout: 30_000 })

  const boxOf = () => mini.evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
    return { left, top, right, bottom, width, height, zIndex: getComputedStyle(element).zIndex }
  })

  const initial = await boxOf()
  expect(Number(initial.zIndex)).toBeGreaterThanOrEqual(1500)
  expect(initial).toMatchObject({ width: 400, height: 301 })

  // Dragging .dock-meta to the top-left moves the box without navigating away to /watch and clamps below the 56px header.
  const meta = mini.locator('.dock-meta')
  const metaBox = (await meta.boundingBox())!
  const startX = metaBox.x + metaBox.width * 0.4
  const startY = metaBox.y + metaBox.height * 0.5
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 1000, startY - 1000, { steps: 6 })
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).left)).toBe(16)
  await expect.poll(async () => Math.round((await boxOf()).top)).toBe(72)
  expect(new URL(page.url()).pathname).toBe('/settings')

  const storedMoved = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerPosition)
  expect(storedMoved).toMatchObject({ x: 0, y: 0 })

  // Reloading restores the moved miniplayer position cleanly.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async (path) => {
    const { openPlayer } = await import(path) as typeof import('../../src/player/session')
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Offline miniplayer move verification' })
  }, '/src/player/session.ts')
  await expect(mini).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    const b = await boxOf()
    return { left: Math.round(b.left), top: Math.round(b.top) }
  }).toEqual({ left: 16, top: 72 })

  // While parked top-left, right and bottom-right handles resize outward keeping top-left anchored.
  const rightHandle = mini.locator('[data-resize="right"]')
  const rightBox = (await rightHandle.boundingBox())!
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightBox.x + rightBox.width / 2 + 80, rightBox.y + rightBox.height / 2)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(480)
  expect(Math.round((await boxOf()).left)).toBe(16)
  expect(Math.round((await boxOf()).top)).toBe(72)

  const brHandle = mini.locator('[data-resize="bottom-right"]')
  const brBox = (await brHandle.boundingBox())!
  await page.mouse.move(brBox.x + brBox.width / 2, brBox.y + brBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(brBox.x + brBox.width / 2 - 80, brBox.y + brBox.height / 2 - 45)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(400)
  expect(Math.round((await boxOf()).left)).toBe(16)
  expect(Math.round((await boxOf()).top)).toBe(72)

  await brHandle.boundingBox().then(async (box) => {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 45)
    await page.mouse.up()
  })

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(480)
  expect(Math.round((await boxOf()).left)).toBe(16)
  expect(Math.round((await boxOf()).top)).toBe(72)

  // Keyboard move handle nudges position with arrows and resets on Home.
  const moveHandle = mini.getByRole('button', { name: 'Move miniplayer', exact: true })
  await moveHandle.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await boxOf()).left)).toBe(80)
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => Math.round((await boxOf()).top)).toBe(96)
  await page.keyboard.press('Home')
  await expect.poll(async () => ({ left: Math.round((await boxOf()).left), bottom: Math.round((await boxOf()).bottom) })).toEqual({
    left: 1280 - 480 - 16,
    bottom: 800 - 16,
  })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerPosition)).toBeUndefined()

  // Move again via grip button and reset with double-click.
  const gripBox = (await moveHandle.boundingBox())!
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 - 200, gripBox.y + gripBox.height / 2 - 120, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await boxOf()).left)).toBeLessThan(1280 - 480 - 100)

  await moveHandle.dblclick()
  await expect.poll(async () => Math.round((await boxOf()).left)).toBe(1280 - 480 - 16)

  // Verify miniplayer sits above z-index 100 rails (such as Home's sticky chip bar) and can be dragged via video surface.
  const railOverlap = await page.evaluate(() => {
    const rail = document.createElement('div')
    rail.id = 'mock-sticky-rail'
    rail.style.cssText = 'position: fixed; inset: 56px 0 auto 0; height: 220px; z-index: 100; background: #111;'
    document.body.append(rail)
    return true
  })
  expect(railOverlap).toBe(true)

  const slotBox = (await mini.locator('.dock-slot').boundingBox())!
  await page.mouse.move(slotBox.x + slotBox.width * 0.25, slotBox.y + slotBox.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(slotBox.x + slotBox.width * 0.25 - 600, 120, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await boxOf()).top)).toBeLessThan(180)
  const hitOnTop = await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Miniplayer"]')!
    const rect = aside.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width * 0.5, rect.top + 30)
    return aside.contains(hit)
  })
  expect(hitOnTop).toBe(true)
  await page.evaluate(() => document.getElementById('mock-sticky-rail')?.remove())

  await mini.getByRole('separator', { name: 'Resize miniplayer', exact: true }).dblclick()
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(400)
  await mini.getByRole('button', { name: 'Move miniplayer', exact: true }).dblclick()
  await expect.poll(async () => Math.round((await boxOf()).left)).toBe(1280 - 400 - 16)

  // Clicking the title link without moving >= 5px still navigates normally to /watch.
  await mini.locator('.dock-title').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/watch')
  expect(pageErrors).toEqual([])
})
