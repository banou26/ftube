import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const THEATER_HARNESS = '/tests/browser/fixtures/theater-bigger-harness.tsx'
const SHORTS_HARNESS = '/tests/browser/fixtures/shorts-menu-harness.tsx'

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

const mountWatchPlayer = async (page: Page, theater: 'default' | 'theater', videoId: string) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(holdPlayback)
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ volume: 0.5, muted: false }))
  })
  await hideFknNotice(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/privacy')
  await expect(page.locator('#app main')).toBeVisible({ timeout: 30_000 })

  const host = page.locator(`[data-theater-bigger-harness="${videoId}"]`)
  await expect(async () => {
    if (await host.count() === 0) {
      await page.evaluate(async ([path, vid, mode]) => {
        const mod = await import(path!) as typeof import('./fixtures/theater-bigger-harness')
        mod.mountTheaterBiggerHarness({ videoId: vid, theater: mode as 'default' | 'theater' })
      }, [THEATER_HARNESS, videoId, theater] as const)
    }
    await expect(host.locator('main .stage [data-player-surface] video')).toBeVisible({ timeout: 10_000 })
    await expect(host.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 10_000 })
  }).toPass({ timeout: 60_000 })

  return host
}

test('adjusts volume with mouse wheel when hovering Watch player in default and theater modes without scrolling the page or menu', async ({ page }) => {
  test.setTimeout(120_000)

  for (const mode of ['default', 'theater'] as const) {
    const host = await mountWatchPlayer(page, mode, `wheel-watch-${mode}`)
    const surface = host.locator('[data-player-surface]')
    const video = surface.locator('video')

    await page.evaluate(() => window.scrollTo(0, 120))
    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(scrollBefore).toBe(120)

    const box = (await surface.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    await page.mouse.wheel(0, -120)
    await expect.poll(() => video.evaluate(el => ({
      volume: Number((el as HTMLVideoElement).volume.toFixed(2)),
      muted: (el as HTMLVideoElement).muted,
    }))).toEqual({ volume: 0.55, muted: false })
    await expect(surface.locator('[data-bezel="volume"]')).toContainText('55%')
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

    await expect.poll(() => page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('yt-client:settings') || '{}') as { volume?: number, muted?: boolean }
      return { volume: raw.volume, muted: raw.muted }
    })).toEqual({ volume: 0.55, muted: false })

    await page.mouse.wheel(0, 120)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => video.evaluate(el => ({
      volume: Number((el as HTMLVideoElement).volume.toFixed(2)),
      muted: (el as HTMLVideoElement).muted,
    }))).toEqual({ volume: 0.45, muted: false })
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

    // Scrolling over the Settings popup menu must not change volume.
    await host.getByRole('button', { name: 'Settings', exact: true }).click()
    const menu = host.getByRole('menu', { name: 'Player settings' })
    await expect(menu).toBeVisible()
    const menuBox = (await menu.boundingBox())!
    await page.mouse.move(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(150)
    expect(await video.evaluate(el => Number((el as HTMLVideoElement).volume.toFixed(2)))).toBe(0.45)
  }
})

test('adjusts Shorts volume with mouse wheel on the volume pill without scrolling to another Short', async ({ page }) => {
  test.setTimeout(120_000)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.addInitScript(holdPlayback)
  await hideFknNotice(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/privacy')

  const root = page.locator('[data-shorts-menu-harness="true"]')
  await expect(async () => {
    if (await root.count() === 0) {
      await page.evaluate(async ([path]) => {
        const harness = await import(path!) as typeof import('./fixtures/shorts-menu-harness')
        harness.mountShortsMenuHarness('full')
      }, [SHORTS_HARNESS])
    }
    await expect(root.locator('[data-short-id="short-1"] video')).toBeVisible({ timeout: 10_000 })
  }).toPass({ timeout: 60_000 })

  const slide = root.locator('[data-short-id="short-1"]')
  const pill = slide.locator('.volume-pill')
  const video = slide.locator('video')
  await expect(pill).toBeVisible()

  await page.evaluate(() => {
    const el = document.querySelector('[data-shorts-menu-harness="true"] [data-short-id="short-1"] video') as HTMLVideoElement
    el.volume = 0.5
    el.muted = false
  })

  const pillBox = (await pill.boundingBox())!
  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2)

  await page.mouse.wheel(0, -120)
  await expect.poll(() => video.evaluate(el => ({
    volume: Number((el as HTMLVideoElement).volume.toFixed(2)),
    muted: (el as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.55, muted: false })

  await page.mouse.wheel(0, 120)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => video.evaluate(el => ({
    volume: Number((el as HTMLVideoElement).volume.toFixed(2)),
    muted: (el as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.45, muted: false })
  await expect(slide.getByRole('slider', { name: 'Volume', includeHidden: true })).toHaveAttribute('aria-valuetext', '45%')

  // Wheel over the volume pill must not change the active Short slide.
  expect(new URL(page.url()).pathname).toBe('/shorts/short-1')
})
