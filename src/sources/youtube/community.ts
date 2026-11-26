import type {
  SourceLikeStatus,
  SourcePost,
  SourcePostPoll,
  SourcePostPollChoice,
  SourceTextRun,
  SourceVideo,
} from '../types'

export type PostActionTokens = {
  like?: string
  unlike?: string
  dislike?: string
  undislike?: string
}

export type CommunitySortChip = {
  label: string
  selected: boolean
  token?: string
}

export type ParsedCommunityPost = {
  post: SourcePost
  actions?: PostActionTokens
}

export type ParsedCommunityResponse = {
  available: boolean
  channelId?: string
  title?: string
  avatar?: string
  sortChips: CommunitySortChip[]
  posts: ParsedCommunityPost[]
  continuationToken?: string
}

export type ParsedCommunityContinuation = {
  posts: ParsedCommunityPost[]
  continuationToken?: string
}

type RawTextRun = {
  text?: string
  bold?: boolean
  navigationEndpoint?: {
    urlEndpoint?: { url?: string }
    watchEndpoint?: { videoId?: string, startTimeSeconds?: number }
    browseEndpoint?: { browseId?: string }
    commandMetadata?: { webCommandMetadata?: { url?: string } }
  }
}

type RawText = {
  simpleText?: string
  runs?: RawTextRun[]
  content?: string
}

type RawThumbnail = {
  url?: string
  width?: number
  height?: number
}

const rawText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? value : undefined
  }
  const obj = value as RawText | undefined
  if (!obj) return undefined
  if (typeof obj.simpleText === 'string' && obj.simpleText.length > 0) return obj.simpleText
  if (typeof obj.content === 'string' && obj.content.length > 0) return obj.content
  if (Array.isArray(obj.runs) && obj.runs.length > 0) {
    const joined = obj.runs.map(run => run.text ?? '').join('')
    return joined.length > 0 ? joined : undefined
  }
  return undefined
}

const unwrapRedirectUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined
  try {
    const parsed = new URL(url, 'https://www.youtube.com')
    const target = parsed.hostname === 'www.youtube.com' && parsed.pathname === '/redirect'
      ? new URL(parsed.searchParams.get('q') ?? '')
      : parsed
    return target.protocol === 'https:' || target.protocol === 'http:' ? target.href : undefined
  } catch {
    return undefined
  }
}

const rawRuns = (value: unknown): SourceTextRun[] => {
  const obj = value as RawText | undefined
  if (!obj) return []
  if (!Array.isArray(obj.runs) || obj.runs.length === 0) {
    return typeof obj.simpleText === 'string' && obj.simpleText.length > 0
      ? [{ text: obj.simpleText }]
      : []
  }
  return obj.runs.flatMap((run) => {
    const text = run.text
    if (!text) return []
    const ep = run.navigationEndpoint
    const url = unwrapRedirectUrl(ep?.urlEndpoint?.url ?? ep?.commandMetadata?.webCommandMetadata?.url)
    const videoId = ep?.watchEndpoint?.videoId
    const startSeconds = ep?.watchEndpoint?.startTimeSeconds
    const browseId = ep?.browseEndpoint?.browseId
    return [{
      text,
      ...(run.bold === true ? { bold: true } : {}),
      ...(url && !videoId && !browseId ? { url } : {}),
      ...(videoId ? { videoId } : {}),
      ...(typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? { startSeconds } : {}),
      ...(browseId ? { browseId } : {}),
    }]
  })
}

const bestThumbnail = (thumbnails: readonly RawThumbnail[] | undefined, maxWidth?: number): string | undefined => {
  if (!thumbnails || thumbnails.length === 0) return undefined
  const valid = thumbnails.filter(item => typeof item.url === 'string' && item.url.length > 0)
  if (valid.length === 0) return undefined
  const sorted = [...valid].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  if (maxWidth !== undefined) {
    const fit = sorted.find(item => (item.width ?? 0) >= maxWidth)
    return fit?.url ?? sorted[sorted.length - 1]?.url
  }
  return sorted[sorted.length - 1]?.url
}

const parseDurationText = (label: string | undefined): number | undefined => {
  if (!label) return undefined
  const parts = label.trim().split(':').map(part => Number.parseInt(part, 10))
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return undefined
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return undefined
}

const badgeFlags = (badges: unknown): { isVerified?: boolean, isVerifiedArtist?: boolean } => {
  const list = Array.isArray(badges) ? badges as { metadataBadgeRenderer?: { style?: string, icon?: { iconType?: string } } }[] : []
  let isVerified: boolean | undefined
  let isVerifiedArtist: boolean | undefined
  for (const badge of list) {
    const style = badge.metadataBadgeRenderer?.style ?? ''
    const icon = badge.metadataBadgeRenderer?.icon?.iconType ?? ''
    if (style.includes('VERIFIED_ARTIST') || icon.includes('AUDIO')) isVerifiedArtist = true
    else if (style.includes('VERIFIED') || icon.includes('CHECK')) isVerified = true
  }
  return {
    ...(isVerified ? { isVerified } : {}),
    ...(isVerifiedArtist ? { isVerifiedArtist } : {}),
  }
}

export const extractPerformAction = (endpoint: unknown): string | undefined => {
  if (!endpoint || typeof endpoint !== 'object') return undefined
  const ep = endpoint as {
    performCommentActionEndpoint?: { action?: string, actions?: string[] }
    payload?: { action?: string, actions?: string[] }
    commandExecutorCommand?: { commands?: unknown[] }
    commands?: unknown[]
    action?: string
  }
  if (typeof ep.performCommentActionEndpoint?.action === 'string') return ep.performCommentActionEndpoint.action
  if (typeof ep.performCommentActionEndpoint?.actions?.[0] === 'string') return ep.performCommentActionEndpoint.actions[0]
  if (typeof ep.payload?.action === 'string') return ep.payload.action
  if (typeof ep.payload?.actions?.[0] === 'string') return ep.payload.actions[0]
  if (typeof ep.action === 'string') return ep.action
  const sub = ep.commandExecutorCommand?.commands ?? ep.commands
  if (Array.isArray(sub)) {
    for (const item of sub) {
      const nested = extractPerformAction(item)
      if (nested) return nested
    }
  }
  return undefined
}

const compactActions = (actions: PostActionTokens): PostActionTokens | undefined =>
  actions.like || actions.unlike || actions.dislike || actions.undislike ? actions : undefined

export const extractRawPostActions = (rawPost: unknown): PostActionTokens | undefined => {
  if (!rawPost || typeof rawPost !== 'object') return undefined
  const node = rawPost as {
    actionButtons?: {
      commentActionButtonsRenderer?: {
        likeButton?: { toggleButtonRenderer?: { defaultServiceEndpoint?: unknown, toggledServiceEndpoint?: unknown } }
        dislikeButton?: { toggleButtonRenderer?: { defaultServiceEndpoint?: unknown, toggledServiceEndpoint?: unknown } }
      }
    }
  }
  const buttons = node.actionButtons?.commentActionButtonsRenderer
  const like = extractPerformAction(buttons?.likeButton?.toggleButtonRenderer?.defaultServiceEndpoint)
  const unlike = extractPerformAction(buttons?.likeButton?.toggleButtonRenderer?.toggledServiceEndpoint)
  const dislike = extractPerformAction(buttons?.dislikeButton?.toggleButtonRenderer?.defaultServiceEndpoint)
  const undislike = extractPerformAction(buttons?.dislikeButton?.toggleButtonRenderer?.toggledServiceEndpoint)
  return compactActions({
    ...(like ? { like } : {}),
    ...(unlike ? { unlike } : {}),
    ...(dislike ? { dislike } : {}),
    ...(undislike ? { undislike } : {}),
  })
}

export const extractParsedPostActions = (parsedPost: unknown): PostActionTokens | undefined => {
  if (!parsedPost || typeof parsedPost !== 'object') return undefined
  const node = parsedPost as {
    action_buttons?: {
      like_button?: { endpoint?: unknown, toggled_endpoint?: unknown }
      dislike_button?: { endpoint?: unknown, toggled_endpoint?: unknown }
    }
  }
  const like = extractPerformAction(node.action_buttons?.like_button?.endpoint)
  const unlike = extractPerformAction(node.action_buttons?.like_button?.toggled_endpoint)
  const dislike = extractPerformAction(node.action_buttons?.dislike_button?.endpoint)
  const undislike = extractPerformAction(node.action_buttons?.dislike_button?.toggled_endpoint)
  return compactActions({
    ...(like ? { like } : {}),
    ...(unlike ? { unlike } : {}),
    ...(dislike ? { dislike } : {}),
    ...(undislike ? { undislike } : {}),
  })
}

const rawAttachedVideo = (video: unknown): SourceVideo | undefined => {
  const v = video as {
    videoId?: string
    title?: RawText
    thumbnail?: { thumbnails?: RawThumbnail[] }
    lengthText?: RawText
    shortViewCountText?: RawText
    viewCountText?: RawText
    publishedTimeText?: RawText
    ownerText?: RawText
    shortBylineText?: RawText
  } | undefined
  if (!v?.videoId) return undefined
  const title = rawText(v.title)
  if (!title) return undefined
  const byline = (v.ownerText ?? v.shortBylineText) as RawText | undefined
  const channelName = rawText(byline)
  const channelId = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? ''
  return {
    id: v.videoId,
    title,
    thumbnail: bestThumbnail(v.thumbnail?.thumbnails),
    durationSeconds: parseDurationText(rawText(v.lengthText)),
    viewCount: rawText(v.shortViewCountText) ?? rawText(v.viewCountText),
    publishedText: rawText(v.publishedTimeText),
    badges: [],
    channel: channelName ? { id: channelId, name: channelName } : undefined,
  }
}

const rawPoll = (poll: unknown): SourcePostPoll | undefined => {
  const p = poll as {
    totalVotes?: RawText
    choices?: {
      text?: RawText
      votePercentageIfSelected?: RawText
      votePercentageIfNotSelected?: RawText
      selected?: boolean
      image?: { thumbnails?: RawThumbnail[] }
    }[]
  } | undefined
  if (!p?.choices || p.choices.length === 0) return undefined
  const choices: SourcePostPollChoice[] = p.choices.map((choice) => {
    const pct = choice.selected
      ? rawText(choice.votePercentageIfSelected) ?? rawText(choice.votePercentageIfNotSelected)
      : rawText(choice.votePercentageIfNotSelected) ?? rawText(choice.votePercentageIfSelected)
    const image = bestThumbnail(choice.image?.thumbnails, 160)
    return {
      text: rawText(choice.text) ?? '',
      ...(pct ? { votePercentage: pct } : {}),
      ...(image ? { image } : {}),
    }
  })
  return {
    totalVotesText: rawText(p.totalVotes),
    choices,
  }
}

export const normalizeRawCommunityPost = (
  rawInput: unknown,
  hostChannelId?: string,
): ParsedCommunityPost | undefined => {
  if (!rawInput || typeof rawInput !== 'object') return undefined
  const outer = rawInput as {
    postId?: string
    backstagePostRenderer?: unknown
    sharedPostRenderer?: {
      postId?: string
      displayName?: RawText
      thumbnail?: { thumbnails?: RawThumbnail[] }
      publishedTimeText?: RawText
      content?: RawText
      originalPost?: { backstagePostRenderer?: unknown }
    }
  }
  const inner = outer.backstagePostRenderer
    ?? outer.sharedPostRenderer?.originalPost?.backstagePostRenderer
    ?? rawInput
  const node = inner as {
    postId?: string
    authorText?: RawText
    authorEndpoint?: { browseEndpoint?: { browseId?: string } }
    authorThumbnail?: { thumbnails?: RawThumbnail[] }
    authorBadges?: unknown
    ownerBadges?: unknown
    showPostAuthorBackgroundHighlight?: boolean
    contentText?: RawText
    publishedTimeText?: RawText
    voteCount?: RawText
    voteStatus?: string
    actionButtons?: {
      commentActionButtonsRenderer?: {
        likeButton?: { toggleButtonRenderer?: { isToggled?: boolean, defaultText?: RawText } }
        dislikeButton?: { toggleButtonRenderer?: { isToggled?: boolean } }
        replyButton?: {
          buttonRenderer?: {
            text?: RawText
            accessibility?: { label?: string }
            accessibilityData?: { accessibilityData?: { label?: string } }
          }
        }
      }
    }
    backstageAttachment?: {
      backstageImageRenderer?: { image?: { thumbnails?: RawThumbnail[] } }
      postMultiImageRenderer?: { images?: { backstageImageRenderer?: { image?: { thumbnails?: RawThumbnail[] } } }[] }
      videoRenderer?: unknown
      pollRenderer?: unknown
    }
  }
  if (!node?.postId) return undefined

  const explicitAuthorId = node.authorEndpoint?.browseEndpoint?.browseId
    ?? (node.authorText as RawText | undefined)?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
  const authorId = explicitAuthorId
    ?? hostChannelId
    ?? ''
  const authorName = rawText(node.authorText) ?? ''
  const authorAvatar = bestThumbnail(node.authorThumbnail?.thumbnails, 160)
  const badges = badgeFlags(node.authorBadges ?? node.ownerBadges)
  const runs = rawRuns(node.contentText)
  const text = runs.length > 0 ? runs.map(run => run.text).join('') : (rawText(node.contentText) ?? '')

  const buttons = node.actionButtons?.commentActionButtonsRenderer
  const likeToggled = buttons?.likeButton?.toggleButtonRenderer?.isToggled === true
  const dislikeToggled = buttons?.dislikeButton?.toggleButtonRenderer?.isToggled === true
  let likeStatus: SourceLikeStatus = 'INDIFFERENT'
  if (likeToggled || node.voteStatus === 'LIKE') likeStatus = 'LIKE'
  else if (dislikeToggled || node.voteStatus === 'DISLIKE') likeStatus = 'DISLIKE'

  const replyBtn = buttons?.replyButton?.buttonRenderer
  const commentCountText = rawText(replyBtn?.text)
  const commentCountLabel = replyBtn?.accessibilityData?.accessibilityData?.label ?? replyBtn?.accessibility?.label

  const attachment = node.backstageAttachment
  const attachedImage = bestThumbnail(attachment?.backstageImageRenderer?.image?.thumbnails)
  const multiImages = (attachment?.postMultiImageRenderer?.images ?? [])
    .map(entry => bestThumbnail(entry.backstageImageRenderer?.image?.thumbnails))
    .filter((url): url is string => Boolean(url))
  const attachedVideo = attachment?.videoRenderer ? rawAttachedVideo(attachment.videoRenderer) : undefined
  const poll = attachment?.pollRenderer ? rawPoll(attachment.pollRenderer) : undefined

  const isCreator = Boolean(node.showPostAuthorBackgroundHighlight)
    || (Boolean(hostChannelId) && explicitAuthorId === hostChannelId)
  const actions = extractRawPostActions(node)

  const post: SourcePost = {
    id: node.postId,
    ...(authorName ? { author: { id: authorId, name: authorName, ...(authorAvatar ? { avatar: authorAvatar } : {}), ...badges } } : {}),
    text,
    ...(runs.length > 0 ? { runs } : {}),
    publishedText: rawText(node.publishedTimeText),
    voteCountText: rawText(node.voteCount) ?? rawText(buttons?.likeButton?.toggleButtonRenderer?.defaultText),
    likeStatus,
    ...(hostChannelId || node.showPostAuthorBackgroundHighlight !== undefined ? { isCreator } : {}),
    ...(commentCountText ? { commentCountText } : {}),
    ...(commentCountLabel ? { commentCountLabel } : {}),
    ...(attachedVideo ? { attachedVideo } : {}),
    ...(attachedImage ? { attachedImage } : {}),
    ...(multiImages.length > 0 ? { attachedImages: multiImages } : {}),
    ...(poll ? { poll } : {}),
  }
  return { post, actions }
}

const collectPostsFromItems = (
  items: readonly unknown[] | undefined,
  hostChannelId?: string,
): { posts: ParsedCommunityPost[], continuationToken?: string } => {
  const posts: ParsedCommunityPost[] = []
  let continuationToken: string | undefined

  const visitItem = (item: unknown) => {
    if (!item || typeof item !== 'object') return
    const entry = item as {
      itemSectionRenderer?: { contents?: unknown[] }
      backstagePostThreadRenderer?: { post?: unknown }
      backstagePostRenderer?: unknown
      sharedPostRenderer?: unknown
      continuationItemRenderer?: {
        continuationEndpoint?: { continuationCommand?: { token?: string } }
      }
    }
    if (entry.backstagePostThreadRenderer?.post) {
      const parsed = normalizeRawCommunityPost(entry.backstagePostThreadRenderer.post, hostChannelId)
      if (parsed) posts.push(parsed)
    } else if (entry.backstagePostRenderer || entry.sharedPostRenderer) {
      const parsed = normalizeRawCommunityPost(entry, hostChannelId)
      if (parsed) posts.push(parsed)
    } else if (entry.itemSectionRenderer?.contents) {
      for (const child of entry.itemSectionRenderer.contents) visitItem(child)
    } else if (entry.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      continuationToken ??= entry.continuationItemRenderer.continuationEndpoint.continuationCommand.token
    }
  }

  for (const item of items ?? []) visitItem(item)
  return { posts, continuationToken }
}

export const parseCommunityBrowseResponse = (
  rawData: unknown,
  hostChannelIdHint?: string,
): ParsedCommunityResponse => {
  const data = rawData as {
    header?: {
      pageHeaderRenderer?: {
        content?: {
          pageHeaderViewModel?: {
            title?: { dynamicTextViewModel?: { text?: RawText } }
            image?: { decoratedAvatarViewModel?: { avatar?: { avatarViewModel?: { image?: { sources?: RawThumbnail[] } } } } }
          }
        }
      }
    }
    contents?: {
      twoColumnBrowseResultsRenderer?: {
        tabs?: {
          tabRenderer?: {
            selected?: boolean
            content?: {
              sectionListRenderer?: {
                header?: {
                  feedFilterChipBarRenderer?: {
                    contents?: {
                      chipCloudChipRenderer?: {
                        text?: RawText
                        isSelected?: boolean
                        navigationEndpoint?: { continuationCommand?: { token?: string } }
                      }
                    }[]
                  }
                }
                contents?: {
                  itemSectionRenderer?: { contents?: { messageRenderer?: unknown }[] }
                }[]
              }
            }
          }
        }[]
      }
    }
  } | undefined

  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []
  const selectedTab = tabs.find(t => t.tabRenderer?.selected) ?? tabs[0]
  const sectionList = selectedTab?.tabRenderer?.content?.sectionListRenderer
  const pageHeader = data?.header?.pageHeaderRenderer
  const firstMessage = sectionList?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.messageRenderer

  if (!pageHeader && firstMessage) {
    return { available: false, sortChips: [], posts: [] }
  }

  const vm = pageHeader?.content?.pageHeaderViewModel
  const title = rawText(vm?.title?.dynamicTextViewModel?.text)
  const avatar = bestThumbnail(vm?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources, 160)

  const sortChips: CommunitySortChip[] = []
  for (const chip of sectionList?.header?.feedFilterChipBarRenderer?.contents ?? []) {
    const renderer = chip.chipCloudChipRenderer
    const label = rawText(renderer?.text)
    if (!label) continue
    sortChips.push({
      label,
      selected: renderer?.isSelected === true,
      token: renderer?.navigationEndpoint?.continuationCommand?.token,
    })
  }

  const { posts, continuationToken } = collectPostsFromItems(sectionList?.contents, hostChannelIdHint)
  return {
    available: true,
    channelId: hostChannelIdHint,
    title,
    avatar,
    sortChips,
    posts,
    continuationToken,
  }
}

export const parseCommunityContinuationResponse = (
  rawData: unknown,
  hostChannelIdHint?: string,
): ParsedCommunityContinuation => {
  const data = rawData as {
    onResponseReceivedEndpoints?: {
      reloadContinuationItemsCommand?: { continuationItems?: unknown[] }
      appendContinuationItemsAction?: { continuationItems?: unknown[] }
    }[]
    onResponseReceivedActions?: {
      reloadContinuationItemsCommand?: { continuationItems?: unknown[] }
      appendContinuationItemsAction?: { continuationItems?: unknown[] }
    }[]
  } | undefined
  const actions = [
    ...(data?.onResponseReceivedEndpoints ?? []),
    ...(data?.onResponseReceivedActions ?? []),
  ]
  const items: unknown[] = []
  for (const action of actions) {
    if (action.reloadContinuationItemsCommand?.continuationItems) {
      items.push(...action.reloadContinuationItemsCommand.continuationItems)
    }
    if (action.appendContinuationItemsAction?.continuationItems) {
      items.push(...action.appendContinuationItemsAction.continuationItems)
    }
  }
  return collectPostsFromItems(items, hostChannelIdHint)
}
