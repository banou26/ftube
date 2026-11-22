import { describe, expect, it, vi } from 'vite-plus/test'

import { isDiscordBot, onRequest, youtubeEmbedRedirect } from '../../../functions/_middleware'

describe('isDiscordBot', () => {
  it('matches Discord crawler User-Agent strings case-insensitively', () => {
    expect(isDiscordBot('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)')).toBe(true)
    expect(isDiscordBot('discordbot/2.0')).toBe(true)
    expect(isDiscordBot('Mozilla/5.0 DISCORDBOT')).toBe(true)
  })

  it('rejects browsers, other crawlers, and missing values', () => {
    expect(isDiscordBot(null)).toBe(false)
    expect(isDiscordBot('')).toBe(false)
    expect(isDiscordBot('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36')).toBe(false)
    expect(isDiscordBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(false)
    expect(isDiscordBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(false)
  })
})

describe('youtubeEmbedRedirect', () => {
  const mapUrl = (pathAndQuery: string) => youtubeEmbedRedirect(new URL(`https://youtube.fkn.app${pathAndQuery}`))

  it('maps watch routes and rewrites watch/:id and embed/:id', () => {
    expect(mapUrl('/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(mapUrl('/watch?v=dQw4w9WgXcQ&t=42s&list=PL123&index=2')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2&t=42s',
    )
    expect(mapUrl('/watch?v=dQw4w9WgXcQ&start=30')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')
    expect(mapUrl('/watch/?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(mapUrl('/watch')).toBeUndefined()

    expect(mapUrl('/watch/dQw4w9WgXcQ?t=15s')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15s')
    expect(mapUrl('/embed/dQw4w9WgXcQ?start=10')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')
    expect(mapUrl('/embed/videoseries?list=PL123')).toBe('https://www.youtube.com/playlist?list=PL123')
    expect(mapUrl('/embed/videoseries')).toBeUndefined()
  })

  it('maps Shorts, live, and playlist routes', () => {
    expect(mapUrl('/shorts/y2Vqj-59Hqc')).toBe('https://www.youtube.com/shorts/y2Vqj-59Hqc')
    expect(mapUrl('/shorts/y2Vqj-59Hqc?t=5s')).toBe('https://www.youtube.com/shorts/y2Vqj-59Hqc?t=5s')
    expect(mapUrl('/shorts')).toBeUndefined()

    expect(mapUrl('/live/jfKfPfyJRdk')).toBe('https://www.youtube.com/live/jfKfPfyJRdk')
    expect(mapUrl('/live/jfKfPfyJRdk?start=12')).toBe('https://www.youtube.com/live/jfKfPfyJRdk?t=12')

    expect(mapUrl('/playlist?list=PL123')).toBe('https://www.youtube.com/playlist?list=PL123')
    expect(mapUrl('/playlist')).toBeUndefined()
  })

  it('maps channels, posts, gaming, search, and hashtag routes', () => {
    expect(mapUrl('/@MKBHD')).toBe('https://www.youtube.com/@MKBHD')
    expect(mapUrl('/@MKBHD/videos')).toBe('https://www.youtube.com/@MKBHD/videos')
    expect(mapUrl('/@MKBHD?tab=PLAYLISTS')).toBe('https://www.youtube.com/@MKBHD/playlists')
    expect(mapUrl('/channel/UC123')).toBe('https://www.youtube.com/channel/UC123')
    expect(mapUrl('/channel/UC123/shorts')).toBe('https://www.youtube.com/channel/UC123/shorts')
    expect(mapUrl('/c/BlenderGuru')).toBe('https://www.youtube.com/c/BlenderGuru')
    expect(mapUrl('/user/BlenderGuru')).toBe('https://www.youtube.com/user/BlenderGuru')

    expect(mapUrl('/post/Ugkx123')).toBe('https://www.youtube.com/post/Ugkx123')
    expect(mapUrl('/gaming')).toBe('https://www.youtube.com/gaming')
    expect(mapUrl('/results?search_query=blender+guru')).toBe('https://www.youtube.com/results?search_query=blender+guru')
    expect(mapUrl('/results?search_query=music&sp=EgIQAQ%253D%253D')).toBe(
      'https://www.youtube.com/results?search_query=music&sp=EgIQAQ%253D%253D',
    )
    expect(mapUrl('/results')).toBeUndefined()
    expect(mapUrl('/search/blender%20guru')).toBe('https://www.youtube.com/results?search_query=blender+guru')
    expect(mapUrl('/hashtag/blender')).toBe('https://www.youtube.com/hashtag/blender')
  })

  it('returns undefined for app-only and static routes', () => {
    for (const path of [
      '/',
      '/settings',
      '/privacy',
      '/party',
      '/account',
      '/signin',
      '/feed/subscriptions',
      '/assets/app.js',
      '/__yt_engine__/engine.html',
      '/unknown',
    ]) {
      expect(mapUrl(path)).toBeUndefined()
    }
  })

  it('keeps malformed and adversarial paths strictly on https://www.youtube.com or undefined', () => {
    expect(mapUrl('//evil.com/watch?v=1')).toBeUndefined()
    const malformed = mapUrl('/@%E0%A4%A')
    if (malformed !== undefined) {
      expect(new URL(malformed).origin).toBe('https://www.youtube.com')
    }
  })
})

describe('onRequest', () => {
  const DISCORD_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

  it('redirects Discordbot GET and HEAD requests on watch routes without caching or calling next', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const next = vi.fn(async () => new Response('app'))
      const response = await onRequest({
        request: new Request('https://youtube.fkn.app/watch?v=dQw4w9WgXcQ', {
          method,
          headers: { 'user-agent': DISCORD_UA },
        }),
        next,
      })
      expect(next).not.toHaveBeenCalled()
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('vary')).toBe('User-Agent')
    }
  })

  it('passes through normal browsers, non-GET/HEAD requests, and app-only routes', async () => {
    const browserNext = vi.fn(async () => new Response('app-html', { status: 200 }))
    const browserResponse = await onRequest({
      request: new Request('https://youtube.fkn.app/watch?v=dQw4w9WgXcQ', {
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0.0.0' },
      }),
      next: browserNext,
    })
    expect(browserNext).toHaveBeenCalledTimes(1)
    expect(await browserResponse.text()).toBe('app-html')

    const postNext = vi.fn(async () => new Response('method-passthrough', { status: 405 }))
    await onRequest({
      request: new Request('https://youtube.fkn.app/watch?v=dQw4w9WgXcQ', {
        method: 'POST',
        headers: { 'user-agent': DISCORD_UA },
      }),
      next: postNext,
    })
    expect(postNext).toHaveBeenCalledTimes(1)

    for (const path of ['/', '/privacy']) {
      const appNext = vi.fn(async () => new Response('page', { status: 200 }))
      await onRequest({
        request: new Request(`https://youtube.fkn.app${path}`, {
          method: 'GET',
          headers: { 'user-agent': DISCORD_UA },
        }),
        next: appNext,
      })
      expect(appNext).toHaveBeenCalledTimes(1)
    }
  })
})
