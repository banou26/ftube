import { describe, expect, it } from 'vite-plus/test'

import { entryIn, npmManifest } from '../../scripts/write-npm-manifest.mjs'
import { packageProblems } from '../../scripts/check-npm-package.mjs'
import { decide } from '../../scripts/npm-version-gate.mjs'

const repoPkg = {
  name: '@banou/ftube',
  version: '0.0.1',
  type: 'module',
  description: 'Fast, private YouTube client running in your browser over FKN.',
  license: 'MIT',
  homepage: 'https://youtube.fkn.app',
  repository: { type: 'git', url: 'git+https://github.com/banou26/ftube.git' },
  keywords: ['fkn', 'fkn-type:app'],
  fkn: {
    app: 'fkn:app:17w6qu6cmzioxe4rcja53gvopyfy4673ti3ljucedts57kumfzzoq',
    signed: true,
    url: 'https://youtube.fkn.app/',
    background: 'store/background.webp',
    cover: 'store/cover.webp',
    screenshots: ['store/watch.webp'],
  },
}

const makeTree = (entries: Record<string, string>) => ({
  read: (path: string) => entries[path],
  exists: (path: string) => Object.hasOwn(entries, path) && Buffer.byteLength(entries[path]!) > 0,
  sizeOf: (path: string) => (Object.hasOwn(entries, path) ? Buffer.byteLength(entries[path]!) : -1),
  files: () => Object.keys(entries).sort(),
})

describe('write-npm-manifest', () => {
  it('extracts root entry and keeps only publishable fields', () => {
    const entry = entryIn('<script type="module" crossorigin src="/index-AbCd1234.js"></script>')
    expect(entry).toBe('index-AbCd1234.js')
    const out = npmManifest({ ...repoPkg, private: true, dependencies: { preact: '11' }, scripts: { build: 'x' } }, entry)
    expect(out).toEqual({ ...repoPkg, main: 'index-AbCd1234.js' })
  })
})

describe('check-npm-package', () => {
  it('accepts a valid self-contained package tree', () => {
    const pkg = { ...repoPkg, main: 'index-AbCd1234.js' }
    const tree = makeTree({
      'package.json': JSON.stringify(pkg),
      'index-AbCd1234.js': 'import "/assets/chunk-12345678.js";\nimport "/assets/style-12345678.css";\nexport {}',
      'assets/chunk-12345678.js': 'export const ok = true',
      'assets/style-12345678.css': '@font-face{src:url(./roboto-latin-12345678.woff2)}',
      'assets/roboto-latin-12345678.woff2': 'woff2bytes',
      '__yt_engine__/engine.html': '<script type="module" src="/assets/engine-12345678.js"></script>',
      'assets/engine-12345678.js': 'export {}',
      'favicon.ico': 'ico',
      'app.webmanifest': JSON.stringify({ icons: [{ src: './icons/icon-192.png', purpose: 'any' }] }),
      'icons/icon-192.png': 'png',
      'store/background.webp': 'webp',
      'store/cover.webp': 'webp',
      'store/watch.webp': 'webp',
    })
    expect(packageProblems(pkg, repoPkg, tree)).toEqual([])
  })

  it('rejects nested main, importmap in engine.html, missing assets, and empty files', () => {
    const pkg = { ...repoPkg, main: 'dist/index.js' }
    const tree = makeTree({
      'package.json': JSON.stringify(pkg),
      'dist/index.js': 'import "/assets/missing-12345678.js";\nexport {}',
      '__yt_engine__/engine.html': '<meta name="yt-build" content="1"><script type="importmap">{}</script>',
      'app.webmanifest': '{bad',
      'assets/empty-12345678.js': '',
    })
    const problems = packageProblems(pkg, repoPkg, tree)
    expect(problems.some((p) => p.includes('package root'))).toBe(true)
    expect(problems.some((p) => p.includes('importmap'))).toBe(true)
    expect(problems.some((p) => p.includes('yt-build'))).toBe(true)
    expect(problems.some((p) => p.includes('/assets/missing-12345678.js'))).toBe(true)
    expect(problems.some((p) => p.includes('0 bytes'))).toBe(true)
  })
})

describe('npm-version-gate', () => {
  it('handles unpublished packages, published versions, tombstoned versions, and new versions', () => {
    expect(decide(null, '0.0.1').action).toBe('publish')
    expect(decide({ versions: { '0.0.1': {} }, time: { '0.0.1': '2026-11-26' } }, '0.0.1').action).toBe('skip')
    expect(decide({ versions: {}, time: { '0.0.1': '2026-11-26' } }, '0.0.1').action).toBe('refuse')
    expect(decide({ versions: { '0.0.1': {} }, time: { '0.0.1': '2026-11-26' } }, '0.0.2').action).toBe('publish')
  })
})
