import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { Comments } from '../../../src/components/comments'

const AVATAR_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#cc0000"/></svg>',
)

export const mountCommentsHarness = () => {
  document.documentElement.dataset.engine = 'ready'
  document.querySelector('[data-comments-harness]')?.remove()
  const container = document.createElement('div')
  container.setAttribute('data-comments-harness', 'true')
  container.style.maxWidth = '720px'
  container.style.padding = '16px'
  ;(document.querySelector('main') ?? document.body).prepend(container)

  const postedComments: string[] = []
  const postedReplies: { actionsToken: string, text: string }[] = []
  const subscribedState: Record<string, boolean> = { UC1: false, UC2: false, UCcreator: true }

  const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { operationName, variables } = JSON.parse(init?.body as string) as {
      operationName: string
      variables?: Record<string, unknown>
    }
    if (operationName === 'Session') {
      return new Response(JSON.stringify({
        data: { session: { signedIn: true, name: 'Viewer', avatar: null, handle: '@viewer', accounts: [] } },
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'Comments') {
      return new Response(JSON.stringify({
        data: {
          comments: {
            items: [
              {
                id: 'c1',
                text: 'Great track!',
                runs: [{ text: 'Great track!', url: null, videoId: null, startSeconds: null, browseId: null }],
                publishedText: '2 hours ago',
                likeCountText: '42',
                replyCount: 2,
                repliesCursor: 'replies-1',
                actionsToken: 'tok-1',
                isPinned: false,
                pinnedText: null,
                isHearted: true,
                heartAvatar: AVATAR_SVG,
                heartTooltip: 'Loved by Creator',
                isCreator: false,
                isMember: false,
                isLiked: false,
                isDisliked: false,
                author: { id: 'UC1', name: '@fan', avatar: AVATAR_SVG, isVerified: false, isVerifiedArtist: false },
              },
              {
                id: 'c2',
                text: 'Thanks for watching everyone',
                runs: [{ text: 'Thanks for watching everyone', url: null, videoId: null, startSeconds: null, browseId: null }],
                publishedText: '1 hour ago',
                likeCountText: '15',
                replyCount: 0,
                repliesCursor: null,
                actionsToken: 'tok-2',
                isPinned: true,
                pinnedText: 'Pinned by @Creator',
                isHearted: true,
                heartAvatar: null,
                heartTooltip: null,
                isCreator: true,
                isMember: false,
                isLiked: false,
                isDisliked: false,
                author: { id: 'UCcreator', name: 'Creator', avatar: AVATAR_SVG, isVerified: true, isVerifiedArtist: false },
              },
            ],
            cursor: null,
            disabled: false,
            countText: '2 Comments',
          },
        },
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'CommentReplies') {
      return new Response(JSON.stringify({
        data: {
          commentReplies: {
            items: [
              {
                id: 'r1',
                text: 'Totally agree',
                runs: [{ text: 'Totally agree', url: null, videoId: null, startSeconds: null, browseId: null }],
                publishedText: '1 hour ago',
                likeCountText: '5',
                isHearted: true,
                heartAvatar: AVATAR_SVG,
                heartTooltip: 'Loved by Creator',
                isCreator: false,
                isMember: false,
                author: { id: 'UC2', name: '@reply1', avatar: null, isVerified: false, isVerifiedArtist: false },
              },
              {
                id: 'r2',
                text: 'Glad you liked it',
                runs: [{ text: 'Glad you liked it', url: null, videoId: null, startSeconds: null, browseId: null }],
                publishedText: '30 minutes ago',
                likeCountText: null,
                isHearted: false,
                heartAvatar: null,
                heartTooltip: null,
                isCreator: true,
                isMember: false,
                author: { id: 'UCcreator', name: 'Creator', avatar: null, isVerified: false, isVerifiedArtist: false },
              },
            ],
            cursor: null,
          },
        },
      }), { headers: { 'content-type': 'application/json' } })
    }
    const str = (value: unknown) => typeof value === 'string' ? value : ''
    if (operationName === 'PostComment') {
      postedComments.push(str(variables?.text))
      return new Response(JSON.stringify({ data: { postComment: true } }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'ReplyToComment') {
      postedReplies.push({ actionsToken: str(variables?.actionsToken), text: str(variables?.text) })
      return new Response(JSON.stringify({ data: { replyToComment: true } }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'CommentProfileCard') {
      const id = str(variables?.id)
      const profiles: Record<string, {
        name: string
        avatar: string | null
        handle: string
        subscriberCountText: string
        videoCountText: string
        description: string
        joinedDateText: string
        isVerified: boolean
      }> = {
        UC1: {
          name: 'Fan Commenter',
          avatar: AVATAR_SVG,
          handle: '@fan',
          subscriberCountText: '52 subscribers',
          videoCountText: '4 videos',
          description: 'Music and teardown fan.',
          joinedDateText: 'Joined Mar 15, 2016',
          isVerified: false,
        },
        UC2: {
          name: 'Reply Author',
          avatar: null,
          handle: '@reply1',
          subscriberCountText: '12 subscribers',
          videoCountText: '2 videos',
          description: 'Replying in the thread.',
          joinedDateText: 'Joined Jan 4, 2020',
          isVerified: false,
        },
        UCcreator: {
          name: 'Creator',
          avatar: AVATAR_SVG,
          handle: '@Creator',
          subscriberCountText: '10K subscribers',
          videoCountText: '80 videos',
          description: 'Official channel.',
          joinedDateText: 'Joined May 1, 2014',
          isVerified: true,
        },
      }
      const profile = profiles[id] ?? profiles.UC1!
      return new Response(JSON.stringify({
        data: {
          channel: {
            channel: {
              id,
              name: profile.name,
              avatar: profile.avatar,
              handle: profile.handle,
              subscriberCountText: profile.subscriberCountText,
              videoCountText: profile.videoCountText,
              banner: null,
              description: profile.description,
              isSubscribed: subscribedState[id] ?? false,
              isVerified: profile.isVerified,
              isVerifiedArtist: false,
            },
            videos: { items: [] },
          },
          channelAbout: {
            joinedDateText: profile.joinedDateText,
          },
        },
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'SetSubscribed') {
      const channelId = str(variables?.channelId)
      const subscribed = Boolean(variables?.subscribed)
      subscribedState[channelId] = subscribed
      return new Response(JSON.stringify({
        data: { setSubscribed: { id: channelId, isSubscribed: subscribed } },
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } })
  }

  const client = new Client({
    url: '/comments-harness',
    exchanges: [fetchExchange],
    fetch: fetchAnswer,
    preferGetMethod: false,
  })
  render(<Provider value={client}><Comments videoId='test-video' /></Provider>, container)

  return {
    postedComments: () => postedComments,
    postedReplies: () => postedReplies,
  }
}
