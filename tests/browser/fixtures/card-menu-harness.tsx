import type { VideoCardData } from '../../../src/components/video-card'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'

import { clearDismissed, isDismissedVideo, useDismissed } from '../../../src/components/dismissed-videos'
import { QueuePanel } from '../../../src/components/queue-panel'
import { VideoGrid } from '../../../src/components/video-grid'
import { createCache } from '../../../src/graphql'
import { clearQueue } from '../../../src/player/queue'
import { closePlayer } from '../../../src/player/session'
import { useSession } from '../../../src/session'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

declare global {
  interface Window {
    __cardMenuHarness?: {
      feedbackTokens: string[]
      cleanup: () => void
    }
  }
}

const VIDEOS: VideoCardData[] = [
  {
    id: 'vid-alpha-1',
    title: 'Alpha Video',
    durationSeconds: 185,
    channel: { id: 'UCalpha11111111111111111', name: 'Alpha Channel' },
    notInterestedToken: 'tok-ni-alpha',
    dontRecommendToken: 'tok-dr-alpha',
  },
  {
    id: 'vid-alpha-2',
    title: 'Alpha Followup',
    durationSeconds: 240,
    channel: { id: 'UCalpha11111111111111111', name: 'Alpha Channel' },
    notInterestedToken: 'tok-ni-alpha-2',
    dontRecommendToken: 'tok-dr-alpha-2',
  },
  {
    id: 'vid-beta-1',
    title: 'Beta Video',
    durationSeconds: 300,
    channel: { id: 'UCbeta222222222222222222', name: 'Beta Channel' },
    notInterestedToken: 'tok-ni-beta',
    dontRecommendToken: 'tok-dr-beta',
  },
]

const FeedHarness = () => {
  const { ready } = useSession()
  const dismissed = useDismissed()
  const visible = VIDEOS.filter(video => !isDismissedVideo(dismissed, video))
  if (!ready) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 36rem', gap: '2.4rem', padding: '2.4rem' }}>
      <VideoGrid videos={visible} recommendable />
      <QueuePanel />
    </div>
  )
}

export const mountCardMenuHarness = () => {
  clearQueue()
  clearDismissed()
  closePlayer()

  const state = {
    feedbackTokens: [] as string[],
    cleanup: () => {
      closePlayer()
      clearQueue()
      clearDismissed()
      render(null, host)
      host.remove()
    },
  }
  window.__cardMenuHarness = state

  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    submitFeedback: async (token: string) => {
      state.feedbackTokens.push(token)
      return true
    },
  } as unknown as SourceApi

  const host = document.createElement('div')
  host.setAttribute('data-card-menu-harness', 'true')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto'
  document.body.append(host)

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://card-menu-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  document.documentElement.dataset.engine = 'ready'
  render(
    <Provider value={client}>
      <FeedHarness />
    </Provider>,
    host,
  )
}
