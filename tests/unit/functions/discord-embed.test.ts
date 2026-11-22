import { describe, expect, it, vi } from 'vite-plus/test'

import {
  extractYoutubeMeta,
  handleEmbedRequest,
  handleOembedRequest,
  isDiscordBot,
  onRequest,
  renderEmbedHtml,
  youtubeEmbedRedirect,
  type EmbedMeta,
} from '../../../functions/_middleware'

const WATCH_HTML = `<!doctype html><html><head>
<title>Rockstar actually thought of this.. - YouTube</title>
<meta name="description" content="Fallback description">
<meta content="YouTube" property="og:site_name">
<meta property="og:url" content="https://www.youtube.com/watch?v=q4zQN5r-TZg">
<meta property="og:title" content="Rockstar actually &amp; truly thought of this &#39;now&#39;..">
<meta property="og:image" content="https://i.ytimg.com/vi/q4zQN5r-TZg/maxresdefault.jpg">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
<meta content="This is &quot;GTA 6&quot; Gameplay" property="og:description">
<meta property="og:type" content="video.other">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://i.ytimg.com/vi/q4zQN5r-TZg/maxresdefault.jpg">
<span itemprop="author" itemscope itemtype="http://schema.org/Person"><link href="http://www.youtube.com/@muaxh03" itemprop="url"><link itemprop="name" content="Muaxh03 &amp; Friends"></span>
<meta itemprop="datePublished" content="2026-11-18T05:27:54-08:00">
</head><body></body></html>`

const SHORTS_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Refuse To Give Up&#128293;">
<meta property="og:description" content="Short desc">
<meta property="og:image" content="https://i.ytimg.com/vi/y2Vqj-59Hqc/oar2.jpg">
<meta property="og:image:width" content="576">
<meta property="og:image:height" content="720">
<meta property="og:type" content="video.other">
<meta name="twitter:card" content="player">
<span itemprop="author"><link itemprop="url" href="http://www.youtube.com/@ZenMindset-xe"><link itemprop="name" content="Zen Mindset"></span>
<meta itemprop="datePublished" content="2026-10-02T01:29:50-07:00">
</head></html>`

const CHANNEL_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Marques Brownlee">
<meta property="og:description" content="Tech videos">
<meta property="og:image" content="https://yt3.googleusercontent.com/mkbhd.jpg">
<meta property="og:image:width" content="900">
<meta property="og:image:height" content="900">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary">
<span itemprop="author"><link itemprop="url" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ"><link itemprop="name" content="Marques Brownlee"></span>
</head></html>`

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

describe('extractYoutubeMeta', () => {
  it('extracts watch metadata regardless of attribute order, decodes entities, and rewrites author URL', () => {
    const meta = extractYoutubeMeta(WATCH_HTML, 'https://youtube.fkn.app')
    expect(meta).toEqual({
      title: 'Rockstar actually & truly thought of this \'now\'..',
      description: 'This is "GTA 6" Gameplay',
      image: 'https://i.ytimg.com/vi/q4zQN5r-TZg/maxresdefault.jpg',
      imageWidth: '1280',
      imageHeight: '720',
      ogType: 'video.other',
      twitterCard: 'summary_large_image',
      authorName: 'Muaxh03 & Friends',
      authorUrl: 'https://youtube.fkn.app/@muaxh03',
      datePublished: '2026-11-18T05:27:54-08:00',
    })
  })

  it('normalizes twitter:card="player" to summary_large_image on Shorts and live pages', () => {
    const meta = extractYoutubeMeta(SHORTS_HTML, 'https://youtube.fkn.app')
    expect(meta?.twitterCard).toBe('summary_large_image')
    expect(meta?.title).toBe('Refuse To Give Up🔥')
    expect(meta?.authorUrl).toBe('https://youtube.fkn.app/@ZenMindset-xe')
  })

  it('omits author fields on channel profile pages to avoid duplicating the channel name', () => {
    const meta = extractYoutubeMeta(CHANNEL_HTML, 'https://youtube.fkn.app')
    expect(meta).toEqual({
      title: 'Marques Brownlee',
      description: 'Tech videos',
      image: 'https://yt3.googleusercontent.com/mkbhd.jpg',
      imageWidth: '900',
      imageHeight: '900',
      ogType: 'profile',
      twitterCard: 'summary',
    })
  })

  it('rejects consent interstitials and generic YouTube home titles', () => {
    expect(extractYoutubeMeta('<title>Before you continue to YouTube</title>', 'https://youtube.fkn.app')).toBeUndefined()
    expect(extractYoutubeMeta('<title>YouTube</title><meta property="og:title" content="YouTube">', 'https://youtube.fkn.app')).toBeUndefined()
  })
})

describe('renderEmbedHtml', () => {
  it('renders FTube-branded Open Graph, oEmbed link, and publish date without theme-color or YouTube site_name', () => {
    const meta: EmbedMeta = {
      title: 'Rockstar actually thought of this..',
      description: 'This is GTA 6 Gameplay',
      image: 'https://i.ytimg.com/vi/q4zQN5r-TZg/maxresdefault.jpg',
      imageWidth: '1280',
      imageHeight: '720',
      ogType: 'video.other',
      twitterCard: 'summary_large_image',
      authorName: 'Muaxh03',
      authorUrl: 'https://youtube.fkn.app/@muaxh03',
      datePublished: '2026-11-18T05:27:54-08:00',
    }
    const html = renderEmbedHtml(meta, new URL('https://youtube.fkn.app/watch?v=q4zQN5r-TZg'))
    expect(html).toContain('<title>Rockstar actually thought of this.. - FTube</title>')
    expect(html).toContain('<meta property="og:site_name" content="FTube">')
    expect(html).toContain('<meta property="og:url" content="https://youtube.fkn.app/watch?v=q4zQN5r-TZg">')
    expect(html).toContain('<meta itemprop="datePublished" content="2026-11-18T05:27:54-08:00">')
    expect(html).toContain('application/json+oembed')
    expect(html).toContain('https://youtube.fkn.app/__oembed?')
    expect(html).not.toContain('theme-color')
    expect(html).not.toContain('YouTube')
  })

  it('omits the oEmbed link when authorName is absent', () => {
    const html = renderEmbedHtml(
      {
        title: 'Marques Brownlee',
        ogType: 'profile',
        twitterCard: 'summary',
      },
      new URL('https://youtube.fkn.app/@MKBHD'),
    )
    expect(html).not.toContain('oembed')
    expect(html).toContain('<meta property="og:site_name" content="FTube">')
  })
})

describe('handleOembedRequest', () => {
  it('returns provider_name FTube with same-origin author_url and strips external author_url', async () => {
    const valid = handleOembedRequest(
      new URL('https://youtube.fkn.app/__oembed?title=Test&author_name=Muaxh03&author_url=https%3A%2F%2Fyoutube.fkn.app%2F%40muaxh03'),
    )
    expect(valid.status).toBe(200)
    expect(valid.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await valid.json()).toEqual({
      version: '1.0',
      type: 'link',
      provider_name: 'FTube',
      provider_url: 'https://youtube.fkn.app/',
      title: 'Test',
      author_name: 'Muaxh03',
      author_url: 'https://youtube.fkn.app/@muaxh03',
    })

    const external = handleOembedRequest(
      new URL('https://youtube.fkn.app/__oembed?author_name=Muaxh03&author_url=https%3A%2F%2Fevil.example%2F%40x'),
    )
    expect(await external.json()).toEqual({
      version: '1.0',
      type: 'link',
      provider_name: 'FTube',
      provider_url: 'https://youtube.fkn.app/',
      author_name: 'Muaxh03',
    })
  })
})

describe('handleEmbedRequest and onRequest', () => {
  const DISCORD_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

  it('serves 200 FTube embed HTML on Discordbot GET/HEAD without caching across User-Agents', async () => {
    const fetchMock = vi.fn(async () => new Response(WATCH_HTML, { status: 200 }))
    for (const method of ['GET', 'HEAD'] as const) {
      const next = vi.fn(async () => new Response('app'))
      const response = await handleEmbedRequest(
        new Request('https://youtube.fkn.app/watch?v=q4zQN5r-TZg', {
          method,
          headers: { 'user-agent': DISCORD_UA },
        }),
        next,
        fetchMock,
      )
      expect(next).not.toHaveBeenCalled()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('vary')).toBe('User-Agent')
      const body = await response.text()
      if (method === 'HEAD') {
        expect(body).toBe('')
      } else {
        expect(body).toContain('<meta property="og:site_name" content="FTube">')
        expect(body).toContain('https://youtube.fkn.app/__oembed?')
      }
    }
  })

  it('falls back to YouTube oEmbed when HTML fetch fails or returns consent page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const targetUrl = String(input)
      if (targetUrl.startsWith('https://www.youtube.com/oembed')) {
        return new Response(
          JSON.stringify({
            title: 'Fallback Video',
            author_name: 'Muaxh03',
            author_url: 'https://www.youtube.com/@muaxh03',
            thumbnail_url: 'https://i.ytimg.com/vi/q4zQN5r-TZg/hqdefault.jpg',
            thumbnail_width: 480,
            thumbnail_height: 360,
          }),
          { status: 200 },
        )
      }
      return new Response('<title>Before you continue to YouTube</title>', { status: 200 })
    })

    const next = vi.fn(async () => new Response('app'))
    const response = await handleEmbedRequest(
      new Request('https://youtube.fkn.app/watch?v=q4zQN5r-TZg', {
        method: 'GET',
        headers: { 'user-agent': DISCORD_UA },
      }),
      next,
      fetchMock,
    )
    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('<meta property="og:site_name" content="FTube">')
    expect(body).toContain('<meta property="og:title" content="Fallback Video">')
    expect(body).toContain('author_name=Muaxh03')
  })

  it('falls back to 302 redirect when both upstream HTML and oEmbed fail', async () => {
    const fetchMock = vi.fn(async () => new Response('blocked', { status: 429 }))
    const next = vi.fn(async () => new Response('app'))
    const response = await handleEmbedRequest(
      new Request('https://youtube.fkn.app/watch?v=q4zQN5r-TZg', {
        method: 'GET',
        headers: { 'user-agent': DISCORD_UA },
      }),
      next,
      fetchMock,
    )
    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://www.youtube.com/watch?v=q4zQN5r-TZg')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('User-Agent')
  })

  it('serves /__oembed for GET/HEAD with any User-Agent and returns 405 on POST', async () => {
    const next = vi.fn(async () => new Response('app'))
    const getResp = await onRequest({
      request: new Request('https://youtube.fkn.app/__oembed?author_name=Muaxh03'),
      next,
    })
    expect(next).not.toHaveBeenCalled()
    expect(getResp.status).toBe(200)
    expect(await getResp.json()).toMatchObject({ provider_name: 'FTube', author_name: 'Muaxh03' })

    const headResp = await onRequest({
      request: new Request('https://youtube.fkn.app/__oembed?author_name=Muaxh03', { method: 'HEAD' }),
      next,
    })
    expect(headResp.status).toBe(200)
    expect(await headResp.text()).toBe('')

    const postResp = await onRequest({
      request: new Request('https://youtube.fkn.app/__oembed', { method: 'POST' }),
      next,
    })
    expect(postResp.status).toBe(405)
  })

  it('passes through normal browsers, non-GET/HEAD requests, and app-only routes', async () => {
    const browserNext = vi.fn(async () => new Response('app-html', { status: 200 }))
    const browserResponse = await onRequest({
      request: new Request('https://youtube.fkn.app/watch?v=q4zQN5r-TZg', {
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0.0.0' },
      }),
      next: browserNext,
    })
    expect(browserNext).toHaveBeenCalledTimes(1)
    expect(await browserResponse.text()).toBe('app-html')

    const postNext = vi.fn(async () => new Response('method-passthrough', { status: 405 }))
    await onRequest({
      request: new Request('https://youtube.fkn.app/watch?v=q4zQN5r-TZg', {
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
