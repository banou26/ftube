import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/live-chat-harness.tsx'
const OVERLAY_STORAGE_KEY = 'yt-client:over-screen-messages'

const mountHarness = async (page: import('@playwright/test').Page) => {
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
  return harness
}

test('projects incremental chat and emoji-only messages over the screen with customizable settings and moderation cleanup', async ({ page }) => {
  const harness = await mountHarness(page)
  const chat = harness.getByRole('region', { name: 'Live chat' })
  await expect(chat).toBeVisible()

  const toggleBtn = chat.getByRole('button', { name: 'Over-screen chat messages', exact: true })
  const customizeBtn = chat.getByRole('button', { name: 'Customize over-screen messages', exact: true })
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-over-screen-overlay="true"]')).toHaveCount(0)

  // Enabling over-screen messages mounts the non-interactive viewport overlay without replaying initial history.
  await toggleBtn.click()
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true')
  const overlay = page.locator('[data-over-screen-overlay="true"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveCSS('pointer-events', 'none')
  await expect(overlay.locator('[data-overlay-item]')).toHaveCount(0)

  // Open customize panel and verify Test preview spawns items, then close with Escape.
  await customizeBtn.click()
  const panel = chat.getByRole('dialog', { name: 'Over-screen chat messages' })
  await expect(panel).toBeVisible()

  await panel.getByLabel('Text animation', { exact: true }).selectOption('shake')
  await panel.getByLabel('Emoji-only animation', { exact: true }).selectOption('shatter')
  await panel.getByLabel('Overlay font', { exact: true }).selectOption('mono')
  await panel.getByRole('button', { name: 'Test preview', exact: true }).click()

  await expect(overlay.locator('[data-overlay-kind="exclamation"][data-overlay-animation="shake"]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-kind="emoji-only"][data-overlay-animation="shatter"]')).toHaveCount(1)
  await expect(overlay).toHaveAttribute('data-font-family', 'mono')

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // Live pushed text, Unicode emoji-only, custom emoji-only, and self-sent messages render over-screen.
  await page.evaluate(() => {
    window.__liveChatHarness?.pushPage({
      items: [
        {
          id: 'live-text-1',
          kind: 'TEXT',
          text: 'HYPE IN CHAT!',
          runs: [{ text: 'HYPE IN CHAT!' }],
          author: { id: 'UCalice', name: 'Alice', handle: '@alice' },
        },
        {
          id: 'live-emoji-1',
          kind: 'TEXT',
          text: '🔥🔥🔥',
          runs: [{ text: '🔥🔥🔥' }],
          author: { id: 'UCbob', name: 'Bob', handle: '@bob' },
        },
        {
          id: 'live-mod-target',
          kind: 'TEXT',
          text: 'Temporary spam message',
          runs: [{ text: 'Temporary spam message' }],
          author: { id: 'UCspam', name: 'Spammer', handle: '@spammer' },
        },
      ],
    })
  })

  await expect(overlay.locator('[data-overlay-item="live-text-1"]')).toContainText('HYPE IN CHAT!')
  await expect(overlay.locator('[data-overlay-item="live-text-1"]')).toHaveAttribute('data-overlay-kind', 'caps')
  await expect(overlay.locator('[data-overlay-item="live-emoji-1"]')).toHaveAttribute('data-overlay-kind', 'emoji-only')
  await expect(overlay.locator('[data-overlay-item="live-mod-target"]')).toBeVisible()

  // Moderation removal immediately removes the deleted message from the overlay too.
  await page.evaluate(() => {
    window.__liveChatHarness?.pushPage({
      items: [],
      removedIds: ['live-mod-target'],
    })
  })
  await expect(overlay.locator('[data-overlay-item="live-mod-target"]')).toHaveCount(0)

  // Viewer's own sent chat appears immediately on screen.
  const input = chat.locator('form.compose input')
  await input.fill('viewer wave!')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(overlay.locator('[data-overlay-item]')).toContainText(['viewer wave!'])

  // Settings persist across reload in localStorage.
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>, OVERLAY_STORAGE_KEY)
  expect(stored.enabled).toBe(true)
  expect(stored.textAnimation).toBe('shake')
  expect(stored.emojiAnimation).toBe('shatter')
  expect(stored.fontFamily).toBe('mono')

  const reloadedHarness = await mountHarness(page)
  const reloadedChat = reloadedHarness.getByRole('region', { name: 'Live chat' })
  await expect(reloadedChat.getByRole('button', { name: 'Over-screen chat messages', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-over-screen-overlay="true"]')).toHaveAttribute('data-text-animation', 'shake')

  // Disabling immediately clears active overlay items.
  await reloadedChat.getByRole('button', { name: 'Over-screen chat messages', exact: true }).click()
  await expect(page.locator('[data-over-screen-overlay="true"]')).toHaveCount(0)
})

test('keeps over-screen messages active after closing the live chat panel and stops them once turned off after reopening', async ({ page }) => {
  const harness = await mountHarness(page)
  const chat = harness.getByRole('region', { name: 'Live chat' })
  const toggleBtn = chat.getByRole('button', { name: 'Over-screen chat messages', exact: true })

  await toggleBtn.click()
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true')
  const overlay = page.locator('[data-over-screen-overlay="true"]')
  await expect(overlay).toBeVisible()

  // Closing the chat panel hides it without interrupting live over-screen messages
  await chat.getByRole('button', { name: 'Hide chat', exact: true }).click()
  await expect(chat).toBeHidden()
  const showBtn = harness.getByRole('button', { name: 'Show chat', exact: true })
  await expect(showBtn).toBeVisible()
  await expect(overlay).toBeVisible()

  await page.evaluate(() => {
    window.__liveChatHarness?.pushPage({
      items: [
        {
          id: 'after-close-msg',
          kind: 'TEXT',
          text: 'Still streaming while closed',
          runs: [{ text: 'Still streaming while closed' }],
          author: { id: 'UCbob', name: 'Bob', handle: '@bob' },
        },
      ],
    })
  })
  await expect(overlay.locator('[data-overlay-item="after-close-msg"]')).toContainText('Still streaming while closed')
  expect(await page.evaluate(() => window.__liveChatHarness?.closedVideoIds ?? [])).toEqual([])

  // Reopening chat keeps Over-screen enabled, and turning it off stops subsequent overlay messages
  await showBtn.click()
  const reopenedChat = harness.getByRole('region', { name: 'Live chat' })
  const reopenedToggle = reopenedChat.getByRole('button', { name: 'Over-screen chat messages', exact: true })
  await expect(reopenedChat).toBeVisible()
  await expect(reopenedToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(reopenedChat.locator('.log')).toContainText('Still streaming while closed')

  await reopenedToggle.click()
  await expect(reopenedToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(overlay).toHaveCount(0)

  await page.evaluate(() => {
    window.__liveChatHarness?.pushPage({
      items: [
        {
          id: 'after-disable-msg',
          kind: 'TEXT',
          text: 'Panel only after disabling',
          runs: [{ text: 'Panel only after disabling' }],
          author: { id: 'UCalice', name: 'Alice', handle: '@alice' },
        },
      ],
    })
  })
  await expect(reopenedChat.locator('.log')).toContainText('Panel only after disabling')
  await expect(overlay).toHaveCount(0)
})
