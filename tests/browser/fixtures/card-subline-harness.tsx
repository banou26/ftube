import type { VideoCardData } from '../../../src/components/video-card'

import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { VideoCard } from '../../../src/components/video-card'

const CARDS: VideoCardData[] = [
  {
    id: 'single-line-ref',
    title: 'Exploring The Great Pyramid (as a lifelong pyramid fan)',
    durationSeconds: 1180,
    viewCount: '40K',
    viewCountIcon: true,
    publishedText: '7h ago',
    metaDelimiter: ' ',
    channel: { id: 'UC-wirtual', name: 'WirtualTV', isVerified: true },
  },
  {
    id: 'single-line-long',
    title: 'Long Channel Name And Metadata Must Ellipsize Cleanly',
    durationSeconds: 640,
    viewCount: '1.2M views',
    publishedText: '11 months ago',
    channel: {
      id: 'UC-long',
      name: 'Super Long Creator Channel Name That Must Ellipsize Cleanly',
      isVerified: true,
    },
  },
  {
    id: 'single-line-collab',
    title: 'Collaboration Channels Single Line Subline Test',
    durationSeconds: 920,
    viewCount: '84K views',
    publishedText: '3 days ago',
    byline: [
      { text: 'Creator Alpha', isVerified: true },
      { text: ' and ' },
      { text: 'Creator Beta' },
    ],
    collaborators: [
      { id: 'UC-alpha', name: 'Creator Alpha' },
      { id: 'UC-beta', name: 'Creator Beta' },
    ],
  },
]

export const mountCardSublineHarness = () => {
  document.getElementById('app')!.hidden = true
  document.querySelectorAll('[data-card-subline-harness]').forEach(el => el.remove())

  const host = document.createElement('div')
  host.setAttribute('data-card-subline-harness', '')
  host.style.padding = '24px'
  host.style.display = 'grid'
  host.style.gridTemplateColumns = '360px 280px 320px'
  host.style.gap = '16px'
  document.body.append(host)

  const client = new Client({
    url: '/card-subline-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })

  render(
    <Provider value={client}>
      {CARDS.map(video => <VideoCard key={video.id} video={video} />)}
    </Provider>,
    host,
  )
}
