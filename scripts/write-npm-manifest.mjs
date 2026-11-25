// Writes `dist/package.json` and copies static manifest, icon, doc, and store assets into `dist/`
// so publishing `./dist` maps package paths 1:1 onto the FKN sandbox origin root.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KEPT = [
  'name',
  'version',
  'type',
  'description',
  'homepage',
  'repository',
  'keywords',
  'license',
  'fkn',
]

/** Package manifest shipped at the root of `dist/`. */
export const npmManifest = (pkg, entry) => ({
  ...Object.fromEntries(KEPT.filter((key) => pkg[key] !== undefined).map((key) => [key, pkg[key]])),
  main: entry,
})

/** Extracts the built root `index-<hash>.js` entry filename from `dist/index.html`. */
export const entryIn = (html) => {
  const entry = html.match(/<script type="module"[^>]* src="\/(index-[A-Za-z0-9_-]+\.js)"/)?.[1]
  if (!entry) throw new Error('dist/index.html loads no /index-<hash>.js entrypoint')
  return entry
}

const copyInto = (from, to) => {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/** Stages all non-Vite assets and writes `dist/package.json` inside `dir`. */
export const prepareNpmDir = (dir = 'dist') => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const entry = entryIn(readFileSync(join(dir, 'index.html'), 'utf8'))

  for (const name of ['app.webmanifest', 'favicon.ico', 'favicon.svg']) {
    copyInto(join('public', name), join(dir, name))
  }
  if (existsSync('public/icons')) {
    cpSync('public/icons', join(dir, 'icons'), { recursive: true })
  }
  if (existsSync('store')) {
    cpSync('store', join(dir, 'store'), { recursive: true })
  }
  for (const doc of ['README.md', 'LICENSE']) {
    copyInto(doc, join(dir, doc))
  }

  const out = npmManifest(pkg, entry)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(out, null, 2)}\n`)
  return out
}

const isMain = process.argv[1]?.endsWith('write-npm-manifest.mjs')
if (isMain) {
  const out = prepareNpmDir('dist')
  console.log(`dist/package.json: ${out.name} ${out.version}, main ${out.main}`)
}
