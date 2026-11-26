import { render } from 'preact'
import { useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'
import { Parser, YT } from 'youtubei.js'

import { Comments } from '../../../src/components/comments'
import { ReadMore } from '../../../src/components/read-more'
import { ChannelHome } from '../../../src/routes/channel-home'
import { createYoutubeSource } from '../../../src/sources/youtube'
import topics from '../../unit/fixtures/topic-channels.json'

const host = (name: string) => {
  const element = document.createElement('div')
  element.setAttribute('data-posts-harness', name)
  document.body.append(element)
  return element
}

// served by the dev server and imported from posts.spec.ts, to render News's Home from its recorded Hong Kong answer,
// whose one row is of posts
export const mountTopicHome = async () => {
  const source = createYoutubeSource({
    fetch: globalThis.fetch,
    createClient: async () => ({
      getChannel: async () => new YT.Channel(undefined as never, Parser.parseResponse(topics.newsHongKong as never), true),
    }) as never,
  })
  const page = await source.channel('UCYfdidRxbB8Qhf0Nx7ioOYw')
  render(<ChannelHome home={page.home as never} />, host('topic-home'))
}

// a ReadMore whose parent draws it again, with the same text in new children, each time the returned function is called
export const mountReadMore = () => {
  let drawAgain = () => {}
  const Parent = () => {
    const [, setCount] = useState(0)
    drawAgain = () => setCount(count => count + 1)
    return (
      <ReadMore text='a post'>
        <span>a post</span>
      </ReadMore>
    )
  }
  render(<Parent />, host('read-more'))
  return () => drawAgain()
}

export const mountSignedInPostComments = () => {
  const sent: { postId: string, channelId: string, text: string }[] = []
  const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { operationName, variables } = JSON.parse(init?.body as string) as {
      operationName: string
      variables?: Record<string, string>
    }
    if (operationName === 'Session') {
      return new Response(JSON.stringify({
        data: { session: { signedIn: true, name: 'Viewer', avatar: null, handle: '@viewer', accounts: [] } },
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'PostComments') {
      return new Response(JSON.stringify({
        data: {
          postComments: {
            items: [{
              id: 'c1',
              text: 'Existing comment',
              runs: [],
              publishedText: '1 hour ago',
              likeCountText: '3',
              replyCount: 0,
              repliesCursor: null,
              actionsToken: null,
              isPinned: false,
              pinnedText: null,
              isHearted: false,
              heartAvatar: null,
              heartTooltip: null,
              isCreator: false,
              isMember: false,
              isLiked: false,
              isDisliked: false,
              author: { id: 'UC2', name: 'Alice', avatar: null, isVerified: false, isVerifiedArtist: false },
            }],
            cursor: null,
            disabled: false,
            countText: '1 Comment',
          },
        },
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (operationName === 'CommentOnPost') {
      sent.push({ postId: variables?.postId ?? '', channelId: variables?.channelId ?? '', text: variables?.text ?? '' })
      return new Response(JSON.stringify({ data: { commentOnPost: true } }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } })
  }
  const client = new Client({ url: '/posts-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  const container = host('signed-in-post-comments')
  render(<Provider value={client}><Comments post={{ id: 'UgkxPost1', channelId: 'UCauthor1' }} /></Provider>, container)
  return () => sent
}
