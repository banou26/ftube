import { expect, startCaptionsOff, test } from './test'

test('plays a watch video when only ManagedMediaSource is exposed (iOS WebKit)', async ({ page }) => {
  test.setTimeout(180_000)
  await startCaptionsOff(page)
  await page.addInitScript(() => {
    const native = window.MediaSource
    if (!native) return
    Object.defineProperty(window, 'ManagedMediaSource', {
      value: native,
      configurable: true,
      writable: true,
    })
    delete (window as { MediaSource?: unknown }).MediaSource
  })

  const pageErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })

  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'ManagedMediaSource playback did not start' },
  ).toBeGreaterThan(1)

  expect(await page.evaluate(() => (
    typeof (window as { MediaSource?: unknown }).MediaSource === 'undefined'
    && typeof (window as { ManagedMediaSource?: unknown }).ManagedMediaSource === 'function'
  ))).toBe(true)
  expect(await video.evaluate(element => (element as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback)).toBe(true)
  expect(pageErrors).toEqual([])
  await expect(page.locator('.playback-status')).toHaveCount(0)
})
