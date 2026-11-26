import { expect, test } from './test'

test.use({ viewport: { width: 1280, height: 800 } })

const HARNESS = '/tests/browser/fixtures/annotations-harness.tsx'

test('renders icons, pill toggle switches, right chevrons, and dark glass surface in Player settings', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')

  const harness = page.locator('[data-annotations-harness]')
  await expect(async () => {
    if (await harness.count() === 0) {
      await page.evaluate(async (path) => {
        const mod = await import(path) as typeof import('./fixtures/annotations-harness')
        mod.mountAnnotationsHarness()
      }, HARNESS)
    }
    await expect(harness.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  await harness.getByRole('button', { name: 'Settings', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Player settings' })
  await expect(menu).toBeVisible()

  const panelBg = await menu.evaluate(el => getComputedStyle(el).backgroundColor)
  expect(panelBg).toMatch(/^rgba\(28,\s*28,\s*28,/)

  const rows = menu.locator('> button')
  const rowCount = await rows.count()
  expect(rowCount).toBeGreaterThanOrEqual(6)
  for (let i = 0; i < rowCount; i++) {
    await expect(rows.nth(i).locator('svg').first()).toBeVisible()
  }

  const checkboxes = menu.getByRole('menuitemcheckbox')
  const checkCount = await checkboxes.count()
  expect(checkCount).toBeGreaterThanOrEqual(2)
  for (let i = 0; i < checkCount; i++) {
    const row = checkboxes.nth(i)
    await expect(row.locator('.menu-switch')).toBeVisible()
    await expect(row.locator('.menu-switch-thumb')).toBeVisible()
    const detailWidth = await row.locator('.detail').evaluate(el => el.getBoundingClientRect().width)
    expect(detailWidth).toBeLessThanOrEqual(2)
  }

  const ambientRow = menu.getByRole('menuitemcheckbox', { name: /^Ambient mode/ })
  const onX = await ambientRow.locator('.menu-switch-thumb').evaluate(el => el.getBoundingClientRect().x)
  await ambientRow.click()
  await expect(ambientRow).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() =>
    ambientRow.locator('.menu-switch-thumb').evaluate(el => el.getBoundingClientRect().x),
  ).toBeLessThan(onX)

  const submenuRows = menu.getByRole('menuitem')
  const submenuCount = await submenuRows.count()
  expect(submenuCount).toBe(4)
  for (let i = 0; i < submenuCount; i++) {
    await expect(submenuRows.nth(i).locator('svg.menu-chevron')).toBeVisible()
  }
})
