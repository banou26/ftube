import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/shorts-menu-harness.tsx'

const holdPlayback = () => {
  if (window.top !== window) return
  const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (
    this: MessagePort,
    message: unknown,
    ...rest: unknown[]
  ) => void
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    if ((message as { method?: string } | null)?.method === 'openPlayback') return
    return post.call(this, message, ...rest)
  } as typeof MessagePort.prototype.postMessage
}

const openShortsHarness = async (page: Page, viewport: { width: number, height: number }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(holdPlayback)
  await page.setViewportSize(viewport)
  await page.goto('/privacy')

  const root = page.locator('[data-shorts-menu-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async ([path]) => {
        const harness = await import(path!) as { mountShortsMenuHarness: (m: 'full' | 'tracks') => unknown }
        harness.mountShortsMenuHarness('full')
      }, [HARNESS])
    }
    await expect(root).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })

  const firstSlide = root.locator('[data-short-id="short-1"]')
  await expect(firstSlide).toBeVisible({ timeout: 15_000 })
  await expect(firstSlide.locator('.short-title')).toHaveText('The AI Model Iceberg', { timeout: 10_000 })
  return root
}

test('adjacent Short pre-renders its comments panel on desktop so scrolling keeps stage alignment without a snap', async ({ page }) => {
  const root = await openShortsHarness(page, { width: 1280, height: 900 })
  const slide1 = root.locator('[data-short-id="short-1"]')
  const slide2 = root.locator('[data-short-id="short-2"]')
  const slide3 = root.locator('[data-short-id="short-3"]')

  await slide1.getByRole('button', { name: 'Comments', exact: true }).click()

  const panel1 = slide1.locator('.comments-panel')
  const panel2 = slide2.locator('.comments-panel')
  const panel3 = slide3.locator('.comments-panel')

  await expect(panel1).toBeVisible()
  expect((await panel1.boundingBox())!.width).toBeGreaterThanOrEqual(360)
  await expect(panel1).toContainText('Comment on short-1')
  await expect(panel1.locator('.comments-count')).toHaveText('447')
  expect(await panel1.getAttribute('aria-hidden')).toBeNull()
  await expect.poll(() => panel1.evaluate(el => (el as HTMLElement).inert)).toBe(false)

  await expect(panel2).toHaveCount(1)
  await expect(panel2).toContainText('Comment on short-2')
  await expect(panel2.locator('.comments-count')).toHaveText('82')
  await expect(panel2).toHaveAttribute('aria-hidden', 'true')
  await expect.poll(() => panel2.evaluate(el => (el as HTMLElement).inert)).toBe(true)

  await expect(panel3).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Comments' })).toHaveCount(1)

  const stage1Before = (await slide1.locator('.stage').boundingBox())!
  const stage2Before = (await slide2.locator('.stage').boundingBox())!
  expect(Math.abs(stage1Before.x - stage2Before.x)).toBeLessThanOrEqual(1)

  await page.keyboard.press('ArrowDown')
  await expect(slide2).toHaveAttribute('data-active', 'true', { timeout: 10_000 })

  await expect(panel2).toBeVisible()
  await expect.poll(() => panel2.getAttribute('aria-hidden')).toBeNull()
  await expect.poll(() => panel2.evaluate(el => (el as HTMLElement).inert)).toBe(false)
  await expect(panel1).toHaveAttribute('aria-hidden', 'true')
  await expect.poll(() => panel1.evaluate(el => (el as HTMLElement).inert)).toBe(true)
  await expect(panel3).toHaveCount(1)
  await expect(panel3).toContainText('Comment on short-3')

  const accessiblePanelsAfterDown = page.getByRole('complementary', { name: 'Comments' })
  await expect(accessiblePanelsAfterDown).toHaveCount(1)
  await expect(accessiblePanelsAfterDown).toContainText('Comment on short-2')

  const stage2AfterDown = (await slide2.locator('.stage').boundingBox())!
  expect(Math.abs(stage2AfterDown.x - stage2Before.x)).toBeLessThanOrEqual(1)

  await page.keyboard.press('ArrowUp')
  await expect(slide1).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
  await expect.poll(() => panel1.getAttribute('aria-hidden')).toBeNull()
  await expect.poll(() => panel1.evaluate(el => (el as HTMLElement).inert)).toBe(false)
  await expect(panel2).toHaveAttribute('aria-hidden', 'true')
  await expect(panel3).toHaveCount(0)

  const stage1AfterUp = (await slide1.locator('.stage').boundingBox())!
  expect(Math.abs(stage1AfterUp.x - stage2Before.x)).toBeLessThanOrEqual(1)

  await panel1.getByRole('button', { name: 'Close comments', exact: true }).click()
  await expect(root.locator('.comments-panel')).toHaveCount(0)

  const stage1Closed = (await slide1.locator('.stage').boundingBox())!
  const stage2Closed = (await slide2.locator('.stage').boundingBox())!
  expect(stage1Closed.x).toBeGreaterThan(stage2Before.x + 100)
  expect(Math.abs(stage1Closed.x - stage2Closed.x)).toBeLessThanOrEqual(1)
})

test('mobile Shorts viewport keeps comments panel and scrim limited to the active slide', async ({ page }) => {
  const root = await openShortsHarness(page, { width: 412, height: 860 })
  const slide1 = root.locator('[data-short-id="short-1"]')
  const slide2 = root.locator('[data-short-id="short-2"]')

  await slide1.getByRole('button', { name: 'Comments', exact: true }).click()

  await expect(slide1.locator('.comments-panel')).toBeVisible()
  await expect(slide1.locator('.comments-panel')).toContainText('Comment on short-1')
  await expect(slide2.locator('.comments-panel')).toHaveCount(0)
  await expect(root.locator('.comments-scrim')).toHaveCount(1)
  await expect(page.getByRole('complementary', { name: 'Comments' })).toHaveCount(1)
})

test('uses a single compact header, pins the composer while scrolling, avoids 0 replies, keeps bylines inline, and caps reply nesting depth', async ({ page }) => {
  const root = await openShortsHarness(page, { width: 1280, height: 900 })
  const slide1 = root.locator('[data-short-id="short-1"]')

  await slide1.getByRole('button', { name: 'Comments', exact: true }).click()
  const panel = slide1.locator('.comments-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Comment on short-1')

  // Single header with sort and close controls, zero duplicate headings inside scroll container.
  await expect(panel.locator('.compact-header')).toHaveCount(1)
  await expect(panel.locator('h2')).toHaveCount(1)
  await expect(panel.getByRole('button', { name: 'Sort comments', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Close comments', exact: true })).toBeVisible()

  // Single-line byline age even with a long author handle.
  const firstByline = panel.locator('.comment').first().locator('.byline')
  const ageBox = (await firstByline.locator('.age').boundingBox())!
  expect(ageBox.height).toBeLessThanOrEqual(24)

  // Composer stays pinned in footer when the list scrolls.
  const footer = panel.locator('.compact-footer')
  const scroll = panel.locator('.compact-scroll')
  await expect(footer.getByRole('textbox', { name: 'Add a comment', exact: true })).toBeVisible()
  const footerBefore = (await footer.boundingBox())!
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const footerAfter = (await footer.boundingBox())!
  expect(Math.abs(footerAfter.y - footerBefore.y)).toBeLessThanOrEqual(1)
  await scroll.evaluate((el) => { el.scrollTop = 0 })

  // Expanding level-1 and depth-3 replies must never show "0 replies" and caps visual nesting past depth 2.
  const firstComment = panel.locator('.comment').first()
  await firstComment.getByRole('button', { name: '1 reply', exact: true }).first().click()
  const depth3Reply = firstComment.locator('.reply-list[data-depth="3"]')
  await expect(depth3Reply).toBeVisible()
  expect(await panel.locator('button.replies').allTextContents()).not.toContain('0 replies')
  await depth3Reply.getByRole('button', { name: '1 reply', exact: true }).click()
  await expect(firstComment).toContainText('Depth 4 deepest reply shares depth 2 rail.')

  const depthMetrics = await firstComment.evaluate((el) => {
    const scrollContainer = el.closest('.compact-scroll') as HTMLElement
    const bodies = [1, 2, 3, 4].map((d) => {
      const body = el.querySelector<HTMLElement>(`.reply-list[data-depth="${d}"] > .reply-rows > .reply-row > .body`)!
      const rect = body.getBoundingClientRect()
      return { depth: d, left: Math.round(rect.left), width: Math.round(rect.width) }
    })
    return {
      overflow: scrollContainer.scrollWidth - scrollContainer.clientWidth,
      bodies,
    }
  })

  expect(depthMetrics.overflow).toBeLessThanOrEqual(0)
  expect(depthMetrics.bodies[2]!.left).toBe(depthMetrics.bodies[1]!.left)
  expect(depthMetrics.bodies[3]!.left).toBe(depthMetrics.bodies[1]!.left)
  expect(depthMetrics.bodies[2]!.width).toBeGreaterThanOrEqual(200)
  expect(depthMetrics.bodies[3]!.width).toBeGreaterThanOrEqual(200)
})
