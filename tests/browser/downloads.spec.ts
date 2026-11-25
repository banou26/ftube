import { readFileSync } from 'node:fs'

import { expect, plainTest as test } from './test'

// "Me at the zoo" (jNQXAC9IVRw, 19s): small enough to complete real SABR audio + muxed MP4 downloads in seconds.
const SHORT_VOD = 'jNQXAC9IVRw'

test('downloads audio (M4A) and muxed video (MP4) over SABR and manages them on /downloads', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/watch?v=${SHORT_VOD}`)

  const downloadBtn = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadBtn).toBeVisible({ timeout: 120_000 })

  await downloadBtn.click()
  const dialog = page.getByRole('dialog', { name: 'Download' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Audio' }).click()
  const m4aOption = dialog.getByRole('radio', { name: /M4A/ }).first()
  await expect(m4aOption).toBeVisible({ timeout: 60_000 })
  await m4aOption.click()

  const audioDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const audioDownload = await audioDownloadPromise
  expect(audioDownload.suggestedFilename()).toMatch(/\.m4a$/i)
  const audioPath = await audioDownload.path()
  expect(audioPath).toBeTruthy()
  const audioSize = readFileSync(audioPath!).byteLength
  expect(audioSize).toBeGreaterThan(10_000)

  const audioMeta = await page.evaluate(async (bytesBase64) => {
    const raw = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([raw], { type: 'audio/mp4' }))
    try {
      const el = document.createElement('audio')
      el.src = url
      await new Promise<void>((resolve, reject) => {
        el.onloadedmetadata = () => resolve()
        el.onerror = () => reject(new Error('audio failed to load metadata'))
      })
      return { duration: el.duration, readyState: el.readyState }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, readFileSync(audioPath!).toString('base64'))
  expect(audioMeta.duration).toBeGreaterThan(10)
  expect(audioMeta.readyState).toBeGreaterThanOrEqual(1)

  await downloadBtn.click()
  await expect(dialog).toBeVisible()
  const videoRadios = dialog.getByRole('radio')
  await expect(videoRadios.first()).toBeVisible({ timeout: 60_000 })
  await videoRadios.last().click()

  const videoDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const videoDownload = await videoDownloadPromise
  expect(videoDownload.suggestedFilename()).toMatch(/\.mp4$/i)
  const videoPath = await videoDownload.path()
  expect(videoPath).toBeTruthy()
  const videoBytes = readFileSync(videoPath!)
  expect(videoBytes.byteLength).toBeGreaterThan(20_000)

  const videoMeta = await page.evaluate(async (bytesBase64) => {
    const raw = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([raw], { type: 'video/mp4' }))
    try {
      const el = document.createElement('video')
      el.muted = true
      el.src = url
      await new Promise<void>((resolve, reject) => {
        el.onloadedmetadata = () => resolve()
        el.onerror = () => reject(new Error('muxed mp4 failed to load metadata'))
      })
      return { duration: el.duration, videoWidth: el.videoWidth, videoHeight: el.videoHeight, readyState: el.readyState }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, videoBytes.toString('base64'))
  expect(videoMeta.duration).toBeGreaterThan(10)
  expect(videoMeta.videoWidth).toBeGreaterThan(0)
  expect(videoMeta.readyState).toBeGreaterThanOrEqual(1)

  const guide = page.getByRole('navigation', { name: 'Guide' })
  if (await guide.count() === 0) {
    await page.getByRole('button', { name: 'Guide', exact: true }).click()
  }
  await page.getByRole('link', { name: 'Downloads', exact: true }).click()
  await expect(page).toHaveURL(/\/downloads$/)
  await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  await expect(page.locator('.row')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Save file' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Clear history' }).click()
  await expect(page.getByText(/No downloads yet/)).toBeVisible()
})

test('opens the Download dialog from a video card menu', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/results?search_query=rick+astley')
  const more = page.locator('article').getByRole('button', { name: /^More actions for / }).first()
  await expect(more).toBeVisible({ timeout: 120_000 })
  await more.click()
  await page.getByRole('menuitem', { name: 'Download' }).click()
  const dialog = page.getByRole('dialog', { name: 'Download' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio').first()).toBeVisible({ timeout: 60_000 })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
})
