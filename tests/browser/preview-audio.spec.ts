import type { Locator, Page } from '@playwright/test'

import { installMockPlayback } from './mock-playback'
import { expect, hideFknNotice, test } from './test'

const leaveCard = async (page: Page, card: Locator) => {
  const box = (await card.boundingBox())!
  await page.mouse.move(Math.max(4, box.x - 40), Math.max(4, box.y - 20), { steps: 5 })
}

const videoState = async (page: Page) => page.evaluate(() => {
  const dockVideo = document.querySelector('aside[aria-label="Miniplayer"] video') as HTMLVideoElement | null
  const watchVideo = document.querySelector('main [data-player-root] video') as HTMLVideoElement | null
  const previewVideos = [...document.querySelectorAll('article.result video')] as HTMLVideoElement[]
  const allVideos = [...document.querySelectorAll('video')]
  const audibleCount = allVideos.filter(v => !v.paused && !v.ended && !v.muted && v.volume > 0).length
  const serialize = (v: HTMLVideoElement | null) =>
    v ? { paused: v.paused, muted: v.muted, volume: v.volume, audible: !v.paused && !v.ended && !v.muted && v.volume > 0 } : null
  return {
    dock: serialize(dockVideo),
    watch: serialize(watchVideo),
    previews: previewVideos.map(serialize),
    audibleCount,
  }
})

const startDockedFromSearch = async (page: Page) => {
  await hideFknNotice(page)
  await installMockPlayback(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/results?search_query=mock')

  const firstRow = page.locator('article.result').nth(0)
  const secondRow = page.locator('article.result').nth(1)
  const thirdRow = page.locator('article.result').nth(2)
  await expect(firstRow.getByRole('link', { name: 'First Search Video', exact: true })).toBeVisible({ timeout: 30_000 })

  // Search -> Watch
  await firstRow.getByRole('link', { name: 'First Search Video', exact: true }).click()
  await expect(page).toHaveURL(/\/watch\?v=dockvid0001/)
  await expect.poll(async () => (await videoState(page)).watch?.audible).toBe(true)

  // Press I to dock onto Search
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/results\?search_query=mock/)
  const dock = page.getByRole('complementary', { name: 'Miniplayer' })
  await expect(dock).toBeVisible()
  await expect.poll(async () => (await videoState(page)).dock?.audible).toBe(true)

  return { dock, secondRow, thirdRow }
}

test('unmuting a card preview pauses audible dock and restores it only if it was audible', async ({ page }) => {
  const { dock, secondRow, thirdRow } = await startDockedFromSearch(page)

  // Hover second card -> Unmute preview: docked player must stop being audible while preview plays unmuted.
  await secondRow.locator('.thumb').hover()
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await secondRow.getByRole('button', { name: 'Unmute preview' }).click()

  await expect.poll(async () => await videoState(page)).toMatchObject({
    dock: { paused: true, audible: false },
    audibleCount: 1,
  })
  expect((await videoState(page)).previews[0]?.audible).toBe(true)

  // Leaving card restores the docked player.
  await leaveCard(page, secondRow)
  await expect(secondRow.locator('video')).toHaveCount(0)
  await expect.poll(async () => await videoState(page)).toMatchObject({
    dock: { paused: false, audible: true },
    audibleCount: 1,
  })

  // Switching directly from one card preview to another never lets dock resume between or overlap.
  await secondRow.locator('.thumb').hover()
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await videoState(page)).dock?.paused).toBe(true)
  expect((await videoState(page)).audibleCount).toBeLessThanOrEqual(1)

  await page.evaluate(() => {
    const win = window as unknown as { __dockPlayCount?: number }
    win.__dockPlayCount = 0
    const dockVideo = document.querySelector('aside[aria-label="Miniplayer"] video') as HTMLVideoElement | null
    dockVideo?.addEventListener('play', () => {
      win.__dockPlayCount = (win.__dockPlayCount ?? 0) + 1
    })
  })

  await thirdRow.locator('.thumb').hover()
  await expect(thirdRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await videoState(page)).previews[0]?.audible).toBe(true)
  expect((await videoState(page)).audibleCount).toBe(1)
  expect((await videoState(page)).dock?.paused).toBe(true)
  expect(await page.evaluate(() => (window as unknown as { __dockPlayCount?: number }).__dockPlayCount)).toBe(0)

  await leaveCard(page, thirdRow)
  await expect(thirdRow.locator('video')).toHaveCount(0)
  await expect.poll(async () => await videoState(page)).toMatchObject({
    dock: { paused: false, audible: true },
    audibleCount: 1,
  })
  expect(await page.evaluate(() => (window as unknown as { __dockPlayCount?: number }).__dockPlayCount)).toBe(1)

  // If the user explicitly paused the docked player, unmuting and leaving a preview keeps dock paused.
  await dock.locator('video').hover({ position: { x: 80, y: 50 } })
  await dock.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => (await videoState(page)).dock?.paused).toBe(true)

  await secondRow.locator('.thumb').hover()
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await videoState(page)).audibleCount).toBe(1)

  await leaveCard(page, secondRow)
  await expect(secondRow.locator('video')).toHaveCount(0)
  await page.waitForTimeout(100)
  expect((await videoState(page)).dock?.paused).toBe(true)
  expect((await videoState(page)).audibleCount).toBe(0)
})

test('returning to Watch, playing docked player, or closing miniplayer respects audio ownership', async ({ page }) => {
  const { dock, secondRow } = await startDockedFromSearch(page)

  // Pause dock first, unmute preview, then return to Watch: Watch must stay paused and preview mutes/unmounts.
  await dock.locator('video').hover({ position: { x: 80, y: 50 } })
  await dock.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => (await videoState(page)).dock?.paused).toBe(true)

  await secondRow.locator('.thumb').hover()
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await secondRow.getByRole('button', { name: 'Unmute preview' }).click()
  await expect.poll(async () => (await videoState(page)).previews[0]?.audible).toBe(true)

  await dock.getByRole('button', { name: 'Expand', exact: true }).click({ force: true })
  await expect(page).toHaveURL(/\/watch\?v=dockvid0001/)
  await page.waitForTimeout(100)
  const afterExpandPaused = await videoState(page)
  expect(afterExpandPaused.watch?.paused).toBe(true)
  expect(afterExpandPaused.audibleCount).toBe(0)

  // Now unpause on Watch, dock again, hover secondRow (preferMuted=false auto-unmutes and pauses dock),
  // then press k while preview stays mounted to resume dock and force-mute the preview.
  await page.locator('main [data-player-root] .bar button[aria-label="Play"]').click({ force: true })
  await expect.poll(async () => (await videoState(page)).watch?.audible).toBe(true)
  await page.keyboard.press('i')
  await expect(dock).toBeVisible()
  await expect.poll(async () => (await videoState(page)).dock?.audible).toBe(true)

  await secondRow.locator('.thumb').hover()
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => await videoState(page)).toMatchObject({
    dock: { paused: true, audible: false },
    audibleCount: 1,
  })
  expect((await videoState(page)).previews[0]?.audible).toBe(true)

  await page.keyboard.press('k')
  await expect.poll(async () => await videoState(page)).toMatchObject({
    dock: { paused: false, audible: true },
    audibleCount: 1,
  })
  expect((await videoState(page)).previews[0]?.muted).toBe(true)
  await expect(secondRow.getByRole('button', { name: 'Unmute preview' })).toBeVisible()

  // Unmute preview again, then close miniplayer: leaving the card must not throw or leave dock playing.
  await secondRow.getByRole('button', { name: 'Unmute preview' }).click()
  await expect.poll(async () => (await videoState(page)).dock?.paused).toBe(true)
  expect((await videoState(page)).previews[0]?.audible).toBe(true)

  await dock.locator('video').hover({ position: { x: 80, y: 50 } })
  await dock.getByRole('button', { name: 'Close miniplayer', exact: true }).click()
  await expect(dock).toHaveCount(0)
  await leaveCard(page, secondRow)
  await expect.poll(async () => (await videoState(page)).audibleCount).toBe(0)
})
