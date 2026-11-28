import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

const EMOJI_HARNESS = '/tests/browser/fixtures/emoji-picker-harness.tsx'

const openEmojiPickerTab = async (page: import('@playwright/test').Page) => {
  await page.goto('/settings')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Customization', exact: true }).click()
  const appearanceTab = page.getByRole('tab', { name: 'Appearance', exact: true })
  const emojiTab = page.getByRole('tab', { name: 'Emoji picker', exact: true })
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
  await expect(emojiTab).toBeVisible()
  await emojiTab.click()
  await expect(emojiTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/settings\?section=customization&tab=emoji-picker$/)
  return page.getByRole('region', { name: 'Emoji picker customization' })
}

test('navigates between Customization tabs including Emoji picker with URL persistence and fits phone viewport without overflow', async ({ page }) => {
  const section = await openEmojiPickerTab(page)
  const preview = section.getByRole('region', { name: 'Emoji picker preview' }).or(section.locator('[aria-label="Emoji picker preview"]'))
  await expect(preview).toBeVisible()

  // Reloading keeps the Emoji picker sub-tab active.
  await page.reload()
  const emojiTab = page.getByRole('tab', { name: 'Emoji picker', exact: true })
  await expect(emojiTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Emoji picker customization' })).toBeVisible()

  // Keyboard arrow navigation steps across Appearance, Player, and Emoji picker tabs.
  await emojiTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Player', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(emojiTab).toHaveAttribute('aria-selected', 'true')

  // Wide columns and large emojis remain free of horizontal overflow even at 390px phone width.
  await section.getByRole('group', { name: 'Emoji size', exact: true }).getByRole('button', { name: 'Large', exact: true }).click()
  await section.getByRole('group', { name: 'Emojis per row', exact: true }).getByRole('button', { name: '10', exact: true }).click()

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      { message: `horizontal overflow at width ${width}` },
    ).toBe(true)
  }
})

test('updates the live Emoji picker preview immediately for skin tone, size, columns, height, category, visibility toggles, and emoji picks', async ({ page }) => {
  const section = await openEmojiPickerTab(page)
  const preview = section.locator('[aria-label="Emoji picker preview"]')
  const panel = preview.locator('[data-emoji-size]')

  // Default preview attributes and sample pick behavior.
  await expect(panel).toHaveAttribute('data-emoji-size', 'medium')
  await expect(panel).toHaveAttribute('data-emoji-columns', '8')
  await expect(panel).toHaveAttribute('data-picker-height', 'medium')
  await expect(panel.getByRole('button', { name: 'Thumbs up', exact: true })).toHaveText('👍')

  await section.getByRole('group', { name: 'Default skin tone', exact: true }).getByRole('button', { name: 'Medium skin tone', exact: true }).click()
  const thumbsUp = panel.getByRole('button', { name: 'Thumbs up', exact: true })
  await expect(thumbsUp).toHaveText('👍🏽')
  await thumbsUp.click()
  await expect(preview.locator('[data-preview-picked="true"]')).toHaveText('👍🏽')
  await preview.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(preview.locator('[data-preview-picked="true"]')).toHaveText('None')

  // Size, columns, height, and default category update live attributes and tab selection.
  await section.getByRole('group', { name: 'Emoji size', exact: true }).getByRole('button', { name: 'Large', exact: true }).click()
  await expect(panel).toHaveAttribute('data-emoji-size', 'large')

  await section.getByRole('group', { name: 'Emojis per row', exact: true }).getByRole('button', { name: '6', exact: true }).click()
  await expect(panel).toHaveAttribute('data-emoji-columns', '6')

  await section.getByRole('group', { name: 'Picker height', exact: true }).getByRole('button', { name: 'Tall', exact: true }).click()
  await expect(panel).toHaveAttribute('data-picker-height', 'tall')

  await section.getByRole('group', { name: 'Default category', exact: true }).getByRole('button', { name: 'Hearts', exact: true }).click()
  await expect(panel.getByRole('tab', { name: 'Hearts', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => panel.locator('.emoji-grid').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  // Visibility toggles show and hide parts of the preview picker live.
  await expect(panel.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeVisible()
  await section.getByRole('checkbox', { name: 'Show search bar', exact: true }).uncheck()
  await expect(panel.getByRole('searchbox', { name: 'Search emoji', exact: true })).toHaveCount(0)
  await section.getByRole('checkbox', { name: 'Show search bar', exact: true }).check()
  await expect(panel.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeVisible()

  await section.getByRole('checkbox', { name: 'Show skin tone selector', exact: true }).uncheck()
  await expect(panel.getByRole('button', { name: 'Choose skin tone', exact: true })).toHaveCount(0)
  await section.getByRole('checkbox', { name: 'Show skin tone selector', exact: true }).check()
  await expect(panel.getByRole('button', { name: 'Choose skin tone', exact: true })).toBeVisible()

  await section.getByRole('checkbox', { name: 'Show category bar', exact: true }).uncheck()
  await expect(panel.getByRole('tablist', { name: 'Emoji categories', exact: true })).toHaveCount(0)
  await section.getByRole('checkbox', { name: 'Show category bar', exact: true }).check()
  await expect(panel.getByRole('tablist', { name: 'Emoji categories', exact: true })).toBeVisible()

  await expect(panel.locator('.emoji-section-title').first()).toBeVisible()
  await section.getByRole('checkbox', { name: 'Show section headings', exact: true }).uncheck()
  await expect(panel.locator('.emoji-section-title')).toHaveCount(0)
  await section.getByRole('checkbox', { name: 'Show section headings', exact: true }).check()
  await expect(panel.locator('.emoji-section-title').first()).toBeVisible()
})

test('propagates emoji picker customization settings into EmojiButton and supports reset with undo', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())

  const section = await openEmojiPickerTab(page)
  await section.getByRole('group', { name: 'Default skin tone', exact: true }).getByRole('button', { name: 'Dark skin tone', exact: true }).click()
  await section.getByRole('group', { name: 'Emojis per row', exact: true }).getByRole('button', { name: '6', exact: true }).click()
  await section.getByRole('group', { name: 'Default category', exact: true }).getByRole('button', { name: 'Hearts', exact: true }).click()
  await section.getByRole('checkbox', { name: 'Show search bar', exact: true }).uncheck()
  await section.getByRole('checkbox', { name: 'Show section headings', exact: true }).uncheck()
  await section.getByRole('checkbox', { name: 'Close after picking an emoji', exact: true }).check()

  // Verify settings apply to EmojiButton across navigation and reload without disturbing CustomAppearance's fluid picker.
  await page.goto('/privacy')
  await expect(async () => {
    if (await page.locator('[data-emoji-harness="true"]').count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as { mountEmojiPickerHarness: (customEmojis?: unknown[]) => { picked: () => string[] } }
        const state = harness.mountEmojiPickerHarness([])
        ;(window as unknown as { __emojiHarness?: typeof state }).__emojiHarness = state
      }, EMOJI_HARNESS)
    }
    await expect(page.getByRole('button', { name: 'Insert emoji', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const customAppearance = page.locator('#custom-appearance')
  await customAppearance.getByRole('tab', { name: 'Emoji', exact: true }).click()
  const seekEmojiGroup = customAppearance.getByRole('group', { name: 'Seek handle emojis', exact: true })
  await expect(seekEmojiGroup.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeVisible()
  await expect(seekEmojiGroup.locator('[data-emoji-size]')).toHaveClass(/fluid-grid/)

  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Emoji picker', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-emoji-columns="6"]')).toBeVisible()
  await expect(dialog.locator('.emoji-section-title')).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Hearts', exact: true })).toBeFocused()
  await expect.poll(() => dialog.locator('.emoji-grid').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  const darkThumbs = dialog.getByRole('button', { name: 'Thumbs up', exact: true })
  await expect(darkThumbs).toHaveText('👍🏿')
  await darkThumbs.click()
  await expect(dialog).toHaveCount(0)
  const picked = await page.evaluate(() => (window as unknown as { __emojiHarness: { picked: () => string[] } }).__emojiHarness.picked())
  expect(picked).toEqual(['👍🏿'])

  // Reset to default restores defaults and Toast Undo restores customizations.
  await page.goto('/settings?section=customization&tab=emoji-picker')
  const reloadedSection = page.getByRole('region', { name: 'Emoji picker customization' })
  await expect(reloadedSection.getByRole('checkbox', { name: 'Close after picking an emoji', exact: true })).toBeChecked()

  await reloadedSection.getByRole('button', { name: 'Reset to default', exact: true }).click()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Show search bar', exact: true })).toBeChecked()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Show section headings', exact: true })).toBeChecked()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Close after picking an emoji', exact: true })).not.toBeChecked()
  await expect(reloadedSection.locator('[data-emoji-columns="8"]')).toBeVisible()

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Show search bar', exact: true })).not.toBeChecked()
  await expect(reloadedSection.getByRole('checkbox', { name: 'Close after picking an emoji', exact: true })).toBeChecked()
  await expect(reloadedSection.locator('[data-emoji-columns="6"]')).toBeVisible()
})
