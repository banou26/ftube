import type { Locator, Page } from '@playwright/test'

import { installMockPlayback } from './mock-playback'
import { expect, hideFknNotice, test } from './test'

const pressTab = async (page: Page, browserName: string) => {
  await page.keyboard.press(process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
}

const hasAriaHiddenAncestor = async (locator: Locator) =>
  locator.evaluate((el) => el.closest('[aria-hidden="true"]') !== null)

test('exposes Search preview controls and slider to keyboard and screen readers independently of watch links or dock', async ({ page, browserName }) => {
  await hideFknNotice(page)
  await installMockPlayback(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/results?search_query=mock')

  const firstRow = page.locator('article.result').nth(0)
  const secondRow = page.locator('article.result').nth(1)
  await expect(firstRow.getByRole('link', { name: 'First Search Video', exact: true })).toBeVisible({ timeout: 30_000 })

  // Dock First Search Video so we can also confirm preview Space/Escape never collide with docked player shortcuts.
  await firstRow.getByRole('link', { name: 'First Search Video', exact: true }).click()
  await expect(page).toHaveURL(/\/watch\?v=dockvid0001/)
  await expect.poll(() =>
    page.evaluate(() => {
      const video = document.querySelector('main [data-player-root] video') as HTMLVideoElement | null
      return Boolean(video && !video.paused && !video.muted)
    }),
  ).toBe(true)

  await page.keyboard.press('i')
  const dock = page.getByRole('complementary', { name: 'Miniplayer' })
  await expect(dock).toBeVisible()

  // Pause dock so we know its paused state should not toggle on preview Space or close on preview Escape.
  await dock.locator('video').hover({ position: { x: 80, y: 50 } })
  await dock.getByRole('button', { name: 'Pause', exact: true }).click()

  // Move focus to firstRow's channel link (its last focusable control), then Tab forward into secondRow's preview trigger.
  await firstRow.getByRole('link', { name: /Channel One/ }).focus()
  const previewTrigger = secondRow.getByRole('button', { name: 'Preview Second Preview Video', exact: true })
  await pressTab(page, browserName)
  await expect(previewTrigger).toBeFocused()
  expect(await hasAriaHiddenAncestor(previewTrigger)).toBe(false)
  await expect(previewTrigger).toHaveAttribute('aria-pressed', 'false')

  // Activate preview via keyboard Enter without waiting for hover dwell.
  await page.keyboard.press('Enter')
  const stopTrigger = secondRow.getByRole('button', { name: 'Stop preview for Second Preview Video', exact: true })
  await expect(stopTrigger).toHaveAttribute('aria-pressed', 'true')
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })

  // Controls must be in the accessibility tree WITHOUT includeHidden: true and have zero aria-hidden ancestors.
  const unmuteBtn = secondRow.getByRole('button', { name: 'Unmute preview', exact: true })
  const ccBtn = secondRow.getByRole('button', { name: 'Subtitles/CC', exact: true })
  const slider = secondRow.getByRole('slider', { name: 'Seek preview', exact: true })
  await expect(unmuteBtn).toBeVisible()
  await expect(ccBtn).toBeVisible()
  await expect(slider).toBeVisible()
  expect(await hasAriaHiddenAncestor(unmuteBtn)).toBe(false)
  expect(await hasAriaHiddenAncestor(ccBtn)).toBe(false)
  expect(await hasAriaHiddenAncestor(slider)).toBe(false)

  await expect(slider).toHaveAttribute('aria-orientation', 'horizontal')
  await expect(slider).toHaveAttribute('aria-valuemin', '0')
  await expect(slider).toHaveAttribute('aria-valuemax', '180')
  expect(await slider.getAttribute('aria-valuetext')).toContain('of 3:00')

  // Tab order inside thumb-wrap: Stop trigger -> Unmute -> Subtitles/CC -> Seek slider -> Title link.
  await pressTab(page, browserName)
  await expect(unmuteBtn).toBeFocused()
  await page.keyboard.press('Space')
  const muteBtn = secondRow.getByRole('button', { name: 'Mute preview', exact: true })
  await expect(muteBtn).toBeVisible()
  expect(await secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false)
  // Dock must remain visible and paused.
  await expect(dock).toBeVisible()
  expect(await dock.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)

  await pressTab(page, browserName)
  await expect(ccBtn).toBeFocused()
  await expect(ccBtn).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Space')
  await expect(ccBtn).toHaveAttribute('aria-pressed', 'false')

  await pressTab(page, browserName)
  await expect(slider).toBeFocused()
  await page.evaluate(() => {
    const video = document.querySelectorAll('article.result')[1]?.querySelector('video') as HTMLVideoElement | null
    if (video) video.currentTime = 20
  })
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(19)

  await page.keyboard.press('ArrowRight')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(24)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(34)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(36)
  await page.keyboard.press('PageUp')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(45)
  await page.keyboard.press('End')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(180)
  await page.keyboard.press('Home')
  await expect.poll(() => secondRow.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(3)
  expect(new URL(page.url()).pathname).toBe('/results')

  // Escape stops the keyboard preview, restores focus to the trigger button, and keeps miniplayer open.
  await page.keyboard.press('Escape')
  await expect(secondRow.locator('video')).toHaveCount(0)
  await expect(previewTrigger).toBeFocused()
  await expect(previewTrigger).toHaveAttribute('aria-pressed', 'false')
  await expect(dock).toBeVisible()

  // Restart with Enter, Tab through trigger -> Mute (still unmuted) -> CC -> Slider -> Title link (auto-stops preview).
  await page.keyboard.press('Enter')
  await expect(secondRow.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })
  await pressTab(page, browserName)
  await expect(muteBtn).toBeFocused()
  await pressTab(page, browserName)
  await expect(ccBtn).toBeFocused()
  await pressTab(page, browserName)
  await expect(slider).toBeFocused()
  await pressTab(page, browserName)
  await expect(secondRow.getByRole('link', { name: 'Second Preview Video', exact: true })).toBeFocused()
  await expect(secondRow.locator('video')).toHaveCount(0)
})

test('exposes preview controls and keyboard slider on VideoCard, ShortsTile, and ChannelHome FeaturedVideo', async ({ page }) => {
  await hideFknNotice(page)
  await installMockPlayback(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/privacy')
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/preview-a11y-harness.tsx'
    const mod = await import(harness) as { mountPreviewA11yHarness: () => void }
    mod.mountPreviewA11yHarness()
  })

  const surfaces = [
    { selector: '[data-surface="video-card"]', title: 'Accessible Card Video' },
    { selector: '[data-surface="shorts-tile"]', title: 'Accessible Short Tile' },
    { selector: '[data-surface="channel-featured"]', title: 'Accessible Featured Video' },
  ] as const

  for (const { selector, title } of surfaces) {
    const host = page.locator(selector)
    const trigger = host.getByRole('button', { name: `Preview ${title}`, exact: true })
    await expect(trigger).toBeAttached({ timeout: 20_000 })
    expect(await hasAriaHiddenAncestor(trigger)).toBe(false)

    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(host.locator('[data-painted]')).toBeVisible({ timeout: 20_000 })

    const unmuteOrMute = host.getByRole('button', { name: /(?:Un)?[Mm]ute preview/ })
    const cc = host.getByRole('button', { name: 'Subtitles/CC', exact: true })
    const slider = host.getByRole('slider', { name: 'Seek preview', exact: true })
    await expect(unmuteOrMute).toBeVisible()
    await expect(cc).toBeVisible()
    await expect(slider).toBeVisible()
    expect(await hasAriaHiddenAncestor(unmuteOrMute)).toBe(false)
    expect(await hasAriaHiddenAncestor(cc)).toBe(false)
    expect(await hasAriaHiddenAncestor(slider)).toBe(false)

    await slider.focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => host.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(9)

    await page.keyboard.press('Escape')
    await expect(host.locator('video')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  }
})
