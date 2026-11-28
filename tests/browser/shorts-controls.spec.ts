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

const SHAKA_SHORTS_MOCK_JS = `
const installVideoController = (video, options) => {
  let paused = options.autoPlay === false
  let currentTime = options.startTime || 0
  const duration = 120
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration })
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false })
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (v) => {
      currentTime = Number(v) || 0
      video.dispatchEvent(new Event('timeupdate'))
    },
  })
  Object.defineProperty(video, 'buffered', {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => duration }),
  })
  video.play = async () => {
    if (!paused) return
    paused = false
    video.dispatchEvent(new Event('play'))
    video.dispatchEvent(new Event('playing'))
  }
  video.pause = () => {
    if (paused) return
    paused = true
    video.dispatchEvent(new Event('pause'))
  }
  const timer = setInterval(() => {
    if (!paused) {
      currentTime = Math.min(duration, currentTime + 0.2)
      video.dispatchEvent(new Event('timeupdate'))
    }
  }, 200)
  const controller = {
    player: {
      isLive: () => false,
      seekRange: () => ({ start: 0, end: duration }),
      getVariantTracks: () => [{ active: true, width: 720, height: 1280, frameRate: 30 }],
      getBufferedInfo: () => ({ total: [{ start: 0, end: duration }] }),
      configure: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      destroy: async () => {},
    },
    heights: [720],
    storyboards: [],
    isLive: false,
    audioTracks: [{ id: 'en-audio', languageCode: 'en', label: 'English', isDefault: true }],
    audioTrackId: 'en-audio',
    hasDrc: () => false,
    captionTracks: [{ id: 'en-cap', languageCode: 'en', label: 'English', autoGenerated: false }],
    translationLanguages: [],
    selectQuality: async () => {},
    selectAudio: async () => {},
    selectCaption: async () => {},
    play: async () => video.play(),
    destroy: async () => clearInterval(timer),
  }
  queueMicrotask(() => {
    if (options.signal?.aborted) return
    video.dispatchEvent(new Event('loadedmetadata'))
    video.dispatchEvent(new Event('loadeddata'))
  })
  return controller
}
export const startShakaPlayback = async (options) => installVideoController(options.video, options)
`

const FOCUSABLE_QUERY = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

const slideAccessibilityAudit = async (root: ReturnType<Page['locator']>, id: string) =>
  root.locator(`[data-short-id="${id}"]`).evaluate((slide, selector) => {
    const el = slide as HTMLElement
    const candidates = [...el.querySelectorAll<HTMLElement>(selector)]
    const nonNegative = candidates
      .filter(node => node.tabIndex >= 0)
      .map(node => node.getAttribute('aria-label') || node.className || node.tagName)
    return {
      inert: el.inert,
      ariaHidden: el.getAttribute('aria-hidden'),
      topBarButtons: el.querySelectorAll('.top-bar button').length,
      nonNegativeCount: nonNegative.length,
      nonNegative,
    }
  }, FOCUSABLE_QUERY)

const walkTabInsideMain = async (page: Page, expectedActiveSlideId: string) => {
  const visited: { slideId: string | null, label: string }[] = []
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const slide = el?.closest<HTMLElement>('[data-short-id]')
      const inPager = Boolean(el?.closest('.pager'))
      const inMain = Boolean(el?.closest('main'))
      const label = (el?.getAttribute('aria-label') || el?.textContent || el?.className || el?.tagName || '').trim()
      return { slideId: slide?.dataset.shortId ?? null, inPager, inMain, label }
    })
    if (!info.inMain) break
    visited.push({ slideId: info.slideId, label: info.label })
    if (info.slideId) {
      expect(info.slideId, `Tab landed on inactive slide ${info.slideId} (${info.label})`).toBe(expectedActiveSlideId)
    }
    if (info.inPager && info.label === 'Next short') break
  }
  return visited
}

test('keeps inactive Shorts controls out of keyboard tab order and accessibility tree across paused advance and end of feed (APP-1077)', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/src/player/shaka.ts*', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: SHAKA_SHORTS_MOCK_JS }),
  )
  await page.setViewportSize({ width: 1280, height: 900 })
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

  const slide1 = root.locator('[data-short-id="short-1"]')
  const slide2 = root.locator('[data-short-id="short-2"]')
  const slide3 = root.locator('[data-short-id="short-3"]')
  await expect(slide1).toHaveAttribute('data-active', 'true', { timeout: 15_000 })
  await expect(slide1.locator('.short-title')).toHaveText('The AI Model Iceberg', { timeout: 10_000 })

  // 1. Initial state: inactive slides are inert, aria-hidden, have 0 top-bar buttons and 0 nonnegative tabIndex nodes
  expect(await slideAccessibilityAudit(root, 'short-1')).toMatchObject({
    inert: false,
    ariaHidden: null,
  })
  for (const inactiveId of ['short-2', 'short-3']) {
    expect(await slideAccessibilityAudit(root, inactiveId), `initial inactive ${inactiveId}`).toEqual({
      inert: true,
      ariaHidden: 'true',
      topBarButtons: 0,
      nonNegativeCount: 0,
      nonNegative: [],
    })
  }
  // Accessible buttons only reflect active short-1 + Next short pager
  await expect(root.getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(1)

  // sequential Tab walk from first active button reaches Next short without hitting any inactive slide
  const firstBtn = slide1.getByRole('button', { name: /^(Play|Pause)$/ })
  await firstBtn.focus()
  await expect(firstBtn).toBeFocused()
  const walk1 = await walkTabInsideMain(page, 'short-1')
  expect(walk1.some(entry => entry.label === 'Next short')).toBe(true)

  // 2. Pause active short-1 while its Play/Pause button holds focus, then advance via ArrowDown
  const pauseBtn1 = slide1.getByRole('button', { name: 'Pause', exact: true })
  await pauseBtn1.focus()
  await pauseBtn1.click()
  const playBtn1 = slide1.getByRole('button', { name: 'Play', exact: true })
  await expect(playBtn1).toBeVisible()
  await playBtn1.focus()
  await expect(playBtn1).toBeFocused()
  await expect(slide2.locator('.paused-glyph')).toHaveCount(0)

  await page.keyboard.press('ArrowDown')
  await expect(slide2).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
  await expect(slide2.locator('.byline .name')).toHaveText('Second Channel', { timeout: 10_000 })
  await expect(slide2.locator('.paused-glyph')).toHaveCount(0)

  // Focus transferred cleanly into active short-2 (never stranded on short-1 or document.body)
  const focusAfterDown = await page.evaluate(() => ({
    slideId: (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-short-id]')?.dataset.shortId ?? null,
    isBody: document.activeElement === document.body,
  }))
  expect(focusAfterDown).toEqual({ slideId: 'short-2', isBody: false })

  for (const inactiveId of ['short-1', 'short-3']) {
    expect(await slideAccessibilityAudit(root, inactiveId), `after down inactive ${inactiveId}`).toEqual({
      inert: true,
      ariaHidden: 'true',
      topBarButtons: 0,
      nonNegativeCount: 0,
      nonNegative: [],
    })
  }
  // Even though short-1 was paused before leaving, no inactive Play button remains in the accessibility tree
  await expect(root.getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(1)

  const walk2 = await walkTabInsideMain(page, 'short-2')
  expect(walk2.some(entry => entry.label === 'Next short')).toBe(true)

  // 3. Advance to end of feed (short-3) via Next short pager button -> disabled Next hands focus to Previous short
  const nextBtn = root.locator('.pager button[aria-label="Next short"]')
  await nextBtn.focus()
  await expect(nextBtn).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(slide3).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
  await expect(slide3.locator('.byline .name')).toHaveText('Third Channel', { timeout: 10_000 })
  await expect(nextBtn).toBeDisabled()

  const prevBtn = root.locator('.pager button[aria-label="Previous short"]')
  await expect(prevBtn).toBeFocused()
  for (const inactiveId of ['short-1', 'short-2']) {
    expect(await slideAccessibilityAudit(root, inactiveId), `at end inactive ${inactiveId}`).toEqual({
      inert: true,
      ariaHidden: 'true',
      topBarButtons: 0,
      nonNegativeCount: 0,
      nonNegative: [],
    })
  }

  // Pressing Enter on focused Previous short returns cleanly to short-2
  await page.keyboard.press('Enter')
  await expect(slide2).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
  await expect(prevBtn).toBeFocused()
  expect(await slideAccessibilityAudit(root, 'short-3')).toMatchObject({
    inert: true,
    ariaHidden: 'true',
    topBarButtons: 0,
    nonNegativeCount: 0,
  })
})

const samplePoints = async (page: Page, points: readonly { x: number, y: number }[]) => {
  const png = await page.screenshot()
  const url = `data:image/png;base64,${png.toString('base64')}`
  return page.evaluate(async ({ imageUrl, coords }) => {
    const img = new Image()
    img.src = imageUrl
    await img.decode()
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return coords.map(({ x, y }) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * dpr)))
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * dpr)))
      const [r = 0, g = 0, b = 0] = ctx.getImageData(px, py, 1, 1).data
      return { r, g, b }
    })
  }, { imageUrl: url, coords: points })
}

const SHORT_RAIL_ACTIONS = ['Like', 'Dislike', 'Comments', 'Share', 'More actions'] as const

test('makes Shorts action button backgrounds transparent in ambient mode, keeps focus ring and clickability, and restores solid chip backgrounds when ambient mode is off (APP-1073)', async ({ page }) => {
  for (const scenario of [
    { name: 'desktop-dark', width: 1280, height: 900, theme: 'dark', expectedSolidBg: 'rgb(39, 39, 39)', minOpacity: 0.68, minGreenLead: 4 },
    { name: 'desktop-light', width: 1280, height: 900, theme: 'light', expectedSolidBg: 'rgb(242, 242, 242)', minOpacity: 0.22, minGreenLead: 1 },
    { name: 'landscape-dark', width: 915, height: 412, theme: 'dark', expectedSolidBg: 'rgb(39, 39, 39)', minOpacity: 0.68, minGreenLead: 4 },
  ] as const) {
    await page.emulateMedia({ colorScheme: scenario.theme })
    const root = await openShortsControlsHarness(page, { width: scenario.width, height: scenario.height })
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }, scenario.theme)

    const slide = root.locator('[data-short-id="short-1"]')
    const rail = slide.locator('.rail')
    await expect(rail).toHaveAttribute('data-ambient', 'true')
    await expect(slide.locator('[data-ambient-glow]')).toHaveAttribute('data-active', 'true')

    // Wait for the 0.4s ambient opacity fade-in and paint pure green onto the glow canvas
    await slide.locator('[data-ambient-glow] canvas').evaluate((el) => {
      const canvas = el as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#00ff00'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    })
    await expect.poll(
      () => slide.locator('[data-ambient-glow]').evaluate(el => Number(getComputedStyle(el).opacity)),
      { timeout: 5_000 },
    ).toBeGreaterThanOrEqual(scenario.minOpacity)

    const sampleCoords: { name: string, x: number, y: number }[] = []
    for (const label of SHORT_RAIL_ACTIONS) {
      const btn = slide.getByRole('button', { name: label, exact: true })
      const glyph = btn.locator('.glyph')
      await expect(glyph, `${scenario.name} ${label} transparent glyph`).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const box = (await glyph.boundingBox())!
      sampleCoords.push({
        name: label,
        x: Math.round(box.x + Math.min(8, box.width * 0.2)),
        y: Math.round(box.y + box.height / 2),
      })
    }

    const glowPixels = await samplePoints(page, sampleCoords)
    for (let i = 0; i < sampleCoords.length; i++) {
      const px = glowPixels[i]!
      const lead = Math.min(px.g - px.r, px.g - px.b)
      expect(lead, `${scenario.name} ${sampleCoords[i]!.name} did not let green ambient glow through: ${JSON.stringify(px)}`).toBeGreaterThanOrEqual(scenario.minGreenLead)
    }

    // Keyboard focus via Tab reaches each rail button with a visible focus ring
    await slide.locator('.meta .subscribe').focus()
    for (const label of SHORT_RAIL_ACTIONS) {
      const btn = slide.getByRole('button', { name: label, exact: true })
      for (let step = 0; step < 4; step++) {
        if (await btn.evaluate(el => el === document.activeElement)) break
        await page.keyboard.press('Tab')
      }
      expect(await btn.evaluate(el => el === document.activeElement), `${scenario.name} ${label} not keyboard-focused`).toBe(true)
      const focusRing = await btn.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: parseFloat(s.outlineWidth) || 0,
        }
      })
      expect(focusRing.outlineStyle, `${scenario.name} ${label} missing focus outline`).not.toBe('none')
      expect(focusRing.outlineWidth, `${scenario.name} ${label} focus outline too thin`).toBeGreaterThanOrEqual(2)
    }

    // Buttons stay clickable
    await slide.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(slide.getByRole('complementary', { name: 'Comments', exact: true })).toBeVisible()
    await slide.getByRole('button', { name: 'Close comments', exact: true }).click()
    await expect(slide.getByRole('complementary', { name: 'Comments', exact: true })).toHaveCount(0)

    await slide.getByRole('button', { name: 'More actions', exact: true }).click()
    await expect(page.getByRole('menu', { name: 'More actions', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    // Turn Ambient mode off via More options and verify solid chip backgrounds are restored
    await slide.locator('.top-bar').getByRole('button', { name: 'More options', exact: true }).click()
    const optionsMenu = page.getByRole('menu', { name: 'More options', exact: true })
    await optionsMenu.getByRole('menuitemcheckbox', { name: /Ambient mode/ }).click()
    await page.keyboard.press('Escape')

    await expect(rail).not.toHaveAttribute('data-ambient', 'true')
    await expect(slide.locator('[data-ambient-glow]')).toHaveAttribute('data-active', 'false')

    for (const label of SHORT_RAIL_ACTIONS) {
      await expect(
        slide.getByRole('button', { name: label, exact: true }).locator('.glyph'),
        `${scenario.name} ${label} restored solid bg`,
      ).toHaveCSS('background-color', scenario.expectedSolidBg)
    }

    await expect.poll(
      () => slide.locator('[data-ambient-glow]').evaluate(el => Number(getComputedStyle(el).opacity)),
      { timeout: 5_000 },
    ).toBeLessThanOrEqual(0.05)

    const offPixels = await samplePoints(page, sampleCoords)
    for (let i = 0; i < sampleCoords.length; i++) {
      const px = offPixels[i]!
      expect(
        Math.max(Math.abs(px.g - px.r), Math.abs(px.g - px.b)),
        `${scenario.name} ${sampleCoords[i]!.name} solid chip was not neutral grey: ${JSON.stringify(px)}`,
      ).toBeLessThanOrEqual(1)
    }
  }
})


