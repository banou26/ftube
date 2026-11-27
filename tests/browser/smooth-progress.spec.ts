import { expect, hideFknNotice, test } from './test'

test('applies smooth scrubber transitions at rest, disables left delay while scrubbing, and honors prefers-reduced-motion', async ({ page }) => {
  test.setTimeout(120_000)
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const mod = await import(path) as {
      mountQualityHarness: (opts: { heights: number[], initialVideoHeight: number }) => void
    }
    mod.mountQualityHarness({ heights: [1080, 720], initialVideoHeight: 1080 })
  }, '/tests/browser/fixtures/quality-harness.tsx')

  const playerKnob = page.locator('[data-quality-harness] .scrubber .knob')
  const playerFill = page.locator('[data-quality-harness] .scrubber .played').first()
  await expect(playerKnob).toBeAttached({ timeout: 30_000 })

  const readTransitions = () => Promise.all([
    playerKnob.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { prop: cs.transitionProperty, duration: cs.transitionDuration }
    }),
    playerFill.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { prop: cs.transitionProperty, duration: cs.transitionDuration }
    }),
  ])

  const [restKnob, restFill] = await readTransitions()
  expect(restKnob.prop).toContain('left')
  expect(restKnob.prop).toContain('transform')
  expect(restFill.prop).toContain('width')

  // Dragging disables horizontal position lag immediately on both fill and knob.
  await page.evaluate(() => {
    document.querySelector('[data-quality-harness] .scrubber')?.classList.add('scrubbing')
  })
  const [dragKnob, dragFill] = await readTransitions()
  expect(dragKnob.prop).not.toContain('left')
  expect(dragFill.duration).toBe('0s')
  await page.evaluate(() => {
    document.querySelector('[data-quality-harness] .scrubber')?.classList.remove('scrubbing')
  })

  // Reduced motion turns transitions off cleanly.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => {
    const [reducedKnob, reducedFill] = await readTransitions()
    return { knobDuration: reducedKnob.duration, fillDuration: reducedFill.duration }
  }).toEqual({ knobDuration: '0s', fillDuration: '0s' })

  // HoverPreviewScrubber also honors smooth transitions and prefers-reduced-motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(async (path) => {
    const mod = await import(path) as { mountHoverSeekHandle: () => void }
    mod.mountHoverSeekHandle()
  }, '/tests/browser/fixtures/preview-harness.tsx')
  const previewKnob = page.locator('[data-previews="seek-video"] .scrubber .knob').first()
  await expect(previewKnob).toBeAttached({ timeout: 30_000 })
  const normalPreviewProp = await previewKnob.evaluate(el => getComputedStyle(el).transitionProperty)
  expect(normalPreviewProp).toContain('left')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() =>
    previewKnob.evaluate(el => getComputedStyle(el).transitionDuration),
  ).toBe('0s')
})
