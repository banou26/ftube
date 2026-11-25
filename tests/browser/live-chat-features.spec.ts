import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/live-chat-harness.tsx'

test('supports hide/show toggle, Top/Live view switching, pinned banner, emojis, reactions, and mentions', async ({ page }) => {
  await page.goto('/privacy')
  const harness = page.locator('[data-live-chat-harness]')
  await expect(async () => {
    if (await harness.count() === 0) {
      await page.evaluate(async (path) => {
        const mod = await import(path) as typeof import('./fixtures/live-chat-harness')
        mod.mountLiveChatHarness()
      }, HARNESS)
    }
    await expect(harness).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const chat = harness.getByRole('region', { name: 'Live chat' })
  await expect(chat).toBeVisible()
  await expect(chat.getByRole('region', { name: 'Pinned message' })).toContainText('Pinned by Streamer')
  await expect(chat.getByRole('region', { name: 'Pinned message' })).toContainText('Welcome to the stream')

  await expect(chat.locator('.log .mention.self')).toContainText('@viewer')
  await expect(chat.locator('.log .mention:not(.self)')).toContainText('@alice')

  await page.setViewportSize({ width: 1280, height: 900 })
  const box = await chat.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(480)

  await chat.getByRole('button', { name: 'Insert emoji' }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji picker' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: ':party:' }).click()
  await picker.getByRole('button', { name: 'Grinning face', exact: true }).click()
  await page.keyboard.press('Escape')
  const input = chat.getByPlaceholder('Chat…')
  await expect(input).toHaveValue(':party: 😀')

  await input.fill('')
  await chat.getByRole('button', { name: 'Mention Alice' }).click()
  await expect(input).toHaveValue('@alice ')

  await input.fill('hi @bo')
  await input.click()
  const mentions = chat.getByRole('listbox', { name: 'Mention suggestions' })
  await expect(mentions).toBeVisible()
  await expect(mentions.getByRole('option')).toContainText('Bob')
  await input.press('Enter')
  await expect(input).toHaveValue('hi @bob_dev ')

  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.sent ?? [])).toEqual(['hi @bob_dev'])

  await chat.getByRole('button', { name: 'Reactions' }).click()
  const tray = chat.getByRole('group', { name: 'Local reactions' })
  await expect(tray).toBeVisible()
  await tray.getByRole('button', { name: 'React 🎉' }).click()
  await expect(chat.locator('.reaction-particle')).toContainText('🎉')

  await page.evaluate(() => window.__liveChatHarness?.clearPin())
  await expect(chat.getByRole('region', { name: 'Pinned message' })).toBeHidden()

  await chat.getByRole('button', { name: /Top chat/ }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Live chat' }).click()
  await expect(chat.getByText('Unfiltered message in Live chat')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.views ?? [])).toEqual(['TOP', 'ALL'])

  await chat.getByRole('button', { name: 'Hide chat' }).click()
  await expect(chat).toBeHidden()
  const showBtn = harness.getByRole('button', { name: 'Show chat' })
  await expect(showBtn).toBeVisible()
  await showBtn.click()
  await expect(harness.getByRole('region', { name: 'Live chat' })).toBeVisible()
})
