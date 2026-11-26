import type { Page } from '@playwright/test'
import type { AmbientEdgeScenario } from './fixtures/ambient-edges-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/ambient-edges-harness.tsx'

type RgbPixel = { r: number, g: number, b: number, a: number }

const sampleClipPixels = async (
  page: Page,
  points: readonly { x: number, y: number }[],
): Promise<RgbPixel[]> => {
  const png = await page.screenshot()
  const url = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async ({ imageUrl, coords }) => {
    const img = new Image()
    img.src = imageUrl
    await img.decode()
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return coords.map(({ x, y }) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * dpr)))
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * dpr)))
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(px, py, 1, 1).data
      return { r, g, b, a }
    })
  }, { imageUrl: url, coords: points })
}

const mount = async (page: Page, scenario: AmbientEdgeScenario) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  const host = page.locator(`[data-ambient-edges-harness="${scenario.mode}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, config]) => {
        const mod = await import(path) as typeof import('./fixtures/ambient-edges-harness')
        mod.mountAmbientEdges(config)
      }, [HARNESS, scenario] as const)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const bars = host.locator('[data-ambient-bars]')
  await expect(bars).toHaveAttribute('data-active', 'true', { timeout: 20_000 })
  await page.waitForTimeout(350)
  return host
}

test('pillarboxed theater bars mirror the left and right video edges instead of interior center colors', async ({ page }) => {
  const host = await mount(page, {
    mode: 'pillarbox',
    containerWidth: 1200,
    containerHeight: 450,
    videoWidth: 640,
    videoHeight: 360,
    orientation: 'vertical',
    bands: [
      { color: '#f5d000', from: 0, to: 0.1 },
      { color: '#1040e0', from: 0.1, to: 0.9 },
      { color: '#00c853', from: 0.9, to: 1 },
    ],
  })

  const canvasScales = await page.evaluate(() => [...document.querySelectorAll('[data-ambient-glow] canvas, [data-ambient-bars] canvas')]
    .map((canvas) => {
      const transform = getComputedStyle(canvas).transform
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      return [matrix.a, matrix.d]
    }))
  expect(canvasScales).toEqual([[1, 1], [1, 1]])

  // Video is 16:9 inside 1200x450 -> rendered video is 800x450 centered at x = +200..+1000.
  const box = (await host.locator('[data-player-root]').boundingBox())!
  const midY = Math.round(box.y + box.height * 0.5)
  const leftMid = { x: Math.round(box.x + 100), y: midY }
  const leftNearEdge = { x: Math.round(box.x + 188), y: midY }
  const rightNearEdge = { x: Math.round(box.x + box.width - 188), y: midY }
  const rightMid = { x: Math.round(box.x + box.width - 100), y: midY }

  const [lm, ln, rn, rm] = await sampleClipPixels(page, [leftMid, leftNearEdge, rightNearEdge, rightMid])

  for (const pixel of [lm!, ln!]) {
    expect(pixel.r, `expected yellow on left bar, got ${JSON.stringify(pixel)}`).toBeGreaterThan(160)
    expect(pixel.g, `expected yellow on left bar, got ${JSON.stringify(pixel)}`).toBeGreaterThan(140)
    expect(pixel.b, `expected low blue on left bar, got ${JSON.stringify(pixel)}`).toBeLessThan(90)
  }

  for (const pixel of [rn!, rm!]) {
    expect(pixel.g, `expected green on right bar, got ${JSON.stringify(pixel)}`).toBeGreaterThan(140)
    expect(pixel.r, `expected low red on right bar, got ${JSON.stringify(pixel)}`).toBeLessThan(90)
    expect(pixel.b, `expected green not blue on right bar, got ${JSON.stringify(pixel)}`).toBeLessThan(120)
  }
})

test('letterboxed bars match top and bottom video edges without bleeding interior colors', async ({ page }) => {
  const host = await mount(page, {
    mode: 'letterbox',
    containerWidth: 640,
    containerHeight: 450,
    videoWidth: 640,
    videoHeight: 240,
    orientation: 'horizontal',
    bands: [
      { color: '#e53935', from: 0, to: 0.25 },
      { color: '#1040e0', from: 0.25, to: 0.75 },
      { color: '#00c853', from: 0.75, to: 1 },
    ],
  })

  // Video is 640x240 inside 640x450 -> top matte 0..105, bottom matte 345..450.
  const box = (await host.locator('[data-player-root]').boundingBox())!
  const midX = Math.round(box.x + box.width * 0.5)
  const topMid = { x: midX, y: Math.round(box.y + 52) }
  const topNearEdge = { x: midX, y: Math.round(box.y + 96) }
  const bottomNearEdge = { x: midX, y: Math.round(box.y + box.height - 96) }
  const bottomMid = { x: midX, y: Math.round(box.y + box.height - 52) }

  const [tm, tn, bn, bm] = await sampleClipPixels(page, [topMid, topNearEdge, bottomNearEdge, bottomMid])

  for (const pixel of [tm!, tn!]) {
    expect(pixel.r, `expected red on top bar, got ${JSON.stringify(pixel)}`).toBeGreaterThan(150)
    expect(pixel.g, `expected low green on top bar, got ${JSON.stringify(pixel)}`).toBeLessThan(95)
    expect(pixel.b, `expected low blue on top bar, got ${JSON.stringify(pixel)}`).toBeLessThan(95)
  }

  for (const pixel of [bn!, bm!]) {
    expect(pixel.g, `expected green on bottom bar, got ${JSON.stringify(pixel)}`).toBeGreaterThan(135)
    expect(pixel.r, `expected low red on bottom bar, got ${JSON.stringify(pixel)}`).toBeLessThan(95)
    expect(pixel.b, `expected green not blue on bottom bar, got ${JSON.stringify(pixel)}`).toBeLessThan(120)
  }
})
