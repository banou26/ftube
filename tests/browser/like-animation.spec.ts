import type { Page, Route } from '@playwright/test'

import type { LikeStatus } from '../../src/generated/graphql'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/like-harness.tsx'

const RATE_URL = '**/like-harness/**'

// every animation that starts in the harness, as "<button>:<animation>", from before the buttons mount
const recordAnimations = (page: Page) => page.addInitScript(() => {
  const started: string[] = []
  Object.assign(window, { likeAnimations: started })
  document.addEventListener('animationstart', (event) => {
    const button = (event.target as Element).closest('[data-like-harness] button')
    if (button) started.push(`${button.getAttribute('aria-label')}:${event.animationName}`)
  })
})

// what started so far, sorted, since the thumb's and the burst's start in one frame
const animations = (page: Page) => page.evaluate(() => [...(window as unknown as { likeAnimations: string[] }).likeAnimations].sort())

const clearAnimations = (page: Page) => page.evaluate(() => { (window as unknown as { likeAnimations: string[] }).likeAnimations.length = 0 })

// two frames: an animation the last change started has sent its animationstart by then
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

const mount = async (page: Page, likeStatus: LikeStatus) => {
  await recordAnimations(page)
  await page.goto('/privacy')
  const host = page.locator(`[data-like-harness="${likeStatus}"]`)
  // the harness's first import can add a dependency for the dev server to bundle, which reloads the page under it
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, status]) => (await import(path) as typeof import('./fixtures/like-harness')).mountLikes(status), [HARNESS, likeStatus] as const)
    }
    await expect(host.getByRole('button', { name: 'Like', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  return {
    host,
    like: host.getByRole('button', { name: 'Like', exact: true }),
    dislike: host.getByRole('button', { name: 'Dislike', exact: true }),
  }
}

// answers every rating with `status`, or holds each one until `release`
const routeRatings = async (page: Page, status = 200) => {
  const sent: string[] = []
  const held: Route[] = []
  let holding = false
  await page.route(RATE_URL, (route) => {
    sent.push(new URL(route.request().url()).pathname.split('/').pop()!)
    if (holding) held.push(route)
    else void route.fulfill({ status, body: '' })
  })
  return {
    sent,
    hold: () => { holding = true },
    release: async () => {
      holding = false
      for (const route of held.splice(0)) await route.fulfill({ status, body: '' })
    },
  }
}

test('a press on Like fills the thumb with a bounce and a burst at once, and the press that takes it back bounces it', async ({ page }) => {
  const ratings = await routeRatings(page)
  const { like, dislike } = await mount(page, 'INDIFFERENT')
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await settle(page)
  expect(await animations(page)).toEqual([])

  // the thumb fills and plays while YouTube has not answered yet
  ratings.hold()
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce', 'Like:rate-burst'])
  await ratings.release()
  await expect(like).toBeEnabled()

  await clearAnimations(page)
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce'])
  await expect(like).toBeEnabled()

  await clearAnimations(page)
  await dislike.click()
  await expect(dislike).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => animations(page)).toEqual(['Dislike:rate-bounce', 'Dislike:rate-burst'])
  expect(ratings.sent).toEqual(['LIKE', 'INDIFFERENT', 'DISLIKE'])
})

test('a video that opens already liked shows the thumb filled and still', async ({ page }) => {
  await routeRatings(page)
  const { like } = await mount(page, 'LIKE')
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect(like.locator('svg')).toHaveAttribute('fill', 'currentColor')
  await settle(page)
  expect(await animations(page)).toEqual([])

  // the same recorder sees the press that takes the like back, so the empty list above is the page staying still
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce'])
})

test('under reduced motion a press fills the thumb and nothing moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await routeRatings(page)
  const { like } = await mount(page, 'INDIFFERENT')
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect(like).toBeEnabled()
  await settle(page)
  expect(await animations(page)).toEqual([])
})

test('a take-back YouTube refuses bounces at the press, then goes back still', async ({ page }) => {
  const ratings = await routeRatings(page, 500)
  const { like } = await mount(page, 'LIKE')
  ratings.hold()
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce'])

  await clearAnimations(page)
  await ratings.release()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect(like).toBeEnabled()
  await settle(page)
  expect(await animations(page)).toEqual([])
})

// the full screen view hides its buttons with display: none while a settings menu is open
test('a press plays once, not again when the buttons are hidden and shown', async ({ page }) => {
  await routeRatings(page)
  const { host, like } = await mount(page, 'INDIFFERENT')
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce', 'Like:rate-burst'])
  await expect(like).toBeEnabled()
  await expect.poll(() => host.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)

  await clearAnimations(page)
  await host.evaluate((element: HTMLElement) => { element.style.display = 'none' })
  await settle(page)
  await host.evaluate((element: HTMLElement) => { element.style.display = '' })
  await settle(page)
  expect(await animations(page)).toEqual([])

  // the next press still plays, so the empty list above is the thumb staying still
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => animations(page)).toEqual(['Like:rate-bounce'])
})
