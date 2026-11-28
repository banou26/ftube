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

type HarnessApi = {
  subscriptionMutations: () => { kind: 'subscribe' | 'level', channelId: string, value: boolean | string }[]
}

const openShortsControlsHarness = async (page: Page, viewport: { width: number, height: number }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(holdPlayback)
  await page.setViewportSize(viewport)
  await page.goto('/privacy')

  const root = page.locator('[data-shorts-menu-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async ([path]) => {
        const harness = await import(path!) as { mountShortsMenuHarness: (m: 'full' | 'tracks') => HarnessApi }
        const state = harness.mountShortsMenuHarness('full')
        ;(window as unknown as { __shortsControlsHarness?: HarnessApi }).__shortsControlsHarness = state
      }, [HARNESS])
    }
    await expect(root).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })

  const firstSlide = root.locator('[data-short-id="short-1"]')
  await expect(firstSlide).toBeVisible({ timeout: 15_000 })
  await expect(firstSlide.locator('.short-title')).toHaveText('The AI Model Iceberg', { timeout: 10_000 })
  return root
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 412, height: 860 },
]) {
  test(`Shorts subscription menu flips above its trigger on ${viewport.width}x${viewport.height} so Unsubscribe stays in view and selectable (APP-1048)`, async ({ page }) => {
    const root = await openShortsControlsHarness(page, viewport)

    await page.keyboard.press('ArrowDown')
    const slide2 = root.locator('[data-short-id="short-2"]')
    await expect(slide2).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
    await expect.poll(() =>
      slide2.evaluate((el) => {
        const scroller = el.closest('main')
        return scroller ? Math.abs(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : 0
      }),
    ).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/shorts/short-2')

    const trigger = slide2.getByRole('button', { name: 'Subscribed, notifications: Personalized', exact: true })
    await expect(trigger).toBeVisible({ timeout: 10_000 })

    const triggerBox = (await trigger.boundingBox())!
    expect(triggerBox.y + triggerBox.height).toBeGreaterThan(viewport.height * 0.65)

    await trigger.click()
    const menu = page.getByRole('menu', { name: 'Notifications', exact: true })
    await expect(menu).toBeVisible()

    const panelBox = (await menu.boundingBox())!
    expect(panelBox.y + panelBox.height, 'subscription menu should open above trigger with 8px gap').toBeLessThanOrEqual(triggerBox.y - 7)
    expect(panelBox.y).toBeGreaterThanOrEqual(0)
    expect(panelBox.x).toBeGreaterThanOrEqual(0)
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width)

    for (const label of ['All', 'Personalized', 'None', 'Unsubscribe']) {
      const item = menu.getByRole('menuitem', { name: label, exact: true })
      await expect(item).toBeVisible()
      const itemBox = (await item.boundingBox())!
      expect(itemBox.y, `${label} clipped above top edge`).toBeGreaterThanOrEqual(0)
      expect(itemBox.y + itemBox.height, `${label} clipped below bottom edge`).toBeLessThanOrEqual(viewport.height)
      const hit = await item.evaluate((el) => {
        const box = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      })
      expect(hit, `${label} center not hittable`).toBe(true)
    }

    // Keyboard navigation and Escape stay on the Short
    await expect(menu.getByRole('menuitem', { name: 'All', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Personalized', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => location.pathname)).toBe('/shorts/short-2')

    // Select a notification level and verify mutation + state update without leaving the Short
    await trigger.click()
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'All', exact: true }).click()
    await expect(menu).toBeHidden()
    const allTrigger = slide2.getByRole('button', { name: 'Subscribed, notifications: All', exact: true })
    await expect(allTrigger).toBeVisible()
    expect(await page.evaluate(() => location.pathname)).toBe('/shorts/short-2')

    // Open again and click the last option (Unsubscribe) without leaving the Short
    await allTrigger.click()
    await expect(menu).toBeVisible()
    const unsubItem = menu.getByRole('menuitem', { name: 'Unsubscribe', exact: true })
    await expect(unsubItem).toBeInViewport({ ratio: 1 })
    await unsubItem.click()
    await expect(menu).toBeHidden()

    await expect(slide2.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
    await expect(root.getByText('Unsubscribed')).toBeVisible()
    expect(await page.evaluate(() => location.pathname)).toBe('/shorts/short-2')
    const mutations = await page.evaluate(() =>
      (window as unknown as { __shortsControlsHarness: HarnessApi }).__shortsControlsHarness.subscriptionMutations(),
    )
    expect(mutations).toEqual([
      { kind: 'level', channelId: 'UCtwo', value: 'ALL' },
      { kind: 'subscribe', channelId: 'UCtwo', value: false },
    ])
  })
}
