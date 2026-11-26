import type { PostCardData } from '../../../src/components/post-card'

import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { PostCard } from '../../../src/components/post-card'

const svgDataUrl = (fill: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${fill}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="48">${label}</text></svg>`)}`

export const SINGLE_IMAGE_URL = svgDataUrl('#1e40af', 'Single Full Size')
export const MULTI_IMAGE_URLS = [
  svgDataUrl('#b91c1c', 'Slide One'),
  svgDataUrl('#047857', 'Slide Two'),
  svgDataUrl('#7e22ce', 'Slide Three'),
] as const

export const mountPostCardHarness = (variant: 'single' | 'multi' | 'members') => {
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-post-card-harness]').forEach(node => node.remove())

  const client = new Client({
    url: '/post-card-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: {} }), { headers: { 'content-type': 'application/json' } }),
  })

  const post: PostCardData = variant === 'single'
    ? {
        id: 'post-single-1',
        text: 'Check out this photo',
        publishedText: '2 hours ago',
        attachedImage: SINGLE_IMAGE_URL,
        author: { id: 'UC-post', name: 'Photo Creator' },
      }
    : variant === 'multi'
      ? {
          id: 'post-multi-1',
          text: 'Gallery post',
          publishedText: '5 hours ago',
          attachedImages: [...MULTI_IMAGE_URLS],
          author: { id: 'UC-post', name: 'Gallery Creator' },
        }
      : {
          id: 'post-members-1',
          text: 'Exclusive perks post',
          publishedText: '19 hours ago',
          author: { id: 'UC-post', name: 'Member Creator' },
        }

  const host = document.createElement('div')
  host.setAttribute('data-post-card-harness', variant)
  host.style.maxWidth = '64rem'
  host.style.margin = '2.4rem auto'
  document.body.append(host)
  render(
    <Provider value={client}>
      <PostCard post={post} readMore={false} />
    </Provider>,
    host,
  )
}
