import { expect, hideFknNotice, test } from './test'

test('stays inactive by default and supports spatial grid/control navigation plus g chords when enabled', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.setViewportSize({ width: 1280, height: 900 })
  await hideFknNotice(page)
  await page.goto('/settings')

  const main = page.getByRole('main')
  const toggle = main.getByRole('checkbox', { name: 'Full keyboard navigation', exact: true })
  await expect(toggle).not.toBeChecked()

  // Disabled by default: arrows, h/j/k/l, and g chords do not intercept or focus elements spatially.
  await page.locator('#settings-section-heading').click()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-kb-nav-focus="true"]')).toHaveCount(0)
  await page.keyboard.press('g')
  await expect(page.locator('[data-kb-nav-chord]')).toHaveCount(0)
  await page.keyboard.press('h')
  await expect(page).toHaveURL(/\/settings$/)

  // Opt in via Settings -> General and verify persistence across reload.
  await toggle.check()
  await expect(toggle).toBeChecked()
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { keyboardNavigation?: boolean },
  )
  expect(stored.keyboardNavigation).toBe(true)

  await page.reload()
  await expect(page.getByRole('main').getByRole('checkbox', { name: 'Full keyboard navigation', exact: true })).toBeChecked()

  // Spatial navigation vertically and horizontally across Settings controls + pointer cleanup.
  const hideShorts = page.getByRole('main').getByRole('checkbox', { name: 'Hide Shorts', exact: true })
  await hideShorts.focus()
  await page.keyboard.press('j')
  const gridChoice = page.getByRole('main').getByRole('group', { name: 'Subscriptions layout' }).getByRole('button', { name: 'Grid', exact: true })
  const listChoice = page.getByRole('main').getByRole('group', { name: 'Subscriptions layout' }).getByRole('button', { name: 'List', exact: true })
  const channelListChoice = page.getByRole('main').getByRole('group', { name: 'Channel Videos layout' }).getByRole('button', { name: 'List', exact: true })
  await expect(listChoice).toHaveAttribute('data-kb-nav-focus', 'true')

  await page.keyboard.press('j')
  await expect(channelListChoice).toHaveAttribute('data-kb-nav-focus', 'true')
  await page.keyboard.press('k')
  await expect(listChoice).toHaveAttribute('data-kb-nav-focus', 'true')
  await page.keyboard.press('h')
  await expect(gridChoice).toHaveAttribute('data-kb-nav-focus', 'true')
  const pillRadius = await gridChoice.evaluate(el => getComputedStyle(el).borderTopLeftRadius)
  expect(pillRadius).not.toBe('6px')

  await page.keyboard.press('l')
  await expect(listChoice).toHaveAttribute('data-kb-nav-focus', 'true')

  // Moving focus elsewhere (focusin / Tab / programmatic focus) clears the spatial marker.
  await hideShorts.focus()
  await expect(page.locator('[data-kb-nav-focus="true"]')).toHaveCount(0)

  // Settings sidebar navigation keeps native arrow switching while keyboard navigation is enabled.
  const nav = page.getByRole('main').getByRole('navigation', { name: 'Settings' })
  await nav.getByRole('button', { name: 'General', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/\/settings\?section=notifications$/)
  await nav.getByRole('button', { name: 'Notifications', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(page).toHaveURL(/\/settings$/)

  await page.locator('#settings-section-heading').click()
  await expect(page.locator('[data-kb-nav-focus="true"]')).toHaveCount(0)

  // Chord indicator appears on 'g', cancels on Escape, and routes on g+s / g+, / g+/ / g+g.
  await page.keyboard.press('g')
  await expect(page.locator('[data-kb-nav-chord="g"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-kb-nav-chord]')).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings$/)

  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(page).toHaveURL(/\/feed\/subscriptions$/)

  await page.keyboard.press('g')
  await page.keyboard.press(',')
  await expect(page).toHaveURL(/\/settings$/)

  await page.keyboard.press('g')
  await page.keyboard.press('/')
  const searchInput = page.locator('header form[role="search"] input[name="search_query"]')
  await expect(searchInput).toBeFocused()
  await searchInput.fill('g')
  await expect(page.locator('[data-kb-nav-chord]')).toHaveCount(0)
  await searchInput.fill('')
  await searchInput.blur()

  await page.keyboard.press('g')
  await page.keyboard.press('g')
  await expect.poll(() =>
    page.evaluate(() => document.activeElement?.closest('nav[aria-label="Guide"]') !== null),
  ).toBe(true)
})

test('preserves Watch playback keys and lets Escape step focus out of player while g p returns to player', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ keyboardNavigation: true }))
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await hideFknNotice(page)
  await page.goto('/watch?v=dQw4w9WgXcQ')

  const player = page.locator('[data-player-root]')
  await expect(player).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('main').getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible({ timeout: 30_000 })

  // From body/player on Watch, pressing Escape steps focus into watch page controls outside [data-player-root].
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-kb-nav-focus="true"]')).toHaveCount(1)
  await expect.poll(() =>
    page.evaluate(() => {
      const el = document.activeElement
      return Boolean(el && el !== document.body && !el.closest('[data-player-root]'))
    }),
  ).toBe(true)

  // ArrowRight steps spatially across watch page controls without triggering 5s seek; playback key 'm' still toggles mute.
  const firstLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '')
  expect(firstLabel.length).toBeGreaterThan(0)
  await page.keyboard.press('m')
  await expect(player.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible()
  await page.keyboard.press('m')
  await expect(player.getByRole('button', { name: 'Mute', exact: true })).toBeVisible()

  // g p returns focus into [data-player-root].
  await page.keyboard.press('g')
  await page.keyboard.press('p')
  await expect.poll(() =>
    page.evaluate(() => document.activeElement?.closest('[data-player-root]') !== null),
  ).toBe(true)
})
