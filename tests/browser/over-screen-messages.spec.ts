import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/live-chat-harness.tsx'
const OVERLAY_STORAGE_KEY = 'yt-client:over-screen-messages'

const mountHarness = async (
  page: import('@playwright/test').Page,
  storedSettings?: Record<string, unknown>,
) => {
  if (storedSettings) {
    await page.addInitScript(
      ({ key, value }) => {
        if (window !== top) return
        localStorage.setItem(key, JSON.stringify(value))
      },
      { key: OVERLAY_STORAGE_KEY, value: storedSettings },
    )
  }
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

const pickMenuOption = async (
  page: import('@playwright/test').Page,
  panel: import('@playwright/test').Locator,
  label: string,
  optionLabel: string,
) => {
  await panel.getByRole('combobox', { name: label, exact: true }).click()
  const listbox = page.getByRole('listbox', { name: label, exact: true })
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
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

  await pickMenuOption(page, panel, 'Text animation', 'Shake')
  await pickMenuOption(page, panel, 'Emoji-only animation', 'Shatter')
  await pickMenuOption(page, panel, 'ALL CAPS animation', 'Pop in')
  await pickMenuOption(page, panel, 'Question animation', 'Fade')
  await pickMenuOption(page, panel, 'Exclamation animation', 'Bounce')
  await pickMenuOption(page, panel, 'Overlay font', 'Monospace')
  await panel.getByRole('button', { name: 'Test preview', exact: true }).click()

  await expect(overlay.locator('[data-overlay-kind="normal"][data-overlay-animation="shake"]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-kind="caps"][data-overlay-animation="pop"]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-kind="question"][data-overlay-animation="fade"]')).toHaveCount(1)
  await expect(overlay.locator('[data-overlay-kind="exclamation"][data-overlay-animation="bounce"]')).toHaveCount(1)
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
  expect(stored.capsAnimation).toBe('pop')
  expect(stored.questionAnimation).toBe('fade')
  expect(stored.exclamationAnimation).toBe('bounce')
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

  await page.evaluate(() => {
    window.__liveChatHarness?.pushPage({
      items: [
        {
          id: 'before-close-msg',
          kind: 'TEXT',
          text: 'Visible before hiding',
          runs: [{ text: 'Visible before hiding' }],
          author: { id: 'UCalice', name: 'Alice', handle: '@alice' },
        },
      ],
    })
  })
  const beforeCloseItem = overlay.locator('[data-overlay-item="before-close-msg"]')
  await expect(beforeCloseItem).toBeVisible()
  await beforeCloseItem.evaluate((el) => {
    el.setAttribute('data-persist-marker', 'same-node')
  })

  // Closing the chat panel hides it without remounting or replaying active overlay items
  await chat.getByRole('button', { name: 'Hide chat', exact: true }).click()
  await expect(chat).toBeHidden()
  const showBtn = harness.getByRole('button', { name: 'Show chat', exact: true })
  await expect(showBtn).toBeVisible()
  await expect(overlay).toBeVisible()
  await expect(beforeCloseItem).toHaveCount(1)
  await expect(beforeCloseItem).toHaveAttribute('data-persist-marker', 'same-node')

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
  const afterCloseItem = overlay.locator('[data-overlay-item="after-close-msg"]')
  await expect(afterCloseItem).toContainText('Still streaming while closed')
  await afterCloseItem.evaluate((el) => {
    el.setAttribute('data-persist-marker', 'still-same')
  })
  expect(await page.evaluate(() => window.__liveChatHarness?.closedVideoIds ?? [])).toEqual([])

  // Reopening chat keeps Over-screen enabled without replaying active items, and turning it off stops subsequent overlay messages
  await showBtn.click()
  const reopenedChat = harness.getByRole('region', { name: 'Live chat' })
  const reopenedToggle = reopenedChat.getByRole('button', { name: 'Over-screen chat messages', exact: true })
  await expect(reopenedChat).toBeVisible()
  await expect(afterCloseItem).toHaveCount(1)
  await expect(afterCloseItem).toHaveAttribute('data-persist-marker', 'still-same')
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

test('independently toggles over-screen avatars and usernames, migrates legacy showAuthor, and toggles style-by-type', async ({ page }) => {
  // Legacy persisted state without showAvatar migrates showAvatar from showAuthor.
  const harness = await mountHarness(page, { enabled: true, showAuthor: false, speed: 0.5 })
  const chat = harness.getByRole('region', { name: 'Live chat' })
  await chat.getByRole('button', { name: 'Customize over-screen messages', exact: true }).click()
  const panel = chat.getByRole('dialog', { name: 'Over-screen chat messages' })
  const avatarsToggle = panel.getByLabel('Show avatars', { exact: true })
  const usernamesToggle = panel.getByLabel('Show usernames', { exact: true })
  await expect(avatarsToggle).not.toBeChecked()
  await expect(usernamesToggle).not.toBeChecked()

  const overlay = page.locator('[data-over-screen-overlay="true"]')
  await expect(overlay).toBeVisible()

  const avatarUri = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3ea6ff"/></svg>',
  )
  await page.evaluate((avatar) => {
    window.__liveChatHarness?.pushPage({
      items: [
        {
          id: 'perm-1',
          kind: 'TEXT',
          text: 'Avatar and name test?',
          runs: [{ text: 'Avatar and name test?' }],
          author: { id: 'UCimg', name: 'Mina', handle: '@mina', avatar },
        },
        {
          id: 'perm-2',
          kind: 'TEXT',
          text: 'Fallback avatar check',
          runs: [{ text: 'Fallback avatar check' }],
          author: { id: 'UCnoimg', name: 'Bob', handle: '@bob' },
        },
      ],
    })
  }, avatarUri)

  const itemWithImg = overlay.locator('[data-overlay-item="perm-1"]')
  const itemFallback = overlay.locator('[data-overlay-item="perm-2"]')
  await expect(itemWithImg).toBeVisible()
  await expect(itemWithImg.locator('.overlay-avatar')).toHaveCount(0)
  await expect(itemWithImg.locator('.overlay-author')).toHaveCount(0)
  await expect(itemWithImg).toHaveAttribute('data-overlay-kind', 'question')
  await expect(itemWithImg).toHaveAttribute('data-overlay-animation', 'bounce')

  // Enable only Show avatars: renders avatar image and initial fallback without usernames.
  await avatarsToggle.check()
  await expect(avatarsToggle).toBeChecked()
  await expect(usernamesToggle).not.toBeChecked()
  await expect(itemWithImg.locator('img.overlay-avatar')).toHaveCount(1)
  await expect(itemWithImg.locator('.overlay-author')).toHaveCount(0)
  await expect(itemFallback.locator('.overlay-avatar.fallback')).toHaveText('B')
  await expect(itemFallback.locator('.overlay-author')).toHaveCount(0)

  // Turn avatars off and usernames on: renders usernames without avatars.
  await avatarsToggle.uncheck()
  await usernamesToggle.check()
  await expect(itemWithImg.locator('.overlay-avatar')).toHaveCount(0)
  await expect(itemWithImg.locator('.overlay-author')).toHaveText('Mina')
  await expect(itemFallback.locator('.overlay-avatar')).toHaveCount(0)
  await expect(itemFallback.locator('.overlay-author')).toHaveText('Bob')

  // Enable both together: both avatar and username render.
  await avatarsToggle.check()
  await expect(itemWithImg.locator('img.overlay-avatar')).toHaveCount(1)
  await expect(itemWithImg.locator('.overlay-author')).toHaveText('Mina')

  // Disabling Style by message type hides per-type selects and uses Text animation for questions.
  const styleByTypeToggle = panel.getByLabel('Style by message type', { exact: true })
  await expect(panel.getByLabel('Question animation', { exact: true })).toBeVisible()
  await styleByTypeToggle.uncheck()
  await expect(panel.getByLabel('Question animation', { exact: true })).toHaveCount(0)

  await panel.getByRole('button', { name: 'Test preview', exact: true }).click()
  const previewQuestion = overlay.locator('[data-overlay-kind="question"]').last()
  await expect(previewQuestion).toHaveAttribute('data-overlay-animation', 'scroll')
})

test('animates over-screen animation menu items live, preserves Escape layering, and respects prefers-reduced-motion', async ({ page }) => {
  const harness = await mountHarness(page)
  const chat = harness.getByRole('region', { name: 'Live chat' })
  await chat.getByRole('button', { name: 'Customize over-screen messages', exact: true }).click()
  const panel = chat.getByRole('dialog', { name: 'Over-screen chat messages' })
  await expect(panel).toBeVisible()

  const textCombo = panel.getByRole('combobox', { name: 'Text animation', exact: true })
  await textCombo.click()
  const textList = page.getByRole('listbox', { name: 'Text animation', exact: true })
  await expect(textList).toBeVisible()

  const textAnimations = await textList.locator('[data-preview-animation]').evaluateAll((els) =>
    els.map((el) => ({
      kind: el.getAttribute('data-preview-animation'),
      animationName: getComputedStyle(el).animationName,
    })),
  )
  expect(textAnimations.map((entry) => entry.kind)).toEqual(['scroll', 'shake', 'pop', 'bounce', 'fade'])
  expect(textAnimations.every((entry) => entry.animationName && entry.animationName !== 'none')).toBe(true)
  expect(new Set(textAnimations.map((entry) => entry.animationName)).size).toBe(5)

  // First Escape closes only the listbox and keeps the panel open with focus restored to the trigger.
  await page.keyboard.press('Escape')
  await expect(textList).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(textCombo).toBeFocused()

  // Emoji-only and per-type selectors also preview animations inside their options.
  await panel.getByRole('combobox', { name: 'Emoji-only animation', exact: true }).click()
  const emojiList = page.getByRole('listbox', { name: 'Emoji-only animation', exact: true })
  await expect(emojiList).toBeVisible()
  const emojiAnimations = await emojiList.locator('[data-preview-animation]').evaluateAll((els) =>
    els.map((el) => ({
      kind: el.getAttribute('data-preview-animation'),
      animationName: getComputedStyle(el).animationName,
    })),
  )
  const burstAnim = emojiAnimations.find((entry) => entry.kind === 'burst')?.animationName
  const shatterAnim = emojiAnimations.find((entry) => entry.kind === 'shatter')?.animationName
  expect(burstAnim && burstAnim !== 'none').toBe(true)
  expect(shatterAnim && shatterAnim !== 'none').toBe(true)
  expect(burstAnim).not.toBe(shatterAnim)

  await page.keyboard.press('Escape')
  await expect(emojiList).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await chat.getByRole('button', { name: 'Customize over-screen messages', exact: true }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('combobox', { name: 'Question animation', exact: true }).click()
  const questionList = page.getByRole('listbox', { name: 'Question animation', exact: true })
  await expect(questionList).toBeVisible()
  const questionNames = await questionList.locator('[data-preview-animation]').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationName),
  )
  expect(questionNames.every((name) => name && name !== 'none')).toBe(true)
  await page.keyboard.press('Escape')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await textCombo.click()
  await expect(textList).toBeVisible()
  const reducedNames = await textList.locator('[data-preview-animation]').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationName),
  )
  expect(reducedNames).toEqual(['none', 'none', 'none', 'none', 'none'])
  await page.keyboard.press('Escape')

  // Font style selector renders each option and selected trigger in its own font family.
  const fontCombo = panel.getByRole('combobox', { name: 'Overlay font', exact: true })
  await fontCombo.click()
  const fontList = page.getByRole('listbox', { name: 'Overlay font', exact: true })
  await expect(fontList).toBeVisible()
  const fontSamples = await fontList.locator('[data-font-family]').evaluateAll((els) =>
    els.map((el) => ({
      value: el.getAttribute('data-font-family'),
      fontFamily: getComputedStyle(el).fontFamily.toLowerCase(),
    })),
  )
  expect(fontSamples.find((s) => s.value === 'system')?.fontFamily).toContain('roboto')
  expect(fontSamples.find((s) => s.value === 'rounded')?.fontFamily).toContain('rounded')
  expect(fontSamples.find((s) => s.value === 'mono')?.fontFamily).toContain('monospace')
  expect(fontSamples.find((s) => s.value === 'serif')?.fontFamily).toContain('georgia')
  expect(fontSamples.find((s) => s.value === 'display')?.fontFamily).toContain('impact')

  await fontList.getByRole('option', { name: 'Serif', exact: true }).click()
  await expect(fontList).toHaveCount(0)
  const triggerFont = await fontCombo.locator('.trigger-label').evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())
  expect(triggerFont).toContain('georgia')
})
