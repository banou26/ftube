import type { Page } from '@playwright/test'

import { expect, plainTest as test, startCaptionsOff } from './test'

/* Dubbed audio track switching and Stable Volume (DRC) against live YouTube videos:
   - `0e3GPea1Tyg` publishes 24 audio tracks (English US original with DRC + VB, plus 23 dubs).
   - `UjtOGPJ0URM` is a single-track video with plain, DRC, and VB audio formats. */

const DUBBED_ID = '0e3GPea1Tyg'
const SINGLE_DRC_ID = 'UjtOGPJ0URM'

type TraceEntry = {
  at: number
  kind: string
  track: string
  formatKey: string
}

const startPlayback = async (page: Page) => {
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(1)
  return video
}

const audioMediaKeys = (page: Page) =>
  page.evaluate(() =>
    ((globalThis as { __segmentTrace?: TraceEntry[] }).__segmentTrace ?? [])
      .filter((entry) => entry.track === 'audio' && entry.kind === 'media')
      .map((entry) => entry.formatKey),
  )

const openSettings = async (page: Page) => {
  await page.locator('[data-player-root]').hover()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  return page.getByRole('menu', { name: 'Player settings' })
}

const expectPlayingForward = async (page: Page, deltaSeconds = 0.8) => {
  const video = page.locator('video')
  const start = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 45_000, message: `playback did not advance past ${start.toFixed(1)}s` },
  ).toBeGreaterThan(start + deltaSeconds)
}

test('switches dubbed audio tracks and Stable Volume mid-playback without breaking quality or seeking', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await startCaptionsOff(page)

  await page.goto(`/watch?v=${DUBBED_ID}`)
  const video = await startPlayback(page)

  // Starts on the original non-DRC audio track
  const initialKeys = await audioMediaKeys(page)
  expect(initialKeys.length).toBeGreaterThan(0)
  const plainOriginalKey = initialKeys.at(-1)!
  // `ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw` is acont=original + lang=en-US (no drc, no vb)
  expect(plainOriginalKey).toContain('ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw')

  const settings = await openSettings(page)
  const stableRow = settings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ })
  const audioRow = settings.getByRole('menuitem', { name: /^Audio track/ })
  await expect(stableRow).toBeVisible()
  await expect(stableRow).toHaveAttribute('aria-checked', 'false')
  await expect(stableRow).toContainText('Off')
  await expect(audioRow).toBeVisible()
  await expect(audioRow).toContainText('English (US) original')

  // Toggle Stable Volume ON -> switches to DRC variant of English (US) original
  await stableRow.click()
  await expect(stableRow).toHaveAttribute('aria-checked', 'true')
  await expect(stableRow).toContainText('On')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').stableVolume)).toBe(true)

  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not switch to DRC audio format',
  }).toContain('ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM')
  const drcOriginalKey = (await audioMediaKeys(page)).at(-1)!
  expect(drcOriginalKey).not.toBe(plainOriginalKey)

  // Switch Audio track to Spanish dub
  await audioRow.click()
  const audioMenu = page.getByRole('menu', { name: 'Audio track' })
  await expect(audioMenu).toBeVisible()
  // Original track is listed first and checked
  const firstTrack = audioMenu.getByRole('menuitem').nth(1)
  await expect(firstTrack).toContainText('English (US) original')
  await expect(firstTrack.locator('svg')).toHaveCount(1)

  await audioMenu.getByRole('menuitem', { name: 'Spanish', exact: true }).click()
  await expect(audioMenu).toHaveCount(0)

  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not switch to Spanish dubbed audio format',
  }).toContain('Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZXM')
  const spanishKey = (await audioMediaKeys(page)).at(-1)!
  await expectPlayingForward(page)

  // On Spanish (no DRC variant), Stable Volume is hidden and Audio track shows Spanish
  const afterDubSettings = await openSettings(page)
  await expect(afterDubSettings.getByRole('menuitem', { name: /^Audio track/ })).toContainText('Spanish')
  await expect(afterDubSettings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ })).toHaveCount(0)

  // Manual quality change + seek keeps the selected Spanish audio track
  await afterDubSettings.getByRole('menuitem', { name: /^Quality/ }).click()
  await page.getByRole('menu', { name: 'Quality' }).getByRole('menuitem', { name: '360p', exact: true }).click()
  const beforeSeekCount = (await audioMediaKeys(page)).length
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement
    media.currentTime = Math.min(media.duration - 10, media.currentTime + 20)
  })
  await expect.poll(async () => (await audioMediaKeys(page)).length, {
    timeout: 60_000,
    message: 'no audio segment fetched after seek on Spanish track',
  }).toBeGreaterThan(beforeSeekCount)
  expect((await audioMediaKeys(page)).at(-1)).toBe(spanishKey)
  await expectPlayingForward(page)

  // Switch back to English (US) original -> resumes DRC since Stable Volume is still persisted ON
  const returnSettings = await openSettings(page)
  await returnSettings.getByRole('menuitem', { name: /^Audio track/ }).click()
  await page.getByRole('menu', { name: 'Audio track' }).getByRole('menuitem', { name: 'English (US) original', exact: true }).click()

  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not switch back to DRC English original',
  }).toBe(drcOriginalKey)
  await expectPlayingForward(page)

  // Toggle Stable Volume OFF -> returns to plain English original
  const finalSettings = await openSettings(page)
  const finalStable = finalSettings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ })
  await expect(finalStable).toHaveAttribute('aria-checked', 'true')
  await finalStable.click()
  await expect(finalStable).toHaveAttribute('aria-checked', 'false')

  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not switch back to plain English original',
  }).toBe(plainOriginalKey)
  await expectPlayingForward(page)
  expect(errors).toEqual([])
})

test('shows Stable Volume without Audio track on a single-track DRC video and remembers it across reloads', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await startCaptionsOff(page)

  await page.goto(`/watch?v=${SINGLE_DRC_ID}`)
  await startPlayback(page)

  const initialKey = (await audioMediaKeys(page)).at(-1)!
  expect(initialKey).not.toContain('CggKA2RyYxIBMQ')

  const settings = await openSettings(page)
  await expect(settings.getByRole('menuitem', { name: /^Audio track/ })).toHaveCount(0)
  const stableRow = settings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ })
  await expect(stableRow).toBeVisible()
  await expect(stableRow).toHaveAttribute('aria-checked', 'false')

  await stableRow.click()
  await expect(stableRow).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not switch to DRC on single-track video',
  }).toContain('CggKA2RyYxIBMQ')
  await expectPlayingForward(page)

  // Reloading opens directly on the DRC variant with Stable Volume still ON
  await page.reload()
  await startPlayback(page)
  const reloadedKeys = await audioMediaKeys(page)
  expect(reloadedKeys.at(-1)).toContain('CggKA2RyYxIBMQ')

  const reloadedSettings = await openSettings(page)
  await expect(reloadedSettings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ })).toHaveAttribute('aria-checked', 'true')
  expect(errors).toEqual([])
})

test('does not stall when switching Stable Volume, switching audio track, and seeking back-to-back', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await startCaptionsOff(page)

  await page.goto(`/watch?v=${DUBBED_ID}`)
  const video = await startPlayback(page)

  const settings = await openSettings(page)
  await settings.getByRole('menuitemcheckbox', { name: /^Stable Volume/ }).click()
  await settings.getByRole('menuitem', { name: /^Audio track/ }).click()
  const audioMenu = page.getByRole('menu', { name: 'Audio track' })
  await expect(audioMenu).toBeVisible()
  await audioMenu.getByRole('menuitem', { name: 'Spanish', exact: true }).click()
  await expect(audioMenu).toHaveCount(0)

  // Seek immediately while the previous track's init/index fetch could still be in flight
  await video.evaluate((element) => { (element as HTMLVideoElement).currentTime = 20 })
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 60_000, message: 'playback stalled after rapid Stable Volume -> Spanish -> seek' },
  ).toBeGreaterThan(21.5)
  await expect.poll(async () => (await audioMediaKeys(page)).at(-1), {
    timeout: 60_000,
    message: 'did not settle on Spanish audio after rapid switch + seek',
  }).toContain('Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZXM')
  expect(errors).toEqual([])
})
