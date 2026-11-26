import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/comments-harness.tsx'

test('renders creator hearts, vertical reply thread connectors, creator pills, and emoji picker in both composers', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/settings')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })

  const root = page.locator('[data-comments-harness="true"]')
  await expect(async () => {
    await page.evaluate(async (path) => {
      const harness = await import(path) as { mountCommentsHarness: () => { postedComments: () => string[], postedReplies: () => { actionsToken: string, text: string }[] } }
      const state = harness.mountCommentsHarness()
      ;(window as unknown as { __commentsHarness?: typeof state }).__commentsHarness = state
    }, HARNESS)
    await expect(root.locator('.comment')).toHaveCount(2, { timeout: 15_000 })
  }).toPass({ timeout: 120_000 })

  const firstComment = root.locator('.comment').nth(0)
  await expect(firstComment.locator('[data-pinned-comment="true"]')).toHaveCount(0)
  const firstHeart = firstComment.locator('.actions [data-creator-heart="true"]')
  await expect(firstHeart).toHaveAttribute('aria-label', 'Loved by Creator')
  await expect(firstHeart).toHaveAttribute('title', 'Loved by Creator')
  await expect(firstHeart.locator('img.heart-avatar')).toHaveJSProperty('complete', true)
  const heartImgWidth = await firstHeart.locator('img.heart-avatar').evaluate((img: HTMLImageElement) => img.naturalWidth)
  expect(heartImgWidth).toBeGreaterThan(0)

  const secondComment = root.locator('.comment').nth(1)
  const pinnedBadge = secondComment.locator('[data-pinned-comment="true"]')
  await expect(pinnedBadge).toBeVisible()
  await expect(pinnedBadge).toHaveText('Pinned by @Creator')
  await expect(pinnedBadge.locator('svg')).toBeVisible()
  const pinnedBelowByline = await secondComment.evaluate((el) => {
    const pin = el.querySelector('[data-pinned-comment="true"]')!.getBoundingClientRect()
    const byline = el.querySelector('.byline')!.getBoundingClientRect()
    return pin.bottom <= byline.top + 1
  })
  expect(pinnedBelowByline).toBe(true)
  await expect(secondComment.locator('.author.creator')).toBeVisible()
  const fallbackHeart = secondComment.locator('.actions [data-creator-heart="true"]')
  await expect(fallbackHeart).toHaveAttribute('aria-label', 'Loved by creator')
  await expect(fallbackHeart.locator('img')).toHaveCount(0)
  await expect(fallbackHeart.locator('svg')).toBeVisible()

  const repliesToggle = firstComment.getByRole('button', { name: '2 replies', exact: true })
  await repliesToggle.click()
  const replyRows = firstComment.locator('.reply-list .reply-row')
  await expect(replyRows).toHaveCount(2)
  await expect(replyRows.nth(0).locator('[data-creator-heart="true"]')).toBeVisible()
  await expect(replyRows.nth(1).locator('[data-creator-heart="true"]')).toHaveCount(0)
  await expect(replyRows.nth(1).locator('.name.creator')).toBeVisible()

  const connectorMetrics = await replyRows.evaluateAll((rows) =>
    rows.map((row) => {
      const before = getComputedStyle(row, '::before')
      const after = getComputedStyle(row, '::after')
      return {
        beforeLeft: Number.parseFloat(before.borderLeftWidth),
        beforeBottom: Number.parseFloat(before.borderBottomWidth),
        beforeColor: before.borderLeftColor,
        beforeContent: before.content,
        afterLeft: Number.parseFloat(after.borderLeftWidth),
        afterContent: after.content,
      }
    }),
  )
  expect(connectorMetrics[0]!.beforeContent).not.toBe('none')
  expect(connectorMetrics[0]!.beforeLeft).toBeGreaterThan(0)
  expect(connectorMetrics[0]!.beforeBottom).toBeGreaterThan(0)
  expect(connectorMetrics[0]!.afterContent).not.toBe('none')
  expect(connectorMetrics[0]!.afterLeft).toBeGreaterThan(0)
  expect(connectorMetrics[1]!.beforeContent).not.toBe('none')
  expect(connectorMetrics[1]!.beforeLeft).toBeGreaterThan(0)
  expect(connectorMetrics[1]!.afterContent).toBe('none')

  const threadLine = firstComment.locator('.reply-rows button.thread-line')
  await expect(threadLine).toBeVisible()
  await expect(threadLine).toHaveAttribute('aria-label', 'Collapse replies')
  const railGeometry = await firstComment.evaluate(() => {
    const rail = document.querySelector('.reply-rows button.thread-line')!.getBoundingClientRect()
    const avatar = document.querySelector('.reply-rows .reply-row .avatar')!.getBoundingClientRect()
    return { railRight: rail.right, railHeight: rail.height, avatarLeft: avatar.left }
  })
  expect(railGeometry.railHeight).toBeGreaterThan(40)
  expect(railGeometry.railRight).toBeLessThanOrEqual(railGeometry.avatarLeft + 0.5)

  await threadLine.hover()
  await expect.poll(() =>
    replyRows.nth(0).evaluate((row) => getComputedStyle(row, '::before').borderLeftColor),
  ).not.toBe(connectorMetrics[0]!.beforeColor)

  await threadLine.click()
  await expect(replyRows).toHaveCount(0)
  await expect(repliesToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(repliesToggle).toBeFocused()
  await repliesToggle.click()
  await expect(replyRows).toHaveCount(2)

  const topComposer = root.locator('.composer.top')
  const topInput = topComposer.getByRole('textbox', { name: 'Add a comment', exact: true })
  await topInput.fill('Hi there')
  await topInput.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2))
  await topComposer.getByRole('button', { name: 'Insert emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('searchbox', { name: 'Search emoji', exact: true }).fill('fire')
  await picker.getByRole('button', { name: 'Fire', exact: true }).click()
  await expect(topInput).toHaveValue('Hi🔥 there')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await topComposer.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(topInput).toHaveValue('')

  await firstComment.getByRole('button', { name: 'Reply', exact: true }).click()
  const replyComposer = firstComment.locator('.composer')
  const replyInput = replyComposer.getByRole('textbox', { name: 'Add a reply', exact: true })
  await replyInput.fill('Great')
  await replyComposer.getByRole('button', { name: 'Insert emoji', exact: true }).click()
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('searchbox', { name: 'Search emoji', exact: true })).toBeFocused()
  const smileysTab = picker.getByRole('tab', { name: 'Smileys', exact: true })
  await smileysTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(picker.getByRole('tab', { name: 'Gestures', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(picker.getByRole('tab', { name: 'Gestures', exact: true })).toBeFocused()
  await picker.getByRole('button', { name: 'Clapping hands', exact: true }).click()
  await expect(replyInput).toHaveValue('Great👏')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await replyComposer.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(replyComposer).toHaveCount(0)

  const posted = await page.evaluate(() => {
    const state = (window as unknown as { __commentsHarness: { postedComments: () => string[], postedReplies: () => { actionsToken: string, text: string }[] } }).__commentsHarness
    return { comments: state.postedComments(), replies: state.postedReplies() }
  })
  expect(posted.comments).toEqual(['Hi🔥 there'])
  expect(posted.replies).toEqual([{ actionsToken: 'tok-1', text: 'Great👏' }])
})

test('opens mini profile card when clicking top-level or reply commenter avatar', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')

  const root = page.locator('[data-comments-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/comments-harness')
        harness.mountCommentsHarness()
      }, HARNESS)
    }
    await expect(root.locator('.comment')).toHaveCount(2, { timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const firstComment = root.locator('.comment').nth(0)
  await firstComment.getByRole('button', { name: 'View @fan profile', exact: true }).click()
  const card = page.locator('[data-comment-profile-card="UC1"]')
  await expect(card).toBeVisible()
  expect(page.url()).toContain('/privacy')
  await expect(card).toContainText('Fan Commenter')
  await expect(card).toContainText('@fan')
  await expect(card).toContainText('Joined Mar 15, 2016')
  await expect(card).toContainText('52 subscribers')
  await expect(card.getByRole('link', { name: 'View channel', exact: true })).toHaveAttribute('href', '/channel/UC1')

  const subBtn = card.getByRole('button', { name: 'Subscribe', exact: true })
  await subBtn.click()
  await expect(card.getByRole('button', { name: 'Subscribed', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)

  await firstComment.getByRole('button', { name: '2 replies', exact: true }).click()
  await firstComment.getByRole('button', { name: 'View @reply1 profile', exact: true }).click()
  const replyCard = page.locator('[data-comment-profile-card="UC2"]')
  await expect(replyCard).toBeVisible()
  await expect(replyCard).toContainText('Reply Author')

  await page.mouse.click(8, 8)
  await expect(replyCard).toHaveCount(0)
})
