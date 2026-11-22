import { expect, test } from './test'

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

test('keeps watch history import actions inside the signed-out prompt without overflow at phone width', async ({ page }) => {
  test.setTimeout(180_000)
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
  await expect(main.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  const importButton = main.getByRole('button', { name: 'Import from YouTube on this browser', exact: true })
  await expect(importButton).toBeVisible()

  const importBox = await importButton.boundingBox()
  expect(importBox).not.toBeNull()
  expect(importBox!.x).toBeGreaterThanOrEqual(0)
  expect(importBox!.x + importBox!.width).toBeLessThanOrEqual(390.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  expect(errors).toEqual([])
})
