import { readFileSync } from 'node:fs'

import { expect, plainTest as test } from './test'

// "Me at the zoo" (jNQXAC9IVRw, 19s): small enough to complete real SABR audio + muxed MP4 downloads in seconds.
const SHORT_VOD = 'jNQXAC9IVRw'

test('downloads audio (M4A) and muxed video (MP4) over SABR and manages them via the floating menu and /downloads', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/watch?v=${SHORT_VOD}`)

  await expect(page.getByRole('button', { name: /^Downloads:/ })).toHaveCount(0)

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

  const floatingMenu = page.getByRole('dialog', { name: 'Downloads' })
  await expect(floatingMenu).toBeVisible()
  await expect(floatingMenu.getByText(/M4A/)).toBeVisible()

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

  await page.keyboard.press('Escape')
  await expect(floatingMenu).toBeHidden()
  const trayTrigger = page.getByRole('button', { name: /^Downloads:/ })
  await expect(trayTrigger).toBeVisible()

  await page.setViewportSize({ width: 360, height: 860 })
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(signInButton).toBeVisible({ timeout: 30_000 })
  const trayBox = (await trayTrigger.boundingBox())!
  const signInBox = (await signInButton.boundingBox())!
  expect(trayBox.x).toBeGreaterThanOrEqual(0)
  expect(trayBox.x + trayBox.width).toBeLessThanOrEqual(signInBox.x + 0.5)
  expect(signInBox.x + signInBox.width).toBeLessThanOrEqual(360)
  await page.setViewportSize({ width: 1280, height: 900 })

  await downloadBtn.click()
  await expect(dialog).toBeVisible()
  const h264Radios = dialog.getByRole('radio', { name: /H\.264/ })
  await expect(h264Radios.first()).toBeVisible({ timeout: 60_000 })
  await h264Radios.last().click()

  const videoDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(floatingMenu).toBeVisible()
  const videoDownload = await videoDownloadPromise
  expect(videoDownload.suggestedFilename()).toMatch(/\.mp4$/i)
  const videoPath = await videoDownload.path()
  expect(videoPath).toBeTruthy()
  const videoBytes = readFileSync(videoPath!)
  expect(videoBytes.byteLength).toBeGreaterThan(20_000)

  const boxTypes: string[] = []
  let offset = 0
  while (offset + 8 <= videoBytes.byteLength) {
    const size = videoBytes.readUInt32BE(offset)
    const type = videoBytes.subarray(offset + 4, offset + 8).toString('latin1')
    boxTypes.push(type)
    offset += size > 0 ? size : videoBytes.byteLength - offset
  }
  expect(boxTypes).toEqual(['ftyp', 'moov', 'mdat'])
  expect(videoBytes.subarray(8, 12).toString('latin1')).toBe('isom')

  const videoMeta = await page.evaluate(async (bytesBase64) => {
    const raw = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([raw], { type: 'video/mp4' }))
    try {
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.src = url
      document.body.appendChild(el)
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve()
        el.onerror = () => reject(new Error('muxed mp4 failed to load video data'))
      })
      await el.play()
      await new Promise(resolve => setTimeout(resolve, 600))
      const decodedAudio = (el as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0
      const out = {
        duration: el.duration,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        readyState: el.readyState,
        decodedAudio,
      }
      el.remove()
      return out
    } finally {
      URL.revokeObjectURL(url)
    }
  }, videoBytes.toString('base64'))
  expect(videoMeta.duration).toBeGreaterThan(10)
  expect(videoMeta.videoWidth).toBeGreaterThan(0)
  expect(videoMeta.readyState).toBeGreaterThanOrEqual(2)
  expect(videoMeta.decodedAudio).toBeGreaterThan(0)

  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'FTube home' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(trayTrigger).toBeVisible()
  await trayTrigger.click()
  await expect(floatingMenu).toBeVisible()
  await expect(floatingMenu.getByRole('button', { name: 'Save file' }).first()).toBeVisible()
  await floatingMenu.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(trayTrigger).toHaveCount(0)

  const downloadsLink = page.getByRole('link', { name: 'Downloads', exact: true })
  if (await downloadsLink.count() === 0) {
    await page.getByRole('button', { name: 'Guide', exact: true }).click()
  }
  await downloadsLink.click()
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

test('crops a VOD video (MP4) and audio (M4A) download by start/end timestamps', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/watch?v=${SHORT_VOD}`)

  const downloadBtn = page.getByRole('button', { name: 'Download', exact: true })
  await expect(downloadBtn).toBeVisible({ timeout: 120_000 })
  await downloadBtn.click()

  const dialog = page.getByRole('dialog', { name: 'Download' })
  await expect(dialog).toBeVisible()
  const h264Radios = dialog.getByRole('radio', { name: /H\.264/ })
  await expect(h264Radios.first()).toBeVisible({ timeout: 60_000 })
  await h264Radios.last().click()

  const fullSizeText = await h264Radios.last().locator('.format-size').textContent()
  await dialog.getByRole('button', { name: 'Crop', exact: true }).click()

  const startInput = dialog.getByLabel('Start timestamp')
  const endInput = dialog.getByLabel('End timestamp')
  await startInput.fill('0:04')
  await startInput.blur()
  await endInput.fill('0:12')
  await endInput.blur()

  await expect(dialog.getByText('Clip: 0:04 - 0:12 (0:08)')).toBeVisible()
  const croppedSizeText = await h264Radios.last().locator('.format-size').textContent()
  expect(croppedSizeText).not.toBe(fullSizeText)

  const videoDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()

  const floatingMenu = page.getByRole('dialog', { name: 'Downloads' })
  await expect(floatingMenu).toBeVisible()
  await expect(floatingMenu.getByText('0:04 - 0:12')).toBeVisible()

  const videoDownload = await videoDownloadPromise
  expect(videoDownload.suggestedFilename()).toContain('0m04s-0m12s')
  const videoPath = await videoDownload.path()
  expect(videoPath).toBeTruthy()
  const videoBytes = readFileSync(videoPath!)
  expect(videoBytes.byteLength).toBeGreaterThan(10_000)

  const croppedVideoMeta = await page.evaluate(async (bytesBase64) => {
    const raw = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([raw], { type: 'video/mp4' }))
    try {
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.src = url
      document.body.appendChild(el)
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve()
        el.onerror = () => reject(new Error('cropped mp4 failed to load video data'))
      })
      await el.play()
      await new Promise(resolve => setTimeout(resolve, 400))
      const out = {
        duration: el.duration,
        videoWidth: el.videoWidth,
        readyState: el.readyState,
      }
      el.remove()
      return out
    } finally {
      URL.revokeObjectURL(url)
    }
  }, videoBytes.toString('base64'))
  expect(croppedVideoMeta.videoWidth).toBeGreaterThan(0)
  expect(croppedVideoMeta.readyState).toBeGreaterThanOrEqual(2)
  expect(croppedVideoMeta.duration).toBeGreaterThan(6)
  expect(croppedVideoMeta.duration).toBeLessThan(10.5)

  await page.keyboard.press('Escape')
  await downloadBtn.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Audio' }).click()
  const m4aOption = dialog.getByRole('radio', { name: /M4A/ }).first()
  await expect(m4aOption).toBeVisible({ timeout: 60_000 })
  await m4aOption.click()

  await dialog.getByRole('button', { name: 'Crop', exact: true }).click()
  await dialog.getByLabel('Start timestamp').fill('0:05')
  await dialog.getByLabel('Start timestamp').blur()
  await dialog.getByLabel('End timestamp').fill('0:13')
  await dialog.getByLabel('End timestamp').blur()

  const audioDownloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const audioDownload = await audioDownloadPromise
  expect(audioDownload.suggestedFilename()).toContain('0m05s-0m13s')
  const audioPath = await audioDownload.path()
  const audioMeta = await page.evaluate(async (bytesBase64) => {
    const raw = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([raw], { type: 'audio/mp4' }))
    try {
      const el = document.createElement('audio')
      el.src = url
      await new Promise<void>((resolve, reject) => {
        el.onloadedmetadata = () => resolve()
        el.onerror = () => reject(new Error('cropped m4a failed to load metadata'))
      })
      return { duration: el.duration, readyState: el.readyState }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, readFileSync(audioPath!).toString('base64'))
  expect(audioMeta.readyState).toBeGreaterThanOrEqual(1)
  expect(audioMeta.duration).toBeGreaterThan(6)
  expect(audioMeta.duration).toBeLessThan(10.5)
})
