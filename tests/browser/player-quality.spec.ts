import { expect, hideFknNotice, test } from './test'

test('shows actual playing quality and checks the matching option when saved preference is unavailable', async ({ page }) => {
  test.setTimeout(120_000)
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ quality: 2160 }))
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/quality-harness.tsx'
    const mod = await import(harness) as {
      mountQualityHarness: (opts: { heights: number[], initialVideoHeight: number, variantHeight?: number }) => void
    }
    mod.mountQualityHarness({
      heights: [1080, 720, 480, 360, 240, 144],
      initialVideoHeight: 1080,
    })
  })

  const harness = page.locator('[data-quality-harness]')
  const settingsBtn = harness.getByRole('button', { name: 'Settings', exact: true })
  await expect(settingsBtn).toBeVisible({ timeout: 60_000 })

  // Root Settings menu shows the actual active tier (1080p) rather than unavailable 2160p preference.
  await settingsBtn.click()
  const rootMenu = harness.getByRole('menu', { name: 'Player settings' })
  const qualityRow = rootMenu.getByRole('menuitem', { name: /Quality/ })
  await expect(qualityRow).toContainText('1080p')
  await expect(qualityRow).not.toContainText('2160p')

  // Opening Quality checks 1080p (not Auto or 720p) while Auto displays active detail 1080p.
  await qualityRow.click()
  const qualityMenu = harness.getByRole('menu', { name: 'Quality' })
  const autoItem = qualityMenu.getByRole('menuitem', { name: /^Auto/ })
  await expect(autoItem.locator('.detail')).toHaveText('1080p')
  await expect(autoItem.locator('svg')).toHaveCount(0)
  await expect(qualityMenu.getByRole('menuitem', { name: '1080p', exact: true }).locator('svg')).toHaveCount(1)
  await expect(qualityMenu.getByRole('menuitem', { name: '720p', exact: true }).locator('svg')).toHaveCount(0)

  // Stored 2160 preference in localStorage stays preserved so 4K-capable videos still get 2160p.
  const storedBeforeSwitch = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { quality?: unknown })
  expect(storedBeforeSwitch.quality).toBe(2160)

  // Selecting 720p updates both player menu and stored settings.
  await qualityMenu.getByRole('menuitem', { name: '720p', exact: true }).click()
  await expect(qualityMenu).toBeHidden()
  await settingsBtn.click()
  await expect(rootMenu.getByRole('menuitem', { name: /Quality/ })).toContainText('720p')
  await rootMenu.getByRole('menuitem', { name: /Quality/ }).click()
  await expect(qualityMenu.getByRole('menuitem', { name: '720p', exact: true }).locator('svg')).toHaveCount(1)
  const stored720 = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { quality?: unknown })
  expect(stored720.quality).toBe(720)

  // Selecting Auto shows Auto (activeHeight) and updates live on paused resize.
  await qualityMenu.getByRole('menuitem', { name: /^Auto/ }).click()
  await settingsBtn.click()
  await expect(rootMenu.getByRole('menuitem', { name: /Quality/ })).toContainText('Auto (1080p)')
  await rootMenu.getByRole('menuitem', { name: /Quality/ }).click()
  await expect(qualityMenu.getByRole('menuitem', { name: /^Auto/ }).locator('svg')).toHaveCount(1)

  await settingsBtn.click()
  await settingsBtn.click()
  await expect(rootMenu).toBeVisible()
  await page.evaluate(() => {
    (window as unknown as { __qualityHarness: { setVideoHeight: (h: number) => void } }).__qualityHarness.setVideoHeight(720)
  })
  await expect(rootMenu.getByRole('menuitem', { name: /Quality/ })).toContainText('Auto (720p)')

  // External settings update to unavailable 2160p resolves display and check to active 720p.
  await page.evaluate(() => {
    (window as unknown as { __qualityHarness: { setQualitySetting: (q: number) => void } }).__qualityHarness.setQualitySetting(2160)
  })
  await expect(rootMenu.getByRole('menuitem', { name: /Quality/ })).toContainText('720p')
  await expect(rootMenu.getByRole('menuitem', { name: /Quality/ })).not.toContainText('2160p')
  await rootMenu.getByRole('menuitem', { name: /Quality/ }).click()
  await expect(qualityMenu.getByRole('menuitem', { name: '720p', exact: true }).locator('svg')).toHaveCount(1)
})

test('shows active playing quality badge (8K, 4K, 2K, HD, or resolution) on the Settings button without overriding inaccessible preference', async ({ page }) => {
  test.setTimeout(120_000)
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ quality: 2160 }))
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/quality-harness.tsx'
    const mod = await import(harness) as {
      mountQualityHarness: (opts: { heights: number[], initialVideoHeight: number, variantHeight?: number }) => void
    }
    mod.mountQualityHarness({
      heights: [4320, 2160, 1440, 1080, 720, 480, 360],
      initialVideoHeight: 2160,
    })
  })

  const harness = page.locator('[data-quality-harness]')
  const settingsBtn = harness.getByRole('button', { name: 'Settings', exact: true })
  await expect(settingsBtn).toBeVisible({ timeout: 60_000 })

  const badge = settingsBtn.locator('.quality-badge')
  await expect(badge).toHaveAttribute('data-quality-badge', '4K')
  await expect(badge).toHaveText('4K')
  const [btnBox, badgeBox] = await Promise.all([settingsBtn.boundingBox(), badge.boundingBox()])
  expect(btnBox).not.toBeNull()
  expect(badgeBox).not.toBeNull()
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(btnBox!.x + btnBox!.width + 1)
  expect(badgeBox!.y).toBeGreaterThanOrEqual(btnBox!.y - 1)

  const setHeight = (h: number) => page.evaluate((height) => {
    (window as unknown as { __qualityHarness: { setVideoHeight: (val: number) => void } }).__qualityHarness.setVideoHeight(height)
  }, h)
  const setQualitySetting = (q: 'auto' | number) => page.evaluate((next) => {
    (window as unknown as { __qualityHarness: { setQualitySetting: (val: 'auto' | number) => void } }).__qualityHarness.setQualitySetting(next)
  }, q)

  // Dynamic ABR playingHeight updates (8K -> 2K -> HD -> 720p -> 480p) belong to Auto mode.
  await setQualitySetting('auto')

  await setHeight(4320)
  await expect(badge).toHaveAttribute('data-quality-badge', '8K')
  await expect(badge).toHaveText('8K')

  await setHeight(1440)
  await expect(badge).toHaveAttribute('data-quality-badge', '2K')
  await expect(badge).toHaveText('2K')

  await setHeight(1080)
  await expect(badge).toHaveAttribute('data-quality-badge', 'HD')
  await expect(badge).toHaveText('HD')

  await setHeight(720)
  await expect(badge).toHaveAttribute('data-quality-badge', '720p')
  await expect(badge).toHaveText('720p')

  await setHeight(480)
  await expect(badge).toHaveAttribute('data-quality-badge', '480p')
  await expect(badge).toHaveText('480p')
  const [btnBox480, badgeBox480] = await Promise.all([settingsBtn.boundingBox(), badge.boundingBox()])
  expect(badgeBox480!.x + badgeBox480!.width).toBeLessThanOrEqual(btnBox480!.x + btnBox480!.width + 1)

  // Saved 2160 preference on a 1080p-max video shows HD (not 4K).
  await setQualitySetting(2160)
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/quality-harness.tsx'
    const mod = await import(harness) as {
      mountQualityHarness: (opts: { heights: number[], initialVideoHeight: number, variantHeight?: number }) => void
    }
    mod.mountQualityHarness({
      heights: [1080, 720, 480, 360],
      initialVideoHeight: 1080,
    })
  })
  await expect(settingsBtn.locator('.quality-badge')).toHaveAttribute('data-quality-badge', 'HD')
})

test('immediately refreshes Settings button quality badge on manual quality switch even before decoded videoHeight drains', async ({ page }) => {
  test.setTimeout(120_000)
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ quality: 'auto' }))
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  await page.evaluate(async () => {
    const harness = '/tests/browser/fixtures/quality-harness.tsx'
    const mod = await import(harness) as {
      mountQualityHarness: (opts: {
        heights: number[]
        initialVideoHeight: number
        variantHeight?: number
        syncVideoHeightOnPick?: boolean
      }) => void
    }
    mod.mountQualityHarness({
      heights: [2160, 1440, 1080, 720, 480, 360],
      initialVideoHeight: 2160,
      syncVideoHeightOnPick: false,
    })
  })

  const harness = page.locator('[data-quality-harness]')
  const settingsBtn = harness.getByRole('button', { name: 'Settings', exact: true })
  await expect(settingsBtn).toBeVisible({ timeout: 60_000 })

  const badge = settingsBtn.locator('.quality-badge')
  await expect(badge).toHaveAttribute('data-quality-badge', '4K')

  const pickQuality = async (label: string) => {
    await settingsBtn.click()
    await harness.getByRole('menu', { name: 'Player settings' }).getByRole('menuitem', { name: /Quality/ }).click()
    await harness
      .getByRole('menu', { name: 'Quality' })
      .getByRole('menuitem', { name: label === 'Auto' ? /^Auto/ : label, exact: label !== 'Auto' })
      .click()
  }

  await pickQuality('720p')
  await expect(badge).toHaveAttribute('data-quality-badge', '720p')
  await expect(badge).toHaveText('720p')

  // Shaka variantchanged also refreshes Auto's active resolution label immediately while decoded videoHeight lags.
  await page.evaluate(() => {
    (window as unknown as { __qualityHarness: { setVariantHeight: (val: number) => void } }).__qualityHarness.setVariantHeight(720)
  })
  await settingsBtn.click()
  await harness.getByRole('menu', { name: 'Player settings' }).getByRole('menuitem', { name: /Quality/ }).click()
  await expect(harness.getByRole('menu', { name: 'Quality' }).getByRole('menuitem', { name: /^Auto/ }).locator('.detail')).toHaveText('720p')
  await settingsBtn.click()

  await pickQuality('480p')
  await expect(badge).toHaveAttribute('data-quality-badge', '480p')
  await expect(badge).toHaveText('480p')

  await pickQuality('2160p')
  await expect(badge).toHaveAttribute('data-quality-badge', '4K')

  await pickQuality('Auto')
  await expect(badge).toHaveAttribute('data-quality-badge', '720p')
})
