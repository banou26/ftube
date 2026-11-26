type PagesContext = {
  request: Request
  next: () => Promise<Response>
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type EmbedMeta = {
  title: string
  description?: string
  image?: string
  imageWidth?: string
  imageHeight?: string
  ogType: string
  twitterCard: string
  authorName?: string
  authorUrl?: string
  datePublished?: string
}

const YOUTUBE_ORIGIN = 'https://www.youtube.com'
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const SITE_NAME = 'FTube'
const DISCORDBOT_FETCH_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const CONSENT_COOKIE = 'SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg'
const HEAD_BYTES_LIMIT = 32_768
const HTML_TIMEOUT_MS = 3_500
const OEMBED_TIMEOUT_MS = 2_500

// Keep in step with `CHANNEL_TAB_PATHS` in `src/routes/channel-tabs.ts` so legacy `?tab=` links canonicalize.
const CHANNEL_TABS: Record<string, string> = {
  HOME: 'featured',
  VIDEOS: 'videos',
  SHORTS: 'shorts',
  LIVE: 'streams',
  RELEASES: 'releases',
  PODCASTS: 'podcasts',
  COURSES: 'courses',
  SHOWS: 'shows',
  PLAYLISTS: 'playlists',
  COMMUNITY: 'posts',
  STORE: 'store',
  ABOUT: 'about',
  SEARCH: 'search',
}

const DISCORDBOT_UA = /\bdiscordbot\b/i

/** Whether the User-Agent identifies Discord's link-preview crawler (`Discordbot`). */
export const isDiscordBot = (userAgent: string | null): boolean =>
  userAgent !== null && DISCORDBOT_UA.test(userAgent)

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const decodeHtml = (value: string): string =>
  value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|quot|#39|apos|lt|gt);/gi, (full, dec, hex) => {
    if (dec !== undefined) {
      const code = Number.parseInt(dec, 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full
    }
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full
    }
    switch (full.toLowerCase()) {
      case '&amp;':
        return '&'
      case '&quot;':
        return '"'
      case '&#39;':
      case '&apos;':
        return '\''
      case '&lt;':
        return '<'
      case '&gt;':
        return '>'
      default:
        return full
    }
  })

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const rewriteYoutubeUrl = (rawUrl: string | undefined, siteOrigin: string): string | undefined => {
  if (!rawUrl) return undefined
  try {
    const parsed = new URL(rawUrl, YOUTUBE_ORIGIN)
    return YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())
      ? `${siteOrigin}${parsed.pathname}${parsed.search}`
      : undefined
  } catch {
    return undefined
  }
}

const attrOf = (attrs: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  const raw = match?.[1] ?? match?.[2]
  return raw !== undefined ? decodeHtml(raw) : undefined
}

const buildWatchUrl = (videoId: string, params: URLSearchParams): string => {
  const query = new URLSearchParams({ v: videoId })
  const list = params.get('list')
  if (list) query.set('list', list)
  const index = params.get('index')
  if (index) query.set('index', index)
  const at = params.get('t') || params.get('start')
  if (at) query.set('t', at)
  return `${YOUTUBE_ORIGIN}/watch?${query}`
}

const buildChannelUrl = (base: string, tab: string | undefined, params: URLSearchParams): string => {
  if (tab) return `${YOUTUBE_ORIGIN}${base}/${encodeURIComponent(safeDecode(tab))}`
  const legacy = params.get('tab')
  const mapped = legacy && Object.hasOwn(CHANNEL_TABS, legacy) ? CHANNEL_TABS[legacy] : undefined
  if (mapped) return `${YOUTUBE_ORIGIN}${base}/${mapped}`
  return `${YOUTUBE_ORIGIN}${base}`
}

const matchTarget = (url: URL): string | undefined => {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  if (!path.startsWith('/') || path.includes('//')) return undefined

  if (path === '/watch') {
    const videoId = url.searchParams.get('v')
    return videoId ? buildWatchUrl(videoId, url.searchParams) : undefined
  }

  const watchMatch = /^\/watch\/([^/]+)$/.exec(path)
  if (watchMatch?.[1]) {
    // Real youtube.com 404s on `/watch/<id>`, so canonicalize to `/watch?v=<id>`.
    return buildWatchUrl(safeDecode(watchMatch[1]), url.searchParams)
  }

  const embedMatch = /^\/embed\/([^/]+)$/.exec(path)
  if (embedMatch?.[1]) {
    const id = embedMatch[1]
    if (id === 'videoseries') {
      const list = url.searchParams.get('list')
      return list ? `${YOUTUBE_ORIGIN}/playlist?${new URLSearchParams({ list })}` : undefined
    }
    // Real youtube.com's `/embed/<id>` page omits the watch page's oEmbed and OG tags Discord unfurls.
    return buildWatchUrl(safeDecode(id), url.searchParams)
  }

  const shortsMatch = /^\/shorts\/([^/]+)$/.exec(path)
  if (shortsMatch?.[1]) {
    const t = url.searchParams.get('t')
    const base = `${YOUTUBE_ORIGIN}/shorts/${encodeURIComponent(safeDecode(shortsMatch[1]))}`
    return t ? `${base}?${new URLSearchParams({ t })}` : base
  }

  const liveMatch = /^\/live\/([^/]+)$/.exec(path)
  if (liveMatch?.[1]) {
    const at = url.searchParams.get('t') || url.searchParams.get('start')
    const base = `${YOUTUBE_ORIGIN}/live/${encodeURIComponent(safeDecode(liveMatch[1]))}`
    return at ? `${base}?${new URLSearchParams({ t: at })}` : base
  }

  if (path === '/playlist') {
    const list = url.searchParams.get('list')
    return list ? `${YOUTUBE_ORIGIN}/playlist?${new URLSearchParams({ list })}` : undefined
  }

  const handleMatch = /^\/(@[^/]+)(?:\/([^/]+))?$/.exec(path)
  if (handleMatch?.[1]) {
    const handle = encodeURIComponent(safeDecode(handleMatch[1])).replace(/^%40/, '@')
    return buildChannelUrl(`/${handle}`, handleMatch[2], url.searchParams)
  }

  const channelMatch = /^\/(channel|c|user)\/([^/]+)(?:\/([^/]+))?$/.exec(path)
  if (channelMatch?.[1] && channelMatch[2]) {
    const base = `/${channelMatch[1]}/${encodeURIComponent(safeDecode(channelMatch[2]))}`
    return buildChannelUrl(base, channelMatch[3], url.searchParams)
  }

  const postMatch = /^\/post\/([^/]+)$/.exec(path)
  if (postMatch?.[1]) {
    return `${YOUTUBE_ORIGIN}/post/${encodeURIComponent(safeDecode(postMatch[1]))}`
  }

  if (path === '/gaming') {
    return `${YOUTUBE_ORIGIN}/gaming`
  }

  if (path === '/results') {
    const searchQuery = url.searchParams.get('search_query')
    if (!searchQuery) return undefined
    const query = new URLSearchParams({ search_query: searchQuery })
    const sp = url.searchParams.get('sp')
    if (sp) query.set('sp', sp)
    return `${YOUTUBE_ORIGIN}/results?${query}`
  }

  const searchMatch = /^\/search\/([^/]+)$/.exec(path)
  if (searchMatch?.[1]) {
    return `${YOUTUBE_ORIGIN}/results?${new URLSearchParams({ search_query: safeDecode(searchMatch[1]) })}`
  }

  const hashtagMatch = /^\/hashtag\/([^/]+)$/.exec(path)
  if (hashtagMatch?.[1]) {
    return `${YOUTUBE_ORIGIN}/hashtag/${encodeURIComponent(safeDecode(hashtagMatch[1]))}`
  }

  return undefined
}

/**
 * Maps an FTube URL on a YouTube content route to its canonical `https://www.youtube.com/...` URL,
 * or `undefined` when the route is app-specific or lacks required identifiers.
 */
export const youtubeEmbedRedirect = (url: URL): string | undefined => {
  const target = matchTarget(url)
  if (!target) return undefined
  try {
    const parsed = new URL(target)
    return parsed.origin === YOUTUBE_ORIGIN ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Extracts Open Graph, Twitter Card, author, and publish-date metadata from the leading snippet
 * of a YouTube HTML page, rewriting YouTube author links onto `siteOrigin`.
 */
export const extractYoutubeMeta = (html: string, siteOrigin: string): EmbedMeta | undefined => {
  const properties = new Map<string, string>()
  const names = new Map<string, string>()
  const itemprops = new Map<string, string>()

  for (const tag of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = tag[1]
    if (!attrs) continue
    const content = attrOf(attrs, 'content')
    if (content === undefined) continue
    const property = attrOf(attrs, 'property')
    if (property && !properties.has(property)) properties.set(property, content)
    const name = attrOf(attrs, 'name')
    if (name && !names.has(name)) names.set(name, content)
    const itemprop = attrOf(attrs, 'itemprop')
    if (itemprop && !itemprops.has(itemprop)) itemprops.set(itemprop, content)
  }

  const rawTitleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]
  const titleTag = rawTitleTag ? decodeHtml(rawTitleTag).replace(/\s*-\s*YouTube$/i, '').trim() : ''
  const title = (properties.get('og:title') ?? titleTag).trim()
  if (!title || title === 'YouTube' || /^before you continue to youtube/i.test(title)) return undefined

  const description = (properties.get('og:description') ?? names.get('description')) || undefined
  const image = properties.get('og:image') || undefined
  const imageWidth = properties.get('og:image:width') || undefined
  const imageHeight = properties.get('og:image:height') || undefined
  const ogType = properties.get('og:type') || 'website'
  const rawCard = names.get('twitter:card')
  const twitterCard = rawCard === 'player'
    ? 'summary_large_image'
    : (rawCard || (image ? 'summary_large_image' : 'summary'))
  const datePublished = itemprops.get('datePublished') || undefined

  let authorName: string | undefined
  let authorUrl: string | undefined
  if (ogType !== 'profile') {
    const authorBlock = /<span\b[^>]*itemprop=["']author["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
    if (authorBlock) {
      for (const link of authorBlock.matchAll(/<link\b([^>]*)>/gi)) {
        const attrs = link[1]
        if (!attrs) continue
        const itemprop = attrOf(attrs, 'itemprop')
        if (itemprop === 'name') {
          authorName ||= attrOf(attrs, 'content') || undefined
        } else if (itemprop === 'url') {
          authorUrl ||= rewriteYoutubeUrl(attrOf(attrs, 'href'), siteOrigin)
        }
      }
    }
  }

  return {
    title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(imageWidth ? { imageWidth } : {}),
    ...(imageHeight ? { imageHeight } : {}),
    ogType,
    twitterCard,
    ...(authorName ? { authorName } : {}),
    ...(authorUrl ? { authorUrl } : {}),
    ...(datePublished ? { datePublished } : {}),
  }
}

/** Renders the minimal crawler-facing HTML document branded as `FTube`. */
export const renderEmbedHtml = (meta: EmbedMeta, requestUrl: URL): string => {
  const canonicalUrl = requestUrl.toString()
  let oembedUrl: URL | undefined
  if (meta.authorName) {
    oembedUrl = new URL('/__oembed', requestUrl.origin)
    oembedUrl.searchParams.set('author_name', meta.authorName.slice(0, 200))
    if (meta.authorUrl) oembedUrl.searchParams.set('author_url', meta.authorUrl.slice(0, 300))
    oembedUrl.searchParams.set('title', meta.title.slice(0, 300))
  }

  const tags = [
    '<meta charset="utf-8">',
    `<title>${escapeHtml(`${meta.title} - ${SITE_NAME}`)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    oembedUrl
      ? `<link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembedUrl.toString())}" title="${escapeHtml(meta.title)}">`
      : '',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${escapeHtml(meta.ogType)}">`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    meta.description ? `<meta property="og:description" content="${escapeHtml(meta.description)}">` : '',
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}">` : '',
    meta.image && meta.imageWidth ? `<meta property="og:image:width" content="${escapeHtml(meta.imageWidth)}">` : '',
    meta.image && meta.imageHeight ? `<meta property="og:image:height" content="${escapeHtml(meta.imageHeight)}">` : '',
    `<meta name="twitter:card" content="${escapeHtml(meta.twitterCard)}">`,
    `<meta name="twitter:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    meta.description ? `<meta name="twitter:description" content="${escapeHtml(meta.description)}">` : '',
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}">` : '',
    meta.datePublished ? `<meta itemprop="datePublished" content="${escapeHtml(meta.datePublished)}">` : '',
  ].filter(Boolean).join('')

  return `<!doctype html><html lang="en"><head>${tags}</head><body></body></html>`
}

const sameOriginUrl = (rawUrl: string | null, origin: string): string | undefined => {
  if (!rawUrl) return undefined
  const bounded = rawUrl.slice(0, 300)
  try {
    const parsed = new URL(bounded)
    return parsed.origin === origin ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

/** Answers Discord's `/__oembed` lookup with `provider_name: "FTube"` and validated author fields. */
export const handleOembedRequest = (url: URL): Response => {
  const title = url.searchParams.get('title')?.slice(0, 300)
  const authorName = url.searchParams.get('author_name')?.slice(0, 200)
  const authorUrl = sameOriginUrl(url.searchParams.get('author_url'), url.origin)
  const payload = {
    version: '1.0',
    type: 'link',
    provider_name: SITE_NAME,
    provider_url: `${url.origin}/`,
    ...(title ? { title } : {}),
    ...(authorName ? { author_name: authorName } : {}),
    ...(authorUrl ? { author_url: authorUrl } : {}),
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

const readHeadSnippet = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, HEAD_BYTES_LIMIT)
  const decoder = new TextDecoder()
  let text = ''
  let totalBytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        text += decoder.decode()
        break
      }
      totalBytes += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (totalBytes >= HEAD_BYTES_LIMIT || text.includes('</head>') || text.includes('itemprop="datePublished"')) {
        void reader.cancel().catch(() => {})
        break
      }
    }
  } catch {
    void reader.cancel().catch(() => {})
  }
  return text
}

const fetchYoutubeHeadMeta = async (
  youtubeUrl: string,
  siteOrigin: string,
  fetchImpl: FetchLike,
): Promise<EmbedMeta | undefined> => {
  try {
    const response = await fetchImpl(youtubeUrl, {
      headers: {
        'user-agent': DISCORDBOT_FETCH_UA,
        'accept-language': 'en-US,en;q=0.9',
        cookie: CONSENT_COOKIE,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return undefined
    }
    const snippet = await readHeadSnippet(response)
    return extractYoutubeMeta(snippet, siteOrigin)
  } catch {
    return undefined
  }
}

type YoutubeOembed = {
  title?: string
  author_name?: string
  author_url?: string
  thumbnail_url?: string
  thumbnail_width?: number
  thumbnail_height?: number
}

const fetchYoutubeOembedMeta = async (
  youtubeUrl: string,
  siteOrigin: string,
  fetchImpl: FetchLike,
): Promise<EmbedMeta | undefined> => {
  try {
    const response = await fetchImpl(`${YOUTUBE_ORIGIN}/oembed?format=json&url=${encodeURIComponent(youtubeUrl)}`, {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const data = await response.json() as YoutubeOembed
    const title = typeof data.title === 'string' ? data.title.trim() : ''
    if (!title) return undefined
    const authorName = typeof data.author_name === 'string' && data.author_name.trim() ? data.author_name.trim() : undefined
    const authorUrl = typeof data.author_url === 'string' ? rewriteYoutubeUrl(data.author_url, siteOrigin) : undefined
    const image = typeof data.thumbnail_url === 'string' && data.thumbnail_url ? data.thumbnail_url : undefined
    const imageWidth = typeof data.thumbnail_width === 'number' ? String(data.thumbnail_width) : undefined
    const imageHeight = typeof data.thumbnail_height === 'number' ? String(data.thumbnail_height) : undefined
    return {
      title,
      ...(image ? { image } : {}),
      ...(imageWidth ? { imageWidth } : {}),
      ...(imageHeight ? { imageHeight } : {}),
      ogType: 'video.other',
      twitterCard: 'summary_large_image',
      ...(authorName ? { authorName } : {}),
      ...(authorUrl ? { authorUrl } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Serves FTube-branded Discord metadata for `Discordbot` on YouTube content routes (falling back to a
 * canonical `302` redirect if metadata lookup fails) and handles `/__oembed`, while passing browsers through.
 */
export const handleEmbedRequest = async (
  request: Request,
  next: () => Promise<Response>,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  const url = new URL(request.url)

  if (url.pathname === '/__oembed') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
    return handleOembedRequest(url)
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return next()
  if (!isDiscordBot(request.headers.get('user-agent'))) return next()
  const target = youtubeEmbedRedirect(url)
  if (!target) return next()

  const meta = (await fetchYoutubeHeadMeta(target, url.origin, fetchImpl))
    ?? (await fetchYoutubeOembedMeta(target, url.origin, fetchImpl))
  if (meta) {
    const html = renderEmbedHtml(meta, url)
    // `no-store` is mandatory: Cloudflare CDN does not vary cached responses by User-Agent on Free/Pro plans.
    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        vary: 'User-Agent',
      },
    })
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': 'no-store',
      vary: 'User-Agent',
    },
  })
}

/** Cloudflare Pages middleware entrypoint for Discord embed handling and `/__oembed`. */
export const onRequest = ({ request, next }: PagesContext): Promise<Response> =>
  handleEmbedRequest(request, next)
