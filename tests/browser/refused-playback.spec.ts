import type { Frame, Page } from '@playwright/test'

import { ENGINE_PATH } from '../../src/engine/protocol'
import { expect, test } from './test'

/* `kJQP7kiw5Fk` is enforced: in a browser that announces automation, YouTube refuses its stream after a far seek, to
   every new session too (YTB-28), so the player's whole retry ladder runs. */

const VIDEO_ID = 'kJQP7kiw5Fk'

// every read of the video's watch page by the engine, by the time it was asked: they leave through FKN's relay or the
// extension, where no request of the page shows them, so `count` wraps the fetch of each engine frame that booted
// (realm.ts), which its boot sets
const watchReads = async (page: Page) => {
  const reads: number[] = []
  const counted = new WeakSet<Frame>()
  await page.exposeFunction('watchRead', () => reads.push(Date.now()))
  const count = async () => {
    for (const frame of page.frames()) {
      if (counted.has(frame) || new URL(frame.url(), 'http://base.invalid').pathname !== ENGINE_PATH) continue
      counted.add(frame)
      await frame.evaluate(async ({ path, video }) => {
        const { realm } = await import(path) as typeof import('../../src/frame/realm')
        const fetch = realm.fetch
        realm.fetch = (input, init) => {
          const url = input instanceof Request ? input.url : String(input)
          if (url.includes(`youtube.com/watch?v=${video}`)) (window as unknown as { watchRead(): void }).watchRead()
          return fetch(input, init)
        }
      }, { path: '/src/frame/realm.ts', video: VIDEO_ID })
    }
  }
  return { reads, count }
}

// the frame's note of a stream it had to replace, which a refused far seek always leaves
const frameRecovery = async (page: Page) => {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const value = await frame.locator('html').getAttribute('data-segment-recovery', { timeout: 1_000 }).catch(() => null)
    if (value) return value
  }
  return null
}

test('a refused video is tried again a few times, then says so once, with Retry', async ({ page }) => {
  test.setTimeout(300_000)
  const { reads, count } = await watchReads(page)
  let errors = 0
  page.on('console', (message) => { if (message.type() === 'error') errors += 1 })
  await page.goto(`/watch?v=${VIDEO_ID}`)
  const video = page.locator('video')
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime), { timeout: 120_000 }).toBeGreaterThan(1)
  await count()
  await video.evaluate((element) => { (element as HTMLVideoElement).currentTime = 150 })
  const recovery = await expect.poll(() => frameRecovery(page), { timeout: 90_000 }).not.toBeNull().then(() => true, () => false)
  test.skip(!recovery, 'YouTube served the far seek, so there was no refused stream to back off from')

  const status = page.locator('.playback-status')
  await expect(status).toContainText('This video can\'t be played right now', { timeout: 200_000 })
  const retry = page.getByRole('button', { name: 'Retry' })
  await expect(retry).toBeVisible()
  // the open, then one refresh per try: never a read every few seconds
  expect(reads.length).toBeLessThanOrEqual(12)
  const stopped = reads.length
  const errorsAtStop = errors
  await page.waitForTimeout(20_000)
  expect(reads).toHaveLength(stopped)
  // nothing is left asking the refused session: a player left running asks it again at once, logging each answer
  expect(errors - errorsAtStop).toBeLessThan(5)

  await retry.click()
  await expect(retry).toBeHidden()
  await expect.poll(async () => {
    await count()
    return reads.length
  }, { timeout: 60_000 }).toBeGreaterThan(stopped)
})
