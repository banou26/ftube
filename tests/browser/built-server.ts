import type { AddressInfo } from 'node:net'

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD = fileURLToPath(new URL('../../build/', import.meta.url))

const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

const fileAt = (path: string) => path.includes('..')
  ? undefined
  : [path, `${path}.html`].map(name => BUILD + name.slice(1)).find(file => existsSync(file) && statSync(file).isFile())

/**
 * Serves `build/` on an ephemeral localhost port with Cloudflare Pages routing: exact files, clean `.html` URLs,
 * `assets/404.html` with 404 for missing `/assets/*` paths, and `index.html` fallback for app routes.
 */
export const startBuildServer = async () => {
  if (!existsSync(`${BUILD}index.html`)) throw new Error('no build to serve: run npm run build first')
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const asset = path.startsWith('/assets/')
    const found = fileAt(path)
    const file = found ?? (asset ? `${BUILD}assets/404.html` : `${BUILD}index.html`)
    response.writeHead(asset && !found ? 404 : 200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': asset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    })
    response.end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>(resolve => server.close(() => resolve()))
  return { origin, close }
}
