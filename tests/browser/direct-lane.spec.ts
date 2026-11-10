import type { Page, Request } from '@playwright/test'

import { chromium, firefox } from '@playwright/test'

import { ENGINE_PATH } from '../../src/engine/protocol'
import { extensionBuild } from './extension-build'
import { dismissFknNotice, expect, laneOrigin, startCaptionsOff, test } from './test'

// both arms run on laneOrigin, so the flag is the only difference
const turnOff = (page: Page) => page.addInitScript(() => localStorage.setItem('yt-client:step:direct', '0'))

type Seen = { url: string, method: string, fromEngine: boolean, headers: Record<string, string> }

const sentByEngine = (request: Request) => {
  try {
    return new URL(request.frame().url(), 'http://base.invalid').pathname === ENGINE_PATH
  } catch {
    return false
  }
}

// every request the browser sends itself under a www.youtube.com path, and whether the engine frame sent it; the
// catalog lane's requests leave from the relay or the extension, so none of them is seen here
const watchYoutube = (page: Page, path = '/youtubei/v1/') => {
  const direct: Promise<Seen>[] = []
  page.on('request', (request: Request) => {
    const url = request.url()
    if (!url.startsWith(`https://www.youtube.com${path}`)) return
    direct.push(request.allHeaders().then((headers) => ({ url, method: request.method(), fromEngine: sentByEngine(request), headers })))
  })
  return { direct: () => Promise.all(direct) }
}

const homeSettled = (page: Page) => expect.poll(
  () => page.evaluate(() =>
    document.querySelectorAll('a[href^="/watch"]').length > 0 || /Try searching to get started/i.test(document.body.innerText)),
  { timeout: 90_000 },
).toBe(true)

const searchShown = async (page: Page) => {
  await expect(page.locator('a[href^="/watch"]').first()).toBeVisible({ timeout: 90_000 })
  expect(await page.locator('a[href^="/watch"]').count()).toBeGreaterThanOrEqual(5)
}

const expectSimple = (request: Seen) => {
  expect(request.method).toBe('POST')
  expect(request.fromEngine).toBe(true)
  expect(request.headers['content-type']).toBe('text/plain;charset=UTF-8')
  for (const name of ['x-origin', 'x-goog-visitor-id', 'x-youtube-client-name', 'x-youtube-client-version', 'cookie', 'authorization']) {
    expect(request.headers, `${request.url} carried ${name}`).not.toHaveProperty(name)
  }
}

test('signed out, home and a search send InnerTube from the engine frame by default', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const origin = laneOrigin(baseURL)
  const innertube = watchYoutube(page)

  await page.goto(`${origin}/`)
  await homeSettled(page)
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'on')

  await page.goto(`${origin}/results?search_query=blender`)
  await searchShown(page)
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'on')

  const direct = await innertube.direct()
  expect(direct.map(({ url }) => new URL(url).pathname)).toEqual(expect.arrayContaining(['/youtubei/v1/browse', '/youtubei/v1/search']))
  for (const request of direct) expectSimple(request)
})

test('with the direct lane, a watch page plays and seeks', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const innertube = watchYoutube(page)
  await page.goto(`${laneOrigin(baseURL)}/watch/dQw4w9WgXcQ`)
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 120_000 })
    .toBeGreaterThan(1)
  await video.evaluate((element) => {
    (element as HTMLVideoElement).currentTime = 90
  })
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 60_000 })
    .toBeGreaterThan(92)
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'on')
  expect((await innertube.direct()).length).toBeGreaterThan(0)
})

test('signed out, captions are read from the engine frame and drawn', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  await startCaptionsOff(page)
  const captions = watchYoutube(page, '/api/timedtext')
  await page.goto(`${laneOrigin(baseURL)}/watch?v=dQw4w9WgXcQ`)
  await page.getByRole('button', { name: 'Turn on captions', exact: true }).click({ timeout: 120_000 })
  await expect.poll(() => page.locator('video').evaluate((element) =>
    [...(element as HTMLVideoElement).textTracks].find((track) => track.mode === 'showing')?.cues?.length ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(0)

  const direct = await captions.direct()
  expect(direct.length).toBeGreaterThan(0)
  for (const request of direct) {
    expect(request.method).toBe('GET')
    expect(request.fromEngine).toBe(true)
    expect(new URL(request.url).searchParams.get('fmt')).toBe('json3')
    for (const name of ['cookie', 'authorization', 'content-type', 'x-goog-visitor-id']) {
      expect(request.headers, `${request.url} carried ${name}`).not.toHaveProperty(name)
    }
  }
})

// the other arms show the watch sees a direct request, so its empty list here means none was sent
test('with the direct step turned off, InnerTube takes the catalog lane and nothing leaves from the engine frame (control)', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const origin = laneOrigin(baseURL)
  await turnOff(page)
  const innertube = watchYoutube(page)
  await page.goto(`${origin}/`)
  await homeSettled(page)
  await page.goto(`${origin}/results?search_query=blender`)
  await searchShown(page)
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'off')
  expect(await innertube.direct()).toEqual([])
})

test('with direct requests failing, a search still shows through the catalog lane, which pauses the direct one', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  const innertube = watchYoutube(page)
  await page.route('https://www.youtube.com/youtubei/**', (route) => route.abort('failed'))
  await page.goto(`${laneOrigin(baseURL)}/results?search_query=blender`)
  await searchShown(page)
  await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'skipped')
  expect((await innertube.direct()).length).toBeGreaterThan(0)
})

// Firefox refuses youtubei.js's preflighted shape from this origin, so this is the case the simple shape exists for
test('in Firefox, a search sends InnerTube from the engine frame', async ({ baseURL }) => {
  test.setTimeout(240_000)
  // the runner hands every browser type the config's launch options, so Chrome's executable and arguments are cleared
  const browser = await firefox.launch({
    headless: true,
    executablePath: undefined,
    args: [],
    firefoxUserPrefs: { 'media.volume_scale': '0.0' },
  })
  try {
    const page = await browser.newPage()
    await dismissFknNotice(page)
    const innertube = watchYoutube(page)
    await page.goto(`${laneOrigin(baseURL)}/results?search_query=blender`)
    await searchShown(page)
    await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'on')
    const direct = await innertube.direct()
    expect(direct.map(({ url }) => new URL(url).pathname)).toContain('/youtubei/v1/search')
    for (const request of direct) expectSimple(request)
    } finally {
    await browser.close()
  }
})

test.describe('with the FKN extension installed', () => {
  test('a search sends InnerTube from the engine frame and the rest through the extension', async ({ baseURL }) => {
    test.setTimeout(240_000)
    const build = extensionBuild(process.env)
    test.skip(build.skip !== undefined, `YT_EXTENSION_BUILD=skip: ${build.skip}`)
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      executablePath: '/etc/profiles/per-user/banou/bin/google-chrome',
      // playwright's --disable-extensions default defeats the load, and --load-extension no longer works
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--mute-audio', '--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
      viewport: { width: 1440, height: 900 },
    })
    try {
      const session = await context.browser()!.newBrowserCDPSession()
      await session.send('Extensions.loadUnpacked' as 'Browser.getVersion', { path: build.path } as object)
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker')

      const page = await context.newPage()
      await dismissFknNotice(page)
      const innertube = watchYoutube(page)
      const egress: string[] = []
      page.on('console', (message) => {
        if (message.text().includes('egress →')) egress.push(message.text())
      })
      await page.goto(`${laneOrigin(baseURL)}/results?search_query=blender`, { waitUntil: 'domcontentloaded' })
      await searchShown(page)
      await expect(page.locator('html')).toHaveAttribute('data-fkn-extension', 'true')
      await expect(page.locator('html')).toHaveAttribute('data-yt-direct', 'on')
      await expect.poll(() => egress.length, { timeout: 30_000 }).toBeGreaterThan(0)
      expect(egress.join(' ')).toContain('FKN extension')

      const direct = await innertube.direct()
      expect(direct.map(({ url }) => new URL(url).pathname)).toContain('/youtubei/v1/search')
      for (const request of direct) expectSimple(request)
        } finally {
      await context.close()
    }
  })
})
