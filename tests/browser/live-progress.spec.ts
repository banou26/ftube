import type { LiveProgressHarnessOptions } from './fixtures/live-progress-harness'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/live-progress-harness.tsx'

const mountLive = async (page: import('@playwright/test').Page, options: LiveProgressHarnessOptions) => {
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  await page.evaluate(async ([path, opts]) => {
    const mod = await import(path) as typeof import('./fixtures/live-progress-harness')
    mod.mountLiveProgressHarness(opts)
  }, [HARNESS, options] as const)
  const root = page.locator('[data-live-harness]')
  await expect(root.locator('.scrubber')).toBeVisible({ timeout: 30_000 })
  return root
}

test('pins live edge at 100%, avoids -0:00 hover text, scopes active buffer, and resumes on Live click', async ({ page }) => {
  const root = await mountLive(page, {
    start: 1760,
    end: 2000,
    currentTime: 1995,
    buffered: [[1760, 2000]],
    chapters: [{ title: 'Should Hide On Live', startSeconds: 0 }, { title: 'Second', startSeconds: 1880 }],
  })

  const scrubber = root.locator('.scrubber')
  const played = root.locator('.scrubber .played').first()
  const buffered = root.locator('.scrubber .buffered').first()
  const knob = root.locator('.scrubber .knob')

  await expect(root.locator('.chapter')).toHaveCount(0)
  await expect(scrubber).toHaveAttribute('aria-valuetext', 'Live')
  expect(await played.evaluate(el => (el as HTMLElement).style.width)).toBe('100%')
  expect(await knob.evaluate(el => (el as HTMLElement).style.left)).toBe('100%')
  expect(await played.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s')

  const scrubberBox = (await scrubber.boundingBox())!
  await scrubber.hover({ position: { x: scrubberBox.width / 2, y: scrubberBox.height / 2 } })
  await expect(root.locator('.preview-time')).toHaveText('-2:00')
  await page.mouse.move(scrubberBox.x + Math.floor(scrubberBox.width) - 1, scrubberBox.y + scrubberBox.height / 2, { steps: 3 })
  await expect(root.locator('.preview-time')).toHaveText('Live')

  // Seeking back shows only the active buffer around currentTime, not stale live-edge buffer.
  await page.evaluate(() => {
    const h = (window as unknown as { __liveHarness: { setBuffered: (r: [number, number][]) => void, setTime: (t: number) => void, setPaused: (p: boolean) => void } }).__liveHarness
    h.setBuffered([[1875, 1884.8], [1995, 2000]])
    h.setTime(1880)
    h.setPaused(true)
  })

  await expect.poll(() => played.evaluate(el => (el as HTMLElement).style.width)).toBe('50%')
  await expect.poll(() => buffered.evaluate(el => (el as HTMLElement).style.width)).toBe('52%')

  const liveBtn = root.getByRole('button', { name: 'Skip ahead to live broadcast' })
  await expect(liveBtn).toBeEnabled()
  await liveBtn.click()
  await expect.poll(() => played.evaluate(el => (el as HTMLElement).style.width)).toBe('100%')
  const resumed = await page.evaluate(() => (window as unknown as { __liveHarness: { playCount: () => number } }).__liveHarness.playCount())
  expect(resumed).toBeGreaterThanOrEqual(1)
})

test('pins live edge at 100% when live stream has no DVR seek window', async ({ page }) => {
  const root = await mountLive(page, {
    start: 1000,
    end: 1000,
    currentTime: 1000,
    buffered: [[995, 1000]],
  })

  await expect(root.locator('.scrubber')).toHaveAttribute('aria-valuetext', 'Live')
  expect(await root.locator('.scrubber .played').first().evaluate(el => (el as HTMLElement).style.width)).toBe('100%')
  expect(await root.locator('.scrubber .knob').evaluate(el => (el as HTMLElement).style.left)).toBe('100%')
})
