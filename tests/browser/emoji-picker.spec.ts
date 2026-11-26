import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/emoji-picker-harness.tsx'

test('reworked YouTube emoji picker works with channel tabs, skin tones, settings, and group dialog', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')

  const root = page.locator('[data-emoji-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as { mountEmojiPickerHarness: () => { picked: () => string[] } }
        const state = harness.mountEmojiPickerHarness()
        ;(window as unknown as { __emojiHarness?: typeof state }).__emojiHarness = state
      }, HARNESS)
    }
    await expect(root.getByRole('button', { name: 'Insert emoji', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  await root.getByRole('button', { name: 'Insert emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeVisible()
  await expect(picker.getByRole('tab', { name: 'Channel', exact: true })).toBeVisible()
  await expect(picker.getByRole('tab', { name: 'Smileys', exact: true })).toBeVisible()
  await expect(picker.getByRole('tab', { name: 'Gestures', exact: true })).toBeVisible()
  await expect(picker.getByRole('tab', { name: 'Travel', exact: true })).toBeVisible()
  await expect(picker.getByRole('tab', { name: 'Activities', exact: true })).toBeVisible()

  await picker.getByRole('button', { name: 'Choose skin tone', exact: true }).click()
  const tones = picker.getByRole('listbox', { name: 'Skin tone', exact: true })
  await expect(tones).toBeVisible()
  await tones.getByRole('option', { name: 'Medium skin tone', exact: true }).click()

  const thumbsUp = picker.getByRole('button', { name: 'Thumbs up', exact: true })
  await expect(thumbsUp).toHaveText('👍🏽')
  await thumbsUp.click()
  await picker.getByRole('button', { name: ':party:', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)

  const picked = await page.evaluate(() => (window as unknown as { __emojiHarness: { picked: () => string[] } }).__emojiHarness.picked())
  expect(picked).toEqual(['👍🏽', ':party: '])

  const customAppearance = root.locator('#custom-appearance')
  await customAppearance.getByRole('tab', { name: 'Emoji', exact: true }).click()
  const inlineGroup = customAppearance.getByRole('group', { name: 'Seek handle emojis', exact: true })
  await expect(inlineGroup.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeVisible()
  await expect(inlineGroup.getByRole('button', { name: 'Choose skin tone', exact: true })).toBeVisible()
  await expect(inlineGroup.getByRole('tab', { name: 'Travel', exact: true })).toBeVisible()
  await inlineGroup.getByRole('button', { name: 'Rocket', exact: true }).click()
  await expect(root.getByTestId('seek-handle-state')).toHaveText('🚀')

  await root.getByRole('button', { name: 'Open group dialog', exact: true }).click()
  const groupDialog = page.getByRole('dialog', { name: 'New group', exact: true })
  await expect(groupDialog).toBeVisible()
  await groupDialog.getByRole('button', { name: 'More emojis', exact: true }).click()
  await expect(picker).toBeVisible()

  // Escape dismisses only the stacked emoji picker while keeping GroupDialog open
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(groupDialog).toBeVisible()

  await groupDialog.getByRole('button', { name: 'More emojis', exact: true }).click()
  await expect(picker).toBeVisible()
  const pickerTopHit = await picker.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(hit && el.contains(hit))
  })
  expect(pickerTopHit).toBe(true)

  await picker.getByRole('button', { name: 'Rocket', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(groupDialog.getByRole('radio', { name: '🚀', exact: true })).toBeChecked()
  await groupDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(groupDialog).toHaveCount(0)
})
