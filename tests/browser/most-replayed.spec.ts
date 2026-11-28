import type { Page } from '@playwright/test'
import type { MostReplayedHarnessOptions } from './fixtures/most-replayed-harness'

import { answerLookups, dismissFknNotice, expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/most-replayed-harness.tsx'

const openPlayerTab = async (page: Page) => {
  await page.goto('/settings')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Customization', exact: true }).click()
  await page.getByRole('tab', { name: 'Player', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=customization&tab=player$/)
  return page.getByRole('region', { name: 'Player customization' })
}

const mountHarness = async (page: Page, options: MostReplayedHarnessOptions = {}, stayOnPage = false) => {
  if (!stayOnPage) await page.goto('/privacy')
  await page.evaluate(async ([path, opts]) => {
    const mod = await import(path) as typeof import('./fixtures/most-replayed-harness')
    const api = mod.mountMostReplayedHarness(opts)
    ;(window as unknown as { __mostReplayedHarness?: typeof api }).__mostReplayedHarness = api
  }, [HARNESS, options] as const)
  const player = page.locator('[data-most-replayed-harness]')
  await expect(player.locator('.scrubber')).toBeAttached()
  return player
}

const readCurrentTime = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mostReplayedHarness: { currentTime: () => number } }).__mostReplayedHarness.currentTime())

test('defaults off in Settings -> Customization second tab, applies immediately, and persists across reload and videos', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const section = await openPlayerTab(page)
  const toggle = section.getByRole('checkbox', { name: 'Show most replayed moments', exact: true })
  await expect(toggle).not.toBeChecked()

  // With toggle off, hovering the seek bar keeps heatmap absent
  const playerOff = await mountHarness(page, { videoId: 'video-off', mode: 'valid' })
  const offBox = (await playerOff.locator('.scrubber').boundingBox())!
  await page.mouse.move(offBox.x + offBox.width * 0.5, offBox.y + offBox.height / 2)
  await expect(playerOff.locator('[data-most-replayed]')).toHaveCount(0)

  // Turn toggle on at mobile width and verify persistence across reload
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileSection = await openPlayerTab(page)
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    { message: 'no horizontal overflow at 390px on Player customization tab' },
  ).toBe(true)
  await mobileSection.getByRole('checkbox', { name: 'Show most replayed moments', exact: true }).check()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Show most replayed moments', exact: true })).toBeChecked()

  // Persists across videos A and B
  await page.setViewportSize({ width: 1280, height: 800 })
  const vidA = await mountHarness(page, { videoId: 'video-a', mode: 'valid' })
  await expect(vidA.locator('[data-most-replayed="true"]')).toHaveCount(1)

  const vidB = await mountHarness(page, { videoId: 'video-b', mode: 'valid' }, true)
  const boxB = (await vidB.locator('.scrubber').boundingBox())!
  await page.mouse.move(boxB.x + boxB.width * 0.7, boxB.y + boxB.height / 2)
  await expect(vidB.locator('[data-most-replayed="true"]')).toHaveAttribute('data-heatmap-visible', 'true')
})

test('reveals aligned heatmap on desktop hover and scrub with peak heights, hides when idle, and preserves seeking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const section = await openPlayerTab(page)
  await section.getByRole('checkbox', { name: 'Show most replayed moments', exact: true }).check()

  const player = await mountHarness(page, { videoId: 'video-desktop', mode: 'valid', paused: false, initialVisible: true })
  const heatmap = player.locator('[data-most-replayed="true"]')
  const scrubber = player.locator('.scrubber')
  const rail = player.locator('.rail')

  // Hidden during idle playback even when controls are visible
  await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')
  await expect(heatmap).toHaveCSS('opacity', '0')

  // Desktop hover reveals the heatmap aligned above the seek rail
  const scrubberBox = (await scrubber.boundingBox())!
  await page.mouse.move(scrubberBox.x + scrubberBox.width * 0.5, scrubberBox.y + scrubberBox.height / 2)
  await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'true')
  await expect(heatmap).toHaveCSS('opacity', '1')

  const [railBox, heatmapBox] = [await rail.boundingBox(), await heatmap.boundingBox()]
  expect(railBox).toBeTruthy()
  expect(heatmapBox).toBeTruthy()
  expect(Math.abs(heatmapBox!.x - railBox!.x)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(heatmapBox!.width - railBox!.width)).toBeLessThanOrEqual(1.5)
  expect(heatmapBox!.y + heatmapBox!.height).toBeLessThanOrEqual(railBox!.y + 2)

  // Verify curve peak near 70% timeline (x ~ 700) rises strictly higher (smaller SVG y) than low region near 20% (x ~ 200)
  const peakCheck = await heatmap.locator('path.heatmap-stroke').evaluate((pathEl) => {
    const path = pathEl as SVGPathElement
    const totalLen = path.getTotalLength()
    const samples: { x: number, y: number }[] = []
    for (let i = 0; i <= 200; i++) {
      const pt = path.getPointAtLength((totalLen * i) / 200)
      samples.push({ x: pt.x, y: pt.y })
    }
    const yAt = (targetX: number) =>
      samples.reduce((best, cur) => (Math.abs(cur.x - targetX) < Math.abs(best.x - targetX) ? cur : best)).y
    return { yLow: yAt(200), yPeak: yAt(710) }
  })
  expect(peakCheck.yPeak).toBeLessThan(peakCheck.yLow - 25)

  // Leaving seek bar hides heatmap
  const playerBox = (await player.boundingBox())!
  await page.mouse.move(playerBox.x + 40, playerBox.y + 40)
  await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')
  await expect(heatmap).toHaveCSS('opacity', '0')

  // Clicking the seek bar still seeks accurately
  await page.mouse.click(scrubberBox.x + scrubberBox.width * 0.3, scrubberBox.y + scrubberBox.height / 2)
  expect(await readCurrentTime(page)).toBeCloseTo(30, 0)

  // Dragging across seek bar keeps heatmap visible and hides when released outside the seek bar
  await page.mouse.move(scrubberBox.x + scrubberBox.width * 0.25, scrubberBox.y + scrubberBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(scrubberBox.x + scrubberBox.width * 0.65, scrubberBox.y + scrubberBox.height / 2, { steps: 4 })
  await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'true')
  await page.mouse.move(scrubberBox.x + scrubberBox.width * 0.65, playerBox.y + 20)
  await page.mouse.up()
  expect(await readCurrentTime(page)).toBeCloseTo(65, 0)
  await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')
})

test('keeps heatmap hidden on touch tap to reveal controls, reveals during touch scrub, and hides on end or cancel', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await answerLookups(context)
  const page = await context.newPage()
  await dismissFknNotice(page)
  try {
    await page.addInitScript(() => {
      if (window !== top) return
      localStorage.setItem('yt-client:settings', JSON.stringify({ showMostReplayed: true }))
    })
    const player = await mountHarness(page, {
      videoId: 'video-touch',
      mode: 'valid',
      paused: false,
      initialVisible: false,
      width: 390,
    })

    const surface = player.locator('video')
    const controls = player.locator('[aria-label="Seek"]').locator('..')
    const scrubber = player.locator('.scrubber')
    const heatmap = player.locator('[data-most-replayed="true"]')
    const surfaceBox = (await surface.boundingBox())!

    // Tapping the video reveals controls without showing the heatmap
    await page.touchscreen.tap(surfaceBox.x + surfaceBox.width / 2, surfaceBox.y + 60)
    await expect(controls).toHaveClass(/visible/)
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')

    const scrubberBox = (await scrubber.boundingBox())!
    const y = scrubberBox.y + scrubberBox.height / 2

    // Touch scrub start -> heatmap appears; drag -> stays visible; end -> seeks & hides
    await scrubber.evaluate((el, coords) => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', button: 0,
        clientX: coords.startX, clientY: coords.y,
      }))
    }, { startX: scrubberBox.x + scrubberBox.width * 0.25, y })
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'true')

    await scrubber.evaluate((el, coords) => {
      el.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
        clientX: coords.targetX, clientY: coords.y,
      }))
    }, { targetX: scrubberBox.x + scrubberBox.width * 0.6, y })
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'true')

    await scrubber.evaluate((el, coords) => {
      el.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', button: 0,
        clientX: coords.targetX, clientY: coords.y,
      }))
    }, { targetX: scrubberBox.x + scrubberBox.width * 0.6, y })
    expect(await readCurrentTime(page)).toBeCloseTo(60, 0)
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')

    // Touch scrub cancel hides heatmap cleanly without leaving sticky hover
    await scrubber.evaluate((el, coords) => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', button: 0,
        clientX: coords.startX, clientY: coords.y,
      }))
    }, { startX: scrubberBox.x + scrubberBox.width * 0.3, y })
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'true')

    await scrubber.evaluate((el, coords) => {
      el.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch',
        clientX: coords.startX, clientY: coords.y,
      }))
    }, { startX: scrubberBox.x + scrubberBox.width * 0.3, y })
    await expect(heatmap).toHaveAttribute('data-heatmap-visible', 'false')
  } finally {
    await context.close()
  }
})

test('falls back to the standard seek bar when replay data is missing, empty, invalid, or live', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  await page.setViewportSize({ width: 1280, height: 800 })
  const section = await openPlayerTab(page)
  await section.getByRole('checkbox', { name: 'Show most replayed moments', exact: true }).check()

  for (const mode of ['empty', 'invalid'] as const) {
    const player = await mountHarness(page, { videoId: `video-${mode}`, mode })
    const scrubber = player.locator('.scrubber')
    const box = (await scrubber.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
    await expect(player.locator('[data-most-replayed]')).toHaveCount(0)
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2)
    expect(await readCurrentTime(page)).toBeCloseTo(40, 0)
  }

  const livePlayer = await mountHarness(page, { videoId: 'video-live', mode: 'valid', isLive: true })
  const liveBox = (await livePlayer.locator('.scrubber').boundingBox())!
  await page.mouse.move(liveBox.x + liveBox.width * 0.5, liveBox.y + liveBox.height / 2)
  await expect(livePlayer.locator('[data-most-replayed]')).toHaveCount(0)
  expect(errors).toEqual([])
})
