import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/menu-data-harness.tsx'

test('formats notifications menu panel width, constrained avatars and thumbnails, and stacked timestamp rows cleanly on desktop and mobile', async ({ page }) => {
  await page.route('**/menu-data-harness/**', route => route.fulfill({ body: '' }))

  for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/privacy')
    const host = page.locator('[data-menu-data-harness="notifications"]')
    await expect(async () => {
      if (await host.count() === 0) {
        await page.evaluate(async (path) => (await import(path) as typeof import('./fixtures/menu-data-harness')).mountMenuData('notifications'), HARNESS)
      }
      await expect(host).toBeAttached({ timeout: 5_000 })
    }).toPass({ timeout: 120_000 })

    await host.getByRole('button', { name: 'Notifications' }).click()
    const menu = page.getByRole('menu', { name: 'Notifications' })
    const longItem = menu.getByRole('menuitem', { name: /Comment la France reorganise/ })
    await expect(longItem).toBeVisible()

    // Ensure SVG avatar/thumbnail images decoded at their large intrinsic size so constrained CSS sizing is exercised.
    await expect.poll(() => longItem.evaluate((el) => {
      const imgs = [...el.querySelectorAll('img')]
      return imgs.length === 2 && imgs.every(img => img.complete && img.naturalWidth >= 256)
    })).toBe(true)

    const metrics = await menu.evaluate((panel) => {
      const panelRect = panel.getBoundingClientRect()
      const row = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el =>
        (el.getAttribute('aria-label') ?? '').includes('Comment la France reorganise'),
      )!
      const avatar = row.querySelector<HTMLElement>('.row-avatar')!
      const thumb = row.querySelector<HTMLElement>('.row-thumb')!
      const msg = row.querySelector<HTMLElement>('.row-message')!
      const time = row.querySelector<HTMLElement>('.row-time')!
      const avatarRect = avatar.getBoundingClientRect()
      const thumbRect = thumb.getBoundingClientRect()
      const msgRect = msg.getBoundingClientRect()
      const timeRect = time.getBoundingClientRect()
      const msgStyle = getComputedStyle(msg)
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        panelWidth: panelRect.width,
        panelRight: panelRect.right,
        panelLeft: panelRect.left,
        viewportWidth: document.documentElement.clientWidth,
        avatarWidth: avatarRect.width,
        avatarHeight: avatarRect.height,
        avatarRadius: getComputedStyle(avatar).borderRadius,
        thumbWidth: thumbRect.width,
        thumbHeight: thumbRect.height,
        msgY: msgRect.y,
        msgPaddingTop: Number.parseFloat(msgStyle.paddingTop),
        msgPaddingBottom: Number.parseFloat(msgStyle.paddingBottom),
        timeY: timeRect.y,
        timeDisplay: getComputedStyle(time).display,
      }
    })

    expect(metrics.overflow).toBe(false)
    expect(metrics.panelLeft).toBeGreaterThanOrEqual(0)
    expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.panelWidth).toBeLessThanOrEqual(484)
    expect(metrics.panelWidth).toBeGreaterThanOrEqual(Math.min(480, metrics.viewportWidth - 24) - 1)
    expect(metrics.avatarWidth).toBeGreaterThanOrEqual(36)
    expect(metrics.avatarWidth).toBeLessThanOrEqual(44)
    expect(metrics.avatarHeight).toBeLessThanOrEqual(44)
    expect(metrics.thumbWidth).toBeGreaterThanOrEqual(80)
    expect(metrics.thumbWidth).toBeLessThanOrEqual(92)
    expect(metrics.thumbWidth / metrics.thumbHeight).toBeCloseTo(16 / 9, 1)
    expect(metrics.msgPaddingTop).toBe(0)
    expect(metrics.msgPaddingBottom).toBe(0)
    expect(metrics.timeDisplay).toBe('block')
    expect(metrics.timeY).toBeGreaterThanOrEqual(metrics.msgY + 12)
  }
})

test('Dismiss all clears visible notifications, zeroes the unread badge, persists across reload, and leaves items intact on failure', async ({ page }) => {
  await page.goto('/privacy')
  const host = page.locator('[data-notifications-dismiss-harness="true"]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async (path) => (await import(path) as typeof import('./fixtures/menu-data-harness')).mountNotificationsDismissHarness(false), HARNESS)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })

  const bell = host.getByRole('button', { name: 'Notifications' })
  await expect(bell.locator('.badge')).toHaveText('2')
  await bell.click()

  const menu = page.getByRole('menu', { name: 'Notifications' })
  await expect(menu.getByRole('menuitem', { name: 'Alpha channel uploaded a video' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Beta channel started streaming' })).toBeVisible()

  await menu.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  await expect(menu.getByRole('menuitem', { name: 'No notifications' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Show more' })).toHaveCount(0)
  await expect(bell.locator('.badge')).toHaveCount(0)

  const calls = await page.evaluate(() => (window as unknown as { __dismissCalls?: string[][] }).__dismissCalls ?? [])
  expect(calls).toEqual([['notif-a', 'notif-b']])

  // Reloading keeps dismissed notifications hidden via localStorage even if the source returns them again.
  await page.reload()
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async (path) => (await import(path) as typeof import('./fixtures/menu-data-harness')).mountNotificationsDismissHarness(false), HARNESS)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  await bell.click()
  await expect(page.getByRole('menu', { name: 'Notifications' }).getByRole('menuitem', { name: 'No notifications' })).toBeVisible()

  // When dismiss fails server-side, notifications stay visible.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async (path) => (await import(path) as typeof import('./fixtures/menu-data-harness')).mountNotificationsDismissHarness(true), HARNESS)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  await bell.click()
  const errMenu = page.getByRole('menu', { name: 'Notifications' })
  await expect(errMenu.getByRole('menuitem', { name: 'Alpha channel uploaded a video' })).toBeVisible()
  await errMenu.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  await expect(errMenu.getByRole('menuitem', { name: 'Alpha channel uploaded a video' })).toBeVisible()
  await expect(errMenu.getByRole('menuitem', { name: 'Beta channel started streaming' })).toBeVisible()
})
