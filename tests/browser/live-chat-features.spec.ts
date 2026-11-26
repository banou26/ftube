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

  // Distinct live chat card/row kinds & zero empty placeholders
  await expect(chat.locator("[data-chat-kind='sticker']")).toContainText('$5.00')
  await expect(chat.locator("[data-chat-kind='membership']")).toContainText('Member for 3 months')
  await expect(chat.locator("[data-chat-kind='gift']")).toContainText('sent a Treat!')
  await expect(chat.locator("[data-chat-kind='system']")).toContainText('Slow mode is active')

  // Ticker strip pill opens highlight detail banner and closes
  const ticker = chat.getByRole('region', { name: 'Chat highlights' })
  await expect(ticker).toContainText('$10.00')
  await ticker.getByRole('button', { name: /\$10\.00/ }).click()
  const tickerDetail = chat.getByRole('region', { name: 'Highlight detail' })
  await expect(tickerDetail).toContainText('Carol')
  await expect(tickerDetail).toContainText('Great stream today!')
  await tickerDetail.getByRole('button', { name: 'Close highlight' }).click()
  await expect(tickerDetail).toBeHidden()

  // Top Fan inline #1 badge & header button open Top fans leaderboard
  await chat.getByRole('button', { name: 'Top fan #1' }).click()
  const leaderboard = chat.getByRole('dialog', { name: 'Top fans' })
  await expect(leaderboard).toBeVisible()
  await expect(leaderboard).toContainText('Alice')
  await expect(leaderboard).toContainText('1,200 points')
  await expect(leaderboard).toContainText('Bob')
  await leaderboard.getByRole('button', { name: 'Close leaderboard' }).click()
  await expect(leaderboard).toBeHidden()

  await chat.getByRole('button', { name: 'Top fans' }).click()
  await expect(leaderboard).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(leaderboard).toBeHidden()
  await chat.getByRole('button', { name: 'Top fans' }).click()
  await expect(leaderboard).toBeVisible()
  await chat.getByRole('button', { name: 'Top fans' }).click()
  await expect(leaderboard).toBeHidden()

  // Live poll displays choices, accepts vote, updates percentages, and collapses/expands
  const poll = chat.getByRole('region', { name: 'Live poll' })
  await expect(poll).toContainText('Favorite player layout?')
  await poll.getByRole('button', { name: /Theater/ }).click()
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.votes ?? [])).toEqual([
    { videoId: 'live-1', pollId: 'poll-1', voteParams: 'vote-theater' },
  ])
  await expect(poll.getByRole('button', { name: /Theater/ })).toHaveAttribute('data-selected', 'true')
  await expect(poll.getByRole('button', { name: /Theater/ })).toContainText('64%')
  await poll.getByRole('button', { name: 'Collapse poll' }).click()
  await expect(poll.getByRole('button', { name: /Theater/ })).toBeHidden()
  await poll.getByRole('button', { name: 'Expand poll' }).click()
  await expect(poll.getByRole('button', { name: /Theater/ })).toBeVisible()

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

  // Author removal drops all messages by the moderated author
  await expect(chat.locator('.log')).toContainText('Welcome @alice!')
  await page.evaluate(() => window.__liveChatHarness?.pushPage({ removedAuthorIds: ['UCbob'] }))
  await expect(chat.locator('.log')).not.toContainText('Welcome @alice!')

  // Subscribers-only restriction hides compose input; Refresh unlocks into slow mode + local echo
  await page.evaluate(() => window.__liveChatHarness?.setRestricted(true))
  await expect(input).toBeHidden()
  const restrictionStatus = chat.getByRole('status')
  await expect(restrictionStatus).toContainText('Subscribers-only mode')
  await restrictionStatus.getByRole('button', { name: 'Refresh' }).click()
  await expect(chat.getByPlaceholder('Chat…')).toBeVisible()
  await expect(chat).toContainText('Slow mode (2s)')

  const unlockedInput = chat.getByPlaceholder('Chat…')
  await unlockedInput.fill('after unlock :party: 😀')
  await unlockedInput.press('Enter')
  await expect(chat.locator('.log')).toContainText('after unlock')
  await expect(chat.locator('.log .row', { hasText: 'after unlock' })).toHaveCount(1)
  const sendBtn = chat.locator('.compose .send-btn')
  await expect(sendBtn).toBeDisabled()
  await expect(sendBtn).toHaveText(/\ds/)
  await unlockedInput.fill('next')
  await expect(sendBtn).toHaveText('Send', { timeout: 5_000 })
  await expect(chat.locator('.log .row', { hasText: 'after unlock' })).toHaveCount(1)
  await expect(sendBtn).toBeEnabled()

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
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.views ?? [])).toEqual(['TOP', 'TOP', 'ALL'])

  await chat.getByRole('button', { name: 'Hide chat' }).click()
  await expect(chat).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.closedVideoIds ?? [])).toEqual(['live-1'])
  const showBtn = harness.getByRole('button', { name: 'Show chat' })
  await expect(showBtn).toBeVisible()
  await showBtn.click()
  await expect(harness.getByRole('region', { name: 'Live chat' })).toBeVisible()

  await page.evaluate(() => window.__liveChatHarness?.unmount())
  await expect.poll(() => page.evaluate(() => window.__liveChatHarness?.closedVideoIds ?? [])).toEqual(['live-1', 'live-1'])
})

test('makes avatars in live chat messages and pinned banner clickable channel links without breaking mentions', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
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

  for (const id of ['UCalice', 'UCbob', 'UCsupporter', 'UCmember', 'UCdonor', 'UCpayer', 'UCowner']) {
    const link = chat.locator(`a.avatar-link[href="/channel/${id}"]`)
    await expect(link, `expected avatar link for ${id}`).toBeVisible()
  }

  await chat.getByRole('button', { name: 'Mention Alice' }).click()
  await expect(chat.getByPlaceholder('Chat…')).toHaveValue('@alice ')
})

test('opens reactions tray vertically above trigger on hover, collapses on leave, and toggles pin on click', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
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
  const toggle = chat.getByRole('button', { name: 'Reactions' })
  const tray = chat.getByRole('group', { name: 'Local reactions' })
  await expect(toggle).toBeVisible()
  await expect(tray).toHaveCount(0)

  await toggle.hover()
  await expect(tray).toBeVisible()

  const toggleBox = await toggle.boundingBox()
  const trayBox = await tray.boundingBox()
  expect(toggleBox).not.toBeNull()
  expect(trayBox).not.toBeNull()
  expect(trayBox!.height).toBeGreaterThan(trayBox!.width * 2)
  expect(trayBox!.y + trayBox!.height).toBeLessThanOrEqual(toggleBox!.y + 2)

  const pickBoxes = await tray.locator('.reaction-pick').evaluateAll(els =>
    els.map(el => {
      const r = el.getBoundingClientRect()
      return { y: r.y + r.height / 2, x: r.x + r.width / 2 }
    }),
  )
  expect(pickBoxes.length).toBe(5)
  for (let i = 1; i < pickBoxes.length; i++) {
    expect(pickBoxes[i]!.y).toBeGreaterThan(pickBoxes[i - 1]!.y)
  }

  await tray.getByRole('button', { name: 'React ❤️' }).click()
  await expect(chat.locator('.reaction-particle')).toContainText('❤️')

  await chat.locator('.head').hover()
  await expect(tray).toHaveCount(0)

  await toggle.click()
  await expect(tray).toBeVisible()
  await chat.locator('.head').hover()
  await expect(tray).toBeVisible()

  await toggle.click()
  await expect(tray).toHaveCount(0)
})
