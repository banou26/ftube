import type { Locator, Page } from '@playwright/test'

import { expect, test } from './test'

const VIDEO_ID = 'dQw4w9WgXcQ'
const SHORT_ID = 'y2Vqj-59Hqc'

// Chromium with real autoplay blocking so fresh navigations without user gesture reject unmuted play()
// Chrome 156 crashes (SIGTRAP) on --autoplay-policy=document-user-gesture-required; user-gesture-required enforces blocking cleanly
const restrictedTest = test.extend<object, object>({
  browser: [async ({ playwright, browserName, headless, launchOptions }, use) => {
    const browser = await playwright[browserName].launch({
      ...launchOptions,
      headless,
      args: ['--mute-audio', '--autoplay-policy=user-gesture-required'],
    })
    await use(browser)
    await browser.close()
  }, { scope: 'worker' }],
})

// Playwright's own evaluate/locator assertions invoke CDP with userGesture: true,
// which activates navigator.userActivation before Shaka reaches video.play().
// Poll through CDP with userGesture: false so Chromium enforces its real autoplay block.
const waitForGestureFreePlayback = async (page: Page, selector = 'video') => {
  const cdp = await page.context().newCDPSession(page)
  try {
    await expect.poll(async () => {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const v = document.querySelector(${JSON.stringify(selector)});
          return v && !v.paused ? v.currentTime : 0;
        })()`,
        returnByValue: true,
        userGesture: false,
      })
      return Number(result.value ?? 0)
    }, { timeout: 120_000, message: 'playback did not start' }).toBeGreaterThan(0.3)
  } finally {
    await cdp.detach().catch(() => {})
  }
}

const waitForPlayback = async (video: Locator) => {
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => {
      const media = element as HTMLVideoElement
      return media.paused ? 0 : media.currentTime
    }),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(0.3)
}

const storedMuted = (page: Page) => page.evaluate(() => {
  const raw = localStorage.getItem('yt-client:settings')
  if (!raw) return undefined
  return (JSON.parse(raw) as { muted?: boolean }).muted
})

restrictedTest('watch player shows audio permission prompt when autoplay is blocked and unmutes on click', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: Error[] = []
  page.on('pageerror', error => errors.push(error))

  await page.goto(`/watch?v=${VIDEO_ID}`)
  await waitForGestureFreePlayback(page)
  const video = page.locator('video')

  expect(await video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false)
  expect(await storedMuted(page)).not.toBe(true)

  const prompt = page.getByRole('region', { name: 'Audio permission' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Sound is muted by your browser')
  await expect(prompt).toContainText('site settings')
  await expect(prompt).toContainText('Sound to Allow')

  await prompt.getByRole('button', { name: 'Enable sound' }).click()
  await expect(prompt).toBeHidden()

  const afterClick = await video.evaluate(element => {
    const media = element as HTMLVideoElement
    return { muted: media.muted, volume: media.volume, paused: media.paused, currentTime: media.currentTime }
  })
  expect(afterClick.muted).toBe(false)
  expect(afterClick.volume).toBe(1)
  expect(afterClick.paused).toBe(false)

  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 15_000, message: 'playback stopped advancing after unmuting' },
  ).toBeGreaterThan(afterClick.currentTime + 0.3)

  expect(errors).toEqual([])
})

restrictedTest('dismissing the audio permission prompt hides it without pausing playback', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: Error[] = []
  page.on('pageerror', error => errors.push(error))

  await page.goto(`/watch?v=${VIDEO_ID}`)
  await waitForGestureFreePlayback(page)
  const video = page.locator('video')

  const prompt = page.getByRole('region', { name: 'Audio permission' })
  await expect(prompt).toBeVisible()

  await prompt.getByRole('button', { name: 'Dismiss audio prompt' }).click()
  await expect(prompt).toBeHidden()

  const afterDismiss = await video.evaluate(element => {
    const media = element as HTMLVideoElement
    return { muted: media.muted, paused: media.paused, currentTime: media.currentTime }
  })
  expect(afterDismiss.muted).toBe(true)
  expect(afterDismiss.paused).toBe(false)

  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 15_000, message: 'playback stopped advancing after dismissing prompt' },
  ).toBeGreaterThan(afterDismiss.currentTime + 0.3)

  expect(errors).toEqual([])
})

restrictedTest('pressing m unmutes and auto-dismisses the audio permission prompt', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto(`/watch?v=${VIDEO_ID}`)
  await waitForGestureFreePlayback(page)
  const video = page.locator('video')

  const prompt = page.getByRole('region', { name: 'Audio permission' })
  await expect(prompt).toBeVisible()

  await page.keyboard.press('m')
  await expect(prompt).toBeHidden()
  expect(await video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(false)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false)
})

restrictedTest('shorts player shows the audio prompt below the top bar and unmutes on click', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: Error[] = []
  page.on('pageerror', error => errors.push(error))

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/shorts/${SHORT_ID}`)
  await waitForGestureFreePlayback(page, `[data-short-id="${SHORT_ID}"] video`)
  const slide = page.locator(`[data-short-id="${SHORT_ID}"]`)
  const video = slide.locator('video')

  expect(await video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  expect(await storedMuted(page)).not.toBe(true)

  const prompt = slide.getByRole('region', { name: 'Audio permission' })
  await expect(prompt).toBeVisible()
  const [topBarBox, promptBox] = await Promise.all([
    slide.locator('.top-bar').boundingBox(),
    prompt.boundingBox(),
  ])
  expect(promptBox!.y, 'audio prompt overlaps Shorts top-bar controls').toBeGreaterThanOrEqual(topBarBox!.y + topBarBox!.height - 1)

  await prompt.getByRole('button', { name: 'Enable sound' }).click()
  await expect(prompt).toBeHidden()

  const afterClick = await video.evaluate(element => {
    const media = element as HTMLVideoElement
    return { muted: media.muted, paused: media.paused, currentTime: media.currentTime }
  })
  expect(afterClick.muted).toBe(false)
  expect(afterClick.paused).toBe(false)

  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 15_000, message: 'Shorts playback stopped advancing after unmuting' },
  ).toBeGreaterThan(afterClick.currentTime + 0.3)

  expect(errors).toEqual([])
})

test('does not show the audio permission prompt when unmuted autoplay succeeds', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = page.locator('video')
  await waitForPlayback(video)

  expect(await video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(false)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false)
  await expect(page.getByRole('region', { name: 'Audio permission' })).toHaveCount(0)
})
