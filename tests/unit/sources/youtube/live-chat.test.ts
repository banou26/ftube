import { describe, expect, it } from 'vite-plus/test'

import {
  applyPollPatch,
  liveChatToken,
  nextLiveChatDelayMs,
  parseLiveChatLeaderboard,
  parseLiveChatResponse,
  parseSendLiveChatResult,
} from '../../../../src/sources/youtube/live-chat'

describe('liveChatToken', () => {
  it('extracts a parsed non-replay token and skips replays', () => {
    expect(liveChatToken({
      contents_memo: new Map([['TwoColumnWatchNextResults', [{ conversation_bar: { is_replay: false, continuation: 'tok-live' } }]]]),
    })).toBe('tok-live')

    expect(liveChatToken({
      contents_memo: new Map([['TwoColumnWatchNextResults', [{ conversation_bar: { is_replay: true, continuation: 'tok-replay' } }]]]),
    })).toBeUndefined()
  })

  it('extracts raw conversationBar reload token', () => {
    expect(liveChatToken({
      contents: {
        twoColumnWatchNextResults: {
          conversationBar: {
            liveChatRenderer: {
              continuations: [{ reloadContinuationData: { continuation: 'raw-tok' } }],
            },
          },
        },
      },
    })).toBe('raw-tok')
  })
})

describe('nextLiveChatDelayMs', () => {
  it('polls faster when messages are flowing and clamps timed continuation delays', () => {
    expect(nextLiveChatDelayMs({ continuationType: 'invalidation', gotItems: true, quietStreak: 0 })).toBe(1_000)
    expect(nextLiveChatDelayMs({ continuationType: 'invalidation', gotItems: false, quietStreak: 0 })).toBe(1_200)
    expect(nextLiveChatDelayMs({ continuationType: 'invalidation', gotItems: false, quietStreak: 5 })).toBe(2_500)
    expect(nextLiveChatDelayMs({ continuationType: 'timed', timeoutMs: 10_000, gotItems: false, quietStreak: 0 })).toBe(3_000)
    expect(nextLiveChatDelayMs({ continuationType: 'timed', timeoutMs: 250, gotItems: false, quietStreak: 0 })).toBe(1_000)
  })
})

describe('parseLiveChatResponse', () => {
  it('parses restricted participation (subscribers-only / members-only / slow mode) and Top Fans entry point', () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ invalidationContinuationData: { continuation: 'next-1', timeoutMs: 10_000 } }],
          header: {
            liveChatHeaderRenderer: {
              viewSelector: {
                sortFilterSubMenuRenderer: {
                  subMenuItems: [
                    { selected: true, continuation: { reloadContinuationData: { continuation: 'top-tok' } } },
                    { selected: false, continuation: { reloadContinuationData: { continuation: 'all-tok' } } },
                  ],
                },
              },
              viewerLeaderboardEntryPoint: {
                liveViewerLeaderboardChatEntryPointViewModel: {
                  defaultButton: {
                    buttonViewModel: {
                      title: 'Top fans',
                      onTap: {
                        innertubeCommand: {
                          showEngagementPanelEndpoint: {
                            identifier: { tag: 'PAlive_viewer_leaderboard' },
                            globalConfiguration: { params: 'lb-params%3D' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          actionPanel: {
            liveChatRestrictedParticipationRenderer: {
              message: { runs: [{ text: 'Subscribers-only mode' }] },
            },
          },
          actions: [
            { addChatItemAction: { item: { liveChatPlaceholderItemRenderer: { id: 'skip-me' } } } },
            {
              addChatItemAction: {
                item: {
                  liveChatModeChangeMessageRenderer: {
                    id: 'mode-1',
                    icon: { iconType: 'SLOW_MODE' },
                    text: { runs: [{ text: 'Slow mode enabled' }] },
                    subtext: { runs: [{ text: 'You can send a message every 30 seconds' }] },
                  },
                },
              },
            },
          ],
        },
      },
    })

    expect(parsed.ended).toBe(false)
    expect(parsed.continuation).toEqual({ token: 'next-1', type: 'invalidation', timeoutMs: 10_000 })
    expect(parsed.viewTokens).toEqual({ TOP: 'top-tok', ALL: 'all-tok' })
    expect(parsed.selectedView).toBe('TOP')
    expect(parsed.inputState).toEqual({
      status: 'RESTRICTED',
      restrictionMessage: 'Subscribers-only mode',
      restrictionMode: 'SUBSCRIBERS_ONLY',
    })
    expect(parsed.clearSendParams).toBe(true)
    expect(parsed.leaderboard).toEqual({ label: 'Top fans', panelId: 'PAlive_viewer_leaderboard', params: 'lb-params%3D' })
    expect(parsed.slowModeUpdate).toBe(30)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      id: 'mode-1',
      kind: 'SYSTEM',
      text: 'Slow mode enabled - You can send a message every 30 seconds',
    })
  })

  it('parses Top Fan badges, stickers, memberships, gifts, Jewels, tickers, polls, author removals, and reaction burst', () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: 'next-2', timeoutMs: 2_000 } }],
          actionPanel: {
            liveChatMessageInputRenderer: {
              inputField: { liveChatTextInputFieldRenderer: { placeholder: { simpleText: 'Say something...' }, maxCharacterLimit: 200 } },
              sendButton: { buttonRenderer: { serviceEndpoint: { sendLiveChatMessageEndpoint: { params: 'send-secret' } } } },
            },
          },
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: 'm1',
                    message: { runs: [{ text: 'go!' }] },
                    authorName: { simpleText: '@fan1' },
                    authorExternalChannelId: 'UCfan1',
                    beforeContentButtons: [{
                      buttonViewModel: {
                        iconName: 'CROWN_FILLED',
                        title: '#1',
                        customBackgroundColor: 4294901811,
                        customFontColor: 4294967295,
                      },
                    }],
                    authorBadges: [{
                      liveChatAuthorBadgeRenderer: {
                        tooltip: 'Member (6 months)',
                        customThumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/member.png', width: 32 }] },
                      },
                    }],
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatPaidStickerRenderer: {
                    id: 'st1',
                    authorName: { simpleText: '@st_user' },
                    purchaseAmountText: { simpleText: '$5.00' },
                    moneyChipBackgroundColor: 4294950912,
                    backgroundColor: 4294950912,
                    sticker: {
                      thumbnails: [{ url: 'https://img/sticker.png', width: 144 }],
                      accessibility: { accessibilityData: { label: 'Clapping sticker' } },
                    },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
                    id: 'gp1',
                    authorExternalChannelId: 'UCgifter',
                    header: {
                      liveChatSponsorshipsHeaderRenderer: {
                        authorName: { simpleText: '@gifter' },
                        primaryText: { runs: [{ text: 'Sent 5 gift memberships' }] },
                      },
                    },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  giftMessageViewModel: {
                    id: 'jw1',
                    authorName: { content: '@jewel' },
                    text: { content: 'sent Treat' },
                  },
                },
              },
            },
            {
              showLiveChatActionPanelAction: {
                panelToShow: {
                  liveChatActionPanelRenderer: {
                    contents: {
                      pollRenderer: {
                        liveChatPollId: 'poll-1',
                        header: { pollHeaderRenderer: { pollQuestion: { runs: [{ text: 'Best map?' }] } } },
                        choices: [
                          {
                            text: { runs: [{ text: 'Mirage' }] },
                            serviceEndpoint: {
                              commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/live_chat/live_chat_action' } },
                              liveChatActionEndpoint: { params: 'vote-0' },
                            },
                          },
                          { text: { runs: [{ text: 'Inferno' }] } },
                        ],
                      },
                    },
                  },
                },
              },
            },
            {
              addLiveChatTickerItemAction: {
                item: {
                  liveChatTickerPaidMessageItemRenderer: {
                    id: 'tick-1',
                    amount: { simpleText: '$10.00' },
                    startBackgroundColor: 4291821568,
                    amountTextColor: 4294967295,
                    authorUsername: { simpleText: '@donor' },
                  },
                },
              },
            },
            { markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UCtroll' } },
          ],
        },
      },
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [
            {
              payload: {
                liveChatPollStateEntity: {
                  metadataText: { runs: [{ text: '120 votes' }] },
                  pollChoiceStates: [
                    { key: 1, value: { voteRatio: 0.25, votePercentage: { runs: [{ text: '25%' }] } } },
                    { key: 0, value: { voteRatio: 0.75, votePercentage: { runs: [{ text: '75%' }] } } },
                  ],
                },
              },
            },
            {
              payload: {
                emojiFountainDataEntity: {
                  reactionBuckets: [{ totalReactions: 4 }, { totalReactions: 9 }],
                },
              },
            },
          ],
        },
      },
    })

    expect(parsed.inputState).toMatchObject({ status: 'ENABLED', placeholder: 'Say something...', maxLength: 200 })
    expect(parsed.sendParams).toBe('send-secret')
    expect(parsed.items[0]).toMatchObject({
      id: 'm1',
      kind: 'TEXT',
      isMember: true,
      badges: [
        { label: '#1', kind: 'top-fan', backgroundColor: '#ff0033', textColor: '#ffffff' },
        { label: 'Member (6 months)', kind: 'member', iconUrl: 'https://yt3.ggpht.com/member.png' },
      ],
    })
    expect(parsed.items[1]).toMatchObject({ id: 'st1', kind: 'STICKER', stickerUrl: 'https://img/sticker.png', purchaseAmountText: '$5.00' })
    expect(parsed.items[2]).toMatchObject({ id: 'gp1', kind: 'GIFT_MEMBERSHIP', headerPrimaryText: 'Sent 5 gift memberships' })
    expect(parsed.items[3]).toMatchObject({ id: 'jw1', kind: 'GIFT', text: 'sent Treat' })
    expect(parsed.poll).toMatchObject({
      id: 'poll-1',
      question: 'Best map?',
      metadataText: '120 votes',
      choices: [
        { id: '0', text: 'Mirage', votePercentage: '75%', voteRatio: 0.75, voteParams: JSON.stringify({ endpoint: '/live_chat/live_chat_action', params: 'vote-0' }) },
        { id: '1', text: 'Inferno', votePercentage: '25%', voteRatio: 0.25 },
      ],
    })
    expect(parsed.tickerItems[0]).toMatchObject({ id: 'tick-1', label: '$10.00', authorName: '@donor' })
    expect(parsed.removedAuthorIds).toEqual(['UCtroll'])
    expect(parsed.reactionBurst).toBe(6)
  })
})

describe('applyPollPatch, parseLiveChatLeaderboard, and parseSendLiveChatResult', () => {
  it('parses leaderboard rankings from get_panel', () => {
    const lb = parseLiveChatLeaderboard({
      content: {
        engagementPanelSectionListRenderer: {
          header: { engagementPanelTitleHeaderRenderer: { title: { runs: [{ text: 'Top fans' }] } } },
          content: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: [{
                    liveLeaderboardItemViewModel: {
                      rank: { content: '1' },
                      points: { content: '15 XP' },
                      avatar: { avatarViewModel: { image: { sources: [{ url: 'https://img/a.jpg' }] } } },
                      content: {
                        liveLeaderboardItemChannelContentViewModel: {
                          displayName: { content: '@top1' },
                          badge: { buttonViewModel: { title: '#1', customBackgroundColor: 4294901811, customFontColor: 4294967295 } },
                        },
                      },
                    },
                  }],
                },
              }],
            },
          },
        },
      },
    })
    expect(lb).toEqual({
      title: 'Top fans',
      items: [{
        rank: '1',
        displayName: '@top1',
        avatar: 'https://img/a.jpg',
        points: '15 XP',
        badgeLabel: '#1',
        badgeBackgroundColor: '#ff0033',
        badgeTextColor: '#ffffff',
      }],
    })
  })

  it('extracts echoed messages or tooltip errors on send', () => {
    expect(parseSendLiveChatResult({
      actions: [{
        addChatItemAction: {
          item: { liveChatTextMessageRenderer: { id: 'echo-1', message: { runs: [{ text: 'hi!' }] }, authorName: { simpleText: '@me' } } },
        },
      }],
    }).addedMessages[0]).toMatchObject({ id: 'echo-1', text: 'hi!' })

    expect(parseSendLiveChatResult({
      actions: [{
        showLiveChatTooltipCommand: { tooltip: { tooltipRenderer: { text: { simpleText: 'Slow mode is on' } } } },
      }],
    }).errorMessage).toBe('Slow mode is on')

    const patched = applyPollPatch(
      { id: 'p', question: 'Q', questionRuns: [], choices: [{ id: '0', text: 'A', runs: [] }] },
      { metadataText: '5 votes', choices: new Map([[0, { votePercentage: '100%', voteRatio: 1 }]]) },
    )
    expect(patched?.choices[0]?.votePercentage).toBe('100%')
  })

  it('preserves emoji shortcuts and unicode emojis in text, parses closed polls, and rejects traversal vote endpoints', () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: 'tok-next', timeoutMs: 3000 } }],
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: 'emoji-msg',
                    authorName: { simpleText: '@sender' },
                    authorExternalChannelId: 'UCsend',
                    message: {
                      runs: [
                        { text: 'hi ' },
                        { emoji: { emojiId: ':wave:', shortcuts: [':wave:'], isCustomEmoji: true, image: { thumbnails: [{ url: 'https://img/w.png', width: 24 }] } } },
                        { text: ' ' },
                        { emoji: { emojiId: '😀', shortcuts: [':grinning_face:', ':grinning:'], isCustomEmoji: false, image: { thumbnails: [{ url: 'https://img/smile.png', width: 24 }] } } },
                      ],
                    },
                  },
                },
              },
            },
            {
              showLiveChatActionPanelAction: {
                panelToShow: {
                  liveChatActionPanelRenderer: {
                    contents: {
                      pollRenderer: {
                        liveChatPollId: 'poll-closed',
                        header: {
                          pollHeaderRenderer: {
                            pollQuestion: { simpleText: 'Done?' },
                            liveChatPollType: 'LIVE_CHAT_POLL_TYPE_CLOSED',
                          },
                        },
                        choices: [
                          {
                            text: { simpleText: 'Yes' },
                            serviceEndpoint: {
                              commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/live_chat/../browse' } },
                              sendLiveChatVoteEndpoint: { params: 'evil' },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    })
    expect(parsed.items[0]?.text).toBe('hi :wave: 😀')
    expect(parsed.items[0]?.runs[3]?.emojiLabel).toBe('😀')
    expect(parsed.poll?.finished).toBe(true)
    expect(parsed.poll?.choices[0]?.voteParams).toBeUndefined()
  })
})
