import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { VideoCard } from '../../../src/components/video-card'
import { VideoCardCompact } from '../../../src/components/video-card-compact'

const channel = { id: 'UC-appearance-test', name: 'Appearance Channel' }

const resumeVideo = {
  id: 'resume-card-0',
  title: 'Watched halfway video',
  durationSeconds: 600,
  viewCount: '12K views',
  publishedText: '1d ago',
  progressPercent: 45,
  channel,
}

export const mountAppearanceCards = () => {
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelector('[data-appearance-cards-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-appearance-cards-harness', '')
  host.style.width = '760px'
  document.body.append(host)
  const client = new Client({
    url: '/appearance-cards-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })
  render(
    <Provider value={client}>
      <div data-card='grid' style={{ width: '360px' }}>
        <VideoCard video={resumeVideo} variant='channel' />
      </div>
      <div data-card='compact' style={{ width: '400px' }}>
        <VideoCardCompact video={resumeVideo} />
      </div>
    </Provider>,
    host,
  )
}
