import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/shorts-menu-harness.tsx'

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

type HarnessApi = {
  addedToPlaylist: () => { playlistId: string, videoIds: string[] }[]
  pickedCaptions: () => ({ trackId: string, translateTo?: string } | undefined)[]
  pickedAudio: () => string[]
}

const openShortsMenuHarness = async (page: import('@playwright/test').Page, mode: 'full' | 'tracks') => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(holdPlayback)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/privacy')

  const root = page.locator('[data-shorts-menu-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async ([path, harnessMode]) => {
        const harness = await import(path!) as { mountShortsMenuHarness: (m: 'full' | 'tracks') => HarnessApi }
        const state = harness.mountShortsMenuHarness(harnessMode as 'full' | 'tracks')
        ;(window as unknown as { __shortsMenuHarness?: HarnessApi }).__shortsMenuHarness = state
      }, [HARNESS, mode])
    }
    await expect(root).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
  return root
}

test('Shorts More options menu supports description, save to playlist, ambient mode, playback speed, and feedback dismissals', async ({ page }) => {
  const root = await openShortsMenuHarness(page, 'full')
  const firstSlide = root.locator('[data-short-id="short-1"]')
  await expect(firstSlide).toBeVisible({ timeout: 15_000 })
  await expect(firstSlide.locator('.short-title')).toHaveText('The AI Model Iceberg', { timeout: 10_000 })
  await expect(firstSlide.locator('.byline .name')).toHaveText('RTBF iXPé')

  // Keep rail count unchanged (6 items including More actions) while placing More options in the top bar
  await expect(firstSlide.locator('.rail > .rail-button, .rail > .rail-channel, .rail button.rail-button')).toHaveCount(6)
  const topMoreBtn = firstSlide.locator('.top-bar').getByRole('button', { name: 'More options', exact: true })
  await expect(topMoreBtn).toBeVisible()

  await topMoreBtn.click()
  const menu = page.getByRole('menu', { name: 'More options', exact: true })
  await expect(menu).toBeVisible()

  const itemLabels = await menu.locator('[role^="menuitem"] .label').allTextContents()
  expect(itemLabels).toEqual([
    'Description',
    'Save to playlist',
    'Ambient mode',
    'Captions',
    'Full screen',
    'Audio Track',
    'Playback speed',
    'Not interested',
    "Don't recommend this channel",
    'Open in the full player',
  ])

  // 1. Description dialog
  await menu.getByRole('menuitem', { name: 'Description', exact: true }).click()
  const descDialog = firstSlide.getByRole('dialog', { name: 'Description', exact: true })
  await expect(descDialog).toBeVisible()
  await expect(descDialog).toContainText('The AI Model Iceberg')
  await expect(descDialog).toContainText('RTBF iXPé')
  await expect(descDialog).toContainText('69K')
  await expect(descDialog).toContainText('Likes')
  await expect(descDialog).toContainText('3M')
  await expect(descDialog).toContainText('Views')
  await expect(descDialog).toContainText('Oct 23')
  await expect(descDialog).toContainText('2026')
  await expect(descDialog).toContainText('Deep dive into modern AI models.')
  await expect(descDialog).toContainText('#ai')
  await expect(descDialog).toContainText('#ml')
  await descDialog.getByRole('button', { name: 'Close description', exact: true }).click()
  await expect(descDialog).toHaveCount(0)

  // 2. Save to playlist
  await topMoreBtn.click()
  await menu.getByRole('menuitem', { name: 'Save to playlist', exact: true }).click()
  const saveDialog = page.getByRole('dialog', { name: 'Save to playlist', exact: true })
  await expect(saveDialog).toBeVisible()
  await saveDialog.getByRole('checkbox', { name: /Favorites/ }).click()
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __shortsMenuHarness: HarnessApi }).__shortsMenuHarness.addedToPlaylist()),
  ).toEqual([{ playlistId: 'PLfav', videoIds: ['short-1'] }])
  await saveDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(saveDialog).toHaveCount(0)

  // 3. Ambient mode toggle + playback speed
  await expect(firstSlide.locator('[data-ambient-glow]')).toHaveAttribute('data-active', 'true')
  await topMoreBtn.click()
  const ambientRow = menu.getByRole('menuitemcheckbox', { name: /Ambient mode/ })
  await expect(ambientRow).toHaveAttribute('aria-checked', 'true')
  await ambientRow.click()
  await expect(ambientRow).toHaveAttribute('aria-checked', 'false')
  await expect(firstSlide.locator('[data-ambient-glow]')).toHaveAttribute('data-active', 'false')
  const storedAfterAmbient = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { ambientMode?: boolean })
  expect(storedAfterAmbient.ambientMode).toBe(false)

  await menu.getByRole('menuitem', { name: /Playback speed/ }).click()
  const speedMenu = page.getByRole('menu', { name: 'Playback speed', exact: true })
  await expect(speedMenu).toBeVisible()
  await speedMenu.getByRole('button', { name: '1.5', exact: true }).click()
  await expect.poll(() => firstSlide.locator('video').evaluate(v => (v as HTMLVideoElement).playbackRate)).toBe(1.5)
  const storedAfterSpeed = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}') as { playbackRate?: number })
  expect(storedAfterSpeed.playbackRate).toBe(1.5)
  await speedMenu.getByRole('button', { name: 'Back to previous menu', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: /Playback speed/ })).toContainText('1.5')

  // 4. Not interested removes slide + persists + Undo restores
  await menu.getByRole('menuitem', { name: 'Not interested', exact: true }).click()
  await expect(firstSlide).toHaveCount(0)
  await expect(root.locator('[data-short-id="short-2"]')).toBeVisible()
  const dismissedAfterVideo = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:dismissed') ?? '{}') as { videos?: string[] })
  expect(dismissedAfterVideo.videos).toContain('short-1')
  await root.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(firstSlide).toBeVisible()

  // 5. Don't recommend this channel removes slide + persists channel + Undo restores
  await topMoreBtn.click()
  await menu.getByRole('menuitem', { name: "Don't recommend this channel", exact: true }).click()
  await expect(firstSlide).toHaveCount(0)
  await expect(root.locator('[data-short-id="short-2"]')).toBeVisible()
  const dismissedAfterChannel = await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:dismissed') ?? '{}') as { channels?: string[] })
  expect(dismissedAfterChannel.channels).toContain('UClewis')
  await root.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(firstSlide).toBeVisible()
})

test('Shorts More options supports Captions auto-translate, Audio Track switching, and auto-dubbed disclosure', async ({ page }) => {
  const root = await openShortsMenuHarness(page, 'tracks')
  await root.getByRole('button', { name: 'Track controls harness', exact: true }).click()

  const menu = page.getByRole('menu', { name: 'Track controls harness', exact: true })
  await expect(menu).toBeVisible()

  // Captions + Auto-translate
  await menu.getByRole('menuitem', { name: /Captions/ }).click()
  const captionsMenu = page.getByRole('menu', { name: 'Captions', exact: true })
  await captionsMenu.getByRole('menuitem', { name: 'English', exact: true }).click()
  await root.getByRole('button', { name: 'Track controls harness', exact: true }).click()
  await menu.getByRole('menuitem', { name: /Captions/ }).click()
  await captionsMenu.getByRole('menuitem', { name: 'Auto-translate', exact: true }).click()
  const translateMenu = page.getByRole('menu', { name: 'Auto-translate', exact: true })
  await translateMenu.getByRole('menuitem', { name: 'Spanish', exact: true }).click()

  await root.getByRole('button', { name: 'Track controls harness', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: /Captions/ })).toContainText('English >> Spanish')

  await menu.getByRole('menuitem', { name: /Captions/ }).click()
  await captionsMenu.getByRole('menuitem', { name: 'Off', exact: true }).click()

  // Audio track submenu with auto-dubbed detail
  await root.getByRole('button', { name: 'Track controls harness', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: /Audio Track/ })).toContainText('English (US) original')
  await menu.getByRole('menuitem', { name: /Audio Track/ }).click()
  const audioMenu = page.getByRole('menu', { name: 'Audio track', exact: true })
  const frenchRow = audioMenu.getByRole('menuitem', { name: /French/ })
  await expect(frenchRow).toContainText('auto-dubbed')
  await frenchRow.click()

  await root.getByRole('button', { name: 'Track controls harness', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: /Audio Track/ })).toContainText('French')
  await page.keyboard.press('Escape')

  const calls = await page.evaluate(() => {
    const api = (window as unknown as { __shortsMenuHarness: HarnessApi }).__shortsMenuHarness
    return { captions: api.pickedCaptions(), audio: api.pickedAudio() }
  })
  expect(calls.captions).toEqual([
    { trackId: 'en' },
    { trackId: 'en', translateTo: 'es' },
    undefined,
  ])
  expect(calls.audio).toEqual(['fr'])

  await root.getByRole('button', { name: 'Open auto-dubbed description', exact: true }).click()
  const dialog = root.getByRole('dialog', { name: 'Description', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('How this was made')
  await expect(dialog).toContainText('Auto-dubbed')
})

test('closing or leaving a Short with Description open keeps keyboard navigation working and manages dialog focus', async ({ page }) => {
  const root = await openShortsMenuHarness(page, 'full')
  const firstSlide = root.locator('[data-short-id="short-1"]')
  await expect(firstSlide).toBeVisible({ timeout: 15_000 })
  await expect(firstSlide.locator('.short-title')).toHaveText('The AI Model Iceberg', { timeout: 10_000 })
  await expect(firstSlide.locator('.byline .name')).toHaveText('RTBF iXPé')

  const topMoreBtn = firstSlide.locator('.top-bar').getByRole('button', { name: 'More options', exact: true })
  await topMoreBtn.click()
  const menu = page.getByRole('menu', { name: 'More options', exact: true })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Description', exact: true }).click()

  const descDialog = firstSlide.getByRole('dialog', { name: 'Description', exact: true })
  await expect(descDialog).toBeVisible()
  const closeBtn = descDialog.getByRole('button', { name: 'Close description', exact: true })
  await expect(closeBtn).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(descDialog.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Tab')
  await expect(descDialog.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(descDialog).toHaveCount(0)
  await expect(topMoreBtn).toBeFocused()

  await topMoreBtn.click()
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Description', exact: true }).click()
  await expect(descDialog).toBeVisible()

  await root.getByRole('button', { name: 'Next short', exact: true }).click()
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/shorts/short-2')
  await expect(root.getByRole('dialog', { name: 'Description', exact: true })).toHaveCount(0)

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/shorts/short-3')

  await page.keyboard.press('ArrowUp')
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/shorts/short-2')
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/shorts/short-1')
  await expect(root.getByRole('dialog', { name: 'Description', exact: true })).toHaveCount(0)
})
