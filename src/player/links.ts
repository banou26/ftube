import { safeDecode } from '../components/format'

/**
 * This app's link to a video, in youtube.com's /watch form: `list` keeps the playlist, and `t` is the start in whole
 * seconds, left out at 0 as youtube.com's "Copy video URL at current time" leaves it out.
 */
export const watchLink = (origin: string, videoId: string, { list, t }: { list?: string, t?: number } = {}) => {
  const params = new URLSearchParams({ v: videoId })
  if (list) params.set('list', list)
  const seconds = Math.floor(t ?? 0)
  if (seconds > 0) params.set('t', String(seconds))
  return `${origin}/watch?${params}`
}

/** This app's path to a Short, which opens it in the Shorts player. */
export const shortsHrefFor = (videoId: string) => `/shorts/${encodeURIComponent(videoId)}`

/** This app's link to a Short, in the /shorts form youtube.com's Share copies for one, so it opens in the Shorts player. */
export const shortsLink = (origin: string, videoId: string) => `${origin}${shortsHrefFor(videoId)}`

const attribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The embed code youtube.com's player menu copies (measured 2026-11-10): its own /embed page, since this app has no
 * page another site can embed, at the player's size as shown, with no playlist and no start.
 */
export const embedCode = ({ videoId, title, width, height }: { videoId: string, title?: string, width: number, height: number }) =>
  `<iframe width="${Math.round(width)}" height="${Math.round(height)}" src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}"`
  + (title ? ` title="${attribute(title)}"` : '')
  + ' frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"'
  + ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>'

/**
 * Canonical destination for `/embed/:id`, `/watch/:id`, and `/live/:id` redirects:
 * maps `/embed/videoseries?list=` to `/playlist`, otherwise preserves `v`, `list`,
 * positive 1-based `index` (when `list` is present), and `t` (falling back to `start`).
 */
export const watchRedirectHref = (videoId: string, search: string): string => {
  const query = new URLSearchParams(search)
  const list = query.get('list')
  if (videoId === 'videoseries' && list) return `/playlist?${new URLSearchParams({ list })}`
  const watch = new URLSearchParams({ v: safeDecode(videoId) })
  if (list) {
    watch.set('list', list)
    const rawIndex = query.get('index')?.trim()
    if (rawIndex && /^\d+$/.test(rawIndex)) {
      const index = Number(rawIndex)
      if (Number.isSafeInteger(index) && index > 0) watch.set('index', String(index))
    }
  }
  const at = query.get('t') ?? query.get('start')
  if (at) watch.set('t', at)
  return `/watch?${watch}`
}
