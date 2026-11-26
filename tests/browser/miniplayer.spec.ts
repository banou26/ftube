import type { Locator, Page } from '@playwright/test'

import { expect, test } from './test'

/* youtube.com's miniplayer, measured signed out on 2026-11-10 at 1280 x 800: a 400 x 301 box 16 px from the right and
   the bottom, the 400 x 225 video over two lines (the title, then the channel, or the playlist and the place in it), and
   over the video on hover Expand, Close, a 42 px Play or Pause and the clock. At 400 px it draws no Previous or Next,
   and Shift+P and Shift+N still move along a playlist. `dQw4w9WgXcQ` is 3:33 long, from the channel Rick Astley. */

const VIDEO_ID = 'dQw4w9WgXcQ'
// a regular playlist, whose second entry has one before it (a Mix is rebuilt on every request)
const FIXED_LIST = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'

const startPlayback = async (page: Page) => {
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(1)
  return video
}

const dock = (page: Page) => page.getByRole('complementary', { name: 'Miniplayer' })

const leaveForSettings = async (page: Page) => {
  await page.evaluate(() => {
    history.pushState(null, '', '/settings')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(dock(page)).toBeVisible({ timeout: 30_000 })
  // the page, not a box, holds the focus, as after a click on youtube.com's page
  await page.getByRole('heading', { name: 'Settings' }).click()
}

const box = (locator: Locator) => locator.evaluate((element) => {
  const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
  return { left, top, right, bottom, width, height }
})

const opacity = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).opacity)

const paused = (video: Locator) => video.evaluate(element => (element as HTMLVideoElement).paused)

const videoIdOf = (url: string) => new URL(url, 'http://localhost').searchParams.get('v')

test('draws youtube.com\'s box, title and channel, and Expand, Close, Play and the clock on hover', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  const title = page.locator('main h1')
  await expect(title).not.toBeEmpty({ timeout: 60_000 })
  const name = (await title.textContent())!.trim()
  await leaveForSettings(page)
  const mini = dock(page)

  const frame = await box(mini)
  const edge = await page.evaluate(() => ({ right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight }))
  expect(frame).toMatchObject({ width: 400, height: 301, right: edge.right - 16, bottom: edge.bottom - 16 })
  const picture = await box(video)
  expect(picture).toMatchObject({ left: frame.left, top: frame.top, width: 400, height: 225 })

  // the title on one line, cut short with an ellipsis, and the channel under it
  const heading = mini.locator('.dock-title')
  await expect(heading).toHaveText(name)
  expect(await heading.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    cut: getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth,
  }))).toEqual({ height: 20, cut: true })
  await expect(mini.locator('.dock-byline')).toHaveText('Rick Astley')

  await page.mouse.move(picture.left + 100, picture.top + 60)
  const controls = mini.getByRole('button', { name: 'Expand' }).locator('..')
  await expect.poll(() => opacity(controls)).toBe('1')
  expect(await box(mini.getByRole('button', { name: 'Expand' }))).toMatchObject({ left: picture.left, top: picture.top, width: 40, height: 40 })
  expect(await box(mini.getByRole('button', { name: 'Close miniplayer' }))).toMatchObject({ right: picture.right, top: picture.top, width: 40, height: 40 })
  const play = await box(mini.getByRole('button', { name: 'Pause', exact: true }))
  expect(play).toMatchObject({ width: 42, height: 42 })
  expect(play.left + play.width / 2).toBeCloseTo(picture.left + picture.width / 2, 0)
  expect(play.top + play.height / 2).toBeCloseTo(picture.top + picture.height / 2, 0)
  // the player bar's own clock is still in the page, hidden with the bar
  const clock = mini.getByText(/^\d:\d\d \/ 3:33$/).filter({ visible: true })
  await expect(clock).toBeVisible()
  const clockBox = await box(clock)
  expect(clockBox.left).toBe(picture.left + 12)
  for (const control of ['Previous', 'Next', 'Settings', 'Full screen']) {
    await expect(mini.getByRole('button', { name: control, exact: true })).toHaveCount(0)
  }
  const muteButton = mini.getByRole('button', { name: 'Mute', exact: true })
  const volumeSlider = mini.getByRole('slider', { name: 'Volume', exact: true })
  await expect(muteButton).toBeVisible()
  await expect(volumeSlider).toBeVisible()
  const muteBox = await box(muteButton)
  const volumeBox = await box(volumeSlider)
  expect(muteBox.left).toBeGreaterThan(clockBox.right)
  expect(muteBox.top).toBeGreaterThanOrEqual(picture.top)
  expect(volumeBox.right).toBeLessThanOrEqual(picture.right)
  expect(volumeBox.bottom).toBeLessThanOrEqual(picture.bottom)

  // once the pointer leaves, only the seek bar shows, 3 px along the bottom edge of the video
  await page.mouse.move(10, 400)
  await expect.poll(() => opacity(controls)).toBe('0')
  const seek = mini.getByRole('slider', { name: 'Seek' })
  expect(await opacity(seek.locator('..'))).toBe('1')
  expect(await box(seek.locator('.rail'))).toMatchObject({ left: picture.left, bottom: picture.bottom, width: 400, height: 3 })

  await mini.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => paused(video)).toBe(true)
  await mini.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => paused(video)).toBe(false)
  // the clicked button keeps the focus, and the controls still go with the pointer; moving the focus by key shows them
  await page.mouse.move(10, 400)
  await expect.poll(() => opacity(controls)).toBe('0')
  await page.keyboard.press('Shift+Tab')
  await expect(mini.getByRole('button', { name: 'Close miniplayer' })).toBeFocused()
  await expect.poll(() => opacity(controls)).toBe('1')

  await page.mouse.move(picture.left + 100, picture.top + 60)
  await volumeSlider.fill('0.35')
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.35, muted: false })
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '35%')
  expect(await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('yt-client:settings') || '{}') as { volume?: number, muted?: boolean }
    return { volume: raw.volume, muted: raw.muted }
  })).toEqual({ volume: 0.35, muted: false })

  await muteButton.click()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  const unmuteButton = mini.getByRole('button', { name: 'Unmute', exact: true })
  await expect(unmuteButton).toBeVisible()
  await unmuteButton.click()
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.35, muted: false })

  await volumeSlider.fill('0')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  await expect(unmuteButton).toBeVisible()
  await unmuteButton.click()
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.5, muted: false })

  await volumeSlider.fill('0')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  await page.getByRole('heading', { name: 'Settings' }).click()
  await page.keyboard.press('m')
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.5, muted: false })

  await page.mouse.move(picture.left + 100, picture.top + 60)
  await expect.poll(() => opacity(controls)).toBe('1')
  const sliderBox = await box(volumeSlider)
  await page.mouse.move(sliderBox.left + sliderBox.width / 2, sliderBox.top + sliderBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sliderBox.left + sliderBox.width / 2, 10)
  await expect(controls).toHaveClass(/adjusting/)
  await expect.poll(() => opacity(controls)).toBe('1')
  await page.mouse.up()
  await expect(controls).not.toHaveClass(/adjusting/)
  await expect.poll(() => opacity(controls)).toBe('0')
  await volumeSlider.fill('0.5')

  await page.setViewportSize({ width: 360, height: 740 })
  const picture360 = await box(video)
  await page.mouse.move(picture360.left + 80, picture360.top + 40)
  await expect.poll(() => opacity(controls)).toBe('1')
  const clockBox360 = await box(clock)
  const muteBox360 = await box(mini.getByRole('button', { name: 'Mute', exact: true }))
  const volumeBox360 = await box(volumeSlider)
  expect(muteBox360.left).toBeGreaterThan(clockBox360.right)
  expect(volumeBox360.right).toBeLessThanOrEqual(picture360.right)
  expect(volumeBox360.bottom).toBeLessThanOrEqual(picture360.bottom)

  await page.setViewportSize({ width: 1280, height: 800 })
  const restoredPicture = await box(video)
  await page.evaluate(() => {
    document.body.style.minHeight = '2000px'
    window.scrollTo(0, 200)
  })
  const scrollBefore = await page.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(0)
  await page.mouse.move(restoredPicture.left + 100, restoredPicture.top + 60)

  // Scrolling over the miniplayer adjusts volume by 5% per step without scrolling the page behind it.
  await page.mouse.wheel(0, -120)
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.55, muted: false })
  await expect.poll(() => page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('yt-client:settings') || '{}') as { volume?: number, muted?: boolean }
    return { volume: raw.volume, muted: raw.muted }
  })).toEqual({ volume: 0.55, muted: false })
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  await page.mouse.wheel(0, 120)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.45, muted: false })
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  // Scrolling down past zero mutes cleanly and only scrolling up unmutes from 0 -> 0.05.
  await volumeSlider.fill('0.05')
  await page.mouse.wheel(0, 120)
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0, muted: true })
  await page.mouse.wheel(0, 120)
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  await page.mouse.wheel(0, -120)
  await expect.poll(() => video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.05, muted: false })

  await volumeSlider.fill('0.5')
  await page.evaluate(() => {
    document.body.style.minHeight = ''
    window.scrollTo(0, 0)
  })

  // Expand takes the same video element back to its watch page, still playing with adjusted volume.
  await video.evaluate((element) => {
    element.dataset.docked = 'true'
  })
  const before = await video.evaluate(element => (element as HTMLVideoElement).currentTime)
  await mini.getByRole('button', { name: 'Expand' }).click()
  await expect.poll(() => videoIdOf(page.url())).toBe(VIDEO_ID)
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('main video[data-docked="true"]')).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(before)
  expect(await video.evaluate(element => ({
    volume: Number((element as HTMLVideoElement).volume.toFixed(2)),
    muted: (element as HTMLVideoElement).muted,
  }))).toEqual({ volume: 0.5, muted: false })
})

test('f, t and a double click leave the miniplayer as it is, and Escape closes it', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  const theater = page.getByRole('button', { name: 'Theater mode' })
  await expect(theater).toHaveAttribute('aria-pressed', 'false')
  await leaveForSettings(page)

  const fullscreen = () => page.evaluate(() => document.fullscreenElement !== null)
  await page.keyboard.press('f')
  await page.keyboard.press('t')
  await page.waitForTimeout(1_000)
  expect(await fullscreen()).toBe(false)
  // away from the buttons, where the click reaches the video
  await video.dblclick({ position: { x: 100, y: 60 } })
  await page.waitForTimeout(1_000)
  expect(await fullscreen()).toBe(false)
  await expect(dock(page)).toBeVisible()

  await page.keyboard.press('i')
  await expect(dock(page)).toHaveCount(0)
  await expect(theater).toHaveAttribute('aria-pressed', 'false')
  await page.locator('main h1').click()
  await page.keyboard.press('i')
  await expect(dock(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('video')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/settings')
})

// youtube.com closes Settings, or the panel open in it, as the player docks (measured signed out on 2026-11-10)
test('i with Settings or one of its panels open docks the player with the menu closed, and one Escape closes it', async ({ page }) => {
  test.setTimeout(300_000)
  for (const panel of [undefined, 'Playback speed']) {
    await page.goto(`/watch?v=${VIDEO_ID}`)
    await startPlayback(page)
    await page.locator('[data-player-root]').hover()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('menu', { name: 'Player settings' })
    await expect(settings).toBeVisible()
    if (panel) {
      await settings.getByRole('menuitem', { name: new RegExp(`^${panel}`) }).click()
      await expect(page.getByRole('menu', { name: panel })).toBeVisible()
    }

    await page.keyboard.press('i')
    await expect(dock(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dock(page)).toHaveCount(0)
    await expect(page.locator('video')).toHaveCount(0)
  }
})

test('in a playlist it names the playlist and the place in it, Shift+P plays the entry before, and Close stops it', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto(`/playlist?list=${FIXED_LIST}`)
  const entries = page.locator(`main a[href*="list=${FIXED_LIST}"][href*="index="]`)
  await expect(entries.nth(1)).toBeAttached({ timeout: 120_000 })
  const hrefs = await entries.evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href)))
    .then(urls => urls.map(url => ({ v: url.searchParams.get('v'), index: url.searchParams.get('index') })))
  const first = hrefs.find(entry => entry.index === '1')!
  const second = hrefs.find(entry => entry.index === '2')!
  await page.goto(`/watch?v=${second.v}&list=${FIXED_LIST}&index=2`)
  const queue = page.locator('section[aria-label="Playlist queue"]')
  await expect(queue.locator('li[data-current="true"] a')).toHaveAttribute('href', new RegExp(`v=${second.v}&`), { timeout: 120_000 })
  const playlist = (await queue.locator('.playlist-title').textContent())!
  const total = (await queue.locator('.count').textContent())!.split(' / ')[1]
  await startPlayback(page)
  await leaveForSettings(page)

  const mini = dock(page)
  const place = mini.locator('.dock-byline')
  await expect(place.locator('.dock-name')).toHaveText(playlist)
  await expect(place.locator('.dock-index')).toHaveText(`2 / ${total}`)
  expect(await place.locator('.dock-index').evaluate(element => getComputedStyle(element, '::before').content)).toBe('"•"')

  await page.keyboard.press('Shift+P')
  await expect(place.locator('.dock-index')).toHaveText(`1 / ${total}`, { timeout: 60_000 })
  expect(videoIdOf((await mini.locator('.dock-title').getAttribute('href'))!)).toBe(first.v)
  expect(new URL(page.url()).pathname).toBe('/settings')
  await startPlayback(page)

  await mini.getByRole('button', { name: 'Close miniplayer' }).click()
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('video')).toHaveCount(0)
})

test('resizes while playing, adjusts controls with width, does not seek on corner keys, and persists size across dock cycles', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  await leaveForSettings(page)

  const mini = dock(page)
  const left = mini.locator('[data-resize="left"]')
  const leftBox = (await left.boundingBox())!
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(leftBox.x + leftBox.width / 2 - 160, leftBox.y + leftBox.height / 2)
  await page.mouse.up()

  await expect.poll(async () => Math.round((await box(mini)).width)).toBe(560)
  expect(await box(video)).toMatchObject({ width: 560, height: 315 })

  const beforeKeyTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime)
  const corner = mini.getByRole('separator', { name: 'Resize miniplayer', exact: true })
  await corner.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => Math.round((await box(mini)).width)).toBe(600)
  const afterKeyTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime)
  expect(afterKeyTime).toBeGreaterThanOrEqual(beforeKeyTime)

  // Expand takes playback back to watch; leaving again restores the resized 600 px dock
  await mini.getByRole('button', { name: 'Expand', exact: true }).click()
  await expect(dock(page)).toHaveCount(0)
  await expect.poll(() => videoIdOf(page.url())).toBe(VIDEO_ID)
  await leaveForSettings(page)
  await expect.poll(async () => Math.round((await box(mini)).width)).toBe(600)

  await mini.locator('[data-resize="top-left"]').dblclick()
  await expect.poll(async () => Math.round((await box(mini)).width)).toBe(400)
  await mini.getByRole('button', { name: 'Close miniplayer', exact: true }).click()
  await expect(dock(page)).toHaveCount(0)
})

type EngineFailure = { armed: boolean, port?: MessagePort }

declare global {
  interface Window { engineFailure?: EngineFailure, sameDocument?: true }
}

// the app asks the engine over a MessagePort, `{ id, method, args }`: once armed, every segment the running engine is
// asked for is answered with the error of a failed playback request, which makes the player replace the engine, and the
// next engine's port is let through
const failRunningEngine = () => {
  if (window.top !== window) return
  const failure: EngineFailure = { armed: false }
  window.engineFailure = failure
  const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (this: MessagePort, message: unknown, ...rest: unknown[]) => void
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    const call = message as { id?: number, method?: string } | null
    if (failure.armed && call?.method === 'requestSegment') {
      failure.port ??= this
      if (failure.port === this) {
        setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: call.id, error: 'youtube: segment returned 503' } })), 0)
        return
      }
      failure.armed = false
    }
    return post.call(this, message, ...rest)
  } as typeof MessagePort.prototype.postMessage
}

test('plays on after its engine is replaced, with a new release deployed since the page opened', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(failRunningEngine)
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  await leaveForSettings(page)
  await page.evaluate(() => { window.sameDocument = true })
  // the deploy: the engine frame's fixed address now serves the page of another build
  let engineLoads = 0
  await page.route('**/__yt_engine__/engine.html', async (route) => {
    engineLoads += 1
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace(/(name="yt-build" content=")[^"]*/, '$1a-later-build') })
  })
  const before = await video.evaluate(element => (element as HTMLVideoElement).currentTime)
  await page.evaluate(() => { window.engineFailure!.armed = true })
  await expect.poll(() => page.evaluate(() => window.engineFailure?.armed), { timeout: 60_000, message: 'the engine was not replaced' }).toBe(false)
  expect(await page.evaluate(() => window.sameDocument), 'the page reloaded').toBe(true)
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 60_000, message: 'the docked video did not play on' },
  ).toBeGreaterThan(before + 3)
  expect(await paused(video)).toBe(false)
  await expect(dock(page)).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/settings')
  // the reset loaded the engine page once, found the later build there, and started again in the frame it had
  expect(engineLoads).toBe(1)
  await expect(page.locator('iframe[src="/__yt_engine__/engine.html"]')).toHaveCount(1)
})
