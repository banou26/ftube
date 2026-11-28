import { expect, hideFknNotice, test } from './test'

const NEW_TAB_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control'
const SHORTS_HARNESS = '/tests/browser/fixtures/shorts-menu-harness.tsx'

const holdPlayback = () => {
  if (window.top !== window) return
  const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (
    this: MessagePort,
    message: unknown,
    ...rest: unknown[]
  ) => void
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    if ((message as { method?: string } | null)?.method === 'openPlayback') return
    return post.call(this, message, ...rest)
  } as typeof MessagePort.prototype.postMessage
}

test('uses real links across header menu, settings navigation, guide, search filters, and Shorts full player for new-tab clicks (APP-1124)', async ({ page, context }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await hideFknNotice(page)
  await page.addInitScript(holdPlayback)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/privacy')

  // 1. Header More menu items expose real <a href> links and open in a new tab with Cmd/Ctrl-click
  const moreBtn = page.getByRole('button', { name: 'More', exact: true })
  await expect(moreBtn).toBeVisible({ timeout: 30_000 })
  await moreBtn.click()

  const settingsItem = page.getByRole('menuitem', { name: 'Settings', exact: true })
  const partyItem = page.getByRole('menuitem', { name: 'Watch together', exact: true })
  await expect(settingsItem).toHaveAttribute('href', '/settings')
  await expect(partyItem).toHaveAttribute('href', '/party')
  expect(await settingsItem.evaluate(el => el.tagName)).toBe('A')
  expect(await partyItem.evaluate(el => el.tagName)).toBe('A')

  const [settingsTab] = await Promise.all([
    context.waitForEvent('page'),
    settingsItem.click({ modifiers: [NEW_TAB_MODIFIER] }),
  ])
  await settingsTab.waitForLoadState('domcontentloaded')
  expect(new URL(settingsTab.url()).pathname).toBe('/settings')
  await settingsTab.close()
  expect(new URL(page.url()).pathname).toBe('/privacy')

  await page.getByRole('menuitem', { name: /Appearance:/ }).click()
  const customItem = page.getByRole('menuitem', { name: 'Custom appearance', exact: true })
  await expect(customItem).toHaveAttribute('href', '/settings?section=customization#custom-appearance')
  expect(await customItem.evaluate(el => el.tagName)).toBe('A')

  await page.keyboard.press('Escape')
  await moreBtn.click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)

  // 2. Settings sidebar sections and Customization subtabs are real links supporting Cmd/Ctrl-click and arrow keys
  const playbackNav = page.getByRole('navigation', { name: 'Settings' }).locator('a.nav-item', { hasText: 'Playback' })
  const customizationNav = page.getByRole('navigation', { name: 'Settings' }).locator('a.nav-item', { hasText: 'Customization' })
  await expect(playbackNav).toHaveAttribute('href', '/settings?section=playback')
  await expect(customizationNav).toHaveAttribute('href', '/settings?section=customization')

  const [playbackTab] = await Promise.all([
    context.waitForEvent('page'),
    playbackNav.click({ modifiers: [NEW_TAB_MODIFIER] }),
  ])
  await playbackTab.waitForLoadState('domcontentloaded')
  expect(new URL(playbackTab.url()).pathname + new URL(playbackTab.url()).search).toBe('/settings?section=playback')
  await playbackTab.close()
  expect(new URL(page.url()).search).toBe('')

  await customizationNav.click()
  await expect(page).toHaveURL(/\/settings\?section=customization$/)

  const playerSubTab = page.getByRole('tab', { name: 'Player', exact: true })
  await expect(playerSubTab).toHaveAttribute('href', '/settings?section=customization&tab=player')
  expect(await playerSubTab.evaluate(el => el.tagName)).toBe('A')

  const [playerSubPage] = await Promise.all([
    context.waitForEvent('page'),
    playerSubTab.click({ modifiers: [NEW_TAB_MODIFIER] }),
  ])
  await playerSubPage.waitForLoadState('domcontentloaded')
  expect(new URL(playerSubPage.url()).pathname + new URL(playerSubPage.url()).search).toBe('/settings?section=customization&tab=player')
  await playerSubPage.close()
  await expect(page.getByRole('tab', { name: 'Appearance', exact: true })).toHaveAttribute('aria-selected', 'true')

  // Keyboard navigation between Settings nav items remains intact
  await customizationNav.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#settings-nav-time-management')).toBeFocused()
  await expect(page).toHaveURL(/\/settings\?section=time-management$/)

  // 3. Search filter chips and dialog options are real links
  await page.goto('/results?search_query=mock')
  const videosChip = page.locator('.filter-chips a.filter-chip', { hasText: 'Videos' })
  await expect(videosChip).toHaveAttribute('href', /\/results\?/)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const firstFilterOption = page.getByRole('dialog', { name: 'Search filters', exact: true }).locator('a.option').first()
  await expect(firstFilterOption).toHaveAttribute('href', /\/results\?/)
  await page.keyboard.press('Escape')

  // 4. Guide drawer navigation entries remain real links
  const guideBtn = page.getByRole('button', { name: 'Guide', exact: true })
  await guideBtn.click()
  await expect(page.locator('nav a.item[href="/"]').first()).toBeVisible()
  await expect(page.locator('nav a.item[href="/shorts"]').first()).toBeVisible()

  // 5. Shorts More options "Open in the full player" exposes a real watch link
  await page.goto('/privacy')
  const root = page.locator('[data-shorts-menu-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as { mountShortsMenuHarness: (m: 'full' | 'tracks') => unknown }
        harness.mountShortsMenuHarness('full')
      }, SHORTS_HARNESS)
    }
    await expect(root).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 20_000 })

  const activeSlide = root.locator('[data-short-id="short-1"]')
  await activeSlide.locator('.top-bar').getByRole('button', { name: 'More options', exact: true }).click()
  const fullPlayerItem = page.getByRole('menu', { name: 'More options', exact: true }).getByRole('menuitem', { name: 'Open in the full player', exact: true })
  await expect(fullPlayerItem).toHaveAttribute('href', '/watch?v=short-1')
  expect(await fullPlayerItem.evaluate(el => el.tagName)).toBe('A')
})
