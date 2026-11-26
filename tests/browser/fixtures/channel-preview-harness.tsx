import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { ChannelPreviewCard } from '../../../src/components/channel-preview'

const thumb = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`)}`

const LONG_DESCRIPTION = [
  'Making videos about science, engineering, and experiments around the world.',
  'New episodes every week exploring physics, math, and space.',
  'Business & sponsorships: contact@example.com, thank you for watching and subscribing!',
  'Extra fourth line that must remain completely hidden below the two-line clamp.',
].join(' ')

export const mountChannelPreview = () => {
  document.querySelector('[data-channel-preview-harness]')?.remove()
  document.querySelector('[data-channel-preview]')?.remove()

  const host = document.createElement('div')
  host.setAttribute('data-channel-preview-harness', 'true')
  document.body.append(host)

  const anchor = document.createElement('button')
  anchor.type = 'button'
  anchor.textContent = 'Channel anchor'
  anchor.style.position = 'fixed'
  anchor.style.left = '16px'
  anchor.style.top = '40px'
  host.append(anchor)

  const cardMount = document.createElement('div')
  host.append(cardMount)

  const fetchAnswer = async () => new Response(JSON.stringify({
    data: {
      channel: {
        channel: {
          id: 'UCpreview1',
          name: 'Science Channel',
          avatar: thumb('#2255aa'),
          handle: '@science',
          subscriberCountText: '1.2M subscribers',
          videoCountText: '420 videos',
          banner: null,
          description: LONG_DESCRIPTION,
          isVerified: true,
          isVerifiedArtist: false,
        },
        videos: {
          items: [
            { id: 'v1', title: 'First video title', thumbnail: thumb('#cc3333'), durationSeconds: 615, viewCount: '1M', publishedText: '2 days ago' },
            { id: 'v2', title: 'Second video title', thumbnail: thumb('#33aa55'), durationSeconds: 320, viewCount: '500K', publishedText: '1 week ago' },
            { id: 'v3', title: 'Third video title', thumbnail: thumb('#aa55cc'), durationSeconds: 185, viewCount: '200K', publishedText: '2 weeks ago' },
          ],
        },
      },
    },
  }), { headers: { 'content-type': 'application/json' } })

  const client = new Client({
    url: '/channel-preview-harness',
    exchanges: [fetchExchange],
    fetch: fetchAnswer,
    preferGetMethod: false,
  })

  render(
    <Provider value={client}>
      <ChannelPreviewCard
        channel={{ id: 'UCpreview1', name: 'Science Channel' }}
        anchor={anchor}
        onPointerEnter={() => {}}
        onPointerLeave={() => {}}
        onNavigate={(event: MouseEvent) => event.preventDefault()}
      />
    </Provider>,
    cardMount,
  )
}
