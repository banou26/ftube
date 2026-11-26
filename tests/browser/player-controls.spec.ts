import type { Locator, Page } from '@playwright/test'

import { expect, test } from './test'

/* The player bar against the live source: `dQw4w9WgXcQ` has captions and a related list, so every control is drawn,
   and no chapters; `jNQXAC9IVRw` is 19 s long with three chapters, Intro, The cool thing (from 5 s) and End (from 17 s). */

const VIDEO_ID = 'dQw4w9WgXcQ'
const CHAPTERED_ID = 'jNQXAC9IVRw'

const startPlayback = async (page: Page) => {
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000, message: 'playback did not start' },
  ).toBeGreaterThan(1)
  return video
}

const player = (page: Page) => page.locator('[data-player-root]')

const labels = (page: Page) => player(page).evaluate((root) => {
  const controls = root.querySelector('[aria-label="Seek"]')!.parentElement!
  return [...controls.querySelectorAll('button, input, [role]')].map(control => control.getAttribute('aria-label') ?? '')
})

// the clock is the group that shrinks, so a squeezed bar shows up as a clipped clock long before anything overflows
const fit = (page: Page) => player(page).evaluate((root) => {
  const edge = root.getBoundingClientRect()
  const bar = root.querySelector('.bar')!
  const time = bar.querySelector('.time')!
  const shown = [...bar.querySelectorAll('button, .group')].map(item => item.getBoundingClientRect()).filter(box => box.width > 0)
  return {
    width: Math.round(edge.width),
    overflow: bar.scrollWidth - bar.clientWidth,
    outside: shown.filter(box => box.left < edge.left - 0.5 || box.right > edge.right + 0.5 || box.bottom > edge.bottom + 0.5).length,
    clipped: time.scrollWidth - time.clientWidth > 1,
    chapter: bar.querySelector('.chapter')?.clientWidth ?? 0,
  }
})

// the volume slider opens on a 0.2 s transition, and a measure taken before it ends sees the room it has not taken yet
const settle = (page: Page) => player(page).evaluate(async (root) => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(root.querySelector('.bar')!.getAnimations({ subtree: true }).map(animation => animation.finished))
})

const pointAt = async (page: Page, target: 'player' | 'volume') => {
  if (target === 'volume') await player(page).locator('.volume').hover()
  else {
    const box = (await player(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4)
  }
  await settle(page)
}

const expectFits = async (page: Page, width: number) => {
  await expect.poll(async () => (await fit(page)).width, { message: `the player is not ${width} px wide` }).toBe(width)
  for (const target of ['player', 'volume'] as const) {
    await pointAt(page, target)
    const { overflow, outside, clipped } = await fit(page)
    expect(overflow, `the bar overflows a ${width} px player, pointer on the ${target}`).toBeLessThanOrEqual(0)
    expect(outside, `a control sits outside a ${width} px player, pointer on the ${target}`).toBe(0)
    expect(clipped, `the clock clips in a ${width} px player, pointer on the ${target}`).toBe(false)
  }
}

const phoneBarGeometry = (page: Page) => player(page).evaluate((root) => {
  const edge = root.getBoundingClientRect()
  const bar = root.querySelector('.bar')!
  const left = bar.querySelector('.left')!.getBoundingClientRect()
  const right = bar.querySelector('.right')!.getBoundingClientRect()
  const time = bar.querySelector('.time')!
  const measure = (selector: string) => {
    const box = bar.querySelector(selector)!.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height) }
  }
  const outsideCount = () => [...bar.querySelectorAll('button, .group')]
    .map(item => item.getBoundingClientRect())
    .filter(box => box.width > 0)
    .filter(box => box.left < edge.left - 0.5 || box.right > edge.right + 0.5 || box.top < edge.top - 0.5 || box.bottom > edge.bottom + 0.5)
    .length
  const groupHeights = [...bar.querySelectorAll('.group')]
    .map(item => item.getBoundingClientRect())
    .filter(box => box.width > 0)
    .map(box => Math.round(box.height))

  const durationNode = time.lastChild!
  const savedDuration = durationNode.textContent
  let hourLong = { overflow: 0, outside: 0, clipped: false, overlap: false }
  try {
    durationNode.textContent = '1:23:45'
    const hourLeft = bar.querySelector('.left')!.getBoundingClientRect()
    const hourRight = bar.querySelector('.right')!.getBoundingClientRect()
    hourLong = {
      overflow: bar.scrollWidth - bar.clientWidth,
      outside: outsideCount(),
      clipped: time.scrollWidth - time.clientWidth > 1,
      overlap: hourLeft.right > hourRight.left + 0.5,
    }
  } finally {
    durationNode.textContent = savedDuration
  }

  return {
    barHeight: Math.round(bar.getBoundingClientRect().height),
    play: measure('.play'),
    next: measure('.next'),
    volume: measure('.volume'),
    volumeControl: measure('.volume .control'),
    groupHeights,
    outside: outsideCount(),
    overlap: left.right > right.left + 0.5,
    hourLong,
  }
})

const expectCompactPhoneBar = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height })
  await expectFits(page, width)
  await expectLabelled(page)
  const geometry = await phoneBarGeometry(page)
  expect(geometry.barHeight, `bar height at ${width}x${height}`).toBe(48)
  expect(geometry.play, `Play size at ${width}x${height}`).toEqual({ width: 36, height: 36 })
  expect(geometry.next, `Next size at ${width}x${height}`).toEqual({ width: 36, height: 36 })
  expect(geometry.volume, `Volume group size at ${width}x${height}`).toEqual({ width: 36, height: 36 })
  expect(geometry.volumeControl, `Volume button size at ${width}x${height}`).toEqual({ width: 36, height: 36 })
  expect(new Set(geometry.groupHeights), `group heights at ${width}x${height}`).toEqual(new Set([36]))
  expect(geometry.outside, `controls outside player bounds at ${width}x${height}`).toBe(0)
  expect(geometry.overlap, `.left overlaps .right at ${width}x${height}`).toBe(false)
  expect(geometry.hourLong, `hour-long clock layout at ${width}x${height}`).toEqual({
    overflow: 0,
    outside: 0,
    clipped: false,
    overlap: false,
  })
}

const EVERY_CONTROL = [
  /^(Play|Pause)$/,
  /^Next$/,
  /^(Mute|Unmute)$/,
  /^Volume$/,
  /^Seek$/,
  /^Autoplay$/,
  /^Turn (on|off) captions$/,
  /^Settings$/,
  /^Theater mode$/,
  /^(Exit full screen|Full screen)$/,
]

const expectLabelled = async (page: Page) => {
  const named = await labels(page)
  expect(named, 'a control has no label').not.toContain('')
  for (const pattern of EVERY_CONTROL) expect(named.some(label => pattern.test(label)), `no control is labelled ${pattern}`).toBe(true)
}

test('every control keeps its label, and the bar fits a 1920, 1280, 640 and 400 px player', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => localStorage.setItem('yt-client:settings', JSON.stringify({ theater: true, captionsEnabled: false, captionsChosen: true })))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  await expect(page.getByRole('button', { name: 'Turn on captions' })).toBeAttached({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeAttached({ timeout: 60_000 })
  await video.evaluate(element => (element as HTMLVideoElement).pause())
  // Next comes from the same watch read as the chapters, so their absence here is settled
  await expect(player(page).locator('.chapter')).toHaveCount(0)

  await expectFits(page, 1920)
  await expectLabelled(page)
  // youtube.com's grouping: the play circle on its own, and the right-hand controls sharing one rounded group
  const grouping = await player(page).evaluate((root) => {
    const control = (name: string) => root.querySelector(`.bar [aria-label="${name}"]`)
    const shape = control('Settings')?.closest('.group')
    const style = shape ? getComputedStyle(shape) : undefined
    return {
      shared: Boolean(shape) && control('Full screen')?.closest('.group') === shape,
      radius: style ? Number.parseFloat(style.borderRadius) : 0,
      washed: style !== undefined && style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      circle: control('Play')?.classList.contains('group') ?? false,
      rail: Math.round(root.getBoundingClientRect().bottom - root.querySelector('.rail')!.getBoundingClientRect().bottom),
    }
  })
  // the rail as youtube.com draws it, 57 px up: 1 px above the 56 px row of groups
  expect(grouping).toEqual({ shared: true, radius: 28, washed: true, circle: true, rail: 57 })

  await page.setViewportSize({ width: 1280, height: 800 })
  await expectFits(page, 1280)
  await expectLabelled(page)

  // Verify youtube.com-matched slim volume slider geometry and interactive state
  await pointAt(page, 'volume')
  const volumeSlider = player(page).getByRole('slider', { name: 'Volume' })
  const sliderBox = (await volumeSlider.boundingBox())!
  expect(Math.round(sliderBox.width)).toBe(52)
  expect(Math.round(sliderBox.height)).toBe(40)
  const sliderAppearance = await volumeSlider.evaluate(element => getComputedStyle(element).appearance)
  expect(sliderAppearance).toBe('none')
  await volumeSlider.fill('0.5')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).volume)).toBeCloseTo(0.5, 2)
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '50%')
  await volumeSlider.fill('0')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(true)
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '0%')
  await volumeSlider.fill('1')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).muted)).toBe(false)
  await expect(volumeSlider).toHaveAttribute('aria-valuetext', '100%')

  await page.setViewportSize({ width: 640, height: 800 })
  await expectFits(page, 640)
  await expectLabelled(page)

  // a phone's width: the miniplayer, also 400 px, draws youtube.com's own controls instead of this bar
  await expectCompactPhoneBar(page, 412, 860)
  await expectCompactPhoneBar(page, 400, 800)
  for (const name of ['Play', 'Next', /^(Mute|Unmute)$/, 'Turn on captions', 'Settings', 'Full screen']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('switch', { name: 'Autoplay' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Theater mode' })).toBeHidden()

  await expectCompactPhoneBar(page, 390, 844)
  await expect(page.getByRole('button', { name: 'Picture in picture', exact: true })).toBeVisible()
  await expectCompactPhoneBar(page, 360, 740)
  await expect(page.getByRole('button', { name: 'Picture in picture', exact: true })).toBeHidden()
})

test('names the chapter the playhead is in, beside the clock', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto(`/watch?v=${CHAPTERED_ID}`)
  const video = await startPlayback(page)
  const seek = (seconds: number) => video.evaluate((element, to) => {
    const media = element as HTMLVideoElement
    media.pause()
    media.currentTime = to
  }, seconds)
  const chapter = player(page).locator('.chapter')

  await seek(1)
  await expect(chapter).toHaveText('Intro', { timeout: 60_000 })
  await seek(6)
  await expect(chapter).toHaveText('The cool thing')
  await seek(18)
  await expect(chapter).toHaveText('End')

  const [clock, title] = await Promise.all([player(page).locator('.time').boundingBox(), chapter.boundingBox()])
  expect(title!.x).toBeGreaterThanOrEqual(clock!.x + clock!.width)
  expect(title!.y).toBeCloseTo(clock!.y, 0)
  expect((await fit(page)).overflow).toBeLessThanOrEqual(0)

  // narrower, the title goes before the clock would clip, rather than shrinking to an empty pill
  await seek(6)
  await expect(chapter).toHaveText('The cool thing')
  // 808, 728 and 608 px players, edge to edge in one column: each window is narrower than the last, so the poll waits
  // for the resize
  let previous = (await fit(page)).width
  for (const width of [808, 728, 608]) {
    await page.setViewportSize({ width, height: 800 })
    await expect.poll(async () => (await fit(page)).width).toBeLessThan(previous)
    for (const target of ['player', 'volume'] as const) {
      await pointAt(page, target)
      const measured = await fit(page)
      const where = `a ${measured.width} px player, pointer on the ${target}`
      expect(measured.clipped, `the clock clips in ${where}`).toBe(false)
      expect(measured.overflow, `the bar overflows ${where}`).toBeLessThanOrEqual(0)
      expect(measured.chapter === 0 || measured.chapter >= 80, `the chapter is a ${measured.chapter} px sliver in ${where}`).toBe(true)
      previous = measured.width
    }
  }
})

test('keeps MediaSession metadata and playbackState across track handler changes and guards native iOS transitions', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => {
    const log: { kind: string, action?: string, value: unknown }[] = []
    Object.defineProperty(window, '__msLog', { value: log, writable: true, configurable: true })
    const ms = navigator.mediaSession
    if (!ms) return
    const proto = Object.getPrototypeOf(ms) as MediaSession
    const metaDesc = Object.getOwnPropertyDescriptor(proto, 'metadata') ?? Object.getOwnPropertyDescriptor(ms, 'metadata')
    const stateDesc = Object.getOwnPropertyDescriptor(proto, 'playbackState') ?? Object.getOwnPropertyDescriptor(ms, 'playbackState')
    const origSetActionHandler = ms.setActionHandler.bind(ms)
    if (metaDesc?.get && metaDesc?.set) {
      Object.defineProperty(ms, 'metadata', {
        configurable: true,
        get () {
          return metaDesc.get!.call(this)
        },
        set (value) {
          ;(window as unknown as { __msLog: typeof log }).__msLog.push({ kind: 'metadata', value: value ? value.title : null })
          metaDesc.set!.call(this, value)
        },
      })
    }
    if (stateDesc?.get && stateDesc?.set) {
      Object.defineProperty(ms, 'playbackState', {
        configurable: true,
        get () {
          return stateDesc.get!.call(this)
        },
        set (value) {
          ;(window as unknown as { __msLog: typeof log }).__msLog.push({ kind: 'playbackState', value })
          stateDesc.set!.call(this, value)
        },
      })
    }
    ms.setActionHandler = ((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      ;(window as unknown as { __msLog: typeof log }).__msLog.push({ kind: 'handler', action, value: handler !== null })
      return origSetActionHandler(action, handler)
    }) as MediaSession['setActionHandler']
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = await startPlayback(page)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeAttached({ timeout: 60_000 })

  await expect.poll(async () => page.evaluate(() => ({
    title: navigator.mediaSession?.metadata?.title ?? '',
    playbackState: navigator.mediaSession?.playbackState ?? 'none',
  }))).toEqual({ title: expect.stringMatching(/\S/), playbackState: 'playing' })

  const readLog = () => page.evaluate(() => (window as unknown as { __msLog: { kind: string, action?: string, value: unknown }[] }).__msLog)

  // Flip hasPrevious false -> true via the session queue without remounting VideoPlayer
  await page.evaluate(async ({ queuePath, videoId }) => {
    ;(window as unknown as { __msLog: unknown[] }).__msLog = []
    const queue = await import(queuePath) as typeof import('../../src/player/queue')
    queue.appendQueueEntry({ id: 'prev-vid-id', title: 'Previous Video' })
    queue.appendQueueEntry({ id: videoId, title: 'Current Video' })
    queue.setQueueIndex(1)
  }, { queuePath: '/src/player/queue.ts', videoId: VIDEO_ID })

  await expect.poll(async () => (await readLog()).some(entry => entry.kind === 'handler' && entry.action === 'previoustrack' && entry.value === true)).toBe(true)
  const addLog = await readLog()
  expect(addLog).not.toContainEqual({ kind: 'metadata', value: null })
  expect(addLog).not.toContainEqual({ kind: 'playbackState', value: 'none' })
  await expect.poll(async () => page.evaluate(() => ({
    title: navigator.mediaSession?.metadata?.title ?? '',
    playbackState: navigator.mediaSession?.playbackState ?? 'none',
  }))).toEqual({ title: expect.stringMatching(/\S/), playbackState: 'playing' })

  // Flip hasPrevious true -> false again
  await page.evaluate(async (queuePath) => {
    ;(window as unknown as { __msLog: unknown[] }).__msLog = []
    const queue = await import(queuePath) as typeof import('../../src/player/queue.ts')
    queue.clearQueue()
  }, '/src/player/queue.ts')

  await expect.poll(async () => (await readLog()).some(entry => entry.kind === 'handler' && entry.action === 'previoustrack' && entry.value === false)).toBe(true)
  const removeLog = await readLog()
  expect(removeLog).not.toContainEqual({ kind: 'metadata', value: null })
  expect(removeLog).not.toContainEqual({ kind: 'playbackState', value: 'none' })
  await expect.poll(async () => page.evaluate(() => ({
    title: navigator.mediaSession?.metadata?.title ?? '',
    playbackState: navigator.mediaSession?.playbackState ?? 'none',
  }))).toEqual({ title: expect.stringMatching(/\S/), playbackState: 'playing' })

  // Involuntary pause inside a native transition recovers automatically
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement
    media.dispatchEvent(new Event('webkitendfullscreen'))
    media.pause()
  })
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false)

  const ensurePlaying = async () => {
    await video.evaluate(async (element) => {
      const media = element as HTMLVideoElement
      if (!media.paused) return
      await new Promise<void>((resolve) => {
        media.addEventListener('playing', () => resolve(), { once: true })
        void media.play()
      })
    })
  }
  const fireNativeTransition = () => video.evaluate(element => element.dispatchEvent(new Event('webkitendfullscreen')))

  // 1. PlayerControls Pause button inside transition window stays paused past the 100ms retry
  await ensurePlaying()
  await pointAt(page, 'player')
  const pauseButton = player(page).getByRole('button', { name: 'Pause', exact: true })
  await expect(pauseButton).toBeVisible()
  await fireNativeTransition()
  await pauseButton.click()
  await page.waitForTimeout(250)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true)

  // 2. Clicking the video surface (togglePlay) inside transition window stays paused
  await ensurePlaying()
  const videoBox = (await video.boundingBox())!
  await fireNativeTransition()
  await page.mouse.click(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height * 0.4)
  await page.waitForTimeout(250)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true)

  // 3. Keyboard shortcut ('k') inside transition window stays paused
  await ensurePlaying()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await fireNativeTransition()
  await page.keyboard.press('k')
  await page.waitForTimeout(250)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true)

  // 4. MiniplayerControls Pause button inside transition window stays paused
  await ensurePlaying()
  await page.evaluate(() => {
    history.pushState(null, '', '/settings')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  const mini = page.getByRole('complementary', { name: 'Miniplayer' })
  await expect(mini).toBeVisible({ timeout: 30_000 })
  const miniBox = (await video.boundingBox())!
  await page.mouse.move(miniBox.x + miniBox.width / 2, miniBox.y + miniBox.height / 2)
  const miniPause = mini.getByRole('button', { name: 'Pause', exact: true })
  await expect(miniPause).toBeVisible()
  await fireNativeTransition()
  await miniPause.click()
  await page.waitForTimeout(250)
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true)
})
