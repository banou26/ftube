import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { ShortsTile } from '../../../src/components/shorts-tile'
import { VideoCard } from '../../../src/components/video-card'
import { ChannelHome } from '../../../src/routes/channel-home'

type ChannelHomeData = Parameters<typeof ChannelHome>[0]['home']

const THUMB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1e293b"/></svg>',
)}`

const SHORT_THUMB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="270"><rect width="180" height="270" fill="#312e81"/></svg>',
)}`

const channel = { id: 'channel-a11y', name: 'A11y Channel', avatar: THUMB }

/**
 * Mounts VideoCard, ShortsTile, and ChannelHome FeaturedVideo in an offline tree
 * so assistive-technology preview controls can be verified across all card surfaces.
 */
export const mountPreviewA11yHarness = () => {
  document.getElementById('app')!.hidden = true
  document.querySelector('[data-preview-a11y-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-preview-a11y-harness', '')
  host.style.maxWidth = '960px'
  host.style.padding = '24px'
  document.body.append(host)

  const video = {
    id: 'a11ycard001',
    title: 'Accessible Card Video',
    thumbnail: THUMB,
    durationSeconds: 180,
    inlinePlayerParams: 'params-a11y-card',
    viewCount: '42K',
    publishedText: '1d ago',
    channel,
    badges: [],
  }

  const short = {
    id: 'a11yshort01',
    title: 'Accessible Short Tile',
    thumbnail: SHORT_THUMB,
    durationSeconds: 45,
    inlinePlayerParams: 'params-a11y-short',
    viewCount: '18K',
    isShort: true,
    shortsSequence: 'a11y-seq',
    badges: [],
  }

  const home: ChannelHomeData = {
    __typename: 'ChannelHome',
    featured: {
      __typename: 'Video',
      id: 'a11yfeat001',
      title: 'Accessible Featured Video',
      description: 'Featured video summary',
      descriptionRuns: [{ __typename: 'TextRun', text: 'Featured video summary', url: null, videoId: null, startSeconds: null, browseId: null }],
      thumbnail: THUMB,
      thumbnailSrcset: null,
      durationSeconds: 180,
      isLive: false,
      isMusic: false,
      isUpcoming: false,
      inlinePlayerParams: 'params-a11y-featured',
      viewCount: '90K',
      publishedText: '3d ago',
    },
    shelves: [],
  }

  const client = new Client({
    url: '/preview-a11y-harness',
    exchanges: [fetchExchange],
    fetch: async () => new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } }),
    preferGetMethod: false,
  })

  render(
    <Provider value={client}>
      <section data-surface='video-card' style={{ width: '320px', marginBottom: '24px' }}>
        <VideoCard video={video} />
      </section>
      <section data-surface='shorts-tile' style={{ width: '200px', marginBottom: '24px' }}>
        <ShortsTile short={short} />
      </section>
      <section data-surface='channel-featured'>
        <ChannelHome home={home} />
      </section>
    </Provider>,
    host,
  )
}
