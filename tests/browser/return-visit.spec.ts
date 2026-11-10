import { expect, test } from './test'

/* On a return visit Chrome answers register() only after the update check it queued for that worker has run, which in
   a browser that started recently waits until its first page goes idle (1.5 to 3.4 s, measured 2026-11-10). The
   reload here gets a register() that never answers in every document, so an engine that waits on one never starts. */
test('a return visit starts the engine without waiting on register()', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })

  await page.addInitScript(() => {
    navigator.serviceWorker.register = () => new Promise(() => {})
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
})
