import type { Page } from '@playwright/test'

import { expect, hideFknNotice, test } from './test'

const HARNESS = '/tests/browser/fixtures/header-harness.tsx'

const mountAt = async (page: Page, path: string, ambientMode = true) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await hideFknNotice(page)
  await page.addInitScript((ambient) => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ ambientMode: ambient }))
  }, ambientMode)
  await page.goto('/privacy')
  await page.evaluate(async ([harnessPath, routePath]) => {
    document.querySelectorAll('[data-header-harness]').forEach(el => el.remove())
    const app = document.getElementById('app')
    if (app) app.hidden = true
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
    const mod = await import(harnessPath) as typeof import('./fixtures/header-harness')
    mod.mountHeader('signed-in', 0, routePath)
  }, [HARNESS, path] as const)
  const header = page.locator('[data-header-harness="signed-in"] header')
  await expect(header).toBeVisible({ timeout: 30_000 })
  return header
}

test('keeps the search box and icon-only search button transparent inside the pill', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const header = await mountAt(page, '/settings', true)

  const metrics = await header.evaluate((el) => {
    const searchBox = el.querySelector('.search-box')!
    const searchButton = el.querySelector('.search-button')!
    const boxCs = getComputedStyle(searchBox)
    const btnCs = getComputedStyle(searchButton)
    return {
      headerBg: getComputedStyle(el).backgroundColor,
      boxBg: boxCs.backgroundColor,
      boxRadius: [boxCs.borderTopLeftRadius, boxCs.borderTopRightRadius, boxCs.borderBottomRightRadius, boxCs.borderBottomLeftRadius],
      buttonInsideBox: searchBox.contains(searchButton),
      buttonBg: btnCs.backgroundColor,
      buttonBorderTop: btnCs.borderTopWidth,
    }
  })

  expect(metrics.headerBg).not.toBe('rgba(0, 0, 0, 0)')
  expect(metrics.boxBg).toBe('rgba(0, 0, 0, 0)')
  expect(new Set(metrics.boxRadius)).toEqual(new Set(['40px']))
  expect(metrics.buttonInsideBox).toBe(true)
  expect(metrics.buttonBg).toBe('rgba(0, 0, 0, 0)')
  expect(metrics.buttonBorderTop).toBe('0px')
})

test('makes the watch header transparent at scroll top when ambient mode is enabled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const header = await mountAt(page, '/watch?v=dQw4w9WgXcQ', true)

  await expect(header).toHaveClass(/transparent/)
  expect(await header.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

  await page.evaluate(() => window.scrollTo(0, 120))
  await expect(header).not.toHaveClass(/transparent/)
  await expect.poll(() => header.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(header).toHaveClass(/transparent/)
})
