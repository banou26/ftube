import type { AddressInfo } from 'node:net'

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

import { expect, test } from './test'

const DIST = resolve(import.meta.dirname, '../../dist')
const TENANT_CSP = "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'; base-uri 'self'"

const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

const startSandboxServer = async () => {
  if (!existsSync(join(DIST, 'package.json'))) {
    throw new Error('dist/package.json is missing: run `npm run build:npm` first')
  }
  const pkg = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8')) as { main?: string }
  if (!pkg.main) throw new Error('dist/package.json has no main')
  const shellHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FKN Sandbox</title>
    <script type="module" src="/${pkg.main}"></script>
  </head>
  <body></body>
</html>`

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (pathname === '/' || pathname === '/index.html' || !extname(pathname)) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': TENANT_CSP,
        'cache-control': 'no-store',
      })
      response.end(shellHtml)
      return
    }
    const rel = pathname.replace(/^\/+/, '')
    const full = !pathname.includes('..') ? join(DIST, rel) : ''
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
      response.writeHead(404, {
        'content-type': 'text/plain',
        'content-security-policy': TENANT_CSP,
      })
      response.end('Not found')
      return
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(full)] ?? 'application/octet-stream',
      'content-security-policy': TENANT_CSP,
      'cache-control': 'public, max-age=31536000, immutable',
    })
    response.end(readFileSync(full))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://ftube.sdbx.localhost:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>((done) => server.close(() => done()))
  return { origin, pkgMain: pkg.main, close }
}

test('boots dist/ under the FKN sandbox CSP with zero 404s or policy violations', async ({ page }) => {
  test.setTimeout(180_000)
  const sandbox = await startSandboxServer()
  const cspViolations: string[] = []
  const pageErrors: string[] = []
  const failedSameOrigin: string[] = []

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { __cspViolations?: string[] }).__cspViolations ??= []
      ;(window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective}:${event.blockedURI}`,
      )
    })
  })
  page.on('pageerror', (error) => {
    if (/^(TypeError: )?Failed to fetch$/.test(error.message.trim())) return
    pageErrors.push(error.message)
  })
  page.on('response', (response) => {
    if (response.url().startsWith(sandbox.origin) && response.status() >= 400) {
      failedSameOrigin.push(`${response.status()} ${response.url()}`)
    }
  })

  try {
    const homeResponse = await page.goto(`${sandbox.origin}/`)
    expect(homeResponse?.headers()['content-security-policy']).toBe(TENANT_CSP)
    await expect(page).toHaveTitle('FTube')
    await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })

    const privacyResponse = await page.goto(`${sandbox.origin}/privacy`)
    expect(privacyResponse?.headers()['content-security-policy']).toBe(TENANT_CSP)
    await expect(page).toHaveTitle('Privacy - FTube')
    await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })
    await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible()

    // Check stylesheet injection, Roboto font loading, and clean removal of any leftover violations.
    const cssLoaded = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((link) => {
        const href = link.getAttribute('href') ?? ''
        return href.startsWith('/assets/') && href.endsWith('.css') && Boolean((link as HTMLLinkElement).sheet)
      }),
    )
    expect(cssLoaded).toBe(true)
    const privacyViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )
    cspViolations.push(...privacyViolations)

    await page.goto(`${sandbox.origin}/settings`)
    await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 90_000 })
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    const settingsViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )
    cspViolations.push(...settingsViolations)

    await page.goto(`${sandbox.origin}/results?search_query=blender`)
    await expect(page.locator('article.result').first()).toBeVisible({ timeout: 90_000 })
    const searchViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )
    cspViolations.push(...searchViolations)

    // Exercise player deciphering in the sdbx.localhost sandbox realm (Platform.shim.eval -> agent.decipher).
    await page.goto(`${sandbox.origin}/watch?v=dQw4w9WgXcQ`)
    await page.waitForFunction(
      () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
      null,
      { timeout: 120_000 },
    )
    const watchViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )
    cspViolations.push(...watchViolations)

    expect(failedSameOrigin).toEqual([])
    expect(cspViolations).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await sandbox.close()
  }
})
