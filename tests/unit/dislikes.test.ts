import { describe, expect, it } from 'vite-plus/test'

import { computeLikeDislikeRatio, parseDislikes, parseVotes } from '../../src/dislikes'

// returnyoutubedislikeapi.com/votes answers, recorded 2026-11-09
const RICK_ROLL = { id: 'dQw4w9WgXcQ', dateCreated: '2022-04-09T22:01:38.222268Z', likes: 19496469, rawDislikes: 6720, rawLikes: 130554, dislikes: 521680, rating: 4.895758593863998, viewCount: 1835084823, deleted: false }
const NEVER_SEEN = { id: 'AAAAAAAAAAA', dateCreated: '2026-11-09T12:24:15.3920309Z', likes: 0, rawDislikes: null, rawLikes: null, dislikes: 0, rating: 0, viewCount: 0, deleted: false }
const BAD_ID = { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'Bad Request', status: 400, traceId: '00-0427dc1581afff9bf6b33e649d845d58-bfd56a5f6bda1875-00' }

describe('a Return YouTube Dislike answer', () => {
  it('gives its dislike count', () => {
    expect(parseDislikes(RICK_ROLL)).toBe(521680)
    expect(parseVotes(RICK_ROLL)).toEqual({ likes: 19496469, dislikes: 521680 })
  })

  it('gives nothing for a video the service has never seen', () => {
    expect(parseDislikes(NEVER_SEEN)).toBeUndefined()
    expect(parseVotes(NEVER_SEEN)).toBeUndefined()
  })

  it('gives 0 for a liked video nobody disliked', () => {
    expect(parseDislikes({ ...RICK_ROLL, rawDislikes: 0, dislikes: 0 })).toBe(0)
    expect(parseVotes({ ...RICK_ROLL, rawDislikes: 0, dislikes: 0 })).toEqual({ likes: 19496469, dislikes: 0 })
  })

  it('gives nothing for an error or a malformed answer', () => {
    expect(parseDislikes(BAD_ID)).toBeUndefined()
    expect(parseDislikes(null)).toBeUndefined()
    expect(parseDislikes('521680')).toBeUndefined()
    expect(parseDislikes({ ...RICK_ROLL, dislikes: '521680' })).toBeUndefined()
    expect(parseDislikes({ ...RICK_ROLL, dislikes: -1 })).toBeUndefined()
    expect(parseDislikes({ ...RICK_ROLL, dislikes: Number.NaN })).toBeUndefined()
    expect(parseVotes(BAD_ID)).toBeUndefined()
  })
})

describe('computeLikeDislikeRatio', () => {
  it('computes exact percentage and formatted tooltip from YouTube likeCount and RYD dislikes', () => {
    const ratio = computeLikeDislikeRatio({ likeCount: 64571, rydLikes: 60000, dislikes: 2095 })
    expect(ratio).toBeDefined()
    expect(ratio!.likes).toBe(64571)
    expect(ratio!.dislikes).toBe(2095)
    expect(ratio!.likePercent).toBeCloseTo(96.857468, 4)
    expect(ratio!.tooltip).toBe('64,571 / 2,095')
  })

  it('prefers YouTube likeCount over RYD likes and falls back to rydLikes when likeCount is absent', () => {
    expect(computeLikeDislikeRatio({ likeCount: null, rydLikes: 800, dislikes: 200 })).toEqual({
      likes: 800,
      dislikes: 200,
      likePercent: 80,
      tooltip: '800 / 200',
    })
  })

  it('handles 100% likes and 0% likes boundaries cleanly', () => {
    expect(computeLikeDislikeRatio({ likeCount: 150, dislikes: 0 })).toEqual({
      likes: 150,
      dislikes: 0,
      likePercent: 100,
      tooltip: '150 / 0',
    })
    expect(computeLikeDislikeRatio({ likeCount: 0, dislikes: 12 })).toEqual({
      likes: 0,
      dislikes: 12,
      likePercent: 0,
      tooltip: '0 / 12',
    })
  })

  it('returns undefined when dislikes are missing, both like counts are missing, or total is 0', () => {
    expect(computeLikeDislikeRatio({ likeCount: 100, dislikes: undefined })).toBeUndefined()
    expect(computeLikeDislikeRatio({ likeCount: null, rydLikes: undefined, dislikes: 5 })).toBeUndefined()
    expect(computeLikeDislikeRatio({ likeCount: 0, dislikes: 0 })).toBeUndefined()
    expect(computeLikeDislikeRatio({ likeCount: Number.NaN, rydLikes: -1, dislikes: 5 })).toBeUndefined()
  })
})
