import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const openSettings = async (page: Page, path = '/settings') => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto(path)
  const main = page.getByRole('main')
  await expect(main.getByRole('navigation', { name: 'Settings' })).toBeVisible({ timeout: 30_000 })
  return main
}

test('renders all 7 side-menu sections in order and switches sections with URL persistence', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const main = await openSettings(page)

  // Old horizontal tab bar is gone; side-menu navigation holds all 7 requested items.
  await expect(main.getByRole('tablist')).toHaveCount(0)

  const nav = main.getByRole('navigation', { name: 'Settings' })
  const buttons = nav.getByRole('button')
  await expect(buttons).toHaveText([
    'General',
    'Notifications',
    'Customization',
    'Time management',
    'Playback and performance',
    'Privacy',
    'Advanced settings',
  ])

  const generalBtn = nav.getByRole('button', { name: 'General', exact: true })
  await expect(generalBtn).toHaveAttribute('aria-current', 'page')
  await expect(main.getByRole('checkbox', { name: 'Hide Shorts', exact: true })).toBeVisible()

  // Desktop 2-column layout puts side menu to the left of content panel.
  const [navBox, panelBox] = await Promise.all([
    nav.boundingBox(),
    main.locator('.panel').boundingBox(),
  ])
  expect(navBox).not.toBeNull()
  expect(panelBox).not.toBeNull()
  expect(panelBox!.x).toBeGreaterThan(navBox!.x + navBox!.width)

  // General feed settings mutate live feed store.
  await main.getByRole('group', { name: 'Subscriptions layout' }).getByRole('button', { name: 'List', exact: true }).click()
  await expect(main.getByRole('group', { name: 'Subscriptions layout' }).getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const feedStored = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:feed-view') ?? '{}') as { layouts?: { subscriptions?: string } })
  expect(feedStored.layouts?.subscriptions).toBe('list')

  // Notifications section links to per-channel notifications without fake toggles.
  await nav.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=notifications$/)
  await expect(main.getByRole('link', { name: 'Manage channel notifications' })).toHaveAttribute('href', '/feed/channels')

  // Customization keeps Theme and expanded CustomAppearance preview (Ambient mode lives under Playback and performance).
  await nav.getByRole('button', { name: 'Customization', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=customization$/)
  await expect(main.getByRole('button', { name: 'Dark', exact: true })).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Ambient mode', exact: true })).toHaveCount(0)
  await expect(main.locator('#custom-appearance')).toBeVisible()

  // Time management controls live sleep timer state.
  await nav.getByRole('button', { name: 'Time management', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=time-management$/)
  const enableSleepTimer = main.getByRole('checkbox', { name: 'Enable sleep timer', exact: true })
  await expect(enableSleepTimer).toBeChecked()
  await main.getByRole('button', { name: '30 min', exact: true }).click()
  await expect(main.locator('[data-sleep-status]')).toContainText('Pauses in')
  await main.getByRole('button', { name: 'End of video', exact: true }).click()
  await expect(main.locator('[data-sleep-status]')).toHaveText('Pauses at the end of the current video')
  await main.getByRole('button', { name: 'Off', exact: true }).click()
  await expect(main.locator('[data-sleep-status]')).toHaveText('Timer off')

  // Disabling the sleep timer hides preset choices and persists across reloads.
  await enableSleepTimer.uncheck()
  await expect(enableSleepTimer).not.toBeChecked()
  await expect(main.getByRole('group', { name: 'Sleep timer', exact: true })).toHaveCount(0)
  await expect(main.locator('[data-sleep-status]')).toHaveText('Sleep timer is disabled and hidden from the player.')
  await page.reload()
  await expect(main.getByRole('checkbox', { name: 'Enable sleep timer', exact: true })).not.toBeChecked()
  await expect(main.getByRole('group', { name: 'Sleep timer', exact: true })).toHaveCount(0)
  await main.getByRole('checkbox', { name: 'Enable sleep timer', exact: true }).check()
  await expect(main.getByRole('group', { name: 'Sleep timer', exact: true })).toBeVisible()

  // Playback and performance holds quality, playback checkboxes, speed slider, and captions.
  await nav.getByRole('button', { name: 'Playback and performance', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=playback$/)
  await expect(main.getByRole('button', { name: '1080p', exact: true })).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Autoplay', exact: true })).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Skip sponsors' })).toBeVisible()
  await expect(main.getByRole('slider', { name: 'Playback speed' })).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Always show captions', exact: true })).toBeVisible()

  // Reloading keeps active section from URL query parameter.
  await page.reload()
  await expect(nav.getByRole('button', { name: 'Playback and performance', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(main.getByRole('checkbox', { name: 'Autoplay', exact: true })).toBeVisible()

  // Privacy section holds privacy policy and history links.
  await nav.getByRole('button', { name: 'Privacy', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=privacy$/)
  await expect(main.getByRole('link', { name: 'What FTube keeps and where requests go' })).toHaveAttribute('href', '/privacy')

  // Advanced settings holds connection status and feed display reset.
  await nav.getByRole('button', { name: 'Advanced settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=advanced$/)
  await main.getByRole('button', { name: 'Reset feed display settings', exact: true }).click()
  const feedReset = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:feed-view') ?? '{}') as { layouts?: { subscriptions?: string } })
  expect(feedReset.layouts?.subscriptions).toBe('grid')
})

test('supports legacy ?tab=appearance / #custom-appearance deep links and zero horizontal overflow on phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const main = await openSettings(page, '/settings?tab=appearance')
  const nav = main.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(main.locator('#custom-appearance')).toBeVisible()

  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)

  await main.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Playback and performance', exact: true }).click()
  await expect(main.getByRole('slider', { name: 'Playback speed' })).toBeVisible()
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
})

test('configures preferred subtitle language and video-language skip list with aligned controls and persistence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const main = await openSettings(page, '/settings?section=playback')

  const preferredSelect = main.getByLabel('Preferred subtitle language', { exact: true })
  const alwaysCaptions = main.getByRole('checkbox', { name: 'Always show captions', exact: true })
  const skipSelect = main.getByLabel('Add skipped video language', { exact: true })
  const skipAdd = main.getByRole('button', { name: 'Add', exact: true })
  const [captionRight, prefRight, skipSelectRight, skipAddRight] = await Promise.all([
    alwaysCaptions.boundingBox().then(b => b!.x + b!.width),
    preferredSelect.boundingBox().then(b => b!.x + b!.width),
    skipSelect.boundingBox().then(b => b!.x + b!.width),
    skipAdd.boundingBox().then(b => b!.x + b!.width),
  ])
  expect(Math.abs(prefRight - captionRight)).toBeLessThanOrEqual(2)
  expect(Math.abs(skipSelectRight - prefRight)).toBeLessThanOrEqual(2)
  expect(Math.abs(skipAddRight - prefRight)).toBeLessThanOrEqual(2)

  await expect(preferredSelect).toHaveValue('')
  await preferredSelect.selectOption('ja')
  await expect(preferredSelect).toHaveValue('ja')

  await preferredSelect.selectOption('__custom__')
  const customInput = main.getByLabel('Custom preferred subtitle language code', { exact: true })
  await customInput.fill('pt_br')
  await main.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(preferredSelect).toHaveValue('pt-BR')

  await main.getByLabel('Add skipped video language', { exact: true }).selectOption('en')
  await main.getByLabel('Custom skipped video language code', { exact: true }).fill('fr_fr')
  await main.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(main.getByRole('button', { name: 'Remove English (en) from skipped subtitle languages' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Remove fr-FR from skipped subtitle languages' })).toBeVisible()

  await page.reload()
  await expect(main.getByLabel('Preferred subtitle language', { exact: true })).toHaveValue('pt-BR')
  await expect(main.getByRole('button', { name: 'Remove English (en) from skipped subtitle languages' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Remove fr-FR from skipped subtitle languages' })).toBeVisible()

  await main.getByRole('button', { name: 'Remove English (en) from skipped subtitle languages' }).click()
  await expect(main.getByRole('button', { name: 'Remove English (en) from skipped subtitle languages' })).toHaveCount(0)

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as {
    captionsLanguage?: string
    captionsSkipLanguages?: string[]
  })
  expect(stored.captionsLanguage).toBe('pt-BR')
  expect(stored.captionsSkipLanguages).toEqual(['fr-FR'])
})
