import type { TimedCommentsScenario } from './fixtures/timed-comments-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/timed-comments-harness.tsx'

const mountHarness = async (page: import('@playwright/test').Page, scenario: TimedCommentsScenario = {}) => {
  await page.goto('/privacy')
  await page.evaluate(async ([path, opts]) => {
    const mod = await import(path) as typeof import('./fixtures/timed-comments-harness')
    mod.mountTimedCommentsHarness(opts)
  }, [HARNESS, scenario] as const)
  const player = page.locator('[data-timed-comments-harness]')
  await expect(player.locator('.bar')).toBeVisible()
  return player
}

test('defaults off, toggles from regular settings menu (hidden on live), and works with comments panel closed and at 2x speed', async ({ page }) => {
  const player = await mountHarness(page, { videoId: 'video-1' })

  // Off by default: overlay absent and comments query not triggered while disabled
  await expect(player.locator('[data-overlay-source="timed-comments"]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__timedCommentsHarness?.requestedVideos() ?? [])).toEqual([])

  await player.evaluate(() => window.__timedCommentsHarness?.advanceTime(42.2))
  await expect(player.locator('[data-overlay-source="timed-comments"]')).toHaveCount(0)

  // Opt-in toggle exists inside regular player Settings menu and starts Unchecked / Off
  await player.getByRole('button', { name: 'Settings', exact: true }).click()
  const menu = player.getByRole('menu', { name: 'Player settings' })
  const toggle = menu.getByRole('menuitemcheckbox', { name: /Timed comments/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const overlay = player.locator('[data-overlay-source="timed-comments"]')
  await expect(overlay).toBeAttached()
  await expect(overlay).toHaveCSS('pointer-events', 'none')
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.requestedVideos() ?? [])).toEqual(['video-1'])

  // Close popup menu and verify timed cues without mounting the comments panel
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // Timestamp-only (0:15), wrong-video (0:20), and out-of-range (500s) comments never show
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(15.2))
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(20.2))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)

  // Cross 0:42 -> first valid timestamp for current video renders single item
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(42.3))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-item]')).toContainText('Guitar riff hits')

  // Non-default 2x speed crossing 1:00 shows highest-liked comment and replaces previous active item
  await page.evaluate(() => window.__timedCommentsHarness?.setRate(2))
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(59.4))
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(60.6))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-item]')).toContainText('1:00 Top liked reaction!')
  await expect(overlay.locator('[data-overlay-item]')).not.toContainText('Lower likes comment')

  // Toggle hidden on live streams cleanly
  await page.evaluate(() => window.__timedCommentsHarness?.setScenario({ videoId: 'live-1', isLive: true }))
  await expect(player.locator('[data-overlay-source="timed-comments"]')).toHaveCount(0)
  await player.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(player.getByRole('menu', { name: 'Player settings' }).getByRole('menuitemcheckbox', { name: /Timed comments/ })).toHaveCount(0)
})

test('clears and skips on seek, replays after rewind, clears on video switch and toggle off, and stays clickable in windowed and fullscreen playback', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== top) return
    localStorage.setItem('yt-client:settings', JSON.stringify({ timedComments: true }))
  })
  const player = await mountHarness(page, { videoId: 'video-1' })
  const overlay = player.locator('[data-overlay-source="timed-comments"]')
  await expect(overlay).toBeAttached()
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.requestedVideos() ?? [])).toEqual(['video-1'])

  // Trigger 1:00 cue
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(59.5))
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(60.2))
  await expect(overlay.locator('[data-overlay-item]')).toContainText('1:00 Top liked reaction!')

  // Player controls remain usable while overlay message is active
  const pauseBtn = player.getByRole('button', { name: 'Pause', exact: true })
  await pauseBtn.click()
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.paused())).toBe(true)
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.paused())).toBe(false)

  // Rewind before 1:00 clears active message and lets cue reappear on re-crossing
  await page.evaluate(() => window.__timedCommentsHarness?.seekTo(55))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(60.4))
  await expect(overlay.locator('[data-overlay-item]')).toContainText('1:00 Top liked reaction!')

  // Forward seek past 2:00 clears active message and skips intermediate 2:00 cue
  await page.evaluate(() => window.__timedCommentsHarness?.seekTo(135))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(135.3))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)

  // Enter fullscreen (if supported in headless browser) and confirm timed cue appears inside fullscreen surface while controls work
  const enterFullscreen = player.getByRole('button', { name: 'Full screen', exact: true })
  await enterFullscreen.click()
  await page.waitForTimeout(100)
  const fsElement = await page.evaluate(() => Boolean(document.fullscreenElement))
  if (fsElement) {
    await expect(player.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible()
  }
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(150.2))
  await expect(overlay.locator('[data-overlay-item]')).toContainText('2:30 Finale note')
  if (fsElement) {
    await player.getByRole('button', { name: 'Exit full screen', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  }

  // Switching videos clears active cue and starts cues from new video
  await page.evaluate(() => window.__timedCommentsHarness?.setScenario({ videoId: 'video-2' }))
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.requestedVideos() ?? [])).toEqual(['video-1', 'video-2'])
  await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(10.2))
  await expect(overlay.locator('[data-overlay-item]')).toContainText('Fresh cue on video two')

  // Toggling Timed comments off clears active items immediately
  await player.getByRole('button', { name: 'Settings', exact: true }).click()
  await player.getByRole('menu', { name: 'Player settings' }).getByRole('menuitemcheckbox', { name: /Timed comments/ }).click()
  await expect(player.locator('[data-overlay-source="timed-comments"]')).toHaveCount(0)
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)
})

test('leaves playback usable when comments are disabled, empty, or unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== top) return
    localStorage.setItem('yt-client:settings', JSON.stringify({ timedComments: true }))
  })
  const player = await mountHarness(page, { videoId: 'video-disabled', commentsHidden: false })

  for (const scenario of [
    { videoId: 'video-disabled', commentsHidden: false },
    { videoId: 'video-empty', commentsHidden: false },
    { videoId: 'video-error', commentsHidden: false },
    { videoId: 'video-1', commentsHidden: true },
  ]) {
    await page.evaluate((next) => window.__timedCommentsHarness?.setScenario(next), scenario)
    await page.evaluate(() => window.__timedCommentsHarness?.advanceTime(60.5))
    await expect(player.locator('[data-overlay-source="timed-comments"] [data-overlay-item]')).toHaveCount(0)
  }

  // Player playback toggle remains responsive throughout
  await player.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.paused())).toBe(true)
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__timedCommentsHarness?.paused())).toBe(false)
})
