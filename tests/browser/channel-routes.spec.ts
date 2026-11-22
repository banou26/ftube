import { expect, test } from './test'

const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'

test('refuses a segment that is not a tab', async ({ page }) => {
  const notFound = page.getByText('This page isn\'t available. Sorry about that.', { exact: true })
  await page.goto('/@Blender/nonsense')
  await expect(notFound).toBeVisible()
  await expect(page).toHaveURL('/@Blender/nonsense')

  await page.goto('/nonsense/videos')
  await expect(notFound).toBeVisible()
})

test('lands a channel handle on its Home tab, with the featured video and the shelves', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/@RickAstleyYT')
  const tabs = page.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 120_000 })
  await expect(page).toHaveURL('/@RickAstleyYT')
  const featured = page.getByRole('region', { name: 'Featured video' })
  await expect(featured.locator('h2 a')).toHaveAttribute('href', /^\/watch\?v=/)
  // youtube.com leaves 24px between the tab bar and the featured video
  const [tabsBox, thumbBox] = await Promise.all([tabs.boundingBox(), featured.locator('a').first().boundingBox()])
  if (!tabsBox || !thumbBox) throw new Error('the tab bar or the featured video is not laid out')
  const gap = thumbBox.y - (tabsBox.y + tabsBox.height)
  expect(gap).toBeGreaterThanOrEqual(20)
  expect(gap).toBeLessThanOrEqual(26)
  const shelves = page.locator('main section[aria-label]:not([aria-label="Featured video"])')
    .filter({ has: page.locator('a[href^="/watch?v="], a[href^="/shorts/"]') })
  expect(await shelves.count()).toBeGreaterThanOrEqual(2)
  await expect(shelves.first().locator('h2')).not.toBeEmpty()
})

test('names the tabs like youtube.com, sorts Videos by chips and searches from an icon', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/@RickAstleyYT/videos')
  const tabs = page.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Videos', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 120_000 })
  await expect(tabs.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
  await expect(tabs.getByText('Community')).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Latest', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Popular', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Oldest', exact: true }).click()
  await expect(page).toHaveURL(/sort=Oldest/)
  await expect(page.getByRole('button', { name: 'Oldest', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('main article a.thumb').first()).toHaveAttribute('href', '/watch?v=dQw4w9WgXcQ', { timeout: 120_000 })

  await tabs.getByRole('button', { name: 'Search', exact: true }).click()
  const box = tabs.getByRole('searchbox', { name: 'Search this channel' })
  await expect(box).toBeFocused()
  await page.keyboard.type('never gonna')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/@RickAstleyYT/search?query=never+gonna')
  await expect(box).toHaveValue('never gonna')
  await expect(page.locator('main article a[href^="/watch?v="]').first()).toBeVisible({ timeout: 120_000 })
})

test('opens a channel\'s Shows tab, and keeps the shows on its Playlists tab', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/@mkbhd/shows')
  const tabs = page.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Shows', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 120_000 })
  await expect(page).toHaveURL('/@mkbhd/shows')
  const labels = await tabs.getByRole('link').allTextContents()
  expect(labels.indexOf('Shows')).toBe(labels.indexOf('Live') + 1)
  expect(labels.indexOf('Playlists')).toBe(labels.indexOf('Shows') + 1)
  // youtube.com's show cards: the episode count over the still, the channel's name under the title
  const cards = page.locator('main .playlist-grid a.card')
  await expect(cards.first()).toHaveAttribute('href', /^\/playlist\?list=PL/, { timeout: 120_000 })
  await expect(cards.first()).toContainText(/\d+ episodes/)
  await expect(cards.first()).toContainText('Marques Brownlee')

  await tabs.getByRole('link', { name: 'Playlists', exact: true }).click()
  await expect(page).toHaveURL('/@mkbhd/playlists')
  await expect(cards.filter({ hasText: /\d+ episodes/ }).first()).toBeVisible({ timeout: 120_000 })
  await expect(cards.filter({ hasText: /\d+ videos?/ }).first()).toBeVisible()
  await expect(page.locator('main h1')).toHaveText('Marques Brownlee')
  await expect(page).toHaveTitle('Marques Brownlee - yt-client')
})

test('keeps the channel\'s name in its header once its own videos fill the Home shelves', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/@LinusTechTips')
  const shelf = page.getByRole('region', { name: 'Videos', exact: true })
  await expect(shelf.locator('a[href^="/watch?v="]').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('main h1')).toHaveText('Linus Tech Tips')
  // a collaboration's names open the video, never one channel
  await expect(shelf.locator('a.channel-name[href^="/channel/"]')).toHaveCount(0)
})

test('shows youtube.com\'s own line for a channel that does not exist', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/channel/UCzzzzzzzzzzzzzzzzzzzzzz')
  await expect(page.locator('main .status')).toHaveText('This channel does not exist.', { timeout: 120_000 })
})

// the app asks the engine over a MessagePort, `{ id, method, args }` answered by `{ id, result | error }`
const failChannelCalls = () => {
  if (window.top !== window) return
  const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (this: MessagePort, message: unknown, ...rest: unknown[]) => void
  MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
    const call = message as { id?: number, method?: string } | null
    if (call?.method !== 'channel') return post.call(this, message, ...rest)
    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: call.id, error: 'Tab "featured" not found' } })))
  } as typeof MessagePort.prototype.postMessage
}

test('says in one line that a channel did not load, never the raw error', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(failChannelCalls)
  await page.goto(`/channel/${CHANNEL_ID}`)
  const alert = page.locator('main').getByRole('alert')
  await expect(alert.locator('p')).toHaveText('Something went wrong.', { timeout: 120_000 })
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('featured')
})

test('fits a channel\'s Home shelves in a phone\'s width', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/@RickAstleyYT')
  await expect(page.locator('main .arrow.right').first()).toBeVisible({ timeout: 120_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})

test('draws a channel\'s Shorts tab like youtube.com and opens a Short in the Shorts player', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/@MKBHD/shorts')
  const tabs = page.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Shorts', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 120_000 })
  const thumbs = page.locator('main article a.thumb')
  await expect(thumbs.first()).toBeVisible({ timeout: 60_000 })
  const layout = () => thumbs.evaluateAll(links => {
    const boxes = links.map(link => link.getBoundingClientRect())
    return {
      columns: boxes.filter(box => Math.round(box.top) === Math.round(boxes[0]!.top)).length,
      x: Math.round(boxes[0]!.left),
      width: Math.round(boxes[0]!.width),
      height: Math.round(boxes[0]!.height),
    }
  })
  // youtube.com's first tile on @MKBHD's Shorts tab, measured signed out on 2026-11-10
  for (const [width, expected] of [
    [1920, { columns: 6, x: 442, width: 209, height: 313 }],
    [412, { columns: 1, x: 113, width: 182, height: 273 }],
    [1280, { columns: 5, x: 147, width: 208, height: 311 }],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(layout, { message: `the tiles at ${width}px` }).toEqual(expected)
  }
  // a letterboxed still would show its bars at the tile's sides
  await expect.poll(() => thumbs.first().locator('img').evaluate((img: HTMLImageElement) => img.naturalHeight > img.naturalWidth), {
    message: 'the first tile\'s still is portrait',
  }).toBe(true)

  const hrefs = await page.locator('main article a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(hrefs.length).toBeGreaterThan(10)
  for (const href of hrefs) expect(href).toMatch(/^\/shorts\/[\w-]{11}$/)

  const href = (await thumbs.first().getAttribute('href'))!
  await thumbs.first().click()
  await expect(page).toHaveURL(href)
  const slide = page.locator(`[data-short-id="${href.slice('/shorts/'.length)}"]`)
  await expect(slide).toBeVisible({ timeout: 60_000 })
  await expect(slide.locator('video')).toBeAttached()
})

test('keeps channel header name, document title and compact grid on direct /@MKBHD/playlists load', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/@MKBHD/playlists')
  const cards = page.locator('main .playlist-grid a.card')
  await expect(cards.first()).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('main h1')).toHaveText('Marques Brownlee')
  await expect(page).toHaveTitle('Marques Brownlee - yt-client')
  const columns = await cards.evaluateAll(links => {
    const boxes = links.map(link => link.getBoundingClientRect())
    return boxes.filter(box => Math.abs(box.top - boxes[0]!.top) < 2).length
  })
  expect(columns).toBeGreaterThanOrEqual(4)
})

test('renders posts on /@MKBHD/posts with loading skeletons and a single fetch', async ({ page }) => {
  test.setTimeout(180_000)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/__yt_engine__/engine.html', async (route) => {
    await held
    await route.continue()
  })
  await page.addInitScript(() => {
    if (window.top !== window) return
    const methods: string[] = []
    ;(window as unknown as { __channelPostRpc?: string[] }).__channelPostRpc = methods
    const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage')!.value as (this: MessagePort, message: unknown, ...rest: unknown[]) => void
    MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
      const call = message as { method?: string } | null
      if (call?.method) methods.push(call.method)
      return post.call(this, message, ...rest)
    } as typeof MessagePort.prototype.postMessage
  })
  await page.goto('/@MKBHD/posts', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('main .post-skeleton').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('main .header.skeleton-pulse')).toBeVisible()
  release()
  const posts = page.locator('main article.post')
  await expect(posts.first()).toBeVisible({ timeout: 120_000 })
  expect(await posts.count()).toBeGreaterThanOrEqual(2)
  await expect(page.locator('main h1')).toHaveText('Marques Brownlee')
  await expect(page.locator('main .post-skeleton')).toHaveCount(0)
  const methods = await page.evaluate(() => (window as unknown as { __channelPostRpc?: string[] }).__channelPostRpc ?? [])
  expect(methods).toContain('channel')
  expect(methods).not.toContain('communityPosts')
})

const installClsObserver = () => {
  let cls = 0
  const shifts: { value: number, sources: string[] }[] = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value?: number
      hadRecentInput?: boolean
      sources?: { node?: Element | null }[]
    })[]) {
      if (!entry.hadRecentInput && typeof entry.value === 'number') {
        cls += entry.value
        shifts.push({
          value: entry.value,
          sources: (entry.sources ?? []).map((source) => {
            const node = source.node
            return node ? `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).trim().replace(/\s+/g, '.')}` : ''}` : 'unknown'
          }),
        })
      }
    }
  }).observe({ type: 'layout-shift', buffered: true })
  ;(window as unknown as { __cls?: () => { cls: number, shifts: typeof shifts } }).__cls = () => ({ cls, shifts })
}

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`keeps CLS below 0.10 on /@MKBHD/videos (${label})`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize(viewport)
    await page.addInitScript(installClsObserver)
    await page.goto('/@MKBHD/videos')
    await expect(page.locator('main h1')).toHaveText('Marques Brownlee', { timeout: 120_000 })
    await expect(page.locator('main article a.thumb').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.locator('main .links:not(.links-skeleton)')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(500)
    const { cls, shifts } = await page.evaluate(() =>
      (window as unknown as { __cls: () => { cls: number, shifts: { value: number, sources: string[] }[] } }).__cls())
    expect(cls, `${label} CLS shifts: ${JSON.stringify(shifts)}`).toBeLessThan(0.10)
  })
}
