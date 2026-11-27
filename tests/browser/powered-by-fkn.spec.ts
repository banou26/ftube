import { expect, test } from './test'

const resolvedTokenRgb = async (page: import('@playwright/test').Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, token)

test('displays Powered by FKN badge beside FTube header logo with themed popover and phone hiding', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings?tab=appearance')

  const header = page.locator('header')
  const logo = header.getByRole('link', { name: 'FTube home', exact: true })
  const poweredButton = header.getByRole('button', { name: 'Powered by FKN', exact: true })
  await expect(logo).toBeVisible()
  await expect(poweredButton).toBeVisible()
  await expect(poweredButton).toHaveAttribute('aria-expanded', 'false')

  const [logoBox, poweredBox] = [await logo.boundingBox(), await poweredButton.boundingBox()]
  expect(logoBox).toBeTruthy()
  expect(poweredBox).toBeTruthy()
  expect(poweredBox!.x).toBeGreaterThan(logoBox!.x + logoBox!.width)
  expect(Math.abs(poweredBox!.y + poweredBox!.height / 2 - (logoBox!.y + logoBox!.height / 2))).toBeLessThan(8)

  await poweredButton.click()
  await expect(poweredButton).toHaveAttribute('aria-expanded', 'true')
  const popover = page.getByRole('group', { name: 'Powered by FKN' })
  await expect(popover).toBeVisible()
  const docsLink = popover.getByRole('link', { name: 'How it works', exact: true })
  await expect(docsLink).toHaveAttribute('href', 'https://docs.fkn.dev/user/')
  await expect(docsLink).toHaveAttribute('target', '_blank')
  await expect(docsLink).toHaveAttribute('rel', 'noreferrer')

  // Matches dark, light, and custom themes via --bg-menu
  const darkBg = await resolvedTokenRgb(page, '--bg-menu')
  await expect(popover.locator('> div')).toHaveCSS('background-color', darkBg)

  await page.locator('#custom-appearance').getByRole('button', { name: 'Emerald' }).click()
  const emeraldBg = await resolvedTokenRgb(page, '--bg-menu')
  expect(emeraldBg).not.toBe(darkBg)
  await poweredButton.click()
  await expect(popover).toBeVisible()
  await expect(popover.locator('> div')).toHaveCSS('background-color', emeraldBg)

  await page.getByRole('button', { name: 'Light', exact: true }).click()
  const lightBg = await resolvedTokenRgb(page, '--bg-menu')
  expect(lightBg).not.toBe(emeraldBg)
  await poweredButton.click()
  await expect(popover).toBeVisible()
  await expect(popover.locator('> div')).toHaveCSS('background-color', lightBg)

  await poweredButton.focus()
  await page.keyboard.press('Escape')
  await expect(poweredButton).toHaveAttribute('aria-expanded', 'false')
  await expect(popover).toBeHidden()

  // Hides cleanly at narrow phone widths
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(poweredButton).toBeHidden()
  }
})
