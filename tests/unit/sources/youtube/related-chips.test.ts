import { describe, expect, it } from 'vite-plus/test'
import { Parser } from 'youtubei.js'

import { createYoutubeSource } from '../../../../src/sources/youtube'
import { extractRelatedChips } from '../../../../src/sources/youtube/normalize'

const watchNextWithSecondary = (...secondaryResults: unknown[]) =>
  Parser.parseResponse({
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [{ videoPrimaryInfoRenderer: { title: { simpleText: 'Main Video' } } }],
          },
        },
        secondaryResults: {
          secondaryResults: {
            results: secondaryResults,
          },
        },
      },
    },
  } as never)

describe('extractRelatedChips', () => {
  it('reads RelatedChipCloud wrapping ChipCloud directly in secondary_results', () => {
    const parsed = watchNextWithSecondary({
      relatedChipCloudRenderer: {
        content: {
          chipCloudRenderer: {
            chips: [
              { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
              {
                chipCloudChipRenderer: {
                  text: { simpleText: 'Music' },
                  isSelected: false,
                  navigationEndpoint: { continuationCommand: { token: 'TOK_MUSIC' } },
                },
              },
              {
                chipCloudChipRenderer: {
                  text: { simpleText: 'Live' },
                  isSelected: false,
                  navigationEndpoint: { continuationCommand: { token: 'TOK_LIVE' } },
                },
              },
            ],
          },
        },
      },
    })
    const watchNext = parsed.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as { secondary_results?: unknown[] }
    const chips = extractRelatedChips(watchNext?.secondary_results, parsed.contents_memo as unknown as Map<string, unknown[]>)
    expect(chips.map(chip => ({ label: chip.label, selected: chip.selected, hasEndpoint: Boolean(chip.endpoint) }))).toEqual([
      { label: 'All', selected: true, hasEndpoint: false },
      { label: 'Music', selected: false, hasEndpoint: true },
      { label: 'Live', selected: false, hasEndpoint: true },
    ])
  })

  it('reads RelatedChipCloud in ItemSection header while ignoring ItemSection video contents', () => {
    const parsed = watchNextWithSecondary({
      itemSectionRenderer: {
        header: {
          relatedChipCloudRenderer: {
            content: {
              chipCloudRenderer: {
                chips: [
                  { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
                  {
                    chipCloudChipRenderer: {
                      text: { simpleText: 'From channel' },
                      isSelected: false,
                      navigationEndpoint: { continuationCommand: { token: 'TOK_CHAN' } },
                    },
                  },
                ],
              },
            },
          },
        },
        contents: [
          { compactVideoRenderer: { videoId: 'rel1', title: { simpleText: 'Not a chip' } } },
        ],
      },
    })
    const watchNext = parsed.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as { secondary_results?: unknown[] }
    const chips = extractRelatedChips(watchNext?.secondary_results, parsed.contents_memo as unknown as Map<string, unknown[]>)
    expect(chips.map(chip => chip.label)).toEqual(['All', 'From channel'])
  })

  it('reads ChipBarView/ChipView and FeedFilterChipBar variants and falls back to contents_memo', () => {
    const chipBarParsed = watchNextWithSecondary({
      itemSectionRenderer: {
        header: {
          chipBarViewModel: {
            chips: [
              { chipViewModel: { text: 'All', selected: true, tapCommand: { innertubeCommand: { continuationCommand: { token: 'TOK_ALL' } } } } },
              { chipViewModel: { text: 'Coding', selected: false, tapCommand: { innertubeCommand: { continuationCommand: { token: 'TOK_CODE' } } } } },
            ],
          },
        },
        contents: [],
      },
    })
    const chipBarNext = chipBarParsed.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as { secondary_results?: unknown[] }
    expect(extractRelatedChips(chipBarNext?.secondary_results).map(chip => chip.label)).toEqual(['All', 'Coding'])

    const filterBarParsed = Parser.parseResponse({
      contents: {
        twoColumnWatchNextResults: {
          secondaryResults: {
            secondaryResults: {
              results: [{
                itemSectionRenderer: {
                  header: {
                    feedFilterChipBarRenderer: {
                      contents: [
                        { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
                        { chipCloudChipRenderer: { text: { simpleText: 'Related' }, navigationEndpoint: { continuationCommand: { token: 'TOK_REL' } } } },
                      ],
                    },
                  },
                  contents: [],
                },
              }],
            },
          },
        },
      },
    } as never)
    expect(extractRelatedChips([], filterBarParsed.contents_memo as unknown as Map<string, unknown[]>).map(chip => chip.label))
      .toEqual(['All', 'Related'])
  })

  it('skips non-selected chips without endpoints and suppresses rails with fewer than 2 functional chips', () => {
    const withDeadChip = watchNextWithSecondary({
      relatedChipCloudRenderer: {
        content: {
          chipCloudRenderer: {
            chips: [
              { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
              { chipCloudChipRenderer: { text: { simpleText: 'Broken' }, isSelected: false } },
              {
                chipCloudChipRenderer: {
                  text: { simpleText: 'Gaming' },
                  isSelected: false,
                  navigationEndpoint: { continuationCommand: { token: 'TOK_GAME' } },
                },
              },
            ],
          },
        },
      },
    })
    const secWithDead = (withDeadChip.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as { secondary_results?: unknown[] })?.secondary_results
    expect(extractRelatedChips(secWithDead).map(chip => chip.label)).toEqual(['All', 'Gaming'])

    const onlyOneChip = watchNextWithSecondary({
      relatedChipCloudRenderer: {
        content: {
          chipCloudRenderer: {
            chips: [
              { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
              { chipCloudChipRenderer: { text: { simpleText: 'Dead' }, isSelected: false } },
            ],
          },
        },
      },
    })
    const secSingle = (onlyOneChip.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as { secondary_results?: unknown[] })?.secondary_results
    expect(extractRelatedChips(secSingle)).toEqual([])
  })
})

describe('youtube watch relatedChips integration', () => {
  it('registers chip continuations without relatedCursor and resolves endpoints and actions memos with pagination', async () => {
    const nextResponse = watchNextWithSecondary({
      relatedChipCloudRenderer: {
        content: {
          chipCloudRenderer: {
            chips: [
              { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
              {
                chipCloudChipRenderer: {
                  text: { simpleText: 'Music' },
                  isSelected: false,
                  navigationEndpoint: { continuationCommand: { token: 'TOK_CHIP_MUSIC' } },
                },
              },
              {
                chipCloudChipRenderer: {
                  text: { simpleText: 'Coding' },
                  isSelected: false,
                  navigationEndpoint: { continuationCommand: { token: 'TOK_CHIP_CODING' } },
                },
              },
            ],
          },
        },
      },
    })

    const fakeActions = {
      execute: async (endpoint: string, payload?: { continuation?: string }) => {
        if (endpoint === '/next') return nextResponse
        if (endpoint === '/browse' || payload?.continuation === 'TOK_CHIP_MUSIC') {
          return Parser.parseResponse({
            onResponseReceivedEndpoints: [{
              reloadContinuationItemsCommand: {
                continuationItems: [
                  { compactVideoRenderer: { videoId: 'music-1', title: { simpleText: 'Music Track 1' }, lengthText: { simpleText: '3:20' } } },
                  { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOK_CHIP_MUSIC_2' } } } },
                ],
              },
            }],
          } as never)
        }
        return Parser.parseResponse({
          onResponseReceivedActions: [{
            appendContinuationItemsAction: {
              continuationItems: [
                { compactVideoRenderer: { videoId: 'music-2', title: { simpleText: 'Music Track 2' }, lengthText: { simpleText: '4:05' } } },
              ],
            },
          }],
        } as never)
      },
    }

    const actionsCalls: (string | undefined)[] = []
    const wrappedActions = {
      execute: async (endpoint: string, payload?: { continuation?: string }) => {
        actionsCalls.push(payload?.continuation ?? endpoint)
        if (payload?.continuation === 'TOK_CHIP_MUSIC') {
          return Parser.parseResponse({
            onResponseReceivedEndpoints: [{
              reloadContinuationItemsCommand: {
                continuationItems: [
                  { compactVideoRenderer: { videoId: 'music-1', title: { simpleText: 'Music Track 1' }, lengthText: { simpleText: '3:20' } } },
                  { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOK_CHIP_MUSIC_2' } } } },
                ],
              },
            }],
          } as never)
        }
        if (payload?.continuation === 'TOK_CHIP_MUSIC_2') {
          return Parser.parseResponse({
            onResponseReceivedActions: [{
              appendContinuationItemsAction: {
                continuationItems: [
                  { compactVideoRenderer: { videoId: 'music-2', title: { simpleText: 'Music Track 2' }, lengthText: { simpleText: '4:05' } } },
                ],
              },
            }],
          } as never)
        }
        if (payload?.continuation === 'TOK_CHIP_CODING') {
          return Parser.parseResponse({
            onResponseReceivedActions: [{
              reloadContinuationItemsCommand: {
                continuationItems: [
                  { compactVideoRenderer: { videoId: 'code-1', title: { simpleText: 'Code Talk 1' }, lengthText: { simpleText: '8:10' } } },
                ],
              },
            }],
          } as never)
        }
        return nextResponse
      },
    }
    void fakeActions

    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({ actions: wrappedActions }) as never,
    })

    const meta = await source.watch('vid-abc')
    expect(meta?.relatedCursor).toBeUndefined()
    expect(meta?.relatedChips.map(chip => ({ label: chip.label, selected: chip.selected, emptyId: chip.id === '' }))).toEqual([
      { label: 'All', selected: true, emptyId: true },
      { label: 'Music', selected: false, emptyId: false },
      { label: 'Coding', selected: false, emptyId: false },
    ])

    const musicChip = meta!.relatedChips.find(chip => chip.label === 'Music')!
    const page1 = await source.relatedVideos(musicChip.id)
    expect(page1.items.map(video => video.id)).toEqual(['music-1'])
    expect(page1.cursor).toBeTruthy()

    const page2 = await source.relatedVideos(page1.cursor!)
    expect(page2.items.map(video => video.id)).toEqual(['music-2'])
    expect(page2.cursor).toBeUndefined()

    const codingChip = meta!.relatedChips.find(chip => chip.label === 'Coding')!
    const codingPage = await source.relatedVideos(codingChip.id)
    expect(codingPage.items.map(video => video.id)).toEqual(['code-1'])
    expect(actionsCalls).toContain('TOK_CHIP_MUSIC')
    expect(actionsCalls).toContain('TOK_CHIP_MUSIC_2')
    expect(actionsCalls).toContain('TOK_CHIP_CODING')
  })

  it('isolates related chip cursors from videoContinuations so opening many watch videos does not evict subscriptions cursors', async () => {
    const actions = {
      execute: async (endpoint: string, payload?: { videoId?: string }) => {
        if (endpoint === '/next') {
          const id = payload?.videoId ?? 'v'
          return watchNextWithSecondary({
            relatedChipCloudRenderer: {
              content: {
                chipCloudRenderer: {
                  chips: [
                    { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } },
                    ...Array.from({ length: 8 }, (_, idx) => ({
                      chipCloudChipRenderer: {
                        text: { simpleText: `Topic ${idx}` },
                        isSelected: false,
                        navigationEndpoint: { continuationCommand: { token: `TOK_${id}_${idx}` } },
                      },
                    })),
                  ],
                },
              },
            },
          })
        }
        return {}
      },
    }
    const client = {
      session: { logged_in: true },
      actions,
      getSubscriptionsFeed: async () => ({
        videos: [],
        has_continuation: true,
        getContinuation: async () => ({
          videos: [],
          has_continuation: false,
          page_contents: [],
        }),
      }),
    }

    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client as never,
    })

    const subPage = await source.subscriptions()
    expect(subPage.cursor).toBeTruthy()

    // Register 80 chip cursors across 10 watch calls (> 64 CONTINUATION_LIMIT in one map).
    for (let i = 0; i < 10; i++) {
      const meta = await source.watch(`vid-${i}`)
      expect(meta?.relatedChips).toHaveLength(9)
    }

    // Earlier subscriptions cursor in videoContinuations must survive intact.
    await expect(source.subscriptions(subPage.cursor)).resolves.toMatchObject({ items: [] })
    await expect(source.relatedVideos(subPage.cursor!)).rejects.toThrow('not a watch sidebar')
  })
})
