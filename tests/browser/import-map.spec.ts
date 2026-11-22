import { existsSync, readFileSync } from 'node:fs'

import { BUILD, startBuildServer } from './built-server'
import { expect, test } from './test'

/* Runs against the built app (`npm run build` first), since Vite's build.chunkImportMap only applies to production
   builds and never runs under the dev server. */

let origin = ''
let closeServer: (() => Promise<void>) | undefined

test.beforeAll(async () => {
  const started = await startBuildServer()
  origin = started.origin
  closeServer = started.close
})

test.afterAll(() => closeServer?.())

test('production build boots with the import map and navigates to lazy routes without errors', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const assetResponses: { path: string, status: number }[] = []

  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.origin === origin && url.pathname.startsWith('/assets/')) {
      assetResponses.push({ path: url.pathname, status: response.status() })
    }
  })

  await page.goto(`${origin}/`)
  await expect(page.getByRole('combobox', { name: 'Search' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 })
  await page.evaluate(() => Object.assign(window, { sameDocument: true }))

  const importMapRaw = await page.locator('script[type="importmap"]').textContent()
  expect(importMapRaw).toBeTruthy()
  const imports = (JSON.parse(importMapRaw!) as { imports?: Record<string, string> }).imports ?? {}
  const remappedKeys = new Set(Object.entries(imports).filter(([key, target]) => key !== target).map(([key]) => key))
  expect(remappedKeys.size).toBeGreaterThan(20)

  const entrySrc = await page.locator('script[type="module"][src^="/assets/app-"]').getAttribute('src')
  expect(entrySrc).toBeTruthy()
  const entryCode = readFileSync(`${BUILD}${entrySrc!.slice(1)}`, 'utf8')

  const routes = [
    { path: '/privacy', chunk: 'privacy', heading: 'Privacy' },
    { path: '/settings', chunk: 'settings', heading: 'Settings' },
    { path: '/party', chunk: 'party', heading: 'Watch together' },
  ] as const

  const routeMappings = routes.map(({ chunk }) => {
    const entry = Object.entries(imports).find(([, target]) => new RegExp(`^/assets/${chunk}-[\\w-]{8}\\.js$`).test(target))
    expect(entry, `missing import map entry for ${chunk}`).toBeDefined()
    const [stableKey, hashedTarget] = entry!
    expect(stableKey).not.toBe(hashedTarget)
    // the stable key does not exist on disk, so importing it can only succeed through the browser's import map
    expect(existsSync(`${BUILD}${stableKey.slice(1)}`)).toBe(false)
    expect(existsSync(`${BUILD}${hashedTarget.slice(1)}`)).toBe(true)
    expect(entryCode).toContain(`./${stableKey.slice('/assets/'.length)}`)
    return { stableKey, hashedTarget }
  })

  for (const { path, heading } of routes) {
    await page.evaluate((nextPath) => {
      history.pushState(null, '', nextPath)
      dispatchEvent(new PopStateEvent('popstate'))
    }, path)
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => 'sameDocument' in window), 'the page reloaded').toBe(true)
  }

  const loadedPaths = new Set(assetResponses.filter(({ status }) => status === 200).map(({ path }) => path))
  for (const { hashedTarget } of routeMappings) {
    expect(loadedPaths.has(hashedTarget), `${hashedTarget} was not fetched with HTTP 200`).toBe(true)
  }
  expect(assetResponses.filter(({ path }) => remappedKeys.has(path))).toEqual([])
  expect(assetResponses.filter(({ status }) => status !== 200)).toEqual([])
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
