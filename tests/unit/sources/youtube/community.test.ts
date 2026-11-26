import { describe, expect, it } from 'vite-plus/test'

import { createYoutubeSource } from '../../../../src/sources/youtube'
import {
  extractParsedPostActions,
  extractRawPostActions,
  normalizeRawCommunityPost,
  parseCommunityBrowseResponse,
  parseCommunityContinuationResponse,
} from '../../../../src/sources/youtube/community'

describe('YouTube community parser (APP-865)', () => {
  it('parses FEcommunity_page header, Top/Newest/Creator sort chips, posts, runs, images, polls, and actions', () => {
    const rawBrowse = {
      header: {
        pageHeaderRenderer: {
          pageTitle: 'yfj',
          content: {
            pageHeaderViewModel: {
              title: { dynamicTextViewModel: { text: { content: 'yfj’s Community' } } },
              image: {
                decoratedAvatarViewModel: {
                  avatar: {
                    avatarViewModel: {
                      image: { sources: [{ url: 'https://yt3.ggpht.com/avatar=s160', width: 160 }] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                selected: true,
                content: {
                  sectionListRenderer: {
                    header: {
                      feedFilterChipBarRenderer: {
                        contents: [
                          {
                            chipCloudChipRenderer: {
                              text: { simpleText: 'Top' },
                              isSelected: true,
                              navigationEndpoint: { continuationCommand: { token: 'token-top' } },
                            },
                          },
                          {
                            chipCloudChipRenderer: {
                              text: { simpleText: 'Newest' },
                              isSelected: false,
                              navigationEndpoint: { continuationCommand: { token: 'token-newest' } },
                            },
                          },
                          {
                            chipCloudChipRenderer: {
                              text: { simpleText: 'Creator posts' },
                              isSelected: false,
                              navigationEndpoint: { continuationCommand: { token: 'token-creator' } },
                            },
                          },
                        ],
                      },
                    },
                    contents: [
                      {
                        itemSectionRenderer: {
                          contents: [
                            {
                              backstagePostThreadRenderer: {
                                post: {
                                  backstagePostRenderer: {
                                    postId: 'UgkxPostOne',
                                    authorText: { runs: [{ text: 'yfj', navigationEndpoint: { browseEndpoint: { browseId: 'UC3qmkCVZfs_UqZxSrcNepqw' } } }] },
                                    authorEndpoint: { browseEndpoint: { browseId: 'UC3qmkCVZfs_UqZxSrcNepqw' } },
                                    authorThumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/a1=s88', width: 88 }] },
                                    showPostAuthorBackgroundHighlight: true,
                                    publishedTimeText: { runs: [{ text: '1 month ago' }] },
                                    contentText: {
                                      runs: [
                                        { text: 'Check out ' },
                                        { text: 'https://example.com', navigationEndpoint: { urlEndpoint: { url: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com' } } },
                                      ],
                                    },
                                    voteCount: { simpleText: '42' },
                                    voteStatus: 'LIKE',
                                    backstageAttachment: {
                                      pollRenderer: {
                                        totalVotes: { simpleText: '120 votes' },
                                        choices: [
                                          { text: { runs: [{ text: 'Option A' }] }, votePercentageIfNotSelected: { simpleText: '70%' } },
                                          { text: { runs: [{ text: 'Option B' }] }, votePercentageIfNotSelected: { simpleText: '30%' } },
                                        ],
                                      },
                                    },
                                    actionButtons: {
                                      commentActionButtonsRenderer: {
                                        likeButton: {
                                          toggleButtonRenderer: {
                                            isToggled: true,
                                            defaultServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_LIKE_1' } },
                                            toggledServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_UNLIKE_1' } },
                                          },
                                        },
                                        dislikeButton: {
                                          toggleButtonRenderer: {
                                            isToggled: false,
                                            defaultServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_DISLIKE_1' } },
                                            toggledServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_UNDISLIKE_1' } },
                                          },
                                        },
                                        replyButton: {
                                          buttonRenderer: {
                                            text: { simpleText: '5' },
                                            accessibilityData: { accessibilityData: { label: '5 comments' } },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                      {
                        continuationItemRenderer: {
                          continuationEndpoint: { continuationCommand: { token: 'next-page-token' } },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }

    const parsed = parseCommunityBrowseResponse(rawBrowse, 'UC3qmkCVZfs_UqZxSrcNepqw')
    expect(parsed.available).toBe(true)
    expect(parsed.title).toBe('yfj’s Community')
    expect(parsed.avatar).toBe('https://yt3.ggpht.com/avatar=s160')
    expect(parsed.sortChips).toEqual([
      { label: 'Top', selected: true, token: 'token-top' },
      { label: 'Newest', selected: false, token: 'token-newest' },
      { label: 'Creator posts', selected: false, token: 'token-creator' },
    ])
    expect(parsed.continuationToken).toBe('next-page-token')
    expect(parsed.posts).toHaveLength(1)

    const { post, actions } = parsed.posts[0]!
    expect(post).toMatchObject({
      id: 'UgkxPostOne',
      text: 'Check out https://example.com',
      publishedText: '1 month ago',
      voteCountText: '42',
      commentCountText: '5',
      commentCountLabel: '5 comments',
      likeStatus: 'LIKE',
      isCreator: true,
      author: { id: 'UC3qmkCVZfs_UqZxSrcNepqw', name: 'yfj', avatar: 'https://yt3.ggpht.com/a1=s88' },
      poll: {
        totalVotesText: '120 votes',
        choices: [
          { text: 'Option A', votePercentage: '70%' },
          { text: 'Option B', votePercentage: '30%' },
        ],
      },
    })
    expect(post.runs).toEqual([
      { text: 'Check out ' },
      { text: 'https://example.com', url: 'https://example.com/' },
    ])
    expect(actions).toEqual({
      like: 'ACT_LIKE_1',
      unlike: 'ACT_UNLIKE_1',
      dislike: 'ACT_DISLIKE_1',
      undislike: 'ACT_UNDISLIKE_1',
    })
  })

  it('detects unavailable FEcommunity_page responses cleanly', () => {
    const unavailable = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                selected: true,
                content: {
                  sectionListRenderer: {
                    contents: [
                      { itemSectionRenderer: { contents: [{ messageRenderer: { text: { runs: [{ text: "This Community isn't available" }] } } }] } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }
    const parsed = parseCommunityBrowseResponse(unavailable)
    expect(parsed.available).toBe(false)
    expect(parsed.posts).toEqual([])
  })

  it('parses reloadContinuationItemsCommand responses when switching to Newest sort', () => {
    const continuation = {
      onResponseReceivedEndpoints: [
        {
          reloadContinuationItemsCommand: {
            continuationItems: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      backstagePostThreadRenderer: {
                        post: {
                          backstagePostRenderer: {
                            postId: 'UgkxNewest',
                            authorText: { simpleText: 'FanUser' },
                            authorEndpoint: { browseEndpoint: { browseId: 'UCFan' } },
                            publishedTimeText: { simpleText: '2 hours ago' },
                            contentText: { simpleText: 'Newest post here' },
                            voteStatus: 'INDIFFERENT',
                          },
                        },
                      },
                    },
                  ],
                },
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: { continuationCommand: { token: 'newest-next' } },
                },
              },
            ],
          },
        },
      ],
    }

    const parsed = parseCommunityContinuationResponse(continuation, 'UCHost')
    expect(parsed.posts).toHaveLength(1)
    expect(parsed.posts[0]!.post).toMatchObject({
      id: 'UgkxNewest',
      text: 'Newest post here',
      isCreator: false,
      likeStatus: 'INDIFFERENT',
    })
    expect(parsed.continuationToken).toBe('newest-next')
  })

  it('parses multi-image and video attachments and extracts commandExecutor actions', () => {
    const rawPost = {
      postId: 'UgkxMulti',
      authorText: { simpleText: 'Creator' },
      authorEndpoint: { browseEndpoint: { browseId: 'UCCreator' } },
      contentText: { simpleText: 'Photos' },
      backstageAttachment: {
        postMultiImageRenderer: {
          images: [
            { backstageImageRenderer: { image: { thumbnails: [{ url: 'https://yt3.ggpht.com/1.jpg', width: 500 }] } } },
            { backstageImageRenderer: { image: { thumbnails: [{ url: 'https://yt3.ggpht.com/2.jpg', width: 500 }] } } },
          ],
        },
      },
      actionButtons: {
        commentActionButtonsRenderer: {
          likeButton: {
            toggleButtonRenderer: {
              defaultServiceEndpoint: {
                commandExecutorCommand: {
                  commands: [{ performCommentActionEndpoint: { action: 'EXEC_LIKE' } }],
                },
              },
            },
          },
        },
      },
    }
    const normalized = normalizeRawCommunityPost(rawPost, 'UCCreator')
    expect(normalized?.post.attachedImages).toEqual([
      'https://yt3.ggpht.com/1.jpg',
      'https://yt3.ggpht.com/2.jpg',
    ])
    expect(extractRawPostActions(rawPost)).toEqual({ like: 'EXEC_LIKE' })
    expect(extractParsedPostActions({
      action_buttons: {
        like_button: {
          endpoint: { payload: { action: 'PARSED_LIKE' } },
          toggled_endpoint: { payload: { action: 'PARSED_UNLIKE' } },
        },
      },
    })).toEqual({ like: 'PARSED_LIKE', unlike: 'PARSED_UNLIKE' })
  })

  it('does not infer isCreator from host fallback when authorEndpoint is absent', () => {
    const anonymous = normalizeRawCommunityPost({
      postId: 'UgkxNoAuthor',
      authorText: { simpleText: 'Anon' },
      contentText: { simpleText: 'Anonymous post' },
    }, 'UCHost')
    expect(anonymous?.post.isCreator).toBe(false)
  })
})

describe('createYoutubeSource community & ratePost (APP-865)', () => {
  it('switches sort via continuation token, reports unavailable channels, and toggles LIKE/DISLIKE with tracked state', async () => {
    const calls: { endpoint: string, args: unknown }[] = []
    const client = {
      session: { logged_in: true },
      resolveURL: async (url: string) => {
        if (url.endsWith('/@host')) return { payload: { browseId: 'UCHost' } }
        if (url.endsWith('/@host/community')) return { payload: { browseId: 'FEcommunity_page', params: 'pHost' } }
        return { payload: { browseId: 'FEcommunity_page', params: 'pEmpty' } }
      },
      actions: {
        execute: async (endpoint: string, args: unknown) => {
          calls.push({ endpoint, args })
          const req = args as { browseId?: string, params?: string, continuation?: string }
          if (endpoint === '/browse' && req.params === 'pEmpty') {
            return {
              data: {
                contents: {
                  twoColumnBrowseResultsRenderer: {
                    tabs: [{
                      tabRenderer: {
                        selected: true,
                        content: {
                          sectionListRenderer: {
                            contents: [{ itemSectionRenderer: { contents: [{ messageRenderer: { text: { simpleText: 'Unavailable' } } }] } }],
                          },
                        },
                      },
                    }],
                  },
                },
              },
            }
          }
          if (endpoint === '/browse' && req.continuation === 'sort-newest') {
            return {
              data: {
                onResponseReceivedEndpoints: [{
                  reloadContinuationItemsCommand: {
                    continuationItems: [{
                      itemSectionRenderer: {
                        contents: [{
                          backstagePostThreadRenderer: {
                            post: {
                              backstagePostRenderer: {
                                postId: 'UgkxSortNewest',
                                authorText: { simpleText: 'Host' },
                                authorEndpoint: { browseEndpoint: { browseId: 'UCHost' } },
                                contentText: { simpleText: 'Newest post' },
                                actionButtons: {
                                  commentActionButtonsRenderer: {
                                    likeButton: {
                                      toggleButtonRenderer: {
                                        defaultServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_LIKE' } },
                                        toggledServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_UNLIKE' } },
                                      },
                                    },
                                    dislikeButton: {
                                      toggleButtonRenderer: {
                                        defaultServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_DISLIKE' } },
                                        toggledServiceEndpoint: { performCommentActionEndpoint: { action: 'ACT_UNDISLIKE' } },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        }],
                      },
                    }],
                  },
                }],
              },
            }
          }
          if (endpoint === '/browse') {
            return {
              data: {
                header: { pageHeaderRenderer: { content: { pageHeaderViewModel: { title: { dynamicTextViewModel: { text: { content: 'Host Community' } } } } } } },
                contents: {
                  twoColumnBrowseResultsRenderer: {
                    tabs: [{
                      tabRenderer: {
                        selected: true,
                        content: {
                          sectionListRenderer: {
                            header: {
                              feedFilterChipBarRenderer: {
                                contents: [
                                  { chipCloudChipRenderer: { text: { simpleText: 'Top' }, isSelected: true } },
                                  { chipCloudChipRenderer: { text: { simpleText: 'Newest' }, isSelected: false, navigationEndpoint: { continuationCommand: { token: 'sort-newest' } } } },
                                ],
                              },
                            },
                            contents: [],
                          },
                        },
                      },
                    }],
                  },
                },
              },
            }
          }
          return {}
        },
      },
    }

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client as never })

    const unavail = await source.channelCommunity('@other')
    expect(unavail.available).toBe(false)
    expect(unavail.posts.items).toEqual([])

    const sorted = await source.channelCommunity('@host', 'Newest')
    expect(sorted.available).toBe(true)
    expect(sorted.appliedSort).toBe('Newest')
    expect(sorted.sortOptions).toEqual(['Top', 'Newest'])
    expect(sorted.posts.items).toHaveLength(1)

    const token = sorted.posts.items[0]!.actionsToken!
    expect(token).toBeTruthy()
    await source.ratePost(token, 'LIKE')
    await source.ratePost(token, 'INDIFFERENT')
    await source.ratePost(token, 'DISLIKE')
    await source.ratePost(token, 'INDIFFERENT')

    const actionCalls = calls.filter((c) => c.endpoint === '/comment/perform_comment_action').map((c) => c.args)
    expect(actionCalls).toEqual([
      { actions: ['ACT_LIKE'] },
      { actions: ['ACT_UNLIKE'] },
      { actions: ['ACT_DISLIKE'] },
      { actions: ['ACT_UNDISLIKE'] },
    ])
  })
})
