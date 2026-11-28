import { describe, expect, it } from 'vite-plus/test'

import pkgRaw from '../../package.json?raw'
import { APP_VERSION } from '../../src/version'

describe('APP_VERSION', () => {
  it('matches the package.json semver version', () => {
    const pkg = JSON.parse(pkgRaw) as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/)
  })
})
