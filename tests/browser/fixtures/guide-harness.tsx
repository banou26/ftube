import { render } from 'preact'
import { Client, fetchExchange, Provider } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { Guide } from '../../../src/components/guide'
import { ChannelLiveRedirect } from '../../../src/routes/channel-live'

type HarnessSession = 'signed-in' | 'signed-out' | 'pending'

const answer = (operationName: string, signedIn: boolean) => {
  if (operationName === 'Session') return { session: { signedIn, name: signedIn ? 'Viewer' : null, avatar: null, handle: signedIn ? '@viewer' : null, accounts: [] } }
  if (operationName === 'GuideSubscriptions') return { subscribedChannels: [] }
  return null
}

const mount = (session: HarnessSession) => {
  const host = document.createElement('div')
  host.setAttribute('data-guide-harness', session)
  document.body.append(host)
  const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
    if (session === 'pending' && operationName === 'Session') return new Promise<Response>(() => {})
    return new Response(JSON.stringify({ data: answer(operationName, session === 'signed-in') }), { headers: { 'content-type': 'application/json' } })
  }
  const client = new Client({ url: '/guide-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  render(<Provider value={client}><Guide variant='expanded' /></Provider>, host)
}

// served by the dev server and imported from a spec, to render the expanded guide for a fixed session
export const mountGuide = (signedIn: boolean) => mount(signedIn ? 'signed-in' : 'signed-out')

// the Session answer never comes, as on a cold load before the session probe returns
export const mountPendingGuide = () => mount('pending')

export type GuideSubscriptionFixture = {
  id: string
  name: string
  avatar?: string | null
  isLive?: boolean
  liveVideoId?: string | null
  hasNewContent?: boolean
}

export const mountGuideWithSubscriptions = (channels: GuideSubscriptionFixture[]) => {
  document.documentElement.dataset.engine = 'ready'
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-guide-harness]').forEach(node => node.remove())
  const host = document.createElement('div')
  host.setAttribute('data-guide-harness', 'subscriptions')
  document.body.append(host)
  const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
    if (operationName === 'Session') {
      return new Response(
        JSON.stringify({ data: { session: { signedIn: true, name: 'Viewer', avatar: null, handle: '@viewer', accounts: [] } } }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    if (operationName === 'GuideSubscriptions') {
      return new Response(
        JSON.stringify({
          data: {
            subscribedChannels: channels.map((ch) => ({
              id: ch.id,
              name: ch.name,
              avatar: ch.avatar ?? null,
              isLive: ch.isLive ?? null,
              liveVideoId: ch.liveVideoId ?? null,
              hasNewContent: ch.hasNewContent ?? null,
            })),
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } })
  }
  const client = new Client({ url: '/guide-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  render(<Provider value={client}><Guide variant='expanded' /></Provider>, host)
}

export const mountChannelLiveRedirect = (id: string, base: string, liveVideoId: string | null) => {
  document.documentElement.dataset.engine = 'ready'
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-guide-harness]').forEach(node => node.remove())
  history.replaceState(null, '', `${base}/live`)
  const host = document.createElement('div')
  host.setAttribute('data-guide-harness', 'live-redirect')
  document.body.append(host)
  const fetchAnswer = async () =>
    new Response(JSON.stringify({ data: { channelLiveVideo: liveVideoId } }), { headers: { 'content-type': 'application/json' } })
  const client = new Client({ url: '/guide-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  render(<Provider value={client}><ChannelLiveRedirect id={id} base={base} /></Provider>, host)
}

export const mountGuideRoute = (variant: 'expanded' | 'mini', path: string) => {
  document.documentElement.dataset.engine = 'ready'
  const app = document.getElementById('app')
  if (app) app.hidden = true
  document.querySelectorAll('[data-guide-harness]').forEach(node => node.remove())
  const { hook, searchHook } = memoryLocation({ path })
  const host = document.createElement('div')
  host.setAttribute('data-guide-harness', `route-${variant}`)
  document.body.append(host)
  const fetchAnswer = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
    return new Response(JSON.stringify({ data: answer(operationName, true) }), { headers: { 'content-type': 'application/json' } })
  }
  const client = new Client({ url: '/guide-harness', exchanges: [fetchExchange], fetch: fetchAnswer, preferGetMethod: false })
  render(
    <Router hook={hook} searchHook={searchHook}>
      <Provider value={client}>
        <Guide variant={variant} />
      </Provider>
    </Router>,
    host,
  )
}
