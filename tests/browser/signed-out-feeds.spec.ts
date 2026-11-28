import type { Locator, Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const FEED_PROMPTS = [
  {
    path: '/feed/subscriptions',
    heading: "Don't miss new videos",
    subtitle: 'Sign in to see updates from your favorite YouTube channels',
    h1: undefined,
  },
  {
    path: '/feed/history',
    heading: 'Keep track of what you watch',
    subtitle: "Watch history isn't viewable when signed out.",
    h1: 'Watch history',
  },
  {
    path: '/feed/you',
    heading: 'Enjoy your favorite videos',
    subtitle: "Sign in to access videos that you've liked or saved",
    h1: undefined,
  },
  {
    path: '/feed/playlists',
    heading: 'Enjoy your playlists',
    subtitle: "Sign in to access playlists that you've created or saved",
    h1: undefined,
  },
] as const

const svgShape = (svg: Locator) => svg.evaluate((el) => {
  const GEOM_ATTRS = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2']
  const children = [...el.children].map((child) => {
    const attrs = GEOM_ATTRS
      .map(name => [name, child.getAttribute(name)] as const)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ')
    return `${child.tagName.toLowerCase()}:${attrs}`
  })
  return {
    viewBox: el.getAttribute('viewBox') ?? '',
    strokeWidth: el.getAttribute('stroke-width') ?? '',
    strokeLinecap: el.getAttribute('stroke-linecap') ?? '',
    strokeLinejoin: el.getAttribute('stroke-linejoin') ?? '',
    fill: el.getAttribute('fill') ?? '',
    shapes: children,
  }
})

const promptMetrics = (prompt: Locator) => prompt.evaluate((el) => {
  const icon = el.querySelector('.prompt-icon')!
  const heading = el.querySelector('h2')!
  const iconBox = icon.getBoundingClientRect()
  const headingBox = heading.getBoundingClientRect()
  return {
    iconWidth: iconBox.width,
    iconHeight: iconBox.height,
    gapToHeading: headingBox.top - iconBox.bottom,
  }
})

const openGuideNav = async (page: Page, width: number) => {
  if (width >= 1313) return page.getByRole('navigation', { name: 'Guide' })
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Guide' })
  await expect(drawer).toBeVisible()
  return drawer
}

test('shows centered signed-out prompts across all feed pages in dark and light mode, desktop and phone', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/feed/subscriptions')
  await expect(page.locator('main').getByRole('heading', { name: "Don't miss new videos", level: 2, exact: true })).toBeVisible({ timeout: 90_000 })

  const navigate = (path: string) => page.evaluate((target) => {
    history.pushState(null, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)

      for (const feed of FEED_PROMPTS) {
        await navigate(feed.path)
        const main = page.locator('main')
        const prompt = main.locator('.signed-out-prompt')
        const heading = prompt.getByRole('heading', { name: feed.heading, level: 2, exact: true })
        const subtitle = prompt.getByText(feed.subtitle, { exact: true })
        const signInButton = prompt.getByRole('button', { name: 'Sign in', exact: true })
        const icon = prompt.locator('.prompt-icon svg')

        await expect(heading, `${feed.path} (${scheme}, ${viewport.width}px) missing heading`).toBeVisible({ timeout: 30_000 })
        await expect(subtitle, `${feed.path} (${scheme}, ${viewport.width}px) missing subtitle`).toBeVisible()
        await expect(signInButton, `${feed.path} (${scheme}, ${viewport.width}px) missing Sign in`).toBeVisible()
        await expect(icon, `${feed.path} (${scheme}, ${viewport.width}px) missing icon`).toBeVisible()

        if (feed.h1) {
          await expect(main.getByRole('heading', { name: feed.h1, level: 1, exact: true })).toBeVisible()
        } else {
          await expect(main.getByRole('heading', { level: 1 })).toHaveCount(0)
        }

        const iconBox = await icon.boundingBox()
        expect(iconBox, `${feed.path} icon has no box`).not.toBeNull()
        expect(iconBox!.width).toBeGreaterThanOrEqual(64)
        expect(iconBox!.height).toBeGreaterThanOrEqual(64)

        const styles = await prompt.evaluate((element) => {
          const title = element.querySelector('h2')!
          const sub = element.querySelector('.prompt-subtitle')!
          const rootStyle = getComputedStyle(document.body)
          const titleStyle = getComputedStyle(title)
          const subStyle = getComputedStyle(sub)
          const promptStyle = getComputedStyle(element)
          return {
            titleSize: titleStyle.fontSize,
            titleWeight: titleStyle.fontWeight,
            titleColor: titleStyle.color,
            subSize: subStyle.fontSize,
            subColor: subStyle.color,
            promptBg: promptStyle.backgroundColor,
            pageBg: rootStyle.backgroundColor,
          }
        })
        expect(styles.titleSize).toBe('24px')
        expect(Number(styles.titleWeight)).toBeGreaterThanOrEqual(700)
        expect(styles.subSize).toBe('14px')
        expect(styles.promptBg).toBe('rgba(0, 0, 0, 0)')
        expect(styles.titleColor).not.toBe(styles.pageBg)
        expect(styles.subColor).not.toBe(styles.pageBg)

        const [mainBox, promptBox, buttonBox] = await Promise.all([
          main.boundingBox(),
          prompt.boundingBox(),
          signInButton.boundingBox(),
        ])
        expect(mainBox).not.toBeNull()
        expect(promptBox).not.toBeNull()
        expect(buttonBox).not.toBeNull()
        const mainCenter = mainBox!.x + mainBox!.width / 2
        const promptCenter = promptBox!.x + promptBox!.width / 2
        expect(Math.abs(promptCenter - mainCenter), `${feed.path} prompt not centered at ${viewport.width}px`).toBeLessThanOrEqual(2)
        expect(buttonBox!.x).toBeGreaterThanOrEqual(0)
        expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewport.width + 0.5)

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect(overflow, `${feed.path} overflows horizontally (${scheme}, ${viewport.width}px)`).toBe(0)
      }
    }
  }

  expect(errors).toEqual([])
})

test('keeps watch history import actions inside the signed-out prompt without overflow and reachable by keyboard', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'browser history import is Chromium-only')
  test.setTimeout(180_000)
  await hideFknNotice(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  await page.addInitScript(() => {
    const mark = () => {
      document.documentElement.dataset.fknExtension = 'true'
    }
    if (document.documentElement) return mark()
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return
      mark()
      observer.disconnect()
    }).observe(document, { childList: true })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/feed/history')

  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: 'Watch history', level: 1, exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(main.getByRole('heading', { name: 'Keep track of what you watch', level: 2, exact: true })).toBeVisible()
  const signInButton = main.getByRole('button', { name: 'Sign in', exact: true })
  const importButton = main.getByRole('button', { name: 'Import from YouTube on this browser', exact: true })
  await expect(signInButton).toBeVisible()
  await expect(importButton).toBeVisible()

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    const importBox = await importButton.boundingBox()
    expect(importBox).not.toBeNull()
    expect(importBox!.x).toBeGreaterThanOrEqual(0)
    expect(importBox!.x + importBox!.width).toBeLessThanOrEqual(viewport.width + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

    await signInButton.focus()
    await expect(signInButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(importButton).toBeFocused()
  }
  expect(errors).toEqual([])
})

test('uses distinct signed-out prompt icons for Subscriptions and Playlists matching navigation entries', async ({ page }) => {
  test.setTimeout(180_000)
  await hideFknNotice(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  const navigate = (path: string) => page.evaluate((target) => {
    history.pushState(null, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

  await page.goto('/feed/subscriptions')
  await expect(page.locator('main .signed-out-prompt .prompt-icon svg')).toBeVisible({ timeout: 90_000 })

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)

    await navigate('/feed/subscriptions')
    const subsPrompt = page.locator('main .signed-out-prompt')
    const subsSvg = subsPrompt.locator('.prompt-icon svg')
    await expect(subsSvg).toBeVisible({ timeout: 30_000 })
    const subsShape = await svgShape(subsSvg)
    const subsMetrics = await promptMetrics(subsPrompt)

    const subsGuide = await openGuideNav(page, viewport.width)
    const subsNavSvg = subsGuide.getByRole('link', { name: 'Subscriptions', exact: true }).locator('svg')
    await expect(subsNavSvg).toBeVisible()
    const subsNavShape = await svgShape(subsNavSvg)
    if (viewport.width < 1313) {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Guide' })).toHaveCount(0)
    }

    await navigate('/feed/playlists')
    const playlistsPrompt = page.locator('main .signed-out-prompt')
    const playlistsSvg = playlistsPrompt.locator('.prompt-icon svg')
    await expect(playlistsSvg).toBeVisible({ timeout: 30_000 })
    const playlistsShape = await svgShape(playlistsSvg)
    const playlistsMetrics = await promptMetrics(playlistsPrompt)

    expect(subsShape.shapes, `Subscriptions and Playlists must use distinct icons at ${viewport.width}px`).not.toEqual(playlistsShape.shapes)
    expect(subsShape.shapes).toEqual(subsNavShape.shapes)

    expect(subsShape.viewBox).toBe(playlistsShape.viewBox)
    expect(subsShape.strokeWidth).toBe('1.25')
    expect(playlistsShape.strokeWidth).toBe('1.25')
    expect(subsShape.strokeLinecap).toBe(playlistsShape.strokeLinecap)
    expect(subsShape.strokeLinejoin).toBe(playlistsShape.strokeLinejoin)
    expect(subsShape.fill).toBe(playlistsShape.fill)
    expect(subsMetrics.iconWidth).toBe(72)
    expect(subsMetrics.iconHeight).toBe(72)
    expect(playlistsMetrics.iconWidth).toBe(72)
    expect(playlistsMetrics.iconHeight).toBe(72)
    expect(Math.abs(subsMetrics.gapToHeading - playlistsMetrics.gapToHeading)).toBeLessThanOrEqual(1)

    const guideHarness = '/tests/browser/fixtures/guide-harness.tsx'
    await page.evaluate(async (harnessPath) => {
      document.querySelectorAll('[data-guide-harness]').forEach(node => node.remove())
      const mod = await import(harnessPath) as typeof import('./fixtures/guide-harness')
      mod.mountGuide(true)
    }, guideHarness)
    const signedInGuide = page.locator('[data-guide-harness="signed-in"]')
    await signedInGuide.getByRole('button', { name: 'Show more', exact: true }).click()
    const playlistsNavSvg = signedInGuide.getByRole('link', { name: 'Playlists', exact: true }).locator('svg')
    await expect(playlistsNavSvg).toBeVisible()
    const playlistsNavShape = await svgShape(playlistsNavSvg)
    expect(playlistsShape.shapes).toEqual(playlistsNavShape.shapes)
    await page.evaluate(() => {
      document.querySelectorAll('[data-guide-harness]').forEach(node => node.remove())
    })
  }

  expect(errors).toEqual([])
})

test('aligns signed-out History prompt vertically with Clips and Playlists while keeping Watch history accessible', async ({ page }) => {
  test.setTimeout(180_000)
  await hideFknNotice(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  const navigate = (path: string) => page.evaluate((target) => {
    history.pushState(null, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

  await page.goto('/feed/history')
  await expect(page.locator('main .signed-out-prompt h2')).toBeVisible({ timeout: 90_000 })

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)

    await navigate('/feed/history')
    const historyPromptHeading = page.locator('main .signed-out-prompt h2')
    await expect(historyPromptHeading).toHaveText('Keep track of what you watch', { timeout: 30_000 })
    const namedMain = page.getByRole('main', { name: 'Watch history', exact: true })
    await expect(namedMain).toBeVisible()
    const historyH1 = namedMain.getByRole('heading', { name: 'Watch history', level: 1, exact: true })
    await expect(historyH1).toBeVisible()
    const h1Box = (await historyH1.boundingBox())!
    expect(h1Box.height).toBeLessThanOrEqual(1)
    const historyTop = (await historyPromptHeading.boundingBox())!.y

    await navigate('/feed/clips')
    const clipsPromptHeading = page.locator('main .signed-out-prompt h2')
    await expect(clipsPromptHeading).toHaveText('Enjoy your clips', { timeout: 30_000 })
    const clipsTop = (await clipsPromptHeading.boundingBox())!.y

    await navigate('/feed/playlists')
    const playlistsPromptHeading = page.locator('main .signed-out-prompt h2')
    await expect(playlistsPromptHeading).toHaveText('Enjoy your playlists', { timeout: 30_000 })
    const playlistsTop = (await playlistsPromptHeading.boundingBox())!.y

    expect(Math.abs(historyTop - clipsTop), `History vs Clips h2 vertical mismatch at ${viewport.width}px (${historyTop} vs ${clipsTop})`).toBeLessThanOrEqual(1)
    expect(Math.abs(historyTop - playlistsTop), `History vs Playlists h2 vertical mismatch at ${viewport.width}px (${historyTop} vs ${playlistsTop})`).toBeLessThanOrEqual(1)
  }

  expect(errors).toEqual([])
})
