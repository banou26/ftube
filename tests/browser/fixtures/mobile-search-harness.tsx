import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import SearchPage from '../../../src/routes/search'

const thumb = (fill: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`)}`

const longVideo = (id: string, title: string, overrides?: Record<string, unknown>) => ({
  __typename: 'Video',
  id,
  title,
  inlinePlayerParams: null,
  description: 'ContinuousTokenWithoutBreaks https://science.nasa.gov/missions/james-webb-space-telescope/observations/deepfield/longpath',
  descriptionSnippet: 'ContinuousTokenWithoutBreaks https://science.nasa.gov/missions/james-webb-space-telescope/observations/deepfield/longpath',
  snippetRuns: null,
  thumbnail: thumb('#1e293b'),
  thumbnailSrcset: null,
  durationSeconds: 745,
  isMusic: null,
  viewCount: '1.2M',
  publishedText: '2w ago',
  isLive: null,
  isUpcoming: null,
  isShort: null,
  progressPercent: null,
  badges: ['4K', 'Subtitles'],
  channel: {
    __typename: 'Channel',
    id: `UC${id}`,
    name: 'VeryLongUnbrokenAstronomicalObservatoryChannelName',
    avatar: null,
    isVerified: true,
    isVerifiedArtist: null,
  },
  chapters: null,
  chaptersTitle: null,
  byline: null,
  collaborators: null,
  ...overrides,
})

const chapters = Array.from({ length: 7 }, (_, index) => ({
  __typename: 'Chapter',
  title: `Chapter ${index + 1} UnbrokenTelemetrySegmentToken_${index + 1}`,
  startSeconds: index * 90,
  thumbnail: thumb('#334155'),
}))

const mixedAnswer = {
  search: {
    __typename: 'SearchPage',
    results: [
      longVideo(
        'nasaLong001',
        'I Saw Jupiter 822 Million KM Away!#telescope#astronomy#science#planets#space#stargazing#nasa#jupiter',
        {
          chapters,
          chaptersTitle: '7 chapters in this video with ContinuousTitleTokenThatShouldWrapCleanly',
          badges: ['4K', 'SuperLongContinuousBadgeTokenForMobileOverflowCheck'],
        },
      ),
      {
        __typename: 'Channel',
        id: 'UCnasaLongChan1',
        name: 'NationalAeronauticsAndSpaceAdministrationContinuousChannelName',
        avatar: thumb('#0f172a'),
        handle: '@VeryLongUnbrokenChannelHandleForMobileSearchLayoutTesting',
        subscriberCountText: '12.4M subscribers',
        videoCountText: '8,420 videos',
        description: 'Official observations and streams https://www.nasa.gov/multimedia/nasatv/index.html#continuouspath',
        isSubscribed: false,
        notificationLevel: null,
        isVerified: true,
        isVerifiedArtist: null,
      },
      {
        __typename: 'Playlist',
        id: 'PLnasaLong01',
        title: 'DeepSpaceTelescopeDocumentaryCollection#nasa#jwst#hubble#astrophysics#cosmos',
        thumbnail: thumb('#1d4ed8'),
        videoCountText: '24 videos',
        channel: { __typename: 'Channel', id: 'UCnasaLongChan1', name: 'NASA Science Live' },
      },
      {
        __typename: 'SearchCard',
        cardChannel: {
          __typename: 'Channel',
          id: 'UCnasaCard01',
          name: 'DeepSpaceObservatoryContinuousChannelTitle',
          avatar: thumb('#0369a1'),
          handle: '@DeepSpaceObservatoryHandleContinuous',
          subscriberCountText: '4.2M subscribers',
          videoCountText: '1,234 videos',
          description: 'High resolution telemetry from deep space missions and continuous streams.',
          isSubscribed: false,
          notificationLevel: null,
          isVerified: true,
          isVerifiedArtist: null,
        },
        mix: {
          __typename: 'SearchMix',
          id: 'RDnasaMix01',
          title: 'DeepSpaceMixWithoutBreaks#nasa#jwst#telemetry#astronomy',
          thumbnail: thumb('#0284c7'),
          videoId: 'nasaCardV01',
        },
        videos: Array.from({ length: 5 }, (_, index) =>
          longVideo(`nasaCardV0${index + 1}`, `Observatory Highlight ${index + 1}#space#nasa#jwst#deepfield`)),
      },
      {
        __typename: 'SearchShelf',
        title: 'People also search for',
        subtitle: 'Space exploration and telescope captures#astronomy#cosmos',
        horizontal: true,
        collapsedCount: null,
        videos: Array.from({ length: 6 }, (_, index) =>
          longVideo(`nasaCar0${index + 1}`, `Carousel Capture ${index + 1}#telescope#astrophotography#jupiter#saturn`)),
        shorts: [],
      },
      {
        __typename: 'SearchShelf',
        title: 'Shorts',
        subtitle: null,
        horizontal: false,
        collapsedCount: null,
        videos: [],
        shorts: Array.from({ length: 8 }, (_, index) => ({
          __typename: 'Video',
          id: `nasaShort0${index + 1}`,
          title: `Jupiter Storm #${index + 1} #astronomy#science#planets#space#stargazing`,
          inlinePlayerParams: null,
          thumbnail: thumb('#312e81'),
          animatedThumbnail: null,
          viewCount: `${210 + index * 13}K views`,
          shortsSequence: 'nasa-shorts-seq',
        })),
      },
    ],
    topic: null,
    refinements: [
      'nasa live stream',
      'jameswebbspacetelescopeinfrareddeepfieldobservation2026',
      'artemis mission update',
    ],
    cursor: null,
    unwatchedChip: true,
  },
}

const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
  const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
  return new Response(
    JSON.stringify({ data: operationName === 'SearchResults' ? mixedAnswer : null }),
    { headers: { 'content-type': 'application/json' } },
  )
}

/** Mounts SearchPage against deterministic mixed results for mobile viewport overflow tests. */
export const mountMobileSearch = () => {
  document.getElementById('app')!.hidden = true
  document.querySelector('[data-mobile-search-harness]')?.remove()
  const host = document.createElement('div')
  host.setAttribute('data-mobile-search-harness', '')
  document.body.append(host)
  const client = new Client({
    url: '/mobile-search-harness',
    exchanges: [fetchExchange],
    fetch: fetchAnswer,
    preferGetMethod: false,
  })
  render(
    <Provider value={client}>
      <SearchPage />
    </Provider>,
    host,
  )
}
