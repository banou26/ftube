/// <reference types="vite/client" />
import { describe, expect, it } from 'vite-plus/test'

import { laneOf } from '../../src/frame/lanes'
import { DIRECT_HOSTS, FKN_DOMAINS } from '../../src/privacy-hosts'
import store from './fixtures/channel-store.json'
import mrbeas from './fixtures/suggestions-mrbeas.txt?raw'
import taylor from './fixtures/suggestions-taylor-s.txt?raw'
import fehistory from './history/fehistory.json'
import uploadsFeed from './fixtures/uulf-computerphile.xml?raw'

const within = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`)
const listed = (hostname: string) => DIRECT_HOSTS.some(({ domain }) => within(hostname, domain))
const fkn = (hostname: string) => FKN_DOMAINS.some((domain) => within(hostname, domain))

// raw text through vite, since vite.config.ts shims node:fs to an empty module under vp test; codegen's output is left
// out, since its comments name its docs
const sources = import.meta.glob(
  [
    '../../src/**/*.{ts,tsx,css,html}',
    '!../../src/generated/**',
    '../../index.html',
    '../../__yt_engine__/*.html',
    '../../public/**/*.{js,html}',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

// A host these files name but the browser never loads itself: they only name it (the share targets are links the
// viewer opens in a new tab)
const SHARE_TARGETS = ['src/components/share-dialog.tsx']
const NOT_FETCHED_FROM_THE_PAGE: Record<string, string[]> = {
  'returnyoutubedislike.com': ['src/routes/settings.tsx'],
  'studio.youtube.com': ['src/routes/channel.tsx'],
  'www.google.com': ['src/frame/innertube.ts'],
  'yt-client.local': ['src/graphql.ts'],
  'messages.google.com': SHARE_TARGETS,
  'wa.me': SHARE_TARGETS,
  'www.facebook.com': SHARE_TARGETS,
  'twitter.com': SHARE_TARGETS,
  'reddit.com': SHARE_TARGETS,
  'pinterest.com': SHARE_TARGETS,
  'www.linkedin.com': SHARE_TARGETS,
  // SVG XML namespace literal used in SVG markup, never fetched by the page
  'www.w3.org': ['src/theme/app-icon.ts', 'src/components/over-screen-overlay.tsx'],
  // External user link opened from @fkn/lib's PoweredByFkn popover, never fetched by the page
  'docs.fkn.dev': ['src/components/header.tsx'],
}

// Named by no code or fixture: the standard emoji in live chat messages (fonts.gstatic.com/s/e/notoemoji, read again
// 2026-11-10), and the channel pictures and banners a signed-in session on youtube.fkn.app loaded on 2026-11-02
const MEASURED = ['fonts.gstatic.com', 'yt3.googleusercontent.com']

const urlHosts = (text: string) => [...text.matchAll(/\bhttps?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map(([, host]) => host!.toLowerCase())

// YouTube's image shape, in thumbnails and image sources alike: a url with its size
const imageHosts = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(imageHosts)
  if (!value || typeof value !== 'object') return []
  const { url, width } = value as { url?: unknown, width?: unknown }
  const own = typeof url === 'string' && typeof width === 'number' ? [new URL(url, 'https://base.invalid').hostname] : []
  return [...own, ...Object.values(value).flatMap(imageHosts)]
}

describe('the hosts the privacy page lists', () => {
  it('cover every host the code names, but the ones it only reaches through FKN or never loads', () => {
    const unlisted = Object.entries(sources).flatMap(([path, text]) => {
      const file = path.replace(/^(\.\.\/)+/, '')
      return urlHosts(text)
        .filter((host) => !listed(host) && !fkn(host) && !NOT_FETCHED_FROM_THE_PAGE[host]?.includes(file))
        .map((host) => `${file}: ${host}`)
    })
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(['../../__yt_engine__/engine.html', '../../public/__yt_scramjet__/host.html']))
    expect(unlisted).toEqual([])
  })

  it('cover every image host in real YouTube answers', () => {
    const hosts = new Set([
      ...imageHosts(fehistory),
      ...imageHosts(store),
      ...[...uploadsFeed.matchAll(/<media:thumbnail url="([^"]+)"/g)].map(([, url]) => new URL(url!).hostname),
      ...[taylor, mrbeas].flatMap((answer) => [...answer.matchAll(/"zai":"([^"]+)"/g)].map(([, url]) => new URL(url!).hostname)),
    ])
    expect([...hosts].sort()).toEqual([
      'encrypted-tbn0.gstatic.com',
      'encrypted-tbn1.gstatic.com',
      'encrypted-tbn2.gstatic.com',
      'encrypted-tbn3.gstatic.com',
      'i.ytimg.com',
      'i1.ytimg.com',
      'i2.ytimg.com',
      'i3.ytimg.com',
      'i4.ytimg.com',
      'yt3.ggpht.com',
      'yt3.googleusercontent.com',
    ])
    expect([...hosts].filter((host) => !listed(host))).toEqual([])
  })

  it('name the captions the browser reads from www.youtube.com itself', () => {
    expect(laneOf('https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&fmt=json3', 'GET', false)).toBe('direct')
    expect(DIRECT_HOSTS.find(({ domain }) => domain === 'www.youtube.com')?.what).toMatch(/\bcaptions\b/)
  })

  it('cover the hosts sessions were seen reaching', () => {
    expect(MEASURED.filter((host) => !listed(host))).toEqual([])
  })
})
