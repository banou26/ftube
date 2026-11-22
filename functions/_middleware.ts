type PagesContext = {
  request: Request
  next: () => Promise<Response>
}

const YOUTUBE_ORIGIN = 'https://www.youtube.com'

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
 * Issues a `302 Found` redirect to real YouTube exclusively when Discord's crawler (`Discordbot`) requests a
 * YouTube content route, so Discord renders its native YouTube embed while browsers continue opening FTube.
 */
export const onRequest = async ({ request, next }: PagesContext): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next()
  if (!isDiscordBot(request.headers.get('user-agent'))) return next()
  const target = youtubeEmbedRedirect(new URL(request.url))
  if (!target) return next()
  // `no-store` is mandatory: Cloudflare CDN does not vary cached responses by User-Agent on Free/Pro plans.
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': 'no-store',
      vary: 'User-Agent',
    },
  })
}
