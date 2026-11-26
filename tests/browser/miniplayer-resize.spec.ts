import { expect, test } from './test'

test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
})

test('resizes the real docked miniplayer across handles, clamps to viewport, persists width, and supports keyboard/double-click reset', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })

  await page.evaluate(async (path) => {
    const { openPlayer } = await import(path) as typeof import('../../src/player/session')
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Offline miniplayer resize verification' })
  }, '/src/player/session.ts')

  const mini = page.getByRole('complementary', { name: 'Miniplayer', exact: true })
  await expect(mini).toBeVisible({ timeout: 30_000 })

  const boxOf = () => mini.evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
    return { left, top, right, bottom, width, height }
  })

  const initial = await boxOf()
  expect(initial).toMatchObject({ width: 400, height: 301 })

  // Drag left handle left by 160 px -> width grows from 400 to 560, maintaining right/bottom anchor and 16:9 slot height
  const leftHandle = mini.locator('[data-resize="left"]')
  const leftBox = (await leftHandle.boundingBox())!
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(leftBox.x + leftBox.width / 2 - 160, leftBox.y + leftBox.height / 2)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(560)
  const widened = await boxOf()
  expect(Math.round(widened.height)).toBe(391)
  expect(Math.round(widened.right)).toBe(Math.round(initial.right))
  expect(Math.round(widened.bottom)).toBe(Math.round(initial.bottom))
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerWidth)).toBe(560)

  // Drag top handle up by 90 px -> width grows by 160 px (720)
  const topHandle = mini.locator('[data-resize="top"]')
  const topBox = (await topHandle.boundingBox())!
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2 - 90)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(720)
  expect(Math.round((await boxOf()).height)).toBe(481)

  // Drag top-left corner down-right by (160, 90) -> width shrinks by 160 px (back to 560)
  const cornerHandle = mini.getByRole('separator', { name: 'Resize miniplayer', exact: true })
  const cornerBox = (await cornerHandle.boundingBox())!
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cornerBox.x + cornerBox.width / 2 + 160, cornerBox.y + cornerBox.height / 2 + 90)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(560)

  // Narrow viewport clamps visual width without erasing stored preference; widening restores 560
  await page.setViewportSize({ width: 500, height: 700 })
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(468)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerWidth)).toBe(560)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(560)

  // Keyboard resize steps and Home reset
  await cornerHandle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(600)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(520)
  await page.keyboard.press('Home')
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(400)

  // Re-measure moved handle, drag 80 px wider (480), reload to confirm persistence, then double-click top-left to reset
  const movedLeftBox = (await leftHandle.boundingBox())!
  await page.mouse.move(movedLeftBox.x + movedLeftBox.width / 2, movedLeftBox.y + movedLeftBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(movedLeftBox.x + movedLeftBox.width / 2 - 80, movedLeftBox.y + movedLeftBox.height / 2)
  await page.mouse.up()
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(480)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerWidth)).toBe(480)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async (path) => {
    const { openPlayer } = await import(path) as typeof import('../../src/player/session')
    openPlayer({ videoId: 'dQw4w9WgXcQ', title: 'Offline miniplayer resize verification' })
  }, '/src/player/session.ts')
  await expect(mini).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(480)

  await mini.getByRole('separator', { name: 'Resize miniplayer', exact: true }).dblclick()
  await expect.poll(async () => Math.round((await boxOf()).width)).toBe(400)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') || '{}').miniplayerWidth)).toBeUndefined()

  // Pointercancel clears resizing state without committing a partial drag
  await mini.locator('[data-resize="left"]').dispatchEvent('pointerdown', { pointerId: 7, button: 0, clientX: 868, clientY: 600 })
  await expect(mini).toHaveClass(/resizing/)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 })))
  await expect(mini).not.toHaveClass(/resizing/)

  await mini.getByRole('button', { name: 'Close miniplayer', exact: true }).click()
  await expect(mini).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
