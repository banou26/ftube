import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/card-subline-harness.tsx'

test('keeps preview video card channel name and view/date metadata on a single horizontal line', async ({ page }) => {
  test.setTimeout(120_000)
  await hideFknNotice(page)
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    const mod = await import(path) as typeof import('./fixtures/card-subline-harness')
    mod.mountCardSublineHarness()
  }, HARNESS)

  const cards = page.locator('[data-card-subline-harness] article')
  await expect(cards).toHaveCount(3)

  const measurements = await cards.evaluateAll(articles =>
    articles.map((article) => {
      const channel = article.querySelector('.channel-name')!.getBoundingClientRect()
      const meta = article.querySelector('.meta')!.getBoundingClientRect()
      const sublineEl = article.querySelector('.subline')
      const subline = sublineEl?.getBoundingClientRect()
      return {
        channel: { top: channel.top, right: channel.right, bottom: channel.bottom, height: channel.height },
        meta: { top: meta.top, left: meta.left, right: meta.right, height: meta.height },
        sublineHeight: subline?.height,
        sublineOverflow: sublineEl ? sublineEl.scrollWidth - sublineEl.clientWidth : 0,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    }))

  for (const [index, m] of measurements.entries()) {
    expect(Math.abs(m.channel.top - m.meta.top), `card ${index} channel and meta share one line`).toBeLessThanOrEqual(4)
    expect(m.meta.left, `card ${index} meta sits after channel name`).toBeGreaterThanOrEqual(m.channel.right - 1)
    expect(m.meta.height, `card ${index} meta stays 1 line`).toBeLessThanOrEqual(24)
    expect(m.sublineHeight, `card ${index} has .subline`).toBeDefined()
    expect(m.sublineHeight!, `card ${index} subline stays 1 line`).toBeLessThanOrEqual(24)
    expect(m.sublineOverflow, `card ${index} subline has zero horizontal overflow`).toBeLessThanOrEqual(0)
    expect(m.pageOverflow, `card ${index} causes zero page overflow`).toBeLessThanOrEqual(0)
  }
})
