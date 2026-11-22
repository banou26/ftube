import type { Page } from '@playwright/test'

import { cueReader, holdOnCue } from './cues'
import { expect, laneOrigin, startCaptionsOff, test } from './test'

// the Subtitles menu's Auto-translate and Options against the live source: `dQw4w9WgXcQ` publishes an authored English
// track and 156 Auto-translate languages

const VIDEO = '/watch?v=dQw4w9WgXcQ'

const startPlayback = async (page: Page, url = VIDEO) => {
  await page.goto(url)
  await page.waitForFunction(() => performance.getEntriesByName('yt:first-frame', 'mark').length > 0, null, { timeout: 120_000 })
}

test.beforeEach(({ page }) => startCaptionsOff(page))

const rows = (page: Page) => page.getByRole('menu').getByRole('menuitem')

const openSubtitles = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitem', { name: /^Subtitles/ }).click()
}

const shownTrack = (page: Page) => page.locator('video').evaluate((element) => {
  const track = [...(element as HTMLVideoElement).textTracks].find(candidate => candidate.mode === 'showing')
  return track && { label: track.label, language: track.language, cues: [...track.cues ?? []].map(cue => (cue as VTTCue).text) }
})

// Deterministic browser specs stand in for the translation answer on `youtube.localhost` (where the direct lane stays
// active, as on youtube.fkn.app) so test runs never trigger bursts of translation fetches while still inspecting the
// real signed URL.
const answerTranslations = async (page: Page, status: number, body: string) => {
  const asked: URL[] = []
  await page.route(url => url.hostname === 'www.youtube.com' && url.pathname === '/api/timedtext' && url.searchParams.has('tlang'), async (route) => {
    asked.push(new URL(route.request().url()))
    await route.fulfill({ status, body, headers: { 'access-control-allow-origin': '*' } })
  })
  return asked
}

const FRENCH = 'Je ne te laisserai jamais tomber'
const french = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 600_000, segs: [{ utf8: FRENCH }] }] })

const subtitlesRow = (page: Page) => page.getByRole('menuitem', { name: /^Subtitles/ })

const pickEnglish = async (page: Page) => {
  await openSubtitles(page)
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await expect.poll(async () => (await shownTrack(page))?.cues.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0)
}

const pickFrench = async (page: Page) => {
  await openSubtitles(page)
  await page.getByRole('menuitem', { name: 'Auto-translate' }).click()
  await page.getByRole('menuitem', { name: 'French', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

const remembered = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}').captionsLanguage)

test('the Subtitles list offers Auto-translate for a track on screen, with YouTube\'s languages, as on youtube.com', async ({ page }) => {
  test.setTimeout(300_000)
  await startPlayback(page)
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())

  // with captions off it offers no Auto-translate
  await openSubtitles(page)
  await expect(rows(page).first()).toHaveText('Off')
  await expect(rows(page).last()).toHaveText('Options')
  await expect(page.getByRole('menuitem', { name: 'Auto-translate' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await expect.poll(async () => (await shownTrack(page))?.cues.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0)

  // with a track on screen it is the row before Options, and its first row goes back
  await openSubtitles(page)
  await expect(rows(page).nth(-2)).toHaveText('Auto-translate')
  await page.getByRole('menuitem', { name: 'Auto-translate' }).click()
  await expect(rows(page).nth(1)).toHaveText('Abkhazian')
  await expect(rows(page).last()).toHaveText('Zulu')
  expect(await rows(page).count()).toBeGreaterThan(100)
  await expect(page.getByRole('menuitem', { name: 'French', exact: true })).toBeVisible()
  await rows(page).first().click()
  await expect(rows(page).nth(-2)).toHaveText('Auto-translate')
})

test('an Auto-translate pick asks YouTube for the translated track, turns the captions into the language, and is remembered', async ({ page, baseURL }) => {
  test.setTimeout(300_000)
  const url = `${laneOrigin(baseURL)}${VIDEO}`
  const asked = await answerTranslations(page, 200, french)
  await startPlayback(page, url)
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())
  await pickEnglish(page)
  await pickFrench(page)

  await expect.poll(async () => (await shownTrack(page))?.label, { timeout: 60_000 }).toBe('English >> French')
  expect(await shownTrack(page)).toMatchObject({ language: 'fr', cues: [FRENCH] })
  expect(asked).toHaveLength(1)
  const params = asked[0]!.searchParams
  expect([params.get('lang'), params.get('tlang'), params.get('fmt')]).toStrictEqual(['en', 'fr', 'json3'])
  expect(params.get('signature')).toBeTruthy()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(subtitlesRow(page)).toHaveText('SubtitlesEnglish >> French')
  await subtitlesRow(page).click()
  await expect(rows(page).nth(-3)).toHaveText('Auto-translate')
  await expect(rows(page).nth(-2)).toHaveText('English >> French')
  await page.getByRole('menuitem', { name: 'Auto-translate' }).click()
  await expect(page.getByRole('menuitem', { name: 'French', exact: true }).locator('svg')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // youtube.com remembers the language it translated into, and the next video opens translated into it
  expect(await remembered(page)).toBe('fr')
  await startPlayback(page, url)
  await expect.poll(async () => (await shownTrack(page))?.label, { timeout: 60_000 }).toBe('English >> French')
})

test('a refused Auto-translate keeps the captions on screen and named, and a remembered one opens on its track', async ({ page, baseURL }) => {
  test.setTimeout(300_000)
  const url = `${laneOrigin(baseURL)}${VIDEO}`
  await answerTranslations(page, 429, 'Sorry...')
  await startPlayback(page, url)
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())
  await pickEnglish(page)
  const english = (await shownTrack(page))!
  await pickFrench(page)

  await expect(page.getByRole('status').getByText('Auto-translate is not available right now')).toBeVisible({ timeout: 30_000 })
  expect(await shownTrack(page)).toStrictEqual(english)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(subtitlesRow(page)).toHaveText('SubtitlesEnglish')
  await page.keyboard.press('Escape')
  expect(await remembered(page)).toBe('en')

  await page.evaluate(() => localStorage.setItem('yt-client:settings', JSON.stringify({
    ...JSON.parse(localStorage.getItem('yt-client:settings') ?? '{}'),
    captionsLanguage: 'fr',
  })))
  await startPlayback(page, url)
  await expect.poll(async () => (await shownTrack(page))?.label, { timeout: 60_000 }).toBe('English')
  await expect.poll(async () => (await shownTrack(page))?.cues.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0)
})

test('the Options panel restyles the captions, the look stays for the next visit, and Reset puts it back', async ({ page }) => {
  test.setTimeout(300_000)
  await startPlayback(page)
  await page.getByRole('button', { name: 'Turn on captions' }).click()
  await holdOnCue(page)
  const cue = await cueReader(page)
  await expect.poll(async () => (await cue())?.color, { timeout: 30_000 }).toBe('rgb(255, 255, 255)')
  expect(await cue()).toMatchObject({ size: 100, background: 'rgba(8, 8, 8, 0.75)', shadow: 'none' })
  expect((await cue())!.family).toContain('Roboto')

  await openSubtitles(page)
  await expect(rows(page).last()).toHaveText('Options')
  await page.getByRole('menuitem', { name: 'Options' }).click()
  await expect(rows(page)).toHaveText([
    'Options',
    'Font familyProportional Sans-Serif',
    'Font colorWhite',
    'Font size100%',
    'Background colorBlack',
    'Background opacity75%',
    'Character edge styleNone',
    'Font opacity100%',
    'Reset',
  ])
  const pick = async (row: string, choice: string) => {
    await page.getByRole('menuitem', { name: new RegExp(`^${row}`) }).click()
    await page.getByRole('menuitem', { name: choice, exact: true }).click()
    // as on youtube.com, the choices stay open, the pick checked, and the first row goes back
    await expect(page.getByRole('menuitem', { name: choice, exact: true }).locator('svg')).toHaveCount(1)
    await rows(page).first().click()
  }
  await pick('Font color', 'Yellow')
  await pick('Background opacity', '25%')
  await pick('Character edge style', 'Outline')
  await pick('Font family', 'Casual')
  await pick('Font size', '150%')
  await expect(rows(page).nth(1)).toHaveText('Font familyCasual')
  await page.keyboard.press('Escape')

  const styled = {
    color: 'rgb(255, 255, 0)',
    background: 'rgba(8, 8, 8, 0.25)',
    family: '"Comic Sans MS", Impact, Handlee, fantasy',
    size: 125,
  }
  await expect.poll(async () => (await cue())?.color).toBe(styled.color)
  expect(await cue()).toMatchObject(styled)
  // youtube.com's outline follows the player's base caption size, never the size picked
  const { shadow, base } = (await cue())!
  expect(shadow.split(', rgb').length).toBe(5)
  expect(Number(shadow.match(/^rgb\(34, 34, 34\) 0px 0px ([\d.]+)px/)?.[1])).toBeCloseTo(Math.max(base / 16, 1), 1)

  await startPlayback(page)
  await page.getByRole('button', { name: 'Turn off captions' }).waitFor({ timeout: 30_000 })
  await holdOnCue(page)
  const next = await cueReader(page)
  await expect.poll(async () => (await next())?.color, { timeout: 30_000 }).toBe(styled.color)
  expect(await next()).toMatchObject(styled)

  await openSubtitles(page)
  await page.getByRole('menuitem', { name: 'Options' }).click()
  await page.getByRole('menuitem', { name: 'Reset' }).click()
  await expect(rows(page).nth(2)).toHaveText('Font colorWhite')
  await expect.poll(async () => (await next())?.color).toBe('rgb(255, 255, 255)')
  expect(await next()).toMatchObject({ size: 100, background: 'rgba(8, 8, 8, 0.75)', shadow: 'none' })
  expect((await next())!.family).toContain('Roboto')
})

// rows wholly inside the open menu, which scrolls the rest
const menuFit = (page: Page) => page.evaluate(() => {
  const menu = document.querySelector('[role="menu"]')!.getBoundingClientRect()
  const video = document.querySelector('video')!.getBoundingClientRect()
  const rows = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(row => row.getBoundingClientRect())
  return {
    height: Math.round(menu.height),
    rows: rows.filter(row => row.top >= menu.top - 1 && row.bottom <= menu.bottom + 1).length,
    inside: menu.top >= video.top && menu.bottom <= video.bottom,
    player: video.height,
  }
})

test('at a phone\'s width the settings menus keep youtube.com\'s height inside the player', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 412, height: 860 })
  await startPlayback(page)
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())
  await page.getByRole('button', { name: 'Settings' }).click()
  const root = await menuFit(page)
  // youtube.com's 240 px player keeps a 140 px menu showing 2 rows (measured 2026-11-10)
  expect(root.height).toBeGreaterThanOrEqual(Math.round((root.player - 70) * 0.82) - 1)
  expect(root.inside).toBe(true)
  expect(root.rows).toBeGreaterThanOrEqual(2)
  await page.getByRole('menuitem', { name: /^Subtitles/ }).click()
  const subtitles = await menuFit(page)
  expect(subtitles.inside).toBe(true)
  expect(subtitles.rows).toBeGreaterThanOrEqual(2)
})
