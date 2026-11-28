import { installMockPlayback } from './mock-playback'
import { expect, hideFknNotice, test } from './test'

test('keeps player quality and speed changes scoped to the current tab while Settings edits stay persistent (APP-1113)', async ({ page, context }) => {
  await hideFknNotice(page)
  await installMockPlayback(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  // 1. Change speed and quality inside Watch player
  await page.goto('/watch?v=dockvid0001')
  const video = page.locator('main [data-player-root] video')
  await expect(video).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0)

  const settingsBtn = page.locator('main [data-player-root]').getByRole('button', { name: 'Settings', exact: true })
  await settingsBtn.click()
  await page.getByRole('menuitem', { name: /Playback speed/ }).click()
  await page.getByRole('menu', { name: 'Playback speed', exact: true }).getByRole('button', { name: '1.5', exact: true }).click()
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).playbackRate)).toBe(1.5)
  await page.keyboard.press('Escape')

  await settingsBtn.click()
  await page.getByRole('menuitem', { name: /Quality/ }).click()
  await page.getByRole('menu', { name: 'Quality', exact: true }).getByRole('menuitem', { name: '720p', exact: true }).click()

  const storageAfterPlayer = await page.evaluate(() => ({
    tabPlayback: JSON.parse(sessionStorage.getItem('yt-client:tab-playback') ?? '{}') as { quality?: unknown, playbackRate?: number },
    persistent: JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { quality?: unknown, playbackRate?: number },
  }))
  expect(storageAfterPlayer.tabPlayback).toEqual({ quality: 720, playbackRate: 1.5 })
  expect(storageAfterPlayer.persistent.quality).not.toBe(720)
  expect(storageAfterPlayer.persistent.playbackRate).not.toBe(1.5)

  // 2. Navigate to another video in the SAME tab -> preserves 1.5x and 720p
  await page.goto('/watch?v=prevvid0002')
  await expect(video).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).playbackRate)).toBe(1.5)
  await settingsBtn.click()
  await expect(page.getByRole('menuitem', { name: /Quality/ })).toContainText('720p')
  await expect(page.getByRole('menuitem', { name: /Quality/ })).not.toContainText('Auto')
  await expect(page.getByRole('menuitem', { name: /Playback speed/ })).toContainText('1.5')
  await page.keyboard.press('Escape')

  // 3. Open a brand-new tab -> starts with persistent defaults (1x, Auto)
  const secondTab = await context.newPage()
  try {
    await hideFknNotice(secondTab)
    await installMockPlayback(secondTab)
    await secondTab.setViewportSize({ width: 1280, height: 900 })
    await secondTab.goto('/watch?v=prevvid0003')
    const secondVideo = secondTab.locator('main [data-player-root] video')
    await expect(secondVideo).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => secondVideo.evaluate(v => (v as HTMLVideoElement).playbackRate)).toBe(1)
    const secondSettingsBtn = secondTab.locator('main [data-player-root]').getByRole('button', { name: 'Settings', exact: true })
    await secondSettingsBtn.click()
    await expect(secondTab.getByRole('menuitem', { name: /Quality/ })).toContainText('Auto')
    await secondTab.keyboard.press('Escape')

    // 4. Changing Quality / Speed on /settings?section=playback persists to localStorage and overrides current tab
    await page.goto('/settings?section=playback')
    await page.getByRole('button', { name: '480p', exact: true }).click()
    await page.getByRole('button', { name: '1.25', exact: true }).click()

    const persistentAfterSettings = await page.evaluate(() => ({
      tabPlayback: sessionStorage.getItem('yt-client:tab-playback'),
      persistent: JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { quality?: unknown, playbackRate?: number },
    }))
    expect(persistentAfterSettings.tabPlayback).toBeNull()
    expect(persistentAfterSettings.persistent.quality).toBe(480)
    expect(persistentAfterSettings.persistent.playbackRate).toBe(1.25)

    await secondTab.goto('/watch?v=dockvid0001')
    await expect(secondVideo).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => secondVideo.evaluate(v => (v as HTMLVideoElement).playbackRate)).toBe(1.25)
  } finally {
    await secondTab.close()
  }
})
