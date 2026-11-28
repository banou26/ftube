import { useEffect, useState } from 'preact/hooks'

import { getSettings, subscribeSettings } from './settings'

export type VoteCounts = { likes?: number, dislikes: number }

export type LikeDislikeRatio = {
  likes: number
  dislikes: number
  likePercent: number
  tooltip: string
}

const exactNumber = new Intl.NumberFormat('en-US')

const nonNegativeCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/**
 * Like and dislike counts from a Return YouTube Dislike `/votes` answer, or undefined when the answer has none to
 * show.
 */
export const parseVotes = (answer: unknown): VoteCounts | undefined => {
  if (!answer || typeof answer !== 'object') return undefined
  const { likes, dislikes } = answer as { likes?: unknown, dislikes?: unknown }
  const validDislikes = nonNegativeCount(dislikes)
  if (validDislikes === undefined) return undefined
  const validLikes = nonNegativeCount(likes)
  // an id it has never seen gets a 200 with every count at 0, not the 404 its docs promise (measured 2026-11-09)
  if (validDislikes === 0 && likes === 0) return undefined
  return validLikes === undefined ? { dislikes: validDislikes } : { likes: validLikes, dislikes: validDislikes }
}

/** The dislike count in a Return YouTube Dislike `/votes` answer, or undefined when the answer has none to show. */
export const parseDislikes = (answer: unknown) => parseVotes(answer)?.dislikes

/**
 * Computes the percentage of likes and exact hover breakdown for the Like/Dislike ratio bar.
 * Prefers YouTube's own `likeCount` when present and falls back to Return YouTube Dislike's estimate.
 */
export const computeLikeDislikeRatio = (
  { likeCount, rydLikes, dislikes }: { likeCount?: number | null, rydLikes?: number, dislikes?: number },
): LikeDislikeRatio | undefined => {
  const validDislikes = nonNegativeCount(dislikes)
  if (validDislikes === undefined) return undefined
  const rawLikes = nonNegativeCount(likeCount) ?? nonNegativeCount(rydLikes)
  if (rawLikes === undefined) return undefined
  const likes = Math.trunc(rawLikes)
  const truncatedDislikes = Math.trunc(validDislikes)
  const total = likes + truncatedDislikes
  if (total <= 0) return undefined
  const likePercent = Math.min(100, Math.max(0, (likes / total) * 100))
  return {
    likes,
    dislikes: truncatedDislikes,
    likePercent,
    tooltip: `${exactNumber.format(likes)} / ${exactNumber.format(truncatedDislikes)}`,
  }
}

/**
 * Vote counts from Return YouTube Dislike, fetched once per video while the Show dislike counts setting is on.
 * Undefined while off, until the answer arrives, and when the lookup has no counts to show.
 */
export const useVotes = (videoId: string): VoteCounts | undefined => {
  const [enabled, setEnabled] = useState(() => getSettings().showDislikes)
  const [answer, setAnswer] = useState<{ videoId: string, votes?: VoteCounts }>()

  useEffect(() => subscribeSettings(settings => setEnabled(settings.showDislikes)), [])

  useEffect(() => {
    if (!enabled || videoId === '') return
    const controller = new AbortController()
    fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : undefined))
      .then(body => setAnswer({ videoId, votes: parseVotes(body) }))
      .catch(() => {})
    return () => controller.abort()
  }, [videoId, enabled])

  return enabled && answer?.videoId === videoId ? answer.votes : undefined
}

/**
 * The video's dislike count from Return YouTube Dislike, fetched by the browser itself while the Show dislike counts
 * setting is on. Undefined while off, until the answer arrives, and for good when the lookup fails.
 */
export const useDislikes = (videoId: string) => useVotes(videoId)?.dislikes
