import type { TheaterMode } from '../../src/player/theater'
import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/theater-bigger-harness.tsx'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 800, height: 600 },
  { width: 412, height: 800 },
] as const

const YOUTUBE_THEATER_VIEWPORTS = [
  { width: 1440, height: 900, expectedHeight: 731 },
  { width: 1280, height: 720, expectedHeight: 551 },
  { width: 800, height: 600, expectedHeight: 431 },
  { width: 412, height: 800, expectedHeight: 240 },
] as const

const mountTheaterHarness = async (
  page: Page,
  videoId: string,
  viewport: { width: number, height: number },
  theater: TheaterMode = 'fullscreen',
  preserveSetting = false,
) => {
  await page.setViewportSize(viewport)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.goto('/privacy')
  await expect(page.locator('#app main')).toBeVisible({ timeout: 30_000 })
  const host = page.locator(`[data-theater-bigger-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, vid, mode, keep]) => {
        const mod = await import(path) as typeof import('./fixtures/theater-bigger-harness')
        mod.mountTheaterBiggerHarness({ videoId: vid, theater: mode, preserveSetting: keep })
      }, [HARNESS, videoId, theater, preserveSetting] as const)
    }
    await expect(host.locator('main .stage [data-player-root]')).toBeVisible({ timeout: 5_000 })
    await expect(host.locator('main h1.title')).toBeAttached({ timeout: 5_000 })
    await expect(host.locator('main .comments-slot')).toBeAttached({ timeout: 5_000 })
    await expect(host.getByText('First harness comment below the fold.')).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return host
}

test('fullscreen theater mode fills the full viewport below the header and hides details, comments, and suggested videos until scrolled', async ({ page }) => {
  const host = await mountTheaterHarness(page, 'theater-bigger-1', VIEWPORTS[0], 'fullscreen')
  await expect(host.locator('main')).toHaveClass(/\btheater\b/)
  await expect(host.locator('main')).toHaveClass(/\btheater-fullscreen\b/)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect.poll(async () => host.evaluate((el) => {
      const player = el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect()
      return {
        height: Math.round(player.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }
    }), { message: `viewport settle at ${viewport.width}x${viewport.height}` }).toMatchObject({
      innerWidth: viewport.width,
      innerHeight: viewport.height,
    })

    const metrics = await host.evaluate((el) => {
      const player = el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect()
      const title = el.querySelector('main h1.title')!.getBoundingClientRect()
      const description = el.querySelector('main .about')!.getBoundingClientRect()
      const comments = el.querySelector('main .comments-slot')!.getBoundingClientRect()
      const aside = el.querySelector('main aside.secondary')!.getBoundingClientRect()
      return {
        player: {
          x: player.x,
          y: player.y,
          width: player.width,
          height: player.height,
          bottom: player.bottom,
        },
        titleTop: title.top,
        descriptionTop: description.top,
        commentsTop: comments.top,
        asideTop: aside.top,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })

    expect(metrics.scrollWidth, `no horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(metrics.innerWidth)
    expect(Math.abs(metrics.player.x), `player.x at ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.player.y - 56), `player.y at ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.player.width - viewport.width), `player.width at ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.player.height - (viewport.height - 56)), `player.height at ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.player.bottom - viewport.height), `player.bottom at ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1)

    expect(metrics.titleTop, `title below fold at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(viewport.height)
    expect(metrics.descriptionTop, `description below fold at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(viewport.height)
    expect(metrics.commentsTop, `comments below fold at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(viewport.height)
    expect(metrics.asideTop, `suggested videos below fold at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(viewport.height)

    // Scrolling down reveals the video details, comments, and suggested videos below the player.
    await host.locator('main h1.title').scrollIntoViewIfNeeded()
    await expect(host.locator('main h1.title')).toBeInViewport()
    await expect(host.locator('main .about')).toBeInViewport()
    await host.getByText('First harness comment below the fold.').scrollIntoViewIfNeeded()
    await expect(host.getByText('First harness comment below the fold.')).toBeInViewport()
    await host.locator('main aside.secondary a[href^="/watch"]').first().scrollIntoViewIfNeeded()
    await expect(host.locator('main aside.secondary a[href^="/watch"]').first()).toBeInViewport()
  }
})

test('normal YouTube theater mode spans full width and keeps title visible above the fold', async ({ page }) => {
  const host = await mountTheaterHarness(page, 'theater-youtube-1', YOUTUBE_THEATER_VIEWPORTS[0], 'theater')
  await expect(host.locator('main')).toHaveClass(/\btheater\b/)
  await expect(host.locator('main')).not.toHaveClass(/\btheater-fullscreen\b/)

  for (const viewport of YOUTUBE_THEATER_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.evaluate(() => window.scrollTo(0, 0))

    await expect.poll(async () => host.evaluate((el) => {
      const player = el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect()
      return {
        height: Math.round(player.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }
    }), { message: `youtube theater settle at ${viewport.width}x${viewport.height}` }).toMatchObject({
      innerWidth: viewport.width,
      innerHeight: viewport.height,
    })

    const metrics = await host.evaluate((el) => {
      const player = el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect()
      const title = el.querySelector('main h1.title')!.getBoundingClientRect()
      return {
        x: player.x,
        y: player.y,
        width: player.width,
        height: player.height,
        titleTop: title.top,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }
    })

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
    expect(Math.abs(metrics.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.y - 56)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.width - viewport.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.height - viewport.expectedHeight), `height at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(2)
    expect(metrics.titleTop, `title above fold at ${viewport.width}x${viewport.height}`).toBeLessThan(viewport.height)
  }
})

test('cycles theater switch through Default, YouTube theater, and Fullscreen theater via control button and t shortcut', async ({ page }) => {
  const host = await mountTheaterHarness(page, 'theater-cycle-1', { width: 1440, height: 900 }, 'default')
  const main = host.locator('main')
  const toggle = host.locator('.theater-toggle')
  await expect(toggle).toBeVisible()

  // Initial state: Default
  await expect(main).not.toHaveClass(/\btheater\b/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'default')
  const defaultPlayerWidth = await host.evaluate(el => Math.round(el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect().width))
  expect(defaultPlayerWidth).toBeLessThan(1440)

  // Step 1 -> YouTube theater (click button)
  await toggle.click()
  await expect(main).toHaveClass(/\btheater\b/)
  await expect(main).not.toHaveClass(/\btheater-fullscreen\b/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'theater')
  await expect.poll(async () => host.evaluate(el => ({
    width: Math.round(el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect().width),
    height: Math.round(el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect().height),
    titleTop: el.querySelector('main h1.title')!.getBoundingClientRect().top,
  }))).toMatchObject({ width: 1440, height: 731 })
  expect(await host.evaluate(el => el.querySelector('main h1.title')!.getBoundingClientRect().top)).toBeLessThan(900)

  // Step 2 -> Fullscreen theater (click button)
  await toggle.click()
  await expect(main).toHaveClass(/\btheater\b/)
  await expect(main).toHaveClass(/\btheater-fullscreen\b/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'fullscreen')
  await expect.poll(async () => host.evaluate(el => Math.round(el.querySelector('main .stage [data-player-root]')!.getBoundingClientRect().height))).toBe(844)
  expect(await host.evaluate(el => el.querySelector('main h1.title')!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(900)

  // Step 3 -> Default (click button)
  await toggle.click()
  await expect(main).not.toHaveClass(/\btheater\b/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'default')

  // Repeat 3-state cycle using keyboard shortcut 't'
  await host.locator('main h1.title').click()
  await page.keyboard.press('t')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'theater')
  await expect(main).toHaveClass(/\btheater\b/)
  await expect(main).not.toHaveClass(/\btheater-fullscreen\b/)

  await page.keyboard.press('t')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'fullscreen')
  await expect(main).toHaveClass(/\btheater-fullscreen\b/)

  await page.keyboard.press('t')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'default')
  await expect(main).not.toHaveClass(/\btheater\b/)
})

test('Settings Theater mode selector updates aria-pressed, persists, and initializes watch player mode', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  const openTheaterGroup = async () => {
    await page.goto('/settings?section=playback')
    const group = page.getByRole('main').getByRole('group', { name: 'Theater mode', exact: true })
    await expect(group).toBeVisible({ timeout: 30_000 })
    return {
      defaultBtn: group.getByRole('button', { name: 'Default', exact: true }),
      theaterBtn: group.getByRole('button', { name: 'Theater', exact: true }),
      fullscreenBtn: group.getByRole('button', { name: 'Fullscreen theater', exact: true }),
    }
  }

  let controls = await openTheaterGroup()
  await expect(controls.defaultBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(controls.theaterBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(controls.fullscreenBtn).toHaveAttribute('aria-pressed', 'false')

  await controls.fullscreenBtn.click()
  await expect(controls.defaultBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(controls.theaterBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(controls.fullscreenBtn).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').theater)).toBe('fullscreen')

  await page.reload()
  controls = await openTheaterGroup()
  await expect(controls.fullscreenBtn).toHaveAttribute('aria-pressed', 'true')

  let host = await mountTheaterHarness(page, 'theater-settings-fs', { width: 1440, height: 900 }, 'default', true)
  await expect(host.locator('main')).toHaveClass(/\btheater-fullscreen\b/)
  await expect(host.locator('.theater-toggle')).toHaveAttribute('data-theater-mode', 'fullscreen')

  controls = await openTheaterGroup()
  await controls.theaterBtn.click()
  await expect(controls.defaultBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(controls.theaterBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(controls.fullscreenBtn).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').theater)).toBe('theater')

  await page.reload()
  controls = await openTheaterGroup()
  await expect(controls.theaterBtn).toHaveAttribute('aria-pressed', 'true')

  host = await mountTheaterHarness(page, 'theater-settings-normal', { width: 1440, height: 900 }, 'default', true)
  await expect(host.locator('main')).toHaveClass(/\btheater\b/)
  await expect(host.locator('main')).not.toHaveClass(/\btheater-fullscreen\b/)
  await expect(host.locator('.theater-toggle')).toHaveAttribute('data-theater-mode', 'theater')
})

test('changing theater mode from the player persists to Settings automatically and syncs back', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)

  const host = await mountTheaterHarness(page, 'theater-sync-player', { width: 1440, height: 900 }, 'default', true)
  const toggle = host.locator('.theater-toggle')
  await expect(toggle).toHaveAttribute('data-theater-mode', 'default')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-theater-mode', 'theater')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').theater)).toBe('theater')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-theater-mode', 'fullscreen')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').theater)).toBe('fullscreen')

  await page.goto('/settings?section=playback')
  const group = page.getByRole('main').getByRole('group', { name: 'Theater mode', exact: true })
  await expect(group.getByRole('button', { name: 'Fullscreen theater', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
