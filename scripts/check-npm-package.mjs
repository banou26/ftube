// Verifies that `dist/` is self-contained and valid as an FKN npm app before publishing.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

const ES_MODULE = /(?:^|[\s;}])(?:import|export)\s*[{*"'(]|(?:^|[\s;}])(?:import|export)\s+\w/
const ASSET_REF = /["'`(](\/[A-Za-z0-9_\-./@]*\.(?:js|mjs|css|wasm|woff2|png|svg|webp|ico|html))["'`)]/g
const MAX_STORE_IMAGE_BYTES = 1_048_576
const RELEASE_FETCH_MAX_BYTES = 16_384
const MAX_ESTIMATED_FKN_JSON_BYTES = 14_000
const DISALLOWED_FILES = ['_headers', '_routes.json', 'assets/404.html', 'importmap.json']

const referencesIn = (text) => new Set([...text.matchAll(ASSET_REF)].map((m) => m[1]))

const walk = (dir, prefix = '') => {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else out.push(rel)
  }
  return out
}

/** Reads a directory into the lightweight interface `packageProblems` inspects. */
export const readTree = (root) => ({
  read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined),
  exists: (path) => existsSync(join(root, path)) && statSync(join(root, path)).size > 0,
  sizeOf: (path) => (existsSync(join(root, path)) ? statSync(join(root, path)).size : -1),
  files: () => walk(root).sort(),
})

/** Checks whether `dist/` (`pkg`) agrees with `repo` and can run inside FKN's CSP sandbox. */
export const packageProblems = (pkg, repo, tree) => {
  const problems = []

  for (const field of ['name', 'version']) {
    if (pkg[field] !== repo[field]) {
      problems.push(`published ${field} (${JSON.stringify(pkg[field])}) differs from repo (${JSON.stringify(repo[field])})`)
    }
  }
  if (pkg.repository?.url !== repo.repository?.url) {
    problems.push(`published repository.url (${JSON.stringify(pkg.repository?.url)}) differs from repo (${JSON.stringify(repo.repository?.url)})`)
  }
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
  for (const required of ['fkn', 'fkn-type:app']) {
    if (!keywords.includes(required)) problems.push(`package.json keywords must include ${JSON.stringify(required)}`)
  }

  const main = pkg.main
  if (typeof main !== 'string' || !main.trim()) {
    return [...problems, 'package.json declares no "main" entrypoint']
  }
  if (main.includes('/')) {
    problems.push(`"main" (${JSON.stringify(main)}) must live at the package root so tenant paths map 1:1`)
  }

  const code = tree.read(main)
  if (code === undefined) {
    problems.push(`${main} does not exist`)
    return problems
  }
  if (!code.trim()) {
    problems.push(`${main} is empty`)
    return problems
  }
  if (!ES_MODULE.test(code)) {
    problems.push(`${main} contains no ES import or export`)
  }

  const engineHtml = tree.read('__yt_engine__/engine.html')
  if (engineHtml === undefined) {
    problems.push('__yt_engine__/engine.html is missing')
  } else {
    if (engineHtml.includes('yt-build')) {
      problems.push('__yt_engine__/engine.html must not embed meta[name="yt-build"] without the matching tag in sandbox index.html')
    }
    if (engineHtml.includes('<script type="importmap">')) {
      problems.push('__yt_engine__/engine.html must not contain a chunk importmap')
    }
  }

  // Walk every root-relative asset/chunk/CSS reference reachable from main and engine.html.
  const visited = new Set([main, '__yt_engine__/engine.html'])
  const queue = [main, '__yt_engine__/engine.html']
  while (queue.length > 0) {
    const file = queue.pop()
    const body = tree.read(file)
    if (body === undefined) continue
    for (const ref of referencesIn(body)) {
      const rel = ref.slice(1)
      if (!tree.exists(rel)) {
        problems.push(`${file} references ${ref}, which is missing or empty in dist`)
        continue
      }
      if ((rel.endsWith('.js') || rel.endsWith('.mjs') || rel.endsWith('.css')) && !visited.has(rel)) {
        visited.add(rel)
        queue.push(rel)
      }
    }
    if (file.endsWith('.css')) {
      for (const [, url] of body.matchAll(/url\(\s*['"]?(\.[^'")]+)['"]?\s*\)/g)) {
        const clean = url.split(/[?#]/)[0]
        const target = posix.join(posix.dirname(file), clean)
        if (!tree.exists(target)) {
          problems.push(`${file} references relative font/asset ${url} (${target}), which is missing in dist`)
        }
      }
    }
  }

  if (!tree.exists('favicon.ico')) {
    problems.push('favicon.ico is missing from the package root')
  }

  const rawManifest = tree.read('app.webmanifest')
  if (rawManifest === undefined) {
    problems.push('app.webmanifest is missing from the package root')
  } else {
    try {
      const manifest = JSON.parse(rawManifest)
      const icons = Array.isArray(manifest.icons) ? manifest.icons : []
      const anyIcons = icons.filter((icon) => String(icon.purpose ?? 'any').split(/\s+/).includes('any'))
      if (anyIcons.length === 0) problems.push('app.webmanifest declares no icon with purpose "any"')
      for (const icon of anyIcons) {
        const iconPath = String(icon.src ?? '').replace(/^\.?\//, '')
        if (!iconPath || !tree.exists(iconPath)) {
          problems.push(`app.webmanifest icon ${JSON.stringify(icon.src)} is missing in dist`)
        }
      }
    } catch {
      problems.push('app.webmanifest is not valid JSON')
    }
  }

  const fkn = pkg.fkn ?? {}
  if (fkn.url !== 'https://youtube.fkn.app/') {
    problems.push(`fkn.url should be "https://youtube.fkn.app/", got ${JSON.stringify(fkn.url)}`)
  }
  for (const path of [fkn.background, fkn.cover, ...(fkn.screenshots ?? [])].filter(Boolean)) {
    const clean = String(path).replace(/^\.?\//, '')
    const size = tree.sizeOf(clean)
    if (size <= 0) problems.push(`store image ${path} is missing or empty`)
    else if (size > MAX_STORE_IMAGE_BYTES) problems.push(`store image ${path} is ${size} bytes (max ${MAX_STORE_IMAGE_BYTES})`)
  }

  for (const banned of DISALLOWED_FILES) {
    if (tree.exists(banned)) problems.push(`dist should not ship Cloudflare/dev-only file ${banned}`)
  }

  const allFiles = tree.files()
  if (allFiles.some((file) => file.startsWith('__yt_scramjet__/'))) {
    problems.push('dist should not ship legacy __yt_scramjet__/ files')
  }
  for (const file of allFiles) {
    if (tree.sizeOf(file) === 0) problems.push(`${file} is 0 bytes (unpkg answers 500 for empty files)`)
  }

  // Approximate the signed fkn.json byte size (envelope ~500 B + "<path>":"<44-char b64 sha256>" per file).
  const hashedPaths = allFiles.filter((file) => file !== 'package.json' && file !== 'fkn.json')
  const estimatedBytes = 500 + hashedPaths.reduce((sum, path) => sum + JSON.stringify(path).length + 48, 0)
  if (estimatedBytes > MAX_ESTIMATED_FKN_JSON_BYTES || estimatedBytes > RELEASE_FETCH_MAX_BYTES) {
    problems.push(`estimated fkn.json size (${estimatedBytes} bytes across ${hashedPaths.length} files) exceeds budget (${MAX_ESTIMATED_FKN_JSON_BYTES})`)
  }

  return problems
}

const isMain = process.argv[1]?.endsWith('check-npm-package.mjs')
if (isMain) {
  const dir = process.argv[2] ?? 'dist'
  const repo = JSON.parse(readFileSync('package.json', 'utf8'))
  const tree = readTree(dir)
  const rawPkg = tree.read('package.json')
  if (rawPkg === undefined) {
    console.error(`${dir}/package.json does not exist. Run write-npm-manifest.mjs first.`)
    process.exit(1)
  }
  const shipped = JSON.parse(rawPkg)
  const problems = packageProblems(shipped, repo, tree)
  if (problems.length > 0) {
    console.error(`${resolve(dir)} cannot be published as an FKN app:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`${dir}/${shipped.main} is ready (${tree.files().length} files, zero issues)`)
}
