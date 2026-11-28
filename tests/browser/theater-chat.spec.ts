import type { WatchHarnessOptions } from './fixtures/watch-harness'
import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'

const mountTheaterWatch = async (
  page: Page,
  videoId: string,
  viewport: { width: number, height: number },
  options: Omit<WatchHarnessOptions, 'videoId' | 'longDescription'> = {},
) => {
  await page.setViewportSize(viewport)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  await expect(page.locator('#app main')).toBeVisible({ timeout: 30_000 })
  const host = page.locator(`[data-watch-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness(opts)
      }, [HARNESS, { ...options, theater: options.theater ?? 'fullscreen', videoId, longDescription: true }] as const)
    }
    await expect(host.locator('main.theater .stage [data-player-root]')).toBeVisible({ timeout: 5_000 })
    await expect(host.getByRole('heading', { name: `Harness Video ${videoId}` })).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

const expectRailClearOfPlayer = async (host: ReturnType<Page['locator']>) => {
  const metrics = await host.evaluate((el) => {
    const rail = el.querySelector<HTMLElement>('aside.theater-chat-rail')!.getBoundingClientRect()
    const player = el.querySelector<HTMLElement>('main.theater .stage [data-player-root]')!.getBoundingClientRect()
    const columns = el.querySelector<HTMLElement>('main.theater .columns')!.getBoundingClientRect()
    return {
      top: rail.top,
      bottom: rail.bottom,
      left: rail.left,
      right: rail.right,
      playerRight: player.right,
      columnsRight: columns.right,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
  expect(metrics.playerRight).toBeLessThanOrEqual(metrics.left + 1)
  expect(metrics.columnsRight).toBeLessThanOrEqual(metrics.left + 1)
  expect(Math.abs(metrics.right - metrics.innerWidth)).toBeLessThanOrEqual(2)
  expect(Math.abs(metrics.top - 56)).toBeLessThanOrEqual(2)
  expect(Math.abs(metrics.bottom - metrics.innerHeight)).toBeLessThanOrEqual(2)
  return metrics
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1000, height: 800 },
]) {
  test(`docks live chat full-height on the right in theater mode without overlapping player or horizontal overflow (${viewport.width}x${viewport.height})`, async ({ page }) => {
    const host = await mountTheaterWatch(page, `theater-live-${viewport.width}`, viewport, { isLive: true })

    const rail = host.locator('aside.theater-chat-rail')
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('region', { name: 'Live chat' })).toBeVisible()
    await expect(host.locator('aside.secondary [aria-label="Live chat"]')).toHaveCount(0)

    await expectRailClearOfPlayer(host)

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(400)

    await expectRailClearOfPlayer(host)

    await rail.getByRole('button', { name: 'Hide chat' }).click()
    await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
    const showBtn = host.locator('aside.secondary').getByRole('button', { name: 'Show chat' })
    await expect(showBtn).toBeVisible()
    await showBtn.click()
    await expect(host.locator('aside.theater-chat-rail')).toBeVisible()
  })
}

test('docks live chat replay full-height on the right in theater mode without overlapping player', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-replay-1280', { width: 1280, height: 800 }, {
    isLive: false,
    hasChatReplay: true,
  })

  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
  const openBtn = host.getByRole('region', { name: 'Live chat replay' }).getByRole('button', { name: 'Open panel' })
  await openBtn.scrollIntoViewIfNeeded()
  await openBtn.click()

  const rail = host.locator('aside.theater-chat-rail')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('region', { name: 'Chat replay' })).toBeVisible()
  await expect(host.locator('aside.secondary [aria-label="Chat replay"]')).toHaveCount(0)
  await expectRailClearOfPlayer(host)

  await rail.getByRole('button', { name: 'Close' }).click()
  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
})

test('docks live chat full-height on the right in normal YouTube theater mode too', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-yt-live-1280', { width: 1280, height: 800 }, {
    isLive: true,
    theater: 'theater',
  })

  await expect(host.locator('main')).toHaveClass(/\btheater\b/)
  await expect(host.locator('main')).not.toHaveClass(/\btheater-fullscreen\b/)
  const rail = host.locator('aside.theater-chat-rail')
  await expect(rail).toBeVisible()
  await expectRailClearOfPlayer(host)
})

test('keeps live chat session and over-screen messages alive across hide and show in theater mode', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-overscreen-1280', { width: 1280, height: 800 }, {
    isLive: true,
  })

  const rail = host.locator('aside.theater-chat-rail')
  await expect(rail).toBeVisible()
  const toggleBtn = rail.getByRole('button', { name: 'Over-screen chat messages', exact: true })
  await toggleBtn.click()
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true')

  const draftInput = rail.locator('form.compose input')
  await draftInput.fill('Unsent theater draft')

  const initialCounts = await page.evaluate(() => ({
    initial: window.__watchHarness?.liveChatInitialCalls ?? 0,
    closed: window.__watchHarness?.closeLiveChatCalls ?? 0,
  }))
  expect(initialCounts).toEqual({ initial: 1, closed: 0 })

  await page.evaluate(() => {
    window.__watchHarness?.pushLiveChatPage({
      items: [{
        id: 'theater-before-hide',
        kind: 'TEXT',
        text: 'Before hiding in theater',
        runs: [{ text: 'Before hiding in theater' }],
        author: { id: 'UC-a', name: 'Alice', handle: '@alice' },
      }],
    })
  })
  const overlay = page.locator('[data-over-screen-overlay="true"]')
  const beforeItem = overlay.locator('[data-overlay-item="theater-before-hide"]')
  await expect(beforeItem).toBeVisible()
  await beforeItem.evaluate((el) => {
    el.setAttribute('data-persist-marker', 'same-node')
  })

  // Hiding the chat rail moves the slot to secondary without remounting LiveChat or OverScreenOverlay
  await rail.getByRole('button', { name: 'Hide chat', exact: true }).click()
  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
  const showBtn = host.locator('aside.secondary').getByRole('button', { name: 'Show chat', exact: true })
  await expect(showBtn).toBeVisible()
  await expect(overlay).toBeVisible()
  await expect(beforeItem).toHaveCount(1)
  await expect(beforeItem).toHaveAttribute('data-persist-marker', 'same-node')
  expect(await page.evaluate(() => ({
    initial: window.__watchHarness?.liveChatInitialCalls ?? 0,
    closed: window.__watchHarness?.closeLiveChatCalls ?? 0,
  }))).toEqual({ initial: 1, closed: 0 })

  await page.evaluate(() => {
    window.__watchHarness?.pushLiveChatPage({
      items: [{
        id: 'theater-while-hidden',
        kind: 'TEXT',
        text: 'Arrived while theater rail hidden',
        runs: [{ text: 'Arrived while theater rail hidden' }],
        author: { id: 'UC-b', name: 'Bob', handle: '@bob' },
      }],
    })
  })
  await expect(overlay.locator('[data-overlay-item="theater-while-hidden"]')).toContainText('Arrived while theater rail hidden')

  // Showing chat again re-docks into theater rail with state and draft intact
  await showBtn.click()
  await expect(rail).toBeVisible()
  await expectRailClearOfPlayer(host)
  await expect(rail.getByRole('button', { name: 'Over-screen chat messages', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(rail.locator('form.compose input')).toHaveValue('Unsent theater draft')
  await expect(rail.locator('.log')).toContainText('Hello theater chat!')
  await expect(rail.locator('.log')).toContainText('Before hiding in theater')
  await expect(rail.locator('.log')).toContainText('Arrived while theater rail hidden')
  expect(await page.evaluate(() => ({
    initial: window.__watchHarness?.liveChatInitialCalls ?? 0,
    closed: window.__watchHarness?.closeLiveChatCalls ?? 0,
  }))).toEqual({ initial: 1, closed: 0 })

  // Turning Over-screen off and hiding closes the live chat session cleanly
  await rail.getByRole('button', { name: 'Over-screen chat messages', exact: true }).click()
  await expect(overlay).toHaveCount(0)
  await rail.getByRole('button', { name: 'Hide chat', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__watchHarness?.closeLiveChatCalls ?? 0)).toBe(1)
})

const makeBusyMessages = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, idx) => {
    const num = start + idx
    const text = num % 3 === 0
      ? `Message #${num}: detailed commentary wrapping across multiple lines when chat width changes between layouts`
      : `Message #${num}: quick reaction`
    return {
      id: `msg-${num}`,
      kind: 'TEXT',
      text,
      runs: [{ text }],
      author: { id: `UC-${num}`, name: `Chatter${num}`, handle: `@chatter${num}` },
    }
  })

const topVisibleRowText = (log: Element) => {
  const logRect = log.getBoundingClientRect()
  const rows = Array.from(log.querySelectorAll<HTMLElement>('.row'))
  const first = rows.find((row) => row.getBoundingClientRect().bottom > logRect.top + 4)
  return first?.textContent ?? ''
}

test('preserves live chat reading position when leaving theater mode and keeps pinned viewers at bottom', async ({ page }) => {
  const host = await mountTheaterWatch(page, 'theater-scroll-1440', { width: 1440, height: 900 }, {
    isLive: true,
    initialLiveChatMessages: makeBusyMessages(1, 80),
  })

  const rail = host.locator('aside.theater-chat-rail')
  const railLog = rail.locator('.log')
  await expect(railLog).toContainText('Message #80:')
  await expect.poll(() => railLog.evaluate((el) => el.scrollHeight > el.clientHeight + 500)).toBe(true)

  // Scroll up to Message #30 in Theater mode
  await railLog.evaluate((el) => {
    const target = Array.from(el.querySelectorAll<HTMLElement>('.row')).find((r) => r.textContent?.includes('Message #30:'))
    if (!target) throw new Error('Message #30 row not found')
    el.scrollTop = target.offsetTop + 6
    el.dispatchEvent(new Event('scroll'))
  })
  await expect(rail.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible()
  await expect.poll(() => railLog.evaluate(topVisibleRowText)).toContain('Message #30:')

  // Return to Default view while chat is open: width/height change must keep Message #30 visible
  await page.evaluate(() => window.__watchHarness?.setTheater('default'))
  await expect(host.locator('aside.theater-chat-rail')).toHaveCount(0)
  const secondaryChat = host.locator('aside.secondary').getByRole('region', { name: 'Live chat' })
  await expect(secondaryChat).toBeVisible()
  const secondaryLog = secondaryChat.locator('.log')
  await expect(secondaryChat.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible()
  await expect.poll(() => secondaryLog.evaluate(topVisibleRowText)).toContain('Message #30:')

  // Re-enter theater mode, then push new messages right as leaving theater mode
  await page.evaluate(() => window.__watchHarness?.setTheater('fullscreen'))
  await expect(rail).toBeVisible()
  await expect.poll(() => railLog.evaluate(topVisibleRowText)).toContain('Message #30:')

  const burst = makeBusyMessages(81, 90)
  await page.evaluate((items) => {
    window.__watchHarness?.pushLiveChatPage({ items })
    window.__watchHarness?.setTheater('default')
  }, burst)
  await expect(secondaryLog).toContainText('Message #90:')
  await expect.poll(() => secondaryLog.evaluate(topVisibleRowText)).toContain('Message #30:')

  // Returning to pinned bottom keeps pinned viewers glued to newest messages across mode changes
  await secondaryChat.getByRole('button', { name: 'Jump to latest', exact: true }).click()
  await expect(secondaryChat.getByRole('button', { name: 'Jump to latest', exact: true })).toHaveCount(0)
  await expect.poll(() => secondaryLog.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(36)

  await page.evaluate(() => window.__watchHarness?.setTheater('fullscreen'))
  await expect(railLog).toContainText('Message #90:')
  await expect.poll(() => railLog.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(36)

  const latest = makeBusyMessages(91, 91)
  await page.evaluate((items) => {
    window.__watchHarness?.pushLiveChatPage({ items })
    window.__watchHarness?.setTheater('default')
  }, latest)
  await expect(secondaryLog).toContainText('Message #91:')
  await expect.poll(() => secondaryLog.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(36)
})
