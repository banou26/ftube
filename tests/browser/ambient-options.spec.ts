import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/ambient-edges-harness.tsx'
const SETTINGS_MOD = '/src/settings.ts'

test('configures ambient area, spread, and filling mode in Settings with persistence', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/settings?section=customization')

  const main = page.getByRole('main')
  const ambientCheckbox = main.getByRole('checkbox', { name: 'Ambient mode', exact: true })
  await expect(ambientCheckbox).toBeChecked()

  const areaGroup = main.getByRole('group', { name: 'Ambient area', exact: true })
  const fillGroup = main.getByRole('group', { name: 'Filling mode', exact: true })
  const spreadSlider = main.getByRole('slider', { name: 'Ambient spread', exact: true })
  await expect(areaGroup).toBeVisible()
  await expect(spreadSlider).toHaveValue('100')
  await expect(fillGroup).toBeVisible()

  await areaGroup.getByRole('button', { name: 'Full page', exact: true }).click()
  await main.getByRole('group', { name: 'Ambient spread presets', exact: true }).getByRole('button', { name: '150%', exact: true }).click()
  await fillGroup.getByRole('button', { name: 'Vivid', exact: true }).click()

  await expect(areaGroup.getByRole('button', { name: 'Full page', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(spreadSlider).toHaveValue('150')
  await expect(main.locator('[data-ambient-spread-value]')).toHaveText('150%')
  await expect(fillGroup.getByRole('button', { name: 'Vivid', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Toggling Ambient mode off hides the customization sub-options without erasing them.
  await ambientCheckbox.uncheck()
  await expect(areaGroup).toHaveCount(0)
  await expect(spreadSlider).toHaveCount(0)
  await expect(fillGroup).toHaveCount(0)

  await page.reload()
  await expect(ambientCheckbox).not.toBeChecked()
  await ambientCheckbox.check()
  await expect(areaGroup.getByRole('button', { name: 'Full page', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(spreadSlider).toHaveValue('150')
  await expect(fillGroup.getByRole('button', { name: 'Vivid', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('applies generous Shorts spread, rail layering, sides, top-bottom, vivid filter, and full-page fixed glow live', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')

  const mountPlacement = async (placement: 'watch' | 'shorts') => {
    const host = page.locator(`[data-ambient-options-harness="${placement}"]`)
    await expect(async () => {
      if (await host.count() === 0) {
        await page.evaluate(async ([path, targetPlacement]) => {
          const mod = await import(path) as typeof import('./fixtures/ambient-edges-harness')
          mod.mountAmbientOptionsHarness(targetPlacement)
        }, [HARNESS, placement] as const)
      }
      await expect(host).toBeAttached({ timeout: 5_000 })
    }).toPass({ timeout: 120_000 })
    return host
  }

  // Compare Watch vs Shorts default lateral spread outside stage box.
  const watchHost = await mountPlacement('watch')
  const watchDiff = await watchHost.evaluate((el) => {
    const stage = el.querySelector('[data-ambient-stage="watch"]')!.getBoundingClientRect()
    const glow = el.querySelector('[data-ambient-glow]')!.getBoundingClientRect()
    return stage.left - glow.left
  })

  const shortsHost = await mountPlacement('shorts')
  const shortsGlow = shortsHost.locator('[data-ambient-glow]')
  await expect(shortsGlow).toHaveAttribute('data-active', 'true')
  await expect(shortsGlow).toHaveAttribute('data-ambient-placement', 'shorts')

  const shortsMetrics = await shortsHost.evaluate((el) => {
    const stage = el.querySelector('[data-ambient-stage="shorts"]')!.getBoundingClientRect()
    const glow = el.querySelector('[data-ambient-glow]')!.getBoundingClientRect()
    const railBtn = el.querySelector('.rail-action')!
    const btnBox = railBtn.getBoundingClientRect()
    const hit = document.elementFromPoint(btnBox.left + btnBox.width / 2, btnBox.top + btnBox.height / 2)
    return {
      leftOutset: stage.left - glow.left,
      railAboveGlow: hit === railBtn,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })

  expect(shortsMetrics.leftOutset).toBeGreaterThan(watchDiff)
  expect(shortsMetrics.railAboveGlow).toBe(true)
  expect(shortsMetrics.overflow).toBe(false)

  // Live setting changes update spread, area, full-page fixed positioning, and vivid filter without reload.
  await page.evaluate(async (path) => {
    const settingsMod = await import(path) as typeof import('../../src/settings')
    settingsMod.updateSettings({ ambientArea: 'sides', ambientSpread: 180, ambientFillMode: 'vivid' })
  }, SETTINGS_MOD)
  await expect(shortsGlow).toHaveAttribute('data-ambient-area', 'sides')
  await expect(shortsGlow).toHaveAttribute('data-ambient-spread', '180')
  await expect(shortsGlow).toHaveAttribute('data-ambient-fill-mode', 'vivid')

  const sidesCanvasFilter = await shortsGlow.locator('canvas').evaluate(el => getComputedStyle(el).filter)
  expect(sidesCanvasFilter).toContain('saturate(2.2)')

  await page.evaluate(async (path) => {
    const settingsMod = await import(path) as typeof import('../../src/settings')
    settingsMod.updateSettings({ ambientArea: 'full-page', ambientFillMode: 'average' })
  }, SETTINGS_MOD)
  await expect(shortsGlow).toHaveAttribute('data-ambient-area', 'full-page')
  await expect(shortsGlow).toHaveAttribute('data-ambient-fill-mode', 'average')
  const fixedPos = await shortsGlow.evaluate((el) => {
    const style = getComputedStyle(el)
    return { position: style.position, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) }
  })
  expect(fixedPos.position).toBe('fixed')
  expect(fixedPos.width).toBeGreaterThanOrEqual(1278)
  expect(fixedPos.height).toBeGreaterThanOrEqual(798)
})
