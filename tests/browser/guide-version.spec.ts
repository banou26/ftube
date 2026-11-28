import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from './test'

const PKG_VERSION = (JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string }).version

test('shows the FTube semver version beside copyright in both desktop guide and mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/privacy')

  const guide = page.getByRole('navigation', { name: 'Guide', exact: true })
  const desktopCopy = guide.locator('.copyright')
  await expect(desktopCopy).toBeVisible()
  await expect(desktopCopy).toContainText('© 2026 FTube')
  const desktopVersion = desktopCopy.locator('[data-app-version]')
  await expect(desktopVersion).toBeVisible()
  await expect(desktopVersion).toHaveAttribute('data-app-version', PKG_VERSION)
  await expect(desktopVersion).toHaveText(`v${PKG_VERSION}`)
  expect(await desktopCopy.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Guide', exact: true })
  await expect(drawer).toBeVisible()
  const mobileCopy = drawer.locator('.copyright')
  await expect(mobileCopy).toBeVisible()
  await expect(mobileCopy).toContainText('© 2026 FTube')
  const mobileVersion = mobileCopy.locator('[data-app-version]')
  await expect(mobileVersion).toBeVisible()
  await expect(mobileVersion).toHaveAttribute('data-app-version', PKG_VERSION)
  await expect(mobileVersion).toHaveText(`v${PKG_VERSION}`)
  expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})
