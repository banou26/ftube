import type { TheaterMode } from '../../../src/player/theater'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createCache } from '../../../src/graphql'
import { setTheater as setPlayerTheater } from '../../../src/player/session'
import { coerceTheaterMode } from '../../../src/player/theater'
import WatchPage from '../../../src/routes/watch'
import { updateSettings } from '../../../src/settings'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type TheaterBiggerHarnessOptions = {
  videoId?: string
  theater?: TheaterMode | boolean
  preserveSetting?: boolean
}

const makeRelatedVideo = (id: string, title: string) => ({
  id,
  title,
  durationSeconds: 320,
  viewCount: '84K views',
  publishedText: '3 days ago',
  badges: [],
  channel: { id: `UC-${id}`, name: 'Stream Archives', isVerified: true },
})

export const mountTheaterBiggerHarness = (options: TheaterBiggerHarnessOptions = {}) => {
  const videoId = options.videoId ?? 'theater-bigger-1'
  if (!options.preserveSetting) {
    const initialTheater = options.theater === undefined ? 'fullscreen' : coerceTheaterMode(options.theater)
    setPlayerTheater(updateSettings({ theater: initialTheater }).theater)
  }

  // Keep #app alive at /privacy (for <Global> styles and <PersistentPlayer />),
  // using an isolated memory router so history never navigates #app to /watch.
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-theater-bigger-harness]').forEach(node => node.remove())
  const { hook, searchHook } = memoryLocation({ path: `/watch?v=${videoId}`, static: true })

  const descriptionText = Array.from(
    { length: 18 },
    (_, i) => `Paragraph ${i + 1}: Extended video details rendered below the fold in theater mode.`,
  ).join('\n\n')

  const source = {
    session: async () => ({ signedIn: false, accounts: [] }),
    watch: async (id: string) => ({
      id,
      title: `Harness Video ${id}`,
      isLive: false,
      commentsHidden: false,
      commentCountText: '2 comments',
      viewCountText: '12,345 views',
      shortViewCountText: '12K views',
      publishedDateText: 'Nov 1, 2026',
      relativeDateText: '3 weeks ago',
      hashtags: [],
      likeCountText: '1.2K',
      description: descriptionText,
      descriptionRuns: [{ text: descriptionText }],
      channel: {
        id: 'UC-harness',
        name: 'Harness Creator Studio',
        subscriberCountText: '240K subscribers',
        isSubscribed: false,
        notificationLevel: 'PERSONALIZED',
        isVerified: true,
      },
      related: Array.from({ length: 14 }, (_, i) => makeRelatedVideo(`rel-${i + 1}`, `Suggested Video ${i + 1}`)),
      relatedChips: [],
      chapters: [],
      cardTeasers: [],
    }),
    comments: async () => ({
      items: [
        {
          id: 'comment-1',
          author: { id: 'UC-viewer-1', name: 'Viewer One', handle: '@viewer1' },
          text: 'First harness comment below the fold.',
          runs: [{ text: 'First harness comment below the fold.' }],
          publishedText: '1 day ago',
          likeCountText: '4',
          replyCount: 0,
          isPinned: false,
          isCreator: false,
        },
        {
          id: 'comment-2',
          author: { id: 'UC-viewer-2', name: 'Viewer Two', handle: '@viewer2' },
          text: 'Second harness comment below the fold.',
          runs: [{ text: 'Second harness comment below the fold.' }],
          publishedText: '2 days ago',
          likeCountText: '1',
          replyCount: 0,
          isPinned: false,
          isCreator: false,
        },
      ],
    }),
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: `http://theater-bigger-harness-${videoId}.local/graphql`,
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  const host = document.createElement('div')
  host.setAttribute('data-theater-bigger-harness', videoId)
  host.style.paddingTop = 'var(--header-height, 5.6rem)'
  document.body.append(host)
  render(
    <Router hook={hook} searchHook={searchHook}>
      <Provider value={client}>
        <WatchPage />
      </Provider>
    </Router>,
    host,
  )
}

export const setTheaterMode = (theater: TheaterMode | boolean) => {
  setPlayerTheater(updateSettings({ theater: coerceTheaterMode(theater) }).theater)
}
