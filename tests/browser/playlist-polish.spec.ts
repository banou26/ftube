import type { Page } from '@playwright/test'

import { expect, laneOrigin, test } from './test'

const PLAYLIST_ID = 'PLBsP89CPrMeNIuvr9j3_EQaMwaNJ6rhuQ'
const PLAYLIST_PATH = `/playlist?list=${PLAYLIST_ID}`

const collectPageErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message.split('\n')[0]!.slice(0, 140)))
  return errors
}

const holdEngine = async (page: Page) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/__yt_engine__/engine.html', async (route) => {
    await held
    await route.continue()
  })
  return release
}

for (const theme of ['dark', 'light'] as const) {
  test(`renders ambient hero, direct Share, and expandable description on desktop in ${theme} mode`, async ({ page }) => {
    test.setTimeout(240_000)
    const errors = collectPageErrors(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript((chosenTheme) => {
      if (window !== top) return
      localStorage.setItem('yt-client:settings', JSON.stringify({ theme: chosenTheme, themeChosen: true }))
      const copied: string[] = []
      Object.assign(window, { __copiedLinks: copied })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copied.push(text)
            return Promise.resolve()
          },
        },
      })
    }, theme)

    await page.goto(PLAYLIST_PATH)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('.rows .row').first()).toBeVisible({ timeout: 120_000 })

    const side = page.locator('aside.side.ambient')
    await expect(side).toBeVisible()

    const backdrop = side.locator('.ambient-backdrop')
    const backdropImg = backdrop.locator('img')
    await expect(backdropImg).toBeAttached()
    await expect.poll(() => backdropImg.evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0)

    const sideStyle = await side.evaluate((element) => {
      const computed = getComputedStyle(element)
      const backdropEl = element.querySelector('.ambient-backdrop')!
      const imgEl = backdropEl.querySelector('img')!
      return {
        position: computed.position,
        overflow: computed.overflow,
        backdropPointerEvents: getComputedStyle(backdropEl).pointerEvents,
        imgFilter: getComputedStyle(imgEl).filter,
        headingColor: getComputedStyle(element.querySelector('.heading')!).color,
      }
    })
    expect(sideStyle.position).toBe('sticky')
    expect(sideStyle.overflow).toBe('hidden')
    expect(sideStyle.backdropPointerEvents).toBe('none')
    expect(sideStyle.imgFilter).toContain('blur')
    expect(sideStyle.headingColor).toBe('rgb(255, 255, 255)')

    // Verify sticky pinning on desktop scroll
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }))
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const stickyTop = await side.evaluate(element => Math.round(element.getBoundingClientRect().top))
    expect(stickyTop).toBeGreaterThanOrEqual(72)
    expect(stickyTop).toBeLessThanOrEqual(88)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))

    // Direct circular Share button without redundant overflow menu
    const actions = side.locator('.actions')
    await expect(actions.getByRole('button', { name: 'More actions' })).toHaveCount(0)
    const shareButton = actions.locator('button.round[aria-label="Share"][title="Share"]')
    await expect(shareButton).toBeVisible()
    await shareButton.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedLinks: string[] }).__copiedLinks)).toEqual([
      `${new URL(page.url()).origin}${PLAYLIST_PATH}`,
    ])
    await expect(page.getByText('Link copied to clipboard')).toBeVisible()

    // Expandable description with ...more / Show less toggle
    const description = side.locator('.description')
    await expect(description).toBeVisible()
    const toggle = side.locator('button.description-toggle')
    await expect(toggle).toHaveText('...more')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const collapsedHeight = (await description.boundingBox())!.height
    expect(collapsedHeight).toBeLessThanOrEqual(56)

    await toggle.click()
    await expect(toggle).toHaveText('Show less')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const expandedHeight = (await description.boundingBox())!.height
    expect(expandedHeight).toBeGreaterThan(collapsedHeight)

    await toggle.click()
    await expect(toggle).toHaveText('...more')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect((await description.boundingBox())!.height).toBeCloseTo(collapsedHeight, 0)

    expect(errors).toEqual([])
  })
}

test('keeps CLS below 0.10 and avoids horizontal overflow on phone 390x844', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    if (window !== top) return
    let cls = 0
    const shifts: number[] = []
    Object.assign(window, { __cls: () => cls, __clsEntries: () => shifts })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number, hadRecentInput: boolean }
        if (!shift.hadRecentInput) {
          cls += shift.value
          shifts.push(shift.value)
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })

  const release = await holdEngine(page)
  await page.goto(PLAYLIST_PATH, { waitUntil: 'domcontentloaded' })

  // Side skeleton reserves the hero height before playlist metadata arrives
  const skeleton = page.locator('aside.side .side-skeleton')
  await expect(skeleton).toBeVisible({ timeout: 30_000 })
  await expect(skeleton.locator('.skel-title')).toBeVisible()
  await expect(skeleton.locator('.skel-owner')).toBeVisible()
  await expect(skeleton.locator('.skel-stats')).toBeVisible()
  await expect(skeleton.locator('.skel-desc')).toBeVisible()
  await expect(skeleton.locator('.skel-actions')).toBeVisible()
  // Let the browser paint at least one full skeleton frame before releasing
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  release()
  const side = page.locator('aside.side.ambient')
  await expect(side).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.rows .row').first()).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => side.locator('.cover img').evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const metrics = await page.evaluate(() => {
    const sideEl = document.querySelector('aside.side')!
    const backdropEl = sideEl.querySelector('.ambient-backdrop')!
    const sideRect = sideEl.getBoundingClientRect()
    const backdropRect = backdropEl.getBoundingClientRect()
    return {
      cls: (window as unknown as { __cls: () => number }).__cls(),
      shifts: (window as unknown as { __clsEntries: () => number[] }).__clsEntries(),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      sidePosition: getComputedStyle(sideEl).position,
      backdropMatchesSide:
        Math.abs(sideRect.left - backdropRect.left) <= 1
        && Math.abs(sideRect.top - backdropRect.top) <= 1
        && Math.abs(sideRect.width - backdropRect.width) <= 1
        && Math.abs(sideRect.height - backdropRect.height) <= 1,
    }
  })

  expect(metrics.cls, `CLS ${metrics.cls} (shifts: ${JSON.stringify(metrics.shifts)})`).toBeLessThan(0.10)
  expect(metrics.overflowX).toBe(0)
  expect(metrics.sidePosition).not.toBe('sticky')
  expect(metrics.backdropMatchesSide).toBe(true)
  expect(errors).toEqual([])
})

test('linkifies URLs in playlist descriptions with high contrast in light mode and resets expansion across playlists', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    if (window !== top) return
    localStorage.setItem('yt-client:settings', JSON.stringify({ theme: 'light', themeChosen: true }))
  })

  await page.route(/^https:\/\/www\.youtube\.com\/youtubei\/v1\/browse\?/, async (route) => {
    const response = await route.fetch()
    const text = await response.text()
    const injected = text.replaceAll(
      'Marques Brownlee rewinds the clock',
      'Watch https://youtu.be/dQw4w9WgXcQ and visit https://example.com/retro - Marques Brownlee rewinds the clock',
    )
    await route.fulfill({ response, body: injected })
  })

  await page.goto(`${laneOrigin(baseURL)}${PLAYLIST_PATH}`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const side = page.locator('aside.side.ambient')
  const description = side.locator('.description')
  await expect(description).toBeVisible({ timeout: 120_000 })

  const videoLink = description.locator('a[href="/watch?v=dQw4w9WgXcQ"]')
  const externalLink = description.locator('a[href="https://example.com/retro"]')
  await expect(videoLink).toBeVisible()
  await expect(externalLink).toBeVisible()
  await expect(externalLink).toHaveAttribute('target', '_blank')
  await expect(externalLink).toHaveAttribute('rel', 'noreferrer noopener')
  expect(await externalLink.evaluate(el => getComputedStyle(el).color)).toBe('rgb(138, 203, 255)')

  const toggle = side.locator('button.description-toggle')
  await expect(toggle).toHaveText('...more')
  await toggle.click()
  await expect(toggle).toHaveText('Show less')

  // Client-side navigation to another playlist resets description expansion
  await page.evaluate(() => {
    history.pushState(null, '', '/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(side.locator('.heading')).not.toHaveText('Retro Tech S2', { timeout: 120_000 })
  await expect(page.locator('.rows .row').first()).toBeVisible({ timeout: 120_000 })
  await expect(side.getByRole('button', { name: 'Show less' })).toHaveCount(0)
  expect(errors).toEqual([])
})
