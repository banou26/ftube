import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

const HARNESS = '/tests/browser/fixtures/player-customization-harness.tsx'

const openPlayerTab = async (page: import('@playwright/test').Page) => {
  await page.goto('/settings')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Customization', exact: true }).click()
  const appearanceTab = page.getByRole('tab', { name: 'Appearance', exact: true })
  const playerTab = page.getByRole('tab', { name: 'Player', exact: true })
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#custom-appearance')).toBeVisible()
  await playerTab.click()
  await expect(playerTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/settings\?section=customization&tab=player$/)
  return page.getByRole('region', { name: 'Player customization' })
}

const mountPlayerHarness = async (page: import('@playwright/test').Page, width = 900) => {
  await page.goto('/privacy')
  await page.evaluate(async ([path, harnessWidth]) => {
    const mod = await import(path) as { mountPlayerCustomizationHarness: (options?: { width?: number }) => void }
    mod.mountPlayerCustomizationHarness({ width: harnessWidth })
  }, [HARNESS, width] as const)
  const player = page.locator('[data-player-customization-harness]')
  await expect(player.locator('.bar')).toBeVisible()
  return player
}

test('keeps general appearance in the first tab and places player customization in the second tab', async ({ page }) => {
  const section = await openPlayerTab(page)
  await expect(section.getByRole('group', { name: 'Left side player controls' })).toBeVisible()
  await expect(section.getByRole('group', { name: 'Right side player controls' })).toBeVisible()
  await expect(section.getByRole('group', { name: 'Player settings menu items' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Player', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Player customization' })).toBeVisible()

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      { message: `overflow at width ${width}` },
    ).toBe(true)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\?section=customization$/)
  await expect(page.locator('#custom-appearance')).toBeVisible()
})

test('customizes main bar control visibility, order across sides, settings menu entries, and resets cleanly', async ({ page }) => {
  test.setTimeout(90_000)
  const section = await openPlayerTab(page)

  // Hide Next, Autoplay, and Theater mode
  await section.getByRole('checkbox', { name: 'Show Next in player bar' }).uncheck()
  await section.getByRole('checkbox', { name: 'Show Autoplay in player bar' }).uncheck()
  await section.getByRole('checkbox', { name: 'Show Theater mode in player bar' }).uncheck()

  // Reorder left side via button controls: move Chapter before Time
  await section.getByRole('button', { name: 'Move Chapter earlier' }).click()

  // Move Volume to the right side via button and Settings to the end of the left side via drag-and-drop
  await section.getByRole('button', { name: 'Move Volume to right side' }).click()
  const settingsRow = section.locator('[data-bar-control-row="settings"]')
  const timeRow = section.locator('[data-bar-control-row="time"]')
  const timeBox = await timeRow.boundingBox()
  await settingsRow.dragTo(timeRow, { targetPosition: { x: 24, y: (timeBox?.height ?? 36) - 4 } })

  // Hide Ambient mode, Annotations, and Playback speed from player settings menu
  await section.getByRole('checkbox', { name: 'Show Ambient mode in settings menu' }).uncheck()
  await section.getByRole('checkbox', { name: 'Show Annotations in settings menu' }).uncheck()
  await section.getByRole('checkbox', { name: 'Show Playback speed in settings menu' }).uncheck()

  await page.reload()
  const reloadedSection = page.getByRole('region', { name: 'Player customization' })
  await expect(reloadedSection.getByRole('checkbox', { name: 'Show Autoplay in player bar' })).not.toBeChecked()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Show Playback speed in settings menu' })).not.toBeChecked()

  // Mount PlayerControls and compare actual bar layout, order, coordinates, and popup menu
  const player = await mountPlayerHarness(page)
  await expect(player.locator('[data-control-id="next"]')).toHaveCount(0)
  await expect(player.locator('[data-control-id="autoplay"]')).toHaveCount(0)
  await expect(player.locator('[data-control-id="theater"]')).toHaveCount(0)

  const layout = await player.evaluate((root) => {
    const ids = (sel: string) =>
      [...root.querySelectorAll<HTMLElement>(sel)].map(el => ({
        id: el.dataset.controlId,
        x: el.getBoundingClientRect().left,
      }))
    return {
      left: ids('.left > [data-control-id]'),
      right: ids('.right > [data-control-id]'),
    }
  })

  expect(layout.left.map(item => item.id)).toEqual(['play', 'chapter', 'time', 'settings'])
  expect(layout.right.map(item => item.id)).toEqual(['captions', 'pip', 'fullscreen', 'volume'])
  for (let i = 1; i < layout.left.length; i++) {
    expect(layout.left[i]!.x).toBeGreaterThan(layout.left[i - 1]!.x)
  }
  for (let i = 1; i < layout.right.length; i++) {
    expect(layout.right[i]!.x).toBeGreaterThan(layout.right[i - 1]!.x)
  }

  // Settings moved to the left opens its popup aligned to start inside the player box
  await player.getByRole('button', { name: 'Settings', exact: true }).click()
  const menu = player.getByRole('menu', { name: 'Player settings' })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveClass(/align-start/)
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Ambient mode' })).toHaveCount(0)
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Annotations' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Playback speed' })).toHaveCount(0)
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Stable Volume' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Subtitles' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Quality' })).toBeVisible()

  // Hiding every settings menu item hides the settings button on the player bar
  const customAfterMenu = await openPlayerTab(page)
  for (const label of [
    'Show Stable Volume in settings menu',
    'Show Annotations in settings menu',
    'Show Timed comments in settings menu',
    'Show Picture in picture in settings menu',
    'Show Subtitles in settings menu',
    'Show Audio track in settings menu',
    'Show Sleep timer in settings menu',
    'Show Playback speed in settings menu',
    'Show Ambient mode in settings menu',
    'Show Quality in settings menu',
  ]) {
    await customAfterMenu.getByRole('checkbox', { name: label }).uncheck()
  }
  const hiddenMenuPlayer = await mountPlayerHarness(page)
  await expect(hiddenMenuPlayer.locator('[data-control-id="settings"]')).toHaveCount(0)

  // Reset to default restores full bar and menu
  await openPlayerTab(page)
  await page.getByRole('region', { name: 'Player customization' }).getByRole('button', { name: 'Reset to default' }).click()
  const resetPlayer = await mountPlayerHarness(page)
  const resetLeft = await resetPlayer.locator('.left > [data-control-id]').evaluateAll(
    els => els.map(el => (el as HTMLElement).dataset.controlId),
  )
  const resetRight = await resetPlayer.locator('.right > [data-control-id]').evaluateAll(
    els => els.map(el => (el as HTMLElement).dataset.controlId),
  )
  expect(resetLeft).toEqual(['play', 'next', 'volume', 'time', 'chapter'])
  expect(resetRight).toEqual(['autoplay', 'captions', 'settings', 'pip', 'theater', 'fullscreen'])
  await resetPlayer.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(resetPlayer.getByRole('menu', { name: 'Player settings' }).getByRole('menuitem', { name: 'Quality' })).toBeVisible()
})

test('fits crowded custom left-side controls cleanly inside a 390px phone player bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    if (window !== top) return
    localStorage.setItem('yt-client:settings', JSON.stringify({
      playerBarLayout: {
        left: ['play', 'next', 'volume', 'time', 'captions', 'settings', 'pip', 'fullscreen'],
        right: [],
        hidden: ['chapter', 'autoplay', 'theater'],
      },
    }))
  })

  const player = await mountPlayerHarness(page, 390)
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    { message: 'no document horizontal overflow with 390px player' },
  ).toBe(true)

  const fits = await player.locator('.bar').evaluate(
    el => el.scrollWidth <= el.clientWidth + 1,
  )
  expect(fits).toBe(true)

  const playerBox = (await player.boundingBox())!
  const controlBoxes = await player.locator('.bar [data-control-id]').evaluateAll(els =>
    els
      .filter(el => getComputedStyle(el).display !== 'none')
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return { id: (el as HTMLElement).dataset.controlId ?? '', left: rect.left, right: rect.right, width: rect.width }
      }),
  )
  expect(controlBoxes.map(box => box.id)).toEqual(['play', 'next', 'volume', 'time', 'captions', 'settings', 'pip', 'fullscreen'])
  for (const box of controlBoxes) {
    expect(box.width).toBeGreaterThan(0)
    expect(box.left).toBeGreaterThanOrEqual(playerBox.x - 0.5)
    expect(box.right).toBeLessThanOrEqual(playerBox.x + playerBox.width + 0.5)
  }

  await player.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(player.getByRole('menu', { name: 'Player settings' })).toBeVisible()
})
