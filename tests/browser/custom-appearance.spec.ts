import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

const srgbChannel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const relativeLuminance = (str: string) => {
  const m = str.match(/[\d.]+/g) ?? ['0', '0', '0']
  const [r = 0, g = 0, b = 0] = m.map(Number)
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

const contrastFromRgb = (fg: string, bg: string) => {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const openAppearanceTab = async (page: import('@playwright/test').Page) => {
  await page.goto('/settings')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Customization', exact: true }).click()
  const custom = page.locator('#custom-appearance')
  await expect(custom).toBeVisible()
  return custom
}

test('configures presets, WCAG-AA custom colors, emoji/icon seek handles, web app icon, and Reset to default', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  const custom = await openAppearanceTab(page)

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
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    try {
      const manifest = await cdp.send('Page.getAppManifest')
      expect(manifest.errors).toEqual([])
      expect(manifest.url).toMatch(/^blob:/)
      const parsed = manifest.data ? JSON.parse(manifest.data) as { icons?: { src?: string }[] } : undefined
      expect(parsed?.icons?.length ?? 0).toBeGreaterThan(0)
      expect(parsed?.icons?.some(icon => icon.src?.startsWith('data:image/'))).toBe(true)

      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
      const manifestErrors = installabilityErrors.filter(entry => /manifest|icon|start-url/i.test(entry.errorId))
      expect(manifestErrors).toEqual([])
    } finally {
      await cdp.detach()
    }
  }

  // Verify watch page player renders the custom seek handle
  await page.goto('/watch?v=dQw4w9WgXcQ')
  await expect(page.locator('.scrubber [data-seek-handle="icon"] svg')).toBeVisible({ timeout: 60_000 })

  // 5. Reset to default clears custom tokens, restores seek handle & original favicon/manifest
  await openAppearanceTab(page)
  await page.locator('#custom-appearance').getByRole('button', { name: 'Reset to default' }).click()
  const clearedAccent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))
  expect(clearedAccent).toBe('')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/app.webmanifest')
})

test('renders custom emoji and icon seek handles at rest inside Shorts stage', async ({ page }) => {
  test.setTimeout(180_000)
  const shortUrl = '/shorts/y2Vqj-59Hqc'

  const custom = await openAppearanceTab(page)

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

  await openAppearanceTab(page)
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
  await openAppearanceTab(page)
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
  await openAppearanceTab(page)
  await page.locator('#custom-appearance').getByRole('button', { name: 'Emerald' }).click()

  const harness = '/tests/browser/fixtures/appearance-cards-harness.tsx'
  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const mod = await import(path) as { mountAppearanceCards: () => void }
    mod.mountAppearanceCards()
  }, harness)

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

  await openAppearanceTab(page)
  await page.locator('#custom-appearance').getByRole('button', { name: 'Reset to default' }).click()
  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const mod = await import(path) as { mountAppearanceCards: () => void }
    mod.mountAppearanceCards()
  }, harness)
  await expect(gridFill).toHaveCSS('background-color', 'rgb(255, 0, 51)')
  await expect(compactFill).toHaveCSS('background-color', 'rgb(255, 0, 51)')
})

test('adapts inline SVG header logo colors to the selected custom accent with WCAG contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const custom = await openAppearanceTab(page)

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

test('adapts settings accent preview player to light, dark, and live device color schemes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const custom = await openAppearanceTab(page)
  const previewPlayer = custom.locator('.preview-player')
  const previewPlayed = custom.locator('.preview-played')
  const previewTrack = custom.locator('.preview-track')
  const previewMeta = custom.locator('.preview-meta')
  const previewCta = custom.locator('.preview-cta')
  await expect(previewPlayer).toBeVisible()

  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(previewMeta).toContainText('(light)')
  const defaultLightBg = await previewPlayer.evaluate(el => getComputedStyle(el).backgroundColor)
  expect(defaultLightBg).not.toBe('rgb(24, 24, 24)')
  expect(relativeLuminance(defaultLightBg)).toBeGreaterThan(0.6)
  const lightTrackBg = await previewTrack.evaluate(el => getComputedStyle(el).backgroundColor)
  expect(lightTrackBg).not.toBe('rgba(255, 255, 255, 0.28)')

  const defaultPlayedBg = await previewPlayed.evaluate(el => getComputedStyle(el).backgroundColor)
  const defaultCtaColor = await previewCta.evaluate(el => getComputedStyle(el).color)

  await custom.getByRole('button', { name: 'Violet', exact: true }).click()
  const violetLightBg = await previewPlayer.evaluate(el => getComputedStyle(el).backgroundColor)
  const violetPlayedBg = await previewPlayed.evaluate(el => getComputedStyle(el).backgroundColor)
  const violetCtaColor = await previewCta.evaluate(el => getComputedStyle(el).color)
  expect(relativeLuminance(violetLightBg)).toBeGreaterThan(0.6)
  expect(violetLightBg).not.toBe(defaultLightBg)
  expect(violetPlayedBg).not.toBe(defaultPlayedBg)
  expect(violetCtaColor).not.toBe(defaultCtaColor)

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(previewMeta).toContainText('(dark)')
  const violetDarkBg = await previewPlayer.evaluate(el => getComputedStyle(el).backgroundColor)
  expect(relativeLuminance(violetDarkBg)).toBeLessThan(0.25)

  await page.getByRole('button', { name: 'Device theme', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(previewMeta).toContainText('(light)')
  expect(relativeLuminance(await previewPlayer.evaluate(el => getComputedStyle(el).backgroundColor))).toBeGreaterThan(0.6)

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(previewMeta).toContainText('(dark)')
  expect(relativeLuminance(await previewPlayer.evaluate(el => getComputedStyle(el).backgroundColor))).toBeLessThan(0.25)

  await custom.getByRole('button', { name: 'Reset to default' }).click()
})

test('refreshes the browser favicon immediately when picking a custom theme accent', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  const custom = await openAppearanceTab(page)

  const svgIcon = page.locator('link[rel="icon"][type="image/svg+xml"]')
  const fallbackIcon = page.locator('link[rel="icon"]:not([type="image/svg+xml"])')

  const readAlignedMarks = async () => page.evaluate(async () => {
    const readPaths = (root: ParentNode) => {
      const paths = [...root.querySelectorAll('path')]
      const p0 = getComputedStyle(paths[0]!)
      const p1 = getComputedStyle(paths[1]!)
      const p2 = getComputedStyle(paths[2]!)
      return {
        pillFill: p0.fill,
        pillStroke: p0.stroke,
        playFill: p1.fill,
        chevronStroke: p2.stroke,
        chevronOpacity: p2.opacity,
        d: paths.map(p => p.getAttribute('d')),
      }
    }
    const header = readPaths(document.querySelector('header svg.mark')!)
    const preview = readPaths(document.querySelector('#custom-appearance .preview-brand-mark')!)
    const href = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')?.getAttribute('href') ?? ''
    const svgText = href.startsWith('data:image/svg+xml')
      ? decodeURIComponent(href.slice(href.indexOf(',') + 1))
      : await fetch(href).then(r => r.text())
    const scratch = document.createElement('div')
    scratch.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none'
    scratch.innerHTML = svgText
    document.body.append(scratch)
    const favicon = readPaths(scratch.querySelector('svg')!)
    scratch.remove()
    const badge = getComputedStyle(document.querySelector('#custom-appearance .preview-badge')!)
    const rootStyle = getComputedStyle(document.documentElement)
    return {
      header,
      preview,
      favicon,
      href,
      badge: { color: badge.color, bg: badge.backgroundColor },
      brandMark: rootStyle.getPropertyValue('--brand-mark').trim(),
      brandMarkInk: rootStyle.getPropertyValue('--brand-mark-ink').trim(),
    }
  })

  // With no custom color, all icon modes stay aligned with the favicon and leave --brand-mark* / .preview-badge readable.
  for (const iconLabel of ['Classic icon', 'Dark icon', 'Light icon', 'Theme icon'] as const) {
    await custom.getByRole('button', { name: iconLabel, exact: true }).click()
    const aligned = await readAlignedMarks()
    expect(aligned.header, `default ${iconLabel} header vs favicon`).toEqual(aligned.favicon)
    expect(aligned.preview, `default ${iconLabel} preview vs favicon`).toEqual(aligned.favicon)
    expect(aligned.brandMark, `default ${iconLabel} --brand-mark untouched`).toBe('#ff0000')
    expect(aligned.brandMarkInk, `default ${iconLabel} --brand-mark-ink untouched`).toBe('#ffffff')
    expect(aligned.badge.color, `default ${iconLabel} badge ink`).toBe('rgb(255, 255, 255)')
    expect(contrastFromRgb(aligned.badge.color, aligned.badge.bg), `default ${iconLabel} badge contrast`).toBeGreaterThanOrEqual(3.5)
    if (iconLabel === 'Theme icon') {
      expect(aligned.favicon.pillFill).toBe('rgb(255, 0, 0)')
      expect(aligned.favicon.playFill).toBe('rgb(255, 255, 255)')
    }
  }

  await custom.getByRole('button', { name: 'Ocean', exact: true }).click()
  for (const mode of ['Dark', 'Light'] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const ocean = await readAlignedMarks()
    expect(ocean.href).toMatch(/data:image\/svg\+xml/i)
    expect(ocean.header).toEqual(ocean.favicon)
    expect(ocean.preview).toEqual(ocean.favicon)
    expect(ocean.favicon.pillFill).toBe('rgb(37, 99, 235)')
    expect(ocean.favicon.playFill).toBe('rgb(255, 255, 255)')
    expect(ocean.favicon.chevronStroke).toBe('rgb(255, 255, 255)')
  }

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await custom.getByRole('button', { name: 'Emerald', exact: true }).click()
  await expect(svgIcon).toHaveAttribute('href', /data:image\/svg\+xml.*%2310b981/i)
  await expect(fallbackIcon).not.toHaveAttribute('href', '/favicon.ico')
  const emeraldDark = await readAlignedMarks()
  expect(emeraldDark.header).toEqual(emeraldDark.favicon)
  expect(emeraldDark.preview).toEqual(emeraldDark.favicon)

  const hexInput = custom.getByLabel('Custom primary color hex')
  await hexInput.fill('#ffdd00')
  const yellow = await readAlignedMarks()
  expect(yellow.header).toEqual(yellow.favicon)
  expect(yellow.preview).toEqual(yellow.favicon)

  await hexInput.fill('#2563eb')
  await expect(svgIcon).toHaveAttribute('href', /data:image\/svg\+xml.*%232563eb/i)

  for (const iconLabel of ['Dark icon', 'Light icon', 'Classic icon'] as const) {
    await custom.getByRole('button', { name: iconLabel, exact: true }).click()
    const aligned = await readAlignedMarks()
    expect(aligned.header, `${iconLabel} header vs favicon`).toEqual(aligned.favicon)
    expect(aligned.preview, `${iconLabel} preview vs favicon`).toEqual(aligned.favicon)
    expect(aligned.brandMark, `${iconLabel} keeps palette --brand-mark`).toBe('#2563eb')
    expect(aligned.brandMarkInk, `${iconLabel} keeps palette --brand-mark-ink`).toBe('#ffffff')
    expect(aligned.badge.color, `${iconLabel} badge ink`).toBe('rgb(255, 255, 255)')
    expect(contrastFromRgb(aligned.badge.color, aligned.badge.bg), `${iconLabel} badge contrast`).toBeGreaterThanOrEqual(3.5)
  }
  await expect(svgIcon).toHaveAttribute('href', '/favicon.svg')
  await expect(fallbackIcon).toHaveAttribute('href', '/favicon.ico')

  await custom.getByRole('button', { name: 'Reset to default', exact: true }).click()
  await expect(svgIcon).toHaveAttribute('href', '/favicon.svg')
  await expect(fallbackIcon).toHaveAttribute('href', '/favicon.ico')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/app.webmanifest')
  const reset = await readAlignedMarks()
  expect(reset.header).toEqual(reset.favicon)
  expect(reset.preview).toEqual(reset.favicon)
})

test('organizes Settings into side-menu sections and previews all accent-affected UI elements in Customization', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings')

  const main = page.getByRole('main')
  const nav = main.getByRole('navigation', { name: 'Settings' })
  const generalNav = nav.getByRole('button', { name: 'General', exact: true })
  const customizationNav = nav.getByRole('button', { name: 'Customization', exact: true })
  await expect(generalNav).toHaveAttribute('aria-current', 'page')
  await expect(customizationNav).not.toHaveAttribute('aria-current', 'page')

  await expect(main.getByRole('checkbox', { name: 'Hide Shorts', exact: true })).toBeVisible()
  await expect(main.locator('#custom-appearance')).toBeHidden()
  await expect(main.getByRole('button', { name: 'Device theme', exact: true })).toBeHidden()
  await expect(main.getByRole('checkbox', { name: 'Ambient mode', exact: true })).toBeHidden()

  await customizationNav.click()
  await expect(customizationNav).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/settings\?section=customization$/)
  await expect(main.getByRole('button', { name: 'Device theme', exact: true })).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Ambient mode', exact: true })).toHaveCount(0)
  await expect(main.getByRole('checkbox', { name: 'Hide Shorts', exact: true })).toBeHidden()

  const custom = main.locator('#custom-appearance')
  await expect(custom).toBeVisible()

  // Persistence across reload while on Customization section
  await page.reload()
  await expect(nav.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(main.locator('#custom-appearance')).toBeVisible()

  const brandMark = custom.locator('.preview-brand-mark path').first()
  const previewSearch = custom.locator('.preview-search')
  const previewBadge = custom.locator('.preview-badge')
  const previewNavActive = custom.locator('.preview-nav-active')
  const previewCta = custom.locator('.preview-cta')
  const previewLink = custom.locator('.preview-link')
  const previewCheck = custom.locator('.preview-check')
  const previewPlayed = custom.locator('.preview-played')

  for (const el of [brandMark, previewSearch, previewBadge, previewNavActive, previewCta, previewLink, previewCheck, previewPlayed]) {
    await expect(el).toBeVisible()
  }

  const readColors = () => page.evaluate(() => {
    const pick = (selector: string) => {
      const node = document.querySelector(selector)!
      const cs = getComputedStyle(node)
      return {
        color: cs.color,
        bg: cs.backgroundColor,
        border: cs.borderColor,
        fill: cs.fill,
      }
    }
    return {
      brandMarkFill: pick('#custom-appearance .preview-brand-mark path').fill,
      searchBorder: pick('#custom-appearance .preview-search').border,
      badgeBg: pick('#custom-appearance .preview-badge').bg,
      navBg: pick('#custom-appearance .preview-nav-active').bg,
      ctaBg: pick('#custom-appearance .preview-cta').bg,
      ctaColor: pick('#custom-appearance .preview-cta').color,
      linkColor: pick('#custom-appearance .preview-link').color,
      checkBg: pick('#custom-appearance .preview-check').bg,
      playedBg: pick('#custom-appearance .preview-played').bg,
    }
  })

  for (const mode of ['Dark', 'Light'] as const) {
    await main.getByRole('button', { name: mode, exact: true }).click()
    await custom.getByRole('button', { name: 'Default', exact: true }).click()
    const base = await readColors()

    await custom.getByRole('button', { name: 'Emerald', exact: true }).click()
    const emerald = await readColors()

    expect(emerald.brandMarkFill, `brandMark in ${mode}`).not.toBe(base.brandMarkFill)
    expect(emerald.searchBorder, `searchBorder in ${mode}`).not.toBe(base.searchBorder)
    expect(emerald.badgeBg, `badgeBg in ${mode}`).not.toBe(base.badgeBg)
    expect(emerald.navBg, `navBg in ${mode}`).not.toBe(base.navBg)
    expect(emerald.ctaBg, `ctaBg in ${mode}`).not.toBe(base.ctaBg)
    expect(emerald.ctaColor, `ctaColor in ${mode}`).not.toBe(base.ctaColor)
    expect(emerald.linkColor, `linkColor in ${mode}`).not.toBe(base.linkColor)
    expect(emerald.checkBg, `checkBg in ${mode}`).not.toBe(base.checkBg)
    expect(emerald.playedBg, `playedBg in ${mode}`).not.toBe(base.playedBg)
  }

  // Zero horizontal overflow at desktop and phone viewports
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      { message: `overflow at width ${width}` },
    ).toBe(true)
  }

  // Deep link from /settings#custom-appearance and header menu opens Customization section directly
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings#custom-appearance')
  await expect(nav.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(custom).toBeVisible()

  await page.goto('/privacy')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Appearance/ }).click()
  await page.getByRole('menuitem', { name: 'Custom appearance' }).click()
  await expect(nav.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(custom).toBeVisible()

  await custom.getByRole('button', { name: 'Reset to default', exact: true }).click()
})
