import type { WatchHarnessOptions } from './fixtures/watch-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/watch-harness.tsx'

const mount = async (page: import('@playwright/test').Page, options: WatchHarnessOptions) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  const host = page.locator('[data-watch-harness]')
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const mod = await import(path) as typeof import('./fixtures/watch-harness')
        mod.mountWatchHarness(opts)
      }, [HARNESS, options] as const)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
  await expect(host.locator('.owner-row')).toBeVisible({ timeout: 15_000 })
  return host
}

const rowMetrics = (host: import('@playwright/test').Locator) =>
  host.locator('.owner-row').evaluate((row) => {
    const ownerInfo = row.querySelector<HTMLElement>('.owner-info')
    const actions = row.querySelector<HTMLElement>('.actions')!
    const buttons = [...actions.querySelectorAll<HTMLElement>('button')]
    const rowRect = row.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    const ownerRect = ownerInfo?.getBoundingClientRect()
    const buttonTops = buttons.map(b => Math.round(b.getBoundingClientRect().top))
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rowHeight: Math.round(rowRect.height),
      rowWidth: Math.round(rowRect.width),
      hasOwnerInfo: ownerInfo !== null,
      ownerBottom: ownerRect ? Math.round(ownerRect.bottom) : null,
      actionsTop: Math.round(actionsRect.top),
      actionsHeight: Math.round(actionsRect.height),
      buttonTopSpread: buttonTops.length > 0 ? Math.max(...buttonTops) - Math.min(...buttonTops) : 0,
      inlineLabels: buttons.map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()),
    }
  })

test('keeps desktop owner row single-line, uses compact subscribed bell, moves Groups into More, and avoids duplicate menu items', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, {
    subscribed: true,
    notificationLevel: 'PERSONALIZED',
    channelName: 'Harness Creator Studio',
  })

  const ownerRow = host.locator('.owner-row')
  // No standalone Groups pill or separate Subscribed text button in .owner-row
  await expect(ownerRow.getByRole('button', { name: 'Groups', exact: true })).toHaveCount(0)
  await expect(ownerRow.getByRole('button', { name: 'Subscribed', exact: true })).toHaveCount(0)
  const bellTrigger = ownerRow.getByRole('button', { name: 'Subscribed, notifications: Personalized' })
  await expect(bellTrigger).toBeVisible()

  await bellTrigger.click()
  const subMenu = page.getByRole('menu', { name: 'Notifications' })
  await expect(subMenu.getByRole('menuitem', { name: 'All' })).toBeVisible()
  await expect(subMenu.getByRole('menuitem', { name: 'Unsubscribe' })).toBeVisible()
  await page.keyboard.press('Escape')

  const metrics = await rowMetrics(host)
  expect(metrics.overflow).toBe(false)
  expect(metrics.hasOwnerInfo).toBe(true)
  expect(metrics.rowHeight).toBeLessThanOrEqual(52)
  expect(metrics.buttonTopSpread).toBeLessThanOrEqual(4)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Download', exact: true })).toBeVisible()

  // More actions replaces redundant Share and Theater items with Report while preserving Groups.
  await page.evaluate(() => {
    const calls: unknown[][] = []
    ;(window as unknown as { __openCalls?: unknown[][] }).__openCalls = calls
    window.open = ((...args: unknown[]) => {
      calls.push(args)
      return null
    }) as typeof window.open
  })
  await ownerRow.getByRole('button', { name: 'More actions', exact: true }).click()
  const moreMenu = page.getByRole('menu', { name: 'More actions' })
  await expect(moreMenu.getByRole('menuitem', { name: 'Share' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Save' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Download' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitemcheckbox', { name: 'Theater mode' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Theater mode' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Groups' })).toBeVisible()
  await expect(moreMenu.getByRole('menuitem', { name: 'Report' })).toBeVisible()

  await moreMenu.getByRole('menuitem', { name: 'Report' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __openCalls?: unknown[][] }).__openCalls ?? [])).toEqual([
    ['https://www.youtube.com/watch?v=watch-harness-1', '_blank', 'noopener,noreferrer'],
  ])

  await ownerRow.getByRole('button', { name: 'More actions', exact: true }).click()
  await moreMenu.getByRole('menuitem', { name: 'Groups' }).click()
  await expect(page.getByRole('dialog', { name: 'Groups' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('renders icon-only watch action buttons with labels revealed only on hover', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const host = await mount(page, {
    subscribed: false,
    channelName: 'Harness Creator Studio',
  })

  const actions = host.locator('.owner-row .actions')
  for (const name of ['Share', 'Save', 'Download', 'More actions'] as const) {
    const button = actions.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const metrics = await button.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        text: (el.textContent ?? '').trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    })
    expect(metrics.text).toBe('')
    expect(Math.abs(metrics.width - metrics.height)).toBeLessThanOrEqual(2)
  }

  const likeBtn = actions.getByRole('button', { name: 'Like', exact: true })
  const dislikeBtn = actions.getByRole('button', { name: 'Dislike', exact: true })
  await expect(actions.getByRole('tooltip', { name: 'I like this', exact: true })).toBeHidden()
  await expect(actions.getByRole('tooltip', { name: 'Share', exact: true })).toBeHidden()

  const hoverAndCheck = async (target: import('@playwright/test').Locator, label: string) => {
    await target.hover()
    const tip = actions.getByRole('tooltip', { name: label, exact: true })
    await expect(tip).toBeVisible()
    const [btnBox, tipBox] = await Promise.all([target.boundingBox(), tip.boundingBox()])
    expect(btnBox).not.toBeNull()
    expect(tipBox).not.toBeNull()
    expect(tipBox!.y).toBeGreaterThanOrEqual(btnBox!.y + btnBox!.height)
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(1280)
  }

  await hoverAndCheck(likeBtn, 'I like this')
  await hoverAndCheck(dislikeBtn, 'I dislike this')
  await hoverAndCheck(actions.getByRole('button', { name: 'Share', exact: true }), 'Share')
  await hoverAndCheck(actions.getByRole('button', { name: 'Save', exact: true }), 'Save')
  await hoverAndCheck(actions.getByRole('button', { name: 'Download', exact: true }), 'Download')
  await hoverAndCheck(actions.getByRole('button', { name: 'More actions', exact: true }), 'More actions')

  await actions.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(actions.getByRole('tooltip', { name: 'More actions', exact: true })).toBeHidden()
  await page.keyboard.press('Escape')

  await page.mouse.move(0, 0)
  await dislikeBtn.focus()
  await page.keyboard.press(process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  const shareBtn = actions.getByRole('button', { name: 'Share', exact: true })
  await expect(shareBtn).toBeFocused()
  await expect(actions.getByRole('tooltip', { name: 'Share', exact: true })).toBeVisible()
})

test('overflows lower-priority actions cleanly on narrower desktop widths and two-row phone viewports', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 })
  const host = await mount(page, {
    subscribed: false,
    channelName: 'Very Long Channel Name That Should Truncate Smoothly On Desktop',
    likeCountText: '12,345,678',
  })

  const ownerRow = host.locator('.owner-row')
  await expect.poll(async () => (await rowMetrics(host)).rowHeight).toBeLessThanOrEqual(52)
  const narrowDesktop = await rowMetrics(host)
  expect(narrowDesktop.overflow).toBe(false)
  expect(narrowDesktop.buttonTopSpread).toBeLessThanOrEqual(4)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)

  await ownerRow.getByRole('button', { name: 'More actions', exact: true }).click()
  const moreMenu = page.getByRole('menu', { name: 'More actions' })
  await expect(moreMenu.getByRole('menuitem', { name: 'Share' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Save' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Download' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 630, height: 800 })
  await expect.poll(async () => (await rowMetrics(host)).overflow).toBe(false)
  expect((await rowMetrics(host)).buttonTopSpread).toBeLessThanOrEqual(4)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)

  await ownerRow.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(moreMenu.getByRole('menuitem', { name: 'Share' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Save' })).toBeVisible()
  await expect(moreMenu.getByRole('menuitem', { name: 'Download' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 412, height: 915 })
  await expect.poll(async () => (await rowMetrics(host)).actionsTop).toBeGreaterThanOrEqual((await rowMetrics(host)).ownerBottom ?? 0)
  const mobile = await rowMetrics(host)
  expect(mobile.overflow).toBe(false)
  expect(mobile.buttonTopSpread).toBeLessThanOrEqual(4)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Download', exact: true })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 800 })
  await expect.poll(async () => (await rowMetrics(host)).overflow).toBe(false)
  expect((await rowMetrics(host)).buttonTopSpread).toBeLessThanOrEqual(4)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(ownerRow.locator('.actions').getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)

  await ownerRow.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(moreMenu.getByRole('menuitem', { name: 'Share' })).toHaveCount(0)
  await expect(moreMenu.getByRole('menuitem', { name: 'Save' })).toBeVisible()
  await expect(moreMenu.getByRole('menuitem', { name: 'Download' })).toBeVisible()
  await moreMenu.getByRole('menuitem', { name: 'Save' }).click()
  await expect(page.getByRole('dialog', { name: 'Save to playlist' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Save to playlist' }).getByText('Watch later')).toBeVisible()
  await page.keyboard.press('Escape')
})
