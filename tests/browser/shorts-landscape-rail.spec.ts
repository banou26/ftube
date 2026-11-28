import type { Page } from '@playwright/test'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/shorts-menu-harness.tsx'
const HEADER_HEIGHT_PX = 56
const ACTION_NAMES = ['Like', 'Dislike', 'Comments', 'Share', 'More actions'] as const

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

const expectRailWithinBoundsAndClickable = async (page: Page, root: ReturnType<Page['locator']>, activeId: string) => {
  const viewport = page.viewportSize()!
  const slide = root.locator(`[data-short-id="${activeId}"]`)
  await expect(slide).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
  await expect.poll(() =>
    slide.evaluate((el) => {
      const scroller = el.closest('main')
      return scroller ? Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : 0
    }),
  ).toBeLessThanOrEqual(1)
  await expect(slide.getByRole('link', { name: /.+/ }).first()).toBeVisible({ timeout: 10_000 })

  const boxes: Array<{ name: string, x: number, y: number, width: number, height: number }> = []
  for (const name of ACTION_NAMES) {
    const button = slide.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const box = (await button.boundingBox())!
    expect(box, `${name} box missing on ${activeId}`).toBeTruthy()
    expect(box.y, `${name} clipped above header on ${activeId} at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(HEADER_HEIGHT_PX - 0.5)
    expect(box.y + box.height, `${name} clipped below viewport on ${activeId}`).toBeLessThanOrEqual(viewport.height + 0.5)
    expect(box.x, `${name} clipped past left edge on ${activeId}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${name} clipped past right edge on ${activeId}`).toBeLessThanOrEqual(viewport.width + 0.5)

    const cx = Math.round(box.x + box.width / 2)
    const cy = Math.round(box.y + box.height / 2)
    const hit = await page.evaluate(([x, y, label]) => {
      const target = document.elementFromPoint(x!, y!)
      const ownerSlide = target?.closest('[data-short-id]')?.getAttribute('data-short-id') ?? null
      const hitLabel = target?.closest('button')?.getAttribute('aria-label') ?? null
      return { ownerSlide, hitLabel, expected: label }
    }, [cx, cy, name] as const)
    expect(hit, `${name} center (${cx}, ${cy}) hit wrong element on ${activeId}`).toEqual({
      ownerSlide: activeId,
      hitLabel: name,
      expected: name,
    })

    for (const prev of boxes) {
      const overlaps =
        box.x < prev.x + prev.width - 1
        && box.x + box.width > prev.x + 1
        && box.y < prev.y + prev.height - 1
        && box.y + box.height > prev.y + 1
      expect(overlaps, `${name} overlaps ${prev.name} on ${activeId}`).toBe(false)
    }
    boxes.push({ name, ...box })
  }
}

for (const viewport of [
  { width: 915, height: 412 },
  { width: 740, height: 360 },
]) {
  test(`direct load at ${viewport.width}x${viewport.height} keeps active Short rail below header and operable across slides`, async ({ page }) => {
    const root = await openShortsHarness(page, viewport)
    await expectRailWithinBoundsAndClickable(page, root, 'short-1')

    await page.keyboard.press('ArrowDown')
    await expectRailWithinBoundsAndClickable(page, root, 'short-2')

    await root.locator('[data-short-id="short-2"]').getByRole('button', { name: 'More actions', exact: true }).click()
    await expect(page.getByRole('menu', { name: 'More actions', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })
}

test('resizing portrait 412x915 to landscape 915x412 and 740x360 keeps active rail visible without overlap across advances', async ({ page }) => {
  const root = await openShortsHarness(page, { width: 412, height: 915 })
  await expectRailWithinBoundsAndClickable(page, root, 'short-1')

  await page.setViewportSize({ width: 915, height: 412 })
  await expectRailWithinBoundsAndClickable(page, root, 'short-1')

  await page.keyboard.press('ArrowDown')
  await expectRailWithinBoundsAndClickable(page, root, 'short-2')

  await page.setViewportSize({ width: 740, height: 360 })
  await expectRailWithinBoundsAndClickable(page, root, 'short-2')

  await page.keyboard.press('ArrowDown')
  await expectRailWithinBoundsAndClickable(page, root, 'short-3')
})
