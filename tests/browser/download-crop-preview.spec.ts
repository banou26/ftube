import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/download-crop-harness.tsx'

type PixelSample = { r: number, g: number, b: number, a: number }

type OrientationCase = {
  name: 'landscape' | 'portrait'
  videoId: string
  file: string
  width: number
  height: number
  isPortrait: boolean
  matchesSegment0: (pixel: PixelSample) => boolean
  matchesSegment1: (pixel: PixelSample) => boolean
}

const ORIENTATIONS: OrientationCase[] = [
  {
    name: 'landscape',
    videoId: 'crop-landscape-test',
    file: 'crop-landscape.mp4',
    width: 320,
    height: 180,
    isPortrait: false,
    matchesSegment0: ({ r, g, b, a }) => a > 200 && r > 150 && g < 100 && b < 100,
    matchesSegment1: ({ r, g, b, a }) => a > 200 && g > 110 && r < 100 && b < 100,
  },
  {
    name: 'portrait',
    videoId: 'crop-portrait-test',
    file: 'crop-portrait.mp4',
    width: 180,
    height: 320,
    isPortrait: true,
    matchesSegment0: ({ r, g, b, a }) => a > 200 && r > 150 && g > 70 && b < 70,
    matchesSegment1: ({ r, g, b, a }) => a > 200 && g > 100 && b > 100 && r < 70,
  },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const

const fixtures = new Map<string, Buffer>([
  ['crop-landscape.mp4', readFileSync(resolve(process.cwd(), 'tests/browser/fixtures/crop-landscape.mp4'))],
  ['crop-portrait.mp4', readFileSync(resolve(process.cwd(), 'tests/browser/fixtures/crop-portrait.mp4'))],
])

for (const viewport of VIEWPORTS) {
  for (const orientation of ORIENTATIONS) {
    test(`keeps ${orientation.name} video visible and updates live frame on ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await hideFknNotice(page)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      await page.route('**/__crop_fixtures__/*', async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
        const body = fixtures.get(name)
        if (!body) {
          await route.fulfill({ status: 404 })
          return
        }
        await route.fulfill({ status: 200, contentType: 'video/mp4', body })
      })

      await page.goto('/privacy')
      await page.evaluate(async ([path, options]) => {
        const mod = await import(path) as { mountDownloadCropHarness: (opts: typeof options) => Promise<void> }
        await mod.mountDownloadCropHarness(options)
      }, [
        HARNESS,
        {
          videoId: orientation.videoId,
          title: `Crop preview ${orientation.name}`,
          videoUrl: `/__crop_fixtures__/${orientation.file}`,
          width: orientation.width,
          height: orientation.height,
        },
      ] as const)

      const dialog = page.getByRole('dialog')
      const cropBtn = dialog.getByRole('button', { name: 'Crop', exact: true })
      await expect(cropBtn).toBeVisible()
      await cropBtn.click()

      const previewStage = dialog.locator('[data-crop-preview="true"]')
      const previewCanvas = dialog.locator('[data-crop-preview-canvas="true"]')
      await expect(previewStage).toBeVisible()
      await expect(previewCanvas).toBeVisible()
      await expect(previewCanvas).toHaveAttribute('data-has-frame', 'true')

      const metrics = await page.evaluate(() => {
        const stage = document.querySelector('[data-crop-preview="true"]')
        const canvas = document.querySelector<HTMLCanvasElement>('[data-crop-preview-canvas="true"]')
        const slider = document.querySelector('[data-crop-slider="true"]') ?? document.querySelector('.dual-range')
        const fields = document.querySelector('.crop-fields')
        const actions = document.querySelector('.crop-actions')
        if (!stage || !canvas || !slider || !fields || !actions) return null
        const sRect = stage.getBoundingClientRect()
        const cRect = canvas.getBoundingClientRect()
        const rRect = slider.getBoundingClientRect()
        const fRect = fields.getBoundingClientRect()
        const aRect = actions.getBoundingClientRect()
        return {
          stage: { top: sRect.top, bottom: sRect.bottom, left: sRect.left, right: sRect.right, width: sRect.width, height: sRect.height },
          canvas: {
            top: cRect.top,
            bottom: cRect.bottom,
            left: cRect.left,
            right: cRect.right,
            width: cRect.width,
            height: cRect.height,
            intrinsicWidth: canvas.width,
            intrinsicHeight: canvas.height,
          },
          sliderTop: rRect.top,
          fieldsTop: fRect.top,
          actionsBottom: aRect.bottom,
          actionsRight: aRect.right,
        }
      })

      expect(metrics).not.toBeNull()
      expect(metrics!.stage.top).toBeGreaterThanOrEqual(0)
      expect(metrics!.stage.bottom).toBeLessThanOrEqual(viewport.height)
      expect(metrics!.stage.width).toBeGreaterThanOrEqual(100)
      expect(metrics!.stage.height).toBeGreaterThanOrEqual(80)
      expect(metrics!.canvas.top).toBeGreaterThanOrEqual(metrics!.stage.top - 1)
      expect(metrics!.canvas.bottom).toBeLessThanOrEqual(metrics!.stage.bottom + 1)
      expect(metrics!.canvas.width).toBeGreaterThan(20)
      expect(metrics!.canvas.height).toBeGreaterThan(20)

      if (orientation.isPortrait) {
        expect(metrics!.canvas.intrinsicHeight).toBeGreaterThan(metrics!.canvas.intrinsicWidth)
        expect(metrics!.canvas.height).toBeGreaterThan(metrics!.canvas.width)
      } else {
        expect(metrics!.canvas.intrinsicWidth).toBeGreaterThan(metrics!.canvas.intrinsicHeight)
        expect(metrics!.canvas.width).toBeGreaterThan(metrics!.canvas.height)
      }

      // Preview sits cleanly above the crop slider and controls stay visible inside viewport without overlap.
      expect(metrics!.stage.bottom).toBeLessThanOrEqual(metrics!.sliderTop + 1)
      expect(metrics!.actionsBottom).toBeLessThanOrEqual(viewport.height)
      expect(metrics!.actionsRight).toBeLessThanOrEqual(viewport.width)
      await expect(dialog.getByLabel('Start timestamp')).toBeVisible()
      await expect(dialog.getByLabel('End timestamp')).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Preview clip', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()

      const sampleCenterPixel = () =>
        page.evaluate<PixelSample>(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-crop-preview-canvas="true"]')
          if (!canvas) throw new Error('missing preview canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('missing 2d context')
          const data = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
          return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: data[3] ?? 0 }
        })

      await expect.poll(async () => orientation.matchesSegment0(await sampleCenterPixel())).toBe(true)

      // Scrubbing Start timestamp to 0:03 seeks the video and repaints the live preview canvas.
      const startInput = dialog.getByLabel('Start timestamp')
      await startInput.fill('0:03')
      await expect(startInput).toBeFocused()
      await startInput.press('Enter')

      await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)).toBeGreaterThanOrEqual(2.5)
      await expect.poll(async () => orientation.matchesSegment1(await sampleCenterPixel())).toBe(true)

      // Playing Preview clip keeps the crop preview visible and active while playback advances.
      await dialog.getByRole('button', { name: 'Preview clip', exact: true }).click()
      const stopBtn = dialog.getByRole('button', { name: 'Stop preview', exact: true })
      await expect(stopBtn).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? true)).toBe(false)
      await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)).toBeGreaterThan(3.05)
      await expect(previewCanvas).toBeVisible()

      await stopBtn.click()
      await expect(dialog.getByRole('button', { name: 'Preview clip', exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? false)).toBe(true)
    })
  }
}

test('restores playing and paused watch state across Stop preview, Close, and repeated cycles (APP-1079)', async ({ page }) => {
  await hideFknNotice(page)
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.route('**/__crop_fixtures__/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const body = fixtures.get(name)
    if (!body) {
      await route.fulfill({ status: 404 })
      return
    }
    await route.fulfill({ status: 200, contentType: 'video/mp4', body })
  })

  await page.goto('/privacy')
  await page.evaluate(async ([path, options]) => {
    const mod = await import(path) as { mountDownloadCropHarness: (opts: typeof options) => Promise<void> }
    await mod.mountDownloadCropHarness(options)
  }, [
    HARNESS,
    {
      videoId: 'crop-restore-test',
      title: 'Crop restore test',
      videoUrl: '/__crop_fixtures__/crop-landscape.mp4',
      width: 320,
      height: 180,
    },
  ] as const)

  const dialog = page.getByRole('dialog')

  // Cycle 1: initially playing around 2.0s -> Crop -> Preview clip -> Stop preview -> resumes playing near >= 1.8s.
  await page.evaluate(async () => {
    await window.__downloadCropHarness!.seek(2.0)
    await window.__downloadCropHarness!.play()
  })
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? true)).toBe(false)

  await dialog.getByRole('button', { name: 'Crop', exact: true }).click()
  await dialog.getByRole('button', { name: 'Preview clip', exact: true }).click()
  const stopBtn = dialog.getByRole('button', { name: 'Stop preview', exact: true })
  await expect(stopBtn).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const t = window.__downloadCropHarness?.currentTime() ?? -1
    return t >= 0.25 && t < 1.5
  })).toBe(true)

  await stopBtn.click()
  await expect(dialog.getByRole('button', { name: 'Preview clip', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? true)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)).toBeGreaterThanOrEqual(1.8)

  // Cycle 2: preview again while playing, then Close dialog directly without clicking Stop preview.
  await dialog.getByRole('button', { name: 'Preview clip', exact: true }).click()
  await expect(stopBtn).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const t = window.__downloadCropHarness?.currentTime() ?? -1
    return t >= 0.25 && t < 1.5
  })).toBe(true)

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.isDialogOpen() ?? true)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? true)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)).toBeGreaterThanOrEqual(1.8)

  // Cycle 3: reopen paused at 2.6s -> Crop -> Preview clip -> Stop preview -> paused near 2.6s -> preview -> Close -> paused near 2.6s.
  await page.evaluate(async () => {
    window.__downloadCropHarness!.pause()
    await window.__downloadCropHarness!.seek(2.6)
    window.__downloadCropHarness!.reopenDialog()
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Crop', exact: true }).click()
  await dialog.getByRole('button', { name: 'Preview clip', exact: true }).click()
  await expect(stopBtn).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const t = window.__downloadCropHarness?.currentTime() ?? -1
    return t >= 0.25 && t < 1.5 && window.__downloadCropHarness?.paused() === false
  })).toBe(true)

  await stopBtn.click()
  await expect(dialog.getByRole('button', { name: 'Preview clip', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? false)).toBe(true)
  const restoredPausedTime = await page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)
  expect(restoredPausedTime).toBeGreaterThanOrEqual(2.3)
  expect(restoredPausedTime).toBeLessThanOrEqual(2.9)

  // Cycle 4: preview again while paused, then Close dialog -> stays paused at ~2.6s.
  await dialog.getByRole('button', { name: 'Preview clip', exact: true }).click()
  await expect(stopBtn).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const t = window.__downloadCropHarness?.currentTime() ?? -1
    return t >= 0.25 && t < 1.5
  })).toBe(true)

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.isDialogOpen() ?? true)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__downloadCropHarness?.paused() ?? false)).toBe(true)
  const closedPausedTime = await page.evaluate(() => window.__downloadCropHarness?.currentTime() ?? 0)
  expect(closedPausedTime).toBeGreaterThanOrEqual(2.3)
  expect(closedPausedTime).toBeLessThanOrEqual(2.9)
})
