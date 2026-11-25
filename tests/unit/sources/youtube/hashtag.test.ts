import { describe, expect, it } from 'vite-plus/test'

import type { YoutubeClient } from '../../../../src/sources/youtube'

import { createYoutubeSource } from '../../../../src/sources/youtube'
import { base64Bytes, encodeHashtagParams, protoField } from '../../../../src/sources/youtube/protobuf'

const fakeBrowseClient = (
  handler: (args: { browseId?: string, params?: string }) => unknown,
): YoutubeClient => ({
  session: { logged_in: false, context: { client: { hl: 'en', gl: 'US' } } },
  actions: {
    execute: async (_endpoint: string, args: unknown) => handler((args ?? {}) as { browseId?: string, params?: string }),
  },
} as unknown as YoutubeClient)

describe('encodeHashtagParams', () => {
  it('encodes ALL and SHORTS FEhashtag params matching live YouTube tokens', () => {
    expect(encodeHashtagParams('asmr', 'ALL')).toBe('6gUKCgRhc21yEAAYAQ%3D%3D')
    expect(encodeHashtagParams('asmr', 'SHORTS')).toBe('6gUKCgRhc21yEAAYAw%3D%3D')
    const jp = base64Bytes(encodeHashtagParams('アニメ', 'ALL'))
    expect(new TextDecoder().decode(protoField(jp, [93, 1]) as Uint8Array)).toBe('アニメ')
    expect(protoField(jp, [93, 2])).toBe(0)
    expect(protoField(jp, [93, 3])).toBe(1)
  })
})

describe('youtube hashtag feed', () => {
  it('normalizes mixed-case tags, parses PageHeader and tabs, and pages continuations via actions_memo', async () => {
    const calls: { browseId?: string, params?: string }[] = []
    const client = fakeBrowseClient((args) => {
      calls.push(args)
      return {
        header: {
          item: () => ({
            type: 'PageHeader',
            page_title: '#asmr',
            content: {
              metadata: {
                metadata_rows: [{ metadata_parts: [{ text: { text: '44M videos • 3.9M channels' } }] }],
              },
            },
          }),
        },
        contents_memo: new Map<string, unknown[]>([
          ['Tab', [
            { endpoint: { metadata: { url: '/hashtag/asmr' } } },
            { endpoint: { metadata: { url: '/hashtag/asmr/shorts' } } },
          ]],
          ['Video', [{ video_id: 'v1', title: { text: 'First ASMR' } }]],
          ['ContinuationItem', [{
            endpoint: {
              call: async () => ({
                on_response_received_actions_memo: new Map<string, unknown[]>([
                  ['Video', [{ video_id: 'v2', title: { text: 'Second ASMR' } }]],
                ]),
              }),
            },
          }]],
        ]),
      }
    })

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const page1 = await source.hashtag('  #ASMR  ')
    expect(calls[0]).toMatchObject({ browseId: 'FEhashtag', params: encodeHashtagParams('asmr', 'ALL') })
    expect(page1).toMatchObject({
      tag: 'asmr',
      title: '#asmr',
      stats: '44M videos • 3.9M channels',
      tab: 'ALL',
      availableTabs: ['ALL', 'SHORTS'],
    })
    expect(page1.items.map(item => item.id)).toEqual(['v1'])
    expect(page1.cursor).toBeTruthy()

    const page2 = await source.hashtag('asmr', 'ALL', page1.cursor)
    expect(page2).toMatchObject({
      tag: 'asmr',
      title: '#asmr',
      stats: '44M videos • 3.9M channels',
      tab: 'ALL',
      availableTabs: ['ALL', 'SHORTS'],
    })
    expect(page2.items.map(item => item.id)).toEqual(['v2'])
    expect(page2.cursor).toBeUndefined()
  })

  it('supports HashtagHeader and SHORTS tab with endpoints_memo continuation fallback', async () => {
    const client = fakeBrowseClient(() => ({
      header: {
        item: () => ({
          type: 'HashtagHeader',
          hashtag: { text: '#music' },
          hashtag_info: { text: '203M videos' },
        }),
      },
      contents_memo: new Map<string, unknown[]>([
        ['Video', [{ video_id: 'ignored-on-shorts', title: { text: 'Should skip' } }]],
        ['ShortsLockupView', [{
          on_tap_endpoint: { payload: { videoId: 's1' } },
          overlay_metadata: { primary_text: { text: 'Short 1' }, secondary_text: { text: '10K views' } },
        }]],
        ['ContinuationItem', [{
          endpoint: {
            call: async () => ({
              on_response_received_endpoints_memo: new Map<string, unknown[]>([
                ['ShortsLockupView', [{
                  on_tap_endpoint: { payload: { videoId: 's2' } },
                  overlay_metadata: { primary_text: { text: 'Short 2' } },
                }]],
              ]),
            }),
          },
        }]],
      ]),
    }))

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const first = await source.hashtag('Music', 'SHORTS')
    expect(first).toMatchObject({
      tag: 'music',
      title: '#music',
      stats: '203M videos',
      tab: 'SHORTS',
      availableTabs: ['ALL', 'SHORTS'],
    })
    expect(first.items.map(item => item.id)).toEqual(['s1'])
    const second = await source.hashtag('Music', 'SHORTS', first.cursor)
    expect(second.items.map(item => item.id)).toEqual(['s2'])
  })

  it('returns an empty page without hitting the network when the tag is blank', async () => {
    let called = false
    const client = fakeBrowseClient(() => {
      called = true
      return {}
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.hashtag('   #  ')).resolves.toEqual({
      tag: '',
      title: '#',
      tab: 'ALL',
      availableTabs: ['ALL'],
      items: [],
    })
    expect(called).toBe(false)
  })
})
