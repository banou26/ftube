#!/usr/bin/env node
// Generates app icons, public/favicon.ico, and store listing artwork from `build/` + `public/favicon.svg`.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const BUILD_DIR = join(ROOT, 'build')
const STORE_DIR = join(ROOT, 'store')
const ICONS_DIR = join(ROOT, 'public/icons')
const CHROME = process.env.FTUBE_CHROME ?? '/etc/profiles/per-user/banou/bin/google-chrome'

const onlyArg = (() => {
  const index = process.argv.indexOf('--only')
  return index === -1 ? undefined : process.argv[index + 1]
})()

const TYPES = {
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

const serveBuild = () =>
  new Promise((listening) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      const rel = path.replace(/^\/+/, '')
      const candidates = rel ? [rel, `${rel}.html`] : ['index.html']
      const found = !path.includes('..')
        ? candidates.map((name) => join(BUILD_DIR, name)).find((file) => existsSync(file) && statSync(file).isFile())
        : undefined
      const isAsset = path.startsWith('/assets/')
      const target = found ?? (isAsset ? join(BUILD_DIR, 'assets/404.html') : join(BUILD_DIR, 'index.html'))
      response.writeHead(isAsset && !found ? 404 : 200, {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      })
      response.end(readFileSync(target))
    })
    server.listen(0, 'localhost', () => {
      const { port } = server.address()
      listening({ server, origin: `http://localhost:${port}` })
    })
  })

const toWebp = (pngPath, webpPath, quality = 85) => {
  const { status, stderr } = spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-y', '-i', pngPath, '-c:v', 'libwebp', '-quality', String(quality), '-pix_fmt', 'yuv420p', webpPath],
    { encoding: 'utf8' },
  )
  if (status !== 0) throw new Error(`ffmpeg failed on ${webpPath}: ${stderr}`)
}

const buildIco = (entries) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(entries.length * 16)
  let offset = header.length + dir.length
  for (let i = 0; i < entries.length; i++) {
    const { size, data } = entries[i]
    const pos = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, pos)
    dir.writeUInt8(size >= 256 ? 0 : size, pos + 1)
    dir.writeUInt8(0, pos + 2)
    dir.writeUInt8(0, pos + 3)
    dir.writeUInt16LE(1, pos + 4)
    dir.writeUInt16LE(32, pos + 6)
    dir.writeUInt32LE(data.length, pos + 8)
    dir.writeUInt32LE(offset, pos + 12)
    offset += data.length
  }
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.data)])
}

const brandSvgMarkup = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <path d="M30.37 8.78A3.77 3.77 0 0 0 27.72 6.12C25.38 5.5 16 5.5 16 5.5S6.62 5.5 4.28 6.12A3.77 3.77 0 0 0 1.63 8.78C1 11.13 1 16 1 16s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C6.62 26.5 16 26.5 16 26.5s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C31 20.87 31 16 31 16s0-4.87-.63-7.22Z" fill="#ff0000" />
    <path d="M11.4 20.35V11.65L18.9 16l-7.5 4.35Z" fill="#ffffff" />
    <path d="M19.6 12.25l3.2 3.75-3.2 3.75" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`

const WALL_FRAMES = [
  ['#241315', '#c8282b'],
  ['#161b24', '#335275'],
  ['#221a13', '#8c5327'],
  ['#1a1e18', '#3c613b'],
  ['#261419', '#9c2236'],
  ['#181820', '#48486e'],
  ['#1f1c14', '#7a6328'],
  ['#131d21', '#275c6e'],
  ['#281615', '#b5392c'],
  ['#1b1721', '#5a3d78'],
  ['#1c1d18', '#526133'],
  ['#24161a', '#a32941'],
]

const wallHtml = (columns, rows) =>
  Array.from({ length: columns * rows }, (_, i) => {
    const [base, accent] = WALL_FRAMES[(i * 7 + 3) % WALL_FRAMES.length]
    return `<div class="tile" style="--b:${base};--a:${accent}"></div>`
  }).join('')

const backgroundHtml = () => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 2560px;
    height: 826px;
    background: #0c0c0c;
    overflow: hidden;
  }
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0c0c0c;
    overflow: hidden;
  }
  .wall {
    position: absolute;
    inset: -120px -160px;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 28px;
    transform: rotate(-4deg) scale(1.06);
    filter: blur(22px) saturate(1.15);
    opacity: 0.42;
  }
  .tile {
    aspect-ratio: 16 / 9;
    border-radius: 22px;
    background: radial-gradient(circle at 65% 42%, var(--a) 0%, var(--b) 62%, #111111 100%);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 46% 52% at 50% 38%, rgba(255, 24, 34, 0.24) 0%, rgba(12, 12, 12, 0.45) 55%, #0c0c0c 100%),
      linear-gradient(180deg, rgba(12, 12, 12, 0.28) 0%, rgba(12, 12, 12, 0.62) 58%, #0c0c0c 100%);
  }
  .emblem {
    position: absolute;
    left: 50%;
    top: 38%;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 18px 46px rgba(0, 0, 0, 0.72));
  }
</style>
</head>
<body>
  <div class="canvas">
    <div class="wall">${wallHtml(5, 4)}</div>
    <div class="vignette"></div>
    <div class="emblem">${brandSvgMarkup(220)}</div>
  </div>
</body>
</html>`

const coverHtml = () => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 600px;
    height: 900px;
    background: #0c0c0c;
    color: #ffffff;
    font-family: 'Roboto', system-ui, -apple-system, sans-serif;
    overflow: hidden;
  }
  .capsule {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0c0c0c;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding: 0 48px 136px;
    overflow: hidden;
  }
  .wall {
    position: absolute;
    inset: -80px -120px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 18px;
    transform: rotate(-5deg) scale(1.08);
    filter: blur(20px) saturate(1.18);
    opacity: 0.45;
  }
  .tile {
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    background: radial-gradient(circle at 60% 42%, var(--a) 0%, var(--b) 62%, #111111 100%);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 50% 41%, rgba(255, 24, 34, 0.24) 0%, rgba(12, 12, 12, 0.42) 55%, #0c0c0c 100%),
      linear-gradient(180deg, rgba(12, 12, 12, 0.22) 0%, rgba(12, 12, 12, 0.56) 62%, #0c0c0c 100%);
  }
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 54px;
  }
  .emblem {
    filter: drop-shadow(0 18px 42px rgba(0, 0, 0, 0.72));
  }
  .wordmark {
    font-size: 92px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
    color: #ffffff;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="capsule">
    <div class="wall">${wallHtml(3, 6)}</div>
    <div class="vignette"></div>
    <div class="content">
      <div class="emblem">${brandSvgMarkup(220)}</div>
      <div class="wordmark">FTube</div>
    </div>
  </div>
</body>
</html>`

const generateIcons = async (browser, work) => {
  mkdirSync(ICONS_DIR, { recursive: true })
  const svg = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8')
  const sizes = [16, 32, 48, 192, 512]
  const icoEntries = []

  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:transparent;display:grid;place-items:center}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`)
    const outPath = size >= 192 ? join(ICONS_DIR, `icon-${size}.png`) : join(work, `icon-${size}.png`)
    await page.screenshot({ path: outPath, omitBackground: true })
    await page.close()
    if (size <= 48) icoEntries.push({ size, data: readFileSync(outPath) })
  }

  writeFileSync(join(ROOT, 'public/favicon.ico'), buildIco(icoEntries))
  console.log('generated public/icons/icon-192.png, public/icons/icon-512.png, public/favicon.ico')
}

const generateBrandArt = async (browser, work) => {
  mkdirSync(STORE_DIR, { recursive: true })
  for (const [name, width, height, html] of [
    ['background', 2560, 826, backgroundHtml()],
    ['cover', 600, 900, coverHtml()],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    const png = join(work, `${name}.png`)
    await page.screenshot({ path: png })
    await page.close()
    const out = join(STORE_DIR, `${name}.webp`)
    toWebp(png, out, 88)
    console.log(`store/${name}.webp (${statSync(out).size} bytes)`)
  }
}

const waitImagesLoaded = (page, count = 4) =>
  page.waitForFunction(
    (needed) => {
      const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
        const rect = img.getBoundingClientRect()
        return rect.width > 40 && rect.height > 40
      })
      const ready = imgs.filter((img) => img.complete && img.naturalWidth > 0)
      return ready.length >= needed
    },
    count,
    { timeout: 90_000 },
  )

const openAppPage = async (browser, origin, userAgent, device, path) => {
  const context = await browser.newContext({ ...device, userAgent, locale: 'en-US' })
  await context.route('https://returnyoutubedislikeapi.com/**', (route) =>
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { likes: 48200, dislikes: 310 } }))
  await context.route('https://sponsor.ajay.app/**', (route) =>
    route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, json: [] }))
  const page = await context.newPage()
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = 'iframe[title="FKN"] { visibility: hidden !important; pointer-events: none !important; }'
    const add = () => document.documentElement.append(style)
    if (document.documentElement) add()
    else document.addEventListener('DOMContentLoaded', add, { once: true })
  })
  await page.goto(`${origin}${path}`)
  await page.waitForFunction(() => document.documentElement.dataset.engine === 'ready', null, { timeout: 90_000 })
  return { context, page }
}

const captureShots = async (browser, work) => {
  if (!existsSync(join(BUILD_DIR, 'index.html'))) {
    throw new Error('build/index.html is missing: run `npm run build` first')
  }
  mkdirSync(STORE_DIR, { recursive: true })
  const { server, origin } = await serveBuild()
  const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`
  const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

  const capture = async (name, device, path, ready) => {
    console.log(`capturing ${name} (${path})...`)
    const { context, page } = await openAppPage(browser, origin, userAgent, device, path)
    await ready(page)
    await page.waitForTimeout(500)
    const png = join(work, `${name}.png`)
    await page.screenshot({ path: png })
    await context.close()
    const out = join(STORE_DIR, `${name}.webp`)
    toWebp(png, out, 84)
    console.log(`store/${name}.webp (${statSync(out).size} bytes)`)
  }

  try {
    await capture('watch', desktop, '/watch?v=aqz-KE-bpKQ', async (page) => {
      await page.locator('h1').first().waitFor({ timeout: 90_000 })
      await page.waitForFunction(
        () => {
          const video = document.querySelector('video')
          return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime > 1)
        },
        null,
        { timeout: 120_000 },
      )
      await page.locator('video').evaluate(async (video) => {
        if (Math.abs(video.currentTime - 25) > 1) {
          video.currentTime = 25
          await Promise.race([
            new Promise((done) => video.addEventListener('seeked', done, { once: true })),
            new Promise((done) => setTimeout(done, 15_000)),
          ])
        }
        video.pause()
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      })
      await waitImagesLoaded(page, 4)
    })
    await capture('search', desktop, '/results?search_query=blender+open+movies', async (page) => {
      await page.locator('article.result').first().waitFor({ timeout: 90_000 })
      await waitImagesLoaded(page, 4)
    })
    await capture('channel', desktop, '/@BlenderOfficial/videos', async (page) => {
      await page.locator('h1').first().waitFor({ timeout: 90_000 })
      await waitImagesLoaded(page, 6)
    })
    await capture('phone', phone, '/results?search_query=blender+open+movies', async (page) => {
      await page.locator('article.result').first().waitFor({ timeout: 90_000 })
      await waitImagesLoaded(page, 2)
    })
  } finally {
    await new Promise((done) => server.close(done))
  }
}

const work = mkdtempSync(join(tmpdir(), 'ftube-art-'))
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
})

try {
  if (!onlyArg || onlyArg === 'icons') await generateIcons(browser, work)
  if (!onlyArg || onlyArg === 'art') await generateBrandArt(browser, work)
  if (!onlyArg || onlyArg === 'shots') await captureShots(browser, work)
} finally {
  await browser.close()
  rmSync(work, { recursive: true, force: true })
}
