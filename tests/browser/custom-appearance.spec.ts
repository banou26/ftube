import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

const srgbChannel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const contrastFromRgb = (fg: string, bg: string) => {
  const parse = (str: string) => {
    const m = str.match(/\d+/g) ?? ['0', '0', '0']
    const [r = 0, g = 0, b = 0] = m.map(Number)
    return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
  }
  const l1 = parse(fg)
  const l2 = parse(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

test('configures presets, WCAG-AA custom colors, emoji/icon seek handles, web app icon, and Reset to default', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/settings')
  const custom = page.locator('#custom-appearance')
  await expect(custom).toBeVisible()

  // 1. Preset selection applies CSS tokens and persists across reload
  await custom.getByRole('button', { name: 'Emerald' }).click()
  const accentSet = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim())
  expect(accentSet).not.toBe('')

  await page.reload()
  await expect(page.locator('#custom-appearance').getByRole('button', { name: 'Emerald' })).toHaveAttribute('aria-pressed', 'true')
  const persistedAccent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim())
  expect(persistedAccent).toBe(accentSet)

  // 2. Adversarial bright yellow custom hex meets WCAG AA contrast (>= 4.5) in both dark and light modes
  const hexInput = custom.getByLabel('Custom primary color hex')
  await hexInput.fill('#ffdd00')
  for (const mode of ['Dark', 'Light'] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        bg: style.getPropertyValue('--bg-base').trim(),
        text: style.getPropertyValue('--text-primary').trim(),
        accent: style.getPropertyValue('--accent').trim(),
      }
    })
    const probe = await page.evaluate(([accent, text, bg]) => {
      const el = document.createElement('div')
      el.style.color = accent
      el.style.backgroundColor = bg
      el.style.borderColor = text
      document.body.append(el)
      const cs = getComputedStyle(el)
      const result = { accent: cs.color, bg: cs.backgroundColor, text: cs.borderColor }
      el.remove()
      return result
    }, [colors.accent, colors.text, colors.bg] as const)
    expect(contrastFromRgb(probe.accent, probe.bg), `accent AA in ${mode}`).toBeGreaterThanOrEqual(4.5)
    expect(contrastFromRgb(probe.text, probe.bg), `text AAA in ${mode}`).toBeGreaterThanOrEqual(7.0)
  }

  // 3. Custom seek handle: Emoji then Lucide icon updates preview and Watch page knob
  await custom.getByRole('tab', { name: 'Emoji' }).click()
  await custom.getByRole('button', { name: 'Rocket', exact: false }).click()
  await expect(custom.locator('[data-seek-handle="emoji"]')).toContainText('🚀')

  await custom.getByRole('tab', { name: 'Icon' }).click()
  await custom.getByRole('button', { name: 'Star', exact: true }).click()
  await expect(custom.locator('[data-seek-handle="icon"] svg')).toBeVisible()

  // 4. Mobile web app icon updates favicon & webmanifest cleanly
  await custom.getByRole('button', { name: 'Theme icon' }).click()
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /^data:image\/svg\+xml/)
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /^blob:/)

  // Verify watch page player renders the custom seek handle
  await page.goto('/watch?v=dQw4w9WgXcQ')
  await expect(page.locator('.scrubber [data-seek-handle="icon"] svg')).toBeVisible({ timeout: 60_000 })

  // 5. Reset to default clears custom tokens, restores seek handle & original favicon/manifest
  await page.goto('/settings')
  await page.locator('#custom-appearance').getByRole('button', { name: 'Reset to default' }).click()
  const clearedAccent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))
  expect(clearedAccent).toBe('')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/app.webmanifest')
})

test('renders custom emoji and icon seek handles at rest inside Shorts stage', async ({ page }) => {
  test.setTimeout(180_000)
  const shortUrl = '/shorts/y2Vqj-59Hqc'

  await page.goto('/settings')
  const custom = page.locator('#custom-appearance')
  await expect(custom).toBeVisible()

  await custom.getByRole('tab', { name: 'Emoji' }).click()
  await custom.getByRole('button', { name: 'Rocket', exact: false }).click()
  await expect(custom.locator('[data-seek-handle="emoji"]')).toContainText('🚀')

  await page.goto(shortUrl)
  const stage = page.locator('[data-short-id="y2Vqj-59Hqc"] .stage')
  const emojiKnob = stage.locator('.scrubber [data-seek-handle="emoji"]')
  await expect(emojiKnob).toBeAttached({ timeout: 90_000 })
  await expect(emojiKnob).toBeVisible()
  await expect(emojiKnob).toContainText('🚀')
  // Wait long enough for any 0.12s transition to settle at rest without hovering
  await page.waitForTimeout(200)
  const [stageBox, emojiBox] = [await stage.boundingBox(), await emojiKnob.boundingBox()]
  expect(stageBox).toBeTruthy()
  expect(emojiBox).toBeTruthy()
  expect(emojiBox!.width).toBeGreaterThanOrEqual(12)
  expect(emojiBox!.height).toBeGreaterThanOrEqual(12)
  expect(emojiBox!.x).toBeGreaterThanOrEqual(stageBox!.x)
  expect(emojiBox!.x + emojiBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width)
  expect(emojiBox!.y).toBeGreaterThanOrEqual(stageBox!.y)
  expect(emojiBox!.y + emojiBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height)

  await page.goto('/settings')
  await custom.getByRole('tab', { name: 'Icon' }).click()
  await custom.getByRole('button', { name: 'Star', exact: true }).click()
  await expect(custom.locator('[data-seek-handle="icon"] svg')).toBeVisible()

  await page.goto(shortUrl)
  const iconKnob = stage.locator('.scrubber [data-seek-handle="icon"]')
  await expect(iconKnob.locator('svg')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(200)
  const [iconStageBox, iconBox] = [await stage.boundingBox(), await iconKnob.boundingBox()]
  expect(iconBox).toBeTruthy()
  expect(iconBox!.width).toBeGreaterThanOrEqual(12)
  expect(iconBox!.height).toBeGreaterThanOrEqual(12)
  expect(iconBox!.x).toBeGreaterThanOrEqual(iconStageBox!.x)
  expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(iconStageBox!.x + iconStageBox!.width)
  expect(iconBox!.y).toBeGreaterThanOrEqual(iconStageBox!.y)
  expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(iconStageBox!.y + iconStageBox!.height)

  // Default dot stays hidden at rest until hover
  await page.goto('/settings')
  await custom.getByRole('button', { name: 'Reset to default' }).click()
  await page.goto(shortUrl)
  const defaultKnob = stage.locator('.scrubber [data-seek-handle="default"]')
  await expect(defaultKnob).toBeAttached({ timeout: 90_000 })
  await page.waitForTimeout(200)
  const restBox = await defaultKnob.boundingBox()
  expect(restBox?.width ?? 0).toBe(0)
})

test('tints video card and compact card resume progress bars with the custom accent color', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings')
  await page.locator('#custom-appearance').getByRole('button', { name: 'Emerald' }).click()

  await page.goto('/privacy')
  await page.evaluate(async () => {
    const mod = await import('/tests/browser/fixtures/appearance-cards-harness.tsx') as { mountAppearanceCards: () => void }
    mod.mountAppearanceCards()
  })

  const gridFill = page.locator('[data-appearance-cards-harness] [data-card="grid"] .progress span')
  const compactFill = page.locator('[data-appearance-cards-harness] [data-card="compact"] .progress span')
  await expect(gridFill).toBeVisible()
  await expect(compactFill).toBeVisible()

  const expectedBrandRed = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--brand-red').trim()
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  })
  expect(expectedBrandRed).not.toBe('rgb(255, 0, 0)')
  await expect(gridFill).toHaveCSS('background-color', expectedBrandRed)
  await expect(compactFill).toHaveCSS('background-color', expectedBrandRed)

  await page.goto('/settings')
  await page.locator('#custom-appearance').getByRole('button', { name: 'Reset to default' }).click()
  await page.goto('/privacy')
  await page.evaluate(async () => {
    const mod = await import('/tests/browser/fixtures/appearance-cards-harness.tsx') as { mountAppearanceCards: () => void }
    mod.mountAppearanceCards()
  })
  await expect(gridFill).toHaveCSS('background-color', 'rgb(255, 0, 51)')
  await expect(compactFill).toHaveCSS('background-color', 'rgb(255, 0, 51)')
})

test('adapts inline SVG header logo colors to the selected custom accent with WCAG contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings')
  const custom = page.locator('#custom-appearance')
  await expect(custom).toBeVisible()

  const pill = page.locator('header svg.mark path').nth(0)
  const playTriangle = page.locator('header svg.mark path').nth(1)
  const chevron = page.locator('header svg.mark path').nth(2)

  await expect(pill).toHaveCSS('fill', 'rgb(255, 0, 0)')
  await expect(playTriangle).toHaveCSS('fill', 'rgb(255, 255, 255)')
  await expect(chevron).toHaveCSS('stroke', 'rgb(255, 255, 255)')

  await custom.getByRole('button', { name: 'Emerald' }).click()
  await expect(pill).not.toHaveCSS('fill', 'rgb(255, 0, 0)')
  const emeraldMark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-mark').trim())
  expect(emeraldMark).not.toBe('')

  await custom.getByLabel('Custom primary color hex').fill('#ffdd00')
  for (const mode of ['Dark', 'Light'] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const [pillFill, triangleFill, chevronStroke, bgRgb] = await page.evaluate(() => {
      const mark = document.querySelectorAll('header svg.mark path')
      const probe = document.createElement('div')
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim()
      document.body.append(probe)
      const bg = getComputedStyle(probe).backgroundColor
      probe.remove()
      return [
        getComputedStyle(mark[0]!).fill,
        getComputedStyle(mark[1]!).fill,
        getComputedStyle(mark[2]!).stroke,
        bg,
      ]
    })
    expect(contrastFromRgb(pillFill, bgRgb), `logo mark contrast in ${mode}`).toBeGreaterThanOrEqual(3.0)
    expect(contrastFromRgb(triangleFill, pillFill), `logo ink contrast in ${mode}`).toBeGreaterThanOrEqual(3.0)
    expect(chevronStroke, `chevron stroke matches ink in ${mode}`).toBe(triangleFill)
    if (mode === 'Dark') expect(triangleFill).toBe('rgb(15, 15, 15)')
  }

  await custom.getByRole('button', { name: 'Reset to default' }).click()
  await expect(pill).toHaveCSS('fill', 'rgb(255, 0, 0)')
  await expect(playTriangle).toHaveCSS('fill', 'rgb(255, 255, 255)')
  await expect(chevron).toHaveCSS('stroke', 'rgb(255, 255, 255)')
})
