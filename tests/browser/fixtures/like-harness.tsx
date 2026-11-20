import type { LikeStatus } from '../../../src/generated/graphql'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { Client, fetchExchange, gql, Provider, useQuery } from 'urql'

import { LikePill } from '../../../src/components/like-pill'
import { createCache } from '../../../src/graphql'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

// a rating asks here, named by the status it sends, and fails as the answer a spec routes here does
const RATE_PATH = '/like-harness/'

const WATCH = gql`
  query LikeHarness($id: ID!) {
    watch(id: $id) { id likeStatus likeCountText }
  }
`

const Watched = () => {
  const [{ data }] = useQuery({ query: WATCH, variables: { id: 'video-0' } })
  const watch = data?.watch as { likeStatus: LikeStatus, likeCountText: string } | undefined
  return watch ? <LikePill videoId='video-0' likeStatus={watch.likeStatus} likeCountText={watch.likeCountText} /> : null
}

/**
 * Renders the watch page's Like and Dislike for a signed-in viewer, on a video that opens rated `likeStatus`, through
 * the app's own schema, resolvers and cache. Served by the dev server and imported from a spec.
 */
export const mountLikes = (likeStatus: LikeStatus) => {
  const host = document.createElement('div')
  host.setAttribute('data-like-harness', likeStatus)
  host.style.cssText = 'position: fixed; inset: 6rem auto auto 2rem; z-index: 10000; padding: 2.4rem; background: var(--bg-base)'
  document.body.append(host)
  const source = {
    session: async () => ({ signedIn: true, name: 'Viewer', accounts: [] }),
    watch: async (id: string) => ({ id, likeStatus, likeCountText: '12K' }),
    rateVideo: async (id: string, status: LikeStatus) => {
      const response = await fetch(`${RATE_PATH}${status}`)
      if (!response.ok) throw new Error(`Request to https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false&alt=json failed with status code ${response.status}`)
      return { id, likeStatus: status }
    },
  } as unknown as SourceApi
  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://like-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })
  // useSession reads only once the engine is up
  document.documentElement.dataset.engine = 'ready'
  render(<Provider value={client}><Watched /></Provider>, host)
}
