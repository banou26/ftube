import { describe, expect, it } from 'vite-plus/test'

import { parseRydCommentPage, rydCommentsUrl, rydRepliesUrl } from '../../src/ryd-comments'

describe('Return YouTube Dislike discussion comments', () => {
  it('builds comment and reply URLs with sort and cursor', () => {
    expect(rydCommentsUrl('3iRFdxH-yS0', 'top')).toBe(
      'https://returnyoutubedislikeapi.com/api/discussion/videos/3iRFdxH-yS0/comments?sort=top',
    )
    expect(rydCommentsUrl('3iRFdxH-yS0', 'new', 'abc+1')).toBe(
      'https://returnyoutubedislikeapi.com/api/discussion/videos/3iRFdxH-yS0/comments?sort=new&cursor=abc%2B1',
    )
    expect(rydRepliesUrl('root-1')).toBe(
      'https://returnyoutubedislikeapi.com/api/discussion/comments/root-1/replies',
    )
    expect(rydRepliesUrl('root-1', 'c2')).toBe(
      'https://returnyoutubedislikeapi.com/api/discussion/comments/root-1/replies?cursor=c2',
    )
  })

  it('normalizes valid comments, deleted placeholders, and ignores malformed items', () => {
    const page = parseRydCommentPage({
      items: [
        {
          id: 'c1',
          author: { id: 'u1', nickname: 'Alice' },
          text: 'Still talking here',
          createdAt: '2026-10-01T12:00:00Z',
          editedAt: '2026-10-02T12:00:00Z',
          deleted: false,
          hidden: false,
          likes: 12,
          dislikes: 3,
          replyCount: 2,
        },
        {
          id: 'c2',
          author: null,
          text: 'secret',
          deleted: true,
          likes: -5,
          dislikes: 0,
          replyCount: 0,
        },
        { id: '', text: 'no id' },
      ],
      nextCursor: 'page-2',
    })
    expect(page).toEqual({
      items: [
        {
          id: 'c1',
          authorName: 'Alice',
          text: 'Still talking here',
          createdAt: '2026-10-01T12:00:00Z',
          edited: true,
          deleted: false,
          likes: 12,
          dislikes: 3,
          replyCount: 2,
        },
        {
          id: 'c2',
          authorName: 'Deleted',
          text: '[deleted]',
          createdAt: undefined,
          edited: false,
          deleted: true,
          likes: 0,
          dislikes: 0,
          replyCount: 0,
        },
      ],
      nextCursor: 'page-2',
    })
  })

  it('returns an empty page on non-discussion responses such as { likes, dislikes }', () => {
    expect(parseRydCommentPage({ likes: 0, dislikes: 0 })).toEqual({ items: [], nextCursor: undefined })
    expect(parseRydCommentPage(null)).toEqual({ items: [], nextCursor: undefined })
  })
})
