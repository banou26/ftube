import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

// NixOS ships its Playwright WebKit build under PLAYWRIGHT_BROWSERS_PATH (often a newer revision than npm's lock).
const findWebkitExecutable = (): string | undefined => {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersPath || !existsSync(browsersPath)) return undefined
  const entries = readdirSync(browsersPath).filter(name => name.startsWith('webkit-')).sort().reverse()
  for (const entry of entries) {
    const candidate = join(browsersPath, entry, 'pw_run.sh')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const webkitExecutable = findWebkitExecutable()
const nixChrome = '/etc/profiles/per-user/banou/bin/google-chrome'
const chromiumExecutable = existsSync(nixChrome) ? nixChrome : undefined

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  // Each spec is an engine and a SABR stream of its own, and the default of half the cores makes specs fail on contention
  workers: 2,
  use: {
    baseURL: 'http://localhost:4561',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
          args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: webkitExecutable ? { executablePath: webkitExecutable } : {},
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host localhost',
    port: 4561,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
