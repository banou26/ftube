import type { Browser, Page } from '@playwright/test'

import { answerLookups, dismissFknNotice, expect, test } from './test'

const newViewer = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await answerLookups(context)
  const page = await context.newPage()
  await dismissFknNotice(page)
  const errors: string[] = []
  page.on('pageerror', (error) => {
    // broker's own aborted navigation fetch is unrelated to party state
    if (/^(TypeError: )?Failed to fetch$/.test(error.message.trim())) return
    errors.push(error.message)
  })
  return { context, page, errors }
}

const partyButton = (page: Page) => page.getByRole('button', { name: /Watch together|Hosting|Following|Joining|Party ended/ })

test('shows a short error on /party for a malformed invite link', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/party#not-a-valid-invite')
  await expect(page.getByRole('heading', { name: 'Watch together' })).toBeVisible()
  await expect(page.getByText('This invite link is invalid.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start watch together' })).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('syncs navigation, playback, chat, and moderation between host and guest', async ({ browser }) => {
  test.setTimeout(240_000)
  const host = await newViewer(browser)
  const guest = await newViewer(browser)
  try {
    await host.page.goto('/')
    await expect(host.page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })

    // Host starts a party from the header control and copies the fragment invite link.
    await partyButton(host.page).click()
    await expect(partyButton(host.page)).toHaveText(/Hosting.*1/, { timeout: 30_000 })
    const inviteInput = host.page.getByRole('textbox', { name: 'Invite link' })
    await expect(inviteInput).toBeVisible()
    const inviteLink = await inviteInput.inputValue()
    expect(inviteLink).toMatch(/\/party#[A-Za-z0-9_-]{43}\.(?:[\x21-\x7e]+\/)?[a-z0-9][a-z0-9._-]*$/)
    await host.page.keyboard.press('Escape')

    // Guest opens the invite link and lands on the host's current page.
    await guest.page.goto(inviteLink)
    await expect(guest.page).toHaveURL(/\/$/, { timeout: 45_000 })
    await expect(partyButton(guest.page)).toHaveText(/Following.*2/, { timeout: 30_000 })
    await expect(partyButton(host.page)).toHaveText(/Hosting.*2/, { timeout: 30_000 })

    // Host navigates to a search route and guest follows automatically.
    await host.page.goto('/results?search_query=rick%20astley')
    await expect(guest.page).toHaveURL(/\/results\?search_query=rick%20astley$/, { timeout: 20_000 })

    // Host opens a video, guest follows, and pause + seek sync across players.
    await host.page.goto('/watch?v=dQw4w9WgXcQ')
    await expect(guest.page).toHaveURL(/\/watch\?v=dQw4w9WgXcQ$/, { timeout: 20_000 })
    await Promise.all([
      host.page.waitForFunction(() => performance.getEntriesByName('yt:first-frame', 'mark').length > 0, null, { timeout: 120_000 }),
      guest.page.waitForFunction(() => performance.getEntriesByName('yt:first-frame', 'mark').length > 0, null, { timeout: 120_000 }),
    ])

    await host.page.locator('video').evaluate((video: HTMLVideoElement) => {
      video.pause()
      video.currentTime = 45
    })
    await expect.poll(
      () => guest.page.locator('video').evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime })),
      { timeout: 20_000 },
    ).toMatchObject({ paused: true })
    await expect.poll(
      () => guest.page.locator('video').evaluate((video: HTMLVideoElement) => Math.abs(video.currentTime - 45)),
      { timeout: 20_000 },
    ).toBeLessThan(2.5)

    // Guest leaves /watch so the video docks into the miniplayer, and host seeks still follow.
    await guest.page.evaluate(() => {
      history.pushState(null, '', '/settings')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(guest.page.getByRole('complementary', { name: 'Miniplayer' })).toBeVisible({ timeout: 20_000 })
    await host.page.locator('video').evaluate((video: HTMLVideoElement) => {
      video.currentTime = 95
    })
    await expect.poll(
      async () => {
        const [hostState, guestState] = await Promise.all([
          host.page.locator('video').evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime })),
          guest.page.locator('video').evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime })),
        ])
        return {
          nearTarget: guestState.time >= 92 && Math.abs(guestState.time - hostState.time) < 2.5,
          pausedMatches: guestState.paused === hostState.paused,
        }
      },
      { timeout: 20_000 },
    ).toStrictEqual({ nearTarget: true, pausedMatches: true })

    // Chat round-trips in both directions and shows unread badge when closed.
    await guest.page.getByRole('button', { name: 'Party chat' }).click()
    await guest.page.getByRole('textbox', { name: 'Party message' }).fill('hello from guest')
    await guest.page.getByRole('button', { name: 'Send message' }).click()
    await expect(guest.page.getByText('hello from guest')).toBeVisible()

    await expect(host.page.getByRole('button', { name: 'Party chat' })).toHaveText('1', { timeout: 15_000 })
    await host.page.getByRole('button', { name: 'Party chat' }).click()
    await expect(host.page.getByText('hello from guest')).toBeVisible()
    await host.page.getByRole('textbox', { name: 'Party message' }).fill('hello from host')
    await host.page.getByRole('button', { name: 'Send message' }).click()
    await expect(guest.page.getByText('hello from host')).toBeVisible({ timeout: 15_000 })

    // Host opens /party, sets a name, and kicks the guest.
    await host.page.goto('/party')
    await host.page.getByRole('textbox', { name: 'Display name' }).fill('DJ Host')
    await host.page.getByRole('button', { name: 'Save' }).click()
    await expect(host.page.getByText('DJ Host')).toBeVisible()
    await host.page.getByRole('button', { name: 'Kick' }).click()
    await expect(partyButton(guest.page)).toHaveText(/Party ended/, { timeout: 20_000 })
    await partyButton(guest.page).click()
    await expect(guest.page.getByText('You were removed from the party.')).toBeVisible()

    await host.page.getByRole('button', { name: 'End party' }).click()
    expect(host.errors).toStrictEqual([])
    expect(guest.errors).toStrictEqual([])
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})
