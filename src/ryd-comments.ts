export type RydCommentSort = 'top' | 'new'

export type RydComment = {
  id: string
  authorName: string
  text: string
  createdAt?: string
  edited: boolean
  deleted: boolean
  likes: number
  dislikes: number
  replyCount: number
}

export type RydCommentPage = {
  items: RydComment[]
  nextCursor?: string
}

const API_BASE = 'https://returnyoutubedislikeapi.com/api/discussion'

const safeCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

const parseComment = (value: unknown): RydComment | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as {
    id?: unknown
    author?: { nickname?: unknown } | null
    text?: unknown
    createdAt?: unknown
    editedAt?: unknown
    deleted?: unknown
    hidden?: unknown
    likes?: unknown
    dislikes?: unknown
    replyCount?: unknown
  }
  if (typeof raw.id !== 'string' || !raw.id) return undefined
  const deleted = raw.deleted === true || raw.hidden === true
  const text = deleted ? '[deleted]' : typeof raw.text === 'string' ? raw.text : ''
  if (!deleted && !text) return undefined
  const nickname = typeof raw.author?.nickname === 'string' && raw.author.nickname.trim()
    ? raw.author.nickname.trim()
    : deleted ? 'Deleted' : 'Anonymous'
  return {
    id: raw.id,
    authorName: nickname,
    text,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : undefined,
    edited: typeof raw.editedAt === 'string' && raw.editedAt.length > 0,
    deleted,
    likes: safeCount(raw.likes),
    dislikes: safeCount(raw.dislikes),
    replyCount: safeCount(raw.replyCount),
  }
}

/** Parses a Return YouTube Dislike discussion comments or replies page. */
export const parseRydCommentPage = (answer: unknown): RydCommentPage => {
  if (!answer || typeof answer !== 'object') return { items: [] }
  const { items, nextCursor } = answer as { items?: unknown, nextCursor?: unknown }
  const parsed = Array.isArray(items)
    ? items.map(parseComment).filter((item): item is RydComment => item !== undefined)
    : []
  return {
    items: parsed,
    nextCursor: typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : undefined,
  }
}

export const rydCommentsUrl = (videoId: string, sort: RydCommentSort = 'top', cursor?: string) => {
  const params = new URLSearchParams({ sort })
  if (cursor) params.set('cursor', cursor)
  return `${API_BASE}/videos/${encodeURIComponent(videoId)}/comments?${params}`
}

export const rydRepliesUrl = (rootId: string, cursor?: string) => {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return `${API_BASE}/comments/${encodeURIComponent(rootId)}/replies${suffix}`
}

/** Fetches Return YouTube Dislike discussion comments directly from the browser (no custom headers, no preflight). */
export const fetchRydComments = async (
  videoId: string,
  sort: RydCommentSort,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RydCommentPage | undefined> => {
  try {
    const response = await fetch(rydCommentsUrl(videoId, sort, cursor), { signal })
    if (!response.ok) return undefined
    return parseRydCommentPage(await response.json())
  } catch {
    return undefined
  }
}

/** Fetches replies to a Return YouTube Dislike discussion comment directly from the browser. */
export const fetchRydReplies = async (
  rootId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RydCommentPage | undefined> => {
  try {
    const response = await fetch(rydRepliesUrl(rootId, cursor), { signal })
    if (!response.ok) return undefined
    return parseRydCommentPage(await response.json())
  } catch {
    return undefined
  }
}
