import type {
  SourceChannel,
  SourceChatReplayView,
  SourceLiveChatBadge,
  SourceLiveChatEmoji,
  SourceLiveChatInputState,
  SourceLiveChatLeaderboard,
  SourceLiveChatLeaderboardEntryPoint,
  SourceLiveChatLeaderboardItem,
  SourceLiveChatMessage,
  SourceLiveChatPinnedMessage,
  SourceLiveChatPoll,
  SourceLiveChatPollChoice,
  SourceLiveChatRun,
  SourceLiveChatTickerItem,
} from '../types'

import { argbColor, AVATAR_WIDTH, EMOJI_WIDTH, handleFromUrl, httpsUrl, thumbnail } from './normalize'

type RawThumb = { url?: string, width?: number, height?: number }
type RawThumbList = { thumbnails?: RawThumb[], sources?: RawThumb[] } | RawThumb[]

type RawTextRun = {
  text?: string
  bold?: boolean
  emoji?: {
    emojiId?: string
    shortcuts?: string[]
    isCustomEmoji?: boolean
    is_custom_emoji?: boolean
    image?: RawThumbList
  }
  navigationEndpoint?: {
    commandMetadata?: { webCommandMetadata?: { url?: string } }
    urlEndpoint?: { url?: string }
    watchEndpoint?: { videoId?: string, startTimeSeconds?: number }
    browseEndpoint?: { browseId?: string }
  }
}

type RawText = string | {
  simpleText?: string
  text?: string
  content?: string
  runs?: RawTextRun[]
  toString?: () => string
}

type RawBadge = {
  icon?: { iconType?: string }
  tooltip?: string
  accessibility?: { accessibilityData?: { label?: string } }
  customThumbnail?: RawThumbList
}

type RawButtonViewModel = {
  iconName?: string
  title?: string
  accessibilityText?: string
  customBackgroundColor?: number
  customFontColor?: number
  onTap?: {
    innertubeCommand?: {
      showEngagementPanelEndpoint?: {
        identifier?: { surface?: string, tag?: string }
        globalConfiguration?: { params?: string }
      }
    }
  }
}

export type LiveChatPollEntityPatch = {
  metadataText?: string
  choices: Map<number, { votePercentage?: string, voteRatio?: number }>
}

export type ParsedLiveChatResponse = {
  continuation?: { token: string, type: 'timed' | 'invalidation', timeoutMs?: number }
  ended: boolean
  viewTokens?: { TOP?: string, ALL?: string }
  selectedView?: SourceChatReplayView
  items: SourceLiveChatMessage[]
  removedIds: string[]
  removedAuthorIds: string[]
  removedBannerIds: string[]
  pinned?: SourceLiveChatPinnedMessage
  customEmojis: SourceLiveChatEmoji[]
  inputState?: SourceLiveChatInputState
  sendParams?: string
  clearSendParams: boolean
  slowModeUpdate?: number
  leaderboard?: SourceLiveChatLeaderboardEntryPoint
  poll?: SourceLiveChatPoll
  pollCleared: boolean
  pollPatch?: LiveChatPollEntityPatch
  tickerItems: SourceLiveChatTickerItem[]
  reactionBurst: number
}

const STICKER_WIDTH = 144
const MAX_REACTION_BURST = 6

const rawThumbArray = (list: RawThumbList | undefined): RawThumb[] | undefined => {
  if (!list) return undefined
  if (Array.isArray(list)) return list
  return list.thumbnails ?? list.sources
}

const rawThumb = (list: RawThumbList | undefined, minWidth?: number) => {
  const url = thumbnail(rawThumbArray(list), minWidth)
  return url ? httpsUrl(url) : undefined
}

const emojiText = (emoji: NonNullable<RawTextRun['emoji']>): string => {
  const custom = emoji.isCustomEmoji === true || emoji.is_custom_emoji === true
  return custom
    ? emoji.shortcuts?.[0] ?? emoji.emojiId ?? ''
    : emoji.emojiId ?? emoji.shortcuts?.[0] ?? ''
}

const rawText = (value: RawText | undefined): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.simpleText === 'string') return value.simpleText
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => {
      if (typeof run.text === 'string') return run.text
      if (run.emoji) return emojiText(run.emoji)
      return ''
    }).join('')
  }
  const str = value.toString?.()
  return str && str !== '[object Object]' && str !== 'N/A' ? str : ''
}

const rawRuns = (value: RawText | undefined): SourceLiveChatRun[] => {
  if (!value) return []
  if (typeof value === 'string') return value ? [{ text: value }] : []
  const runs = value.runs
  if (!Array.isArray(runs) || runs.length === 0) {
    const flat = rawText(value)
    return flat ? [{ text: flat }] : []
  }
  return runs.flatMap((run): SourceLiveChatRun[] => {
    if (run.emoji) {
      const url = rawThumb(run.emoji.image, EMOJI_WIDTH)
      if (!url) return run.text ? [{ text: run.text }] : []
      return [{
        text: run.text ?? '',
        emojiUrl: url,
        emojiLabel: emojiText(run.emoji) || run.text || '',
      }]
    }
    const text = run.text
    if (!text) return []
    const nav = run.navigationEndpoint
    const url = nav?.urlEndpoint?.url ?? nav?.commandMetadata?.webCommandMetadata?.url
    const videoId = nav?.watchEndpoint?.videoId
    const startSeconds = nav?.watchEndpoint?.startTimeSeconds
    const browseId = nav?.browseEndpoint?.browseId
    return [{
      text,
      ...(run.bold === true ? { bold: true } : {}),
      ...(url ? { url } : {}),
      ...(videoId ? { videoId } : {}),
      ...(typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? { startSeconds } : {}),
      ...(browseId ? { browseId } : {}),
    }]
  })
}

const extractBadgeInfo = (
  authorBadges: { liveChatAuthorBadgeRenderer?: RawBadge }[] | undefined,
  beforeButtons: { buttonViewModel?: RawButtonViewModel }[] | undefined,
): {
  badges: SourceLiveChatBadge[]
  isOwner?: boolean
  isModerator?: boolean
  isMember?: boolean
  isVerified?: boolean
} => {
  const badges: SourceLiveChatBadge[] = []
  let isOwner = false
  let isModerator = false
  let isMember = false
  let isVerified = false

  for (const entry of beforeButtons ?? []) {
    const btn = entry.buttonViewModel
    if (!btn) continue
    const label = btn.title?.trim() || btn.accessibilityText?.trim()
    if (!label) continue
    const isTopFan = Boolean(btn.iconName?.includes('CROWN') || label.startsWith('#'))
    if (!isTopFan) continue
    badges.push({
      label,
      kind: 'top-fan',
      backgroundColor: argbColor(btn.customBackgroundColor),
      textColor: argbColor(btn.customFontColor),
    })
  }

  for (const wrapper of authorBadges ?? []) {
    const badge = wrapper.liveChatAuthorBadgeRenderer ?? (wrapper as unknown as RawBadge)
    if (!badge) continue
    const iconType = badge.icon?.iconType
    const tooltip = badge.tooltip?.trim() || badge.accessibility?.accessibilityData?.label?.trim()
    const iconUrl = rawThumb(badge.customThumbnail, EMOJI_WIDTH)
    if (iconType === 'OWNER') {
      isOwner = true
      badges.push({ label: tooltip || 'Owner', kind: 'owner' })
    } else if (iconType === 'MODERATOR') {
      isModerator = true
      badges.push({ label: tooltip || 'Moderator', kind: 'moderator' })
    } else if (iconType === 'VERIFIED') {
      isVerified = true
      badges.push({ label: tooltip || 'Verified', kind: 'verified' })
    } else if (iconUrl) {
      isMember = true
      badges.push({ label: tooltip || 'Member', iconUrl, kind: 'member' })
    }
  }

  return {
    badges,
    ...(isOwner ? { isOwner: true } : {}),
    ...(isModerator ? { isModerator: true } : {}),
    ...(isMember ? { isMember: true } : {}),
    ...(isVerified ? { isVerified: true } : {}),
  }
}

const parseRawAuthor = (
  id: string | undefined,
  nameValue: RawText | undefined,
  photos: RawThumbList | undefined,
  url: string | undefined,
  isVerified: boolean | undefined,
): SourceChannel | undefined => {
  const name = rawText(nameValue).trim()
  const resolvedId = id?.trim() || name
  if (!resolvedId || !name) return undefined
  return {
    id: resolvedId,
    name,
    avatar: rawThumb(photos, AVATAR_WIDTH),
    handle: handleFromUrl(url) ?? (name.startsWith('@') ? name : undefined),
    ...(isVerified ? { isVerified: true } : {}),
  }
}

const parseSlowModeSeconds = (textValue: string): number | undefined => {
  if (!/slow\s*mode/i.test(textValue)) return undefined
  if (/\b(off|disabled|ended)\b/i.test(textValue)) return 0
  const match = textValue.match(/(\d+)\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m)\b/i)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return undefined
  return match[2]!.toLowerCase().startsWith('m') ? value * 60 : value
}

const classifyRestrictionMode = (message: string): string => {
  if (/subscriber/i.test(message)) return 'SUBSCRIBERS_ONLY'
  if (/member/i.test(message)) return 'MEMBERS_ONLY'
  if (/slow\s*mode/i.test(message)) return 'SLOW_MODE'
  return 'RESTRICTED'
}

type RawItemEnvelope = {
  liveChatPlaceholderItemRenderer?: unknown
  liveChatTextMessageRenderer?: {
    id?: string
    message?: RawText
    authorName?: RawText
    authorPhoto?: RawThumbList
    authorExternalChannelId?: string
    authorUrl?: string
    authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
    beforeContentButtons?: { buttonViewModel?: RawButtonViewModel }[]
    timestampText?: RawText
  }
  liveChatPaidMessageRenderer?: {
    id?: string
    message?: RawText
    authorName?: RawText
    authorPhoto?: RawThumbList
    authorExternalChannelId?: string
    authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
    beforeContentButtons?: { buttonViewModel?: RawButtonViewModel }[]
    timestampText?: RawText
    purchaseAmountText?: RawText
    headerBackgroundColor?: number
    bodyBackgroundColor?: number
  }
  liveChatPaidStickerRenderer?: {
    id?: string
    authorName?: RawText
    authorPhoto?: RawThumbList
    authorExternalChannelId?: string
    authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
    beforeContentButtons?: { buttonViewModel?: RawButtonViewModel }[]
    timestampText?: RawText
    purchaseAmountText?: RawText
    moneyChipBackgroundColor?: number
    backgroundColor?: number
    sticker?: { thumbnails?: RawThumb[], accessibility?: { accessibilityData?: { label?: string } } }
  }
  liveChatMembershipItemRenderer?: {
    id?: string
    headerPrimaryText?: RawText
    headerSubtext?: RawText
    message?: RawText
    authorName?: RawText
    authorPhoto?: RawThumbList
    authorExternalChannelId?: string
    authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
    timestampText?: RawText
  }
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer?: {
    id?: string
    authorExternalChannelId?: string
    header?: {
      liveChatSponsorshipsHeaderRenderer?: {
        authorName?: RawText
        authorPhoto?: RawThumbList
        authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
        primaryText?: RawText
      }
    }
  }
  liveChatSponsorshipsGiftRedemptionAnnouncementRenderer?: {
    id?: string
    authorName?: RawText
    authorPhoto?: RawThumbList
    authorExternalChannelId?: string
    authorBadges?: { liveChatAuthorBadgeRenderer?: RawBadge }[]
    timestampText?: RawText
    message?: RawText
  }
  giftMessageViewModel?: {
    id?: string
    text?: RawText
    authorName?: RawText
    authorExternalChannelId?: string
    authorAvatar?: { avatarViewModel?: { image?: RawThumbList } }
  }
  liveChatModeChangeMessageRenderer?: {
    id?: string
    icon?: { iconType?: string }
    text?: RawText
    subtext?: RawText
    timestampText?: RawText
  }
  liveChatViewerEngagementMessageRenderer?: {
    id?: string
    icon?: { iconType?: string }
    message?: RawText
  }
}

export const parseRawChatItem = (
  envelope: unknown,
): { message?: SourceLiveChatMessage, slowModeUpdate?: number } => {
  const item = envelope as RawItemEnvelope | undefined
  if (!item || item.liveChatPlaceholderItemRenderer) return {}

  if (item.liveChatTextMessageRenderer) {
    const node = item.liveChatTextMessageRenderer
    if (!node.id) return {}
    const badgeInfo = extractBadgeInfo(node.authorBadges, node.beforeContentButtons)
    return {
      message: {
        id: node.id,
        kind: 'TEXT',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorPhoto, node.authorUrl, badgeInfo.isVerified),
        text: rawText(node.message),
        runs: rawRuns(node.message),
        timestampText: rawText(node.timestampText) || undefined,
        ...(badgeInfo.isOwner ? { isOwner: true } : {}),
        ...(badgeInfo.isModerator ? { isModerator: true } : {}),
        ...(badgeInfo.isMember ? { isMember: true } : {}),
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.liveChatPaidMessageRenderer) {
    const node = item.liveChatPaidMessageRenderer
    if (!node.id) return {}
    const badgeInfo = extractBadgeInfo(node.authorBadges, node.beforeContentButtons)
    return {
      message: {
        id: node.id,
        kind: 'PAID',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorPhoto, undefined, badgeInfo.isVerified),
        text: rawText(node.message),
        runs: rawRuns(node.message),
        timestampText: rawText(node.timestampText) || undefined,
        purchaseAmountText: rawText(node.purchaseAmountText) || undefined,
        headerBackgroundColor: argbColor(node.headerBackgroundColor),
        bodyBackgroundColor: argbColor(node.bodyBackgroundColor),
        ...(badgeInfo.isOwner ? { isOwner: true } : {}),
        ...(badgeInfo.isModerator ? { isModerator: true } : {}),
        ...(badgeInfo.isMember ? { isMember: true } : {}),
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.liveChatPaidStickerRenderer) {
    const node = item.liveChatPaidStickerRenderer
    if (!node.id) return {}
    const badgeInfo = extractBadgeInfo(node.authorBadges, node.beforeContentButtons)
    const stickerLabel = node.sticker?.accessibility?.accessibilityData?.label ?? 'Super Sticker'
    return {
      message: {
        id: node.id,
        kind: 'STICKER',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorPhoto, undefined, badgeInfo.isVerified),
        text: stickerLabel,
        runs: [],
        timestampText: rawText(node.timestampText) || undefined,
        purchaseAmountText: rawText(node.purchaseAmountText) || undefined,
        headerBackgroundColor: argbColor(node.moneyChipBackgroundColor ?? node.backgroundColor),
        bodyBackgroundColor: argbColor(node.backgroundColor),
        stickerUrl: rawThumb(node.sticker?.thumbnails, STICKER_WIDTH),
        stickerLabel,
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.liveChatMembershipItemRenderer) {
    const node = item.liveChatMembershipItemRenderer
    if (!node.id) return {}
    const badgeInfo = extractBadgeInfo(node.authorBadges, undefined)
    const body = node.message ?? node.headerSubtext
    return {
      message: {
        id: node.id,
        kind: 'MEMBERSHIP',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorPhoto, undefined, badgeInfo.isVerified),
        text: rawText(body),
        runs: rawRuns(body),
        timestampText: rawText(node.timestampText) || undefined,
        isMember: true,
        headerBackgroundColor: '#0f7b3e',
        bodyBackgroundColor: '#139b4f',
        headerPrimaryText: rawText(node.headerPrimaryText) || undefined,
        headerSubtext: rawText(node.headerSubtext) || undefined,
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer) {
    const node = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer
    const header = node.header?.liveChatSponsorshipsHeaderRenderer
    if (!node.id || !header) return {}
    const badgeInfo = extractBadgeInfo(header.authorBadges, undefined)
    const primary = rawText(header.primaryText)
    return {
      message: {
        id: node.id,
        kind: 'GIFT_MEMBERSHIP',
        author: parseRawAuthor(node.authorExternalChannelId, header.authorName, header.authorPhoto, undefined, badgeInfo.isVerified),
        text: primary,
        runs: rawRuns(header.primaryText),
        isMember: true,
        headerBackgroundColor: '#0f7b3e',
        bodyBackgroundColor: '#139b4f',
        headerPrimaryText: primary || undefined,
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer) {
    const node = item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer
    if (!node.id) return {}
    const badgeInfo = extractBadgeInfo(node.authorBadges, undefined)
    return {
      message: {
        id: node.id,
        kind: 'GIFT_MEMBERSHIP',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorPhoto, undefined, badgeInfo.isVerified),
        text: rawText(node.message),
        runs: rawRuns(node.message),
        timestampText: rawText(node.timestampText) || undefined,
        isMember: true,
        headerBackgroundColor: '#0f7b3e',
        bodyBackgroundColor: '#139b4f',
        ...(badgeInfo.badges.length ? { badges: badgeInfo.badges } : {}),
      },
    }
  }

  if (item.giftMessageViewModel) {
    const node = item.giftMessageViewModel
    if (!node.id) return {}
    const body = rawText(node.text).trim()
    return {
      message: {
        id: node.id,
        kind: 'GIFT',
        author: parseRawAuthor(node.authorExternalChannelId, node.authorName, node.authorAvatar?.avatarViewModel?.image, undefined, undefined),
        text: body,
        runs: body ? [{ text: body }] : [],
      },
    }
  }

  if (item.liveChatModeChangeMessageRenderer) {
    const node = item.liveChatModeChangeMessageRenderer
    if (!node.id) return {}
    const head = rawText(node.text).trim()
    const sub = rawText(node.subtext).trim()
    const combined = [head, sub].filter(Boolean).join(' - ')
    const slowModeUpdate = parseSlowModeSeconds(combined)
    if (!combined) return { slowModeUpdate }
    return {
      slowModeUpdate,
      message: {
        id: node.id,
        kind: 'SYSTEM',
        text: combined,
        runs: [{ text: combined }],
        timestampText: rawText(node.timestampText) || undefined,
        iconType: node.icon?.iconType,
      },
    }
  }

  if (item.liveChatViewerEngagementMessageRenderer) {
    const node = item.liveChatViewerEngagementMessageRenderer
    const body = rawText(node.message).trim()
    if (!node.id || !body) return {}
    return {
      message: {
        id: node.id,
        kind: 'SYSTEM',
        text: body,
        runs: rawRuns(node.message),
        iconType: node.icon?.iconType,
      },
    }
  }

  return {}
}

type RawPollRenderer = {
  liveChatPollId?: string
  header?: {
    pollHeaderRenderer?: {
      pollQuestion?: RawText
      metadataText?: RawText
      liveChatPollType?: string
    }
  }
  choices?: {
    text?: RawText
    selected?: boolean
    voteRatioIfSelected?: number
    voteRatioIfNotSelected?: number
    votePercentageIfSelected?: RawText
    votePercentageIfNotSelected?: RawText
    serviceEndpoint?: {
      commandMetadata?: { webCommandMetadata?: { apiUrl?: string } }
      sendLiveChatVoteEndpoint?: { params?: string }
      liveChatActionEndpoint?: { params?: string }
      liveChatPollChoiceClickedEndpoint?: { params?: string }
    }
  }[]
}

const parseVoteParams = (choice: NonNullable<RawPollRenderer['choices']>[number]): string | undefined => {
  const endpoint = choice.serviceEndpoint
  if (!endpoint) return undefined
  const params = endpoint.sendLiveChatVoteEndpoint?.params
    ?? endpoint.liveChatActionEndpoint?.params
    ?? endpoint.liveChatPollChoiceClickedEndpoint?.params
  if (!params) return undefined
  const rawUrl = endpoint.commandMetadata?.webCommandMetadata?.apiUrl ?? '/youtubei/v1/live_chat/live_chat_action'
  const path = rawUrl.replace(/^\/youtubei\/v1/, '')
  if (!/^\/live_chat\/[a-z_]+$/.test(path)) return undefined
  return JSON.stringify({ endpoint: path, params })
}

const parseRawPoll = (poll: RawPollRenderer | undefined): SourceLiveChatPoll | undefined => {
  const id = poll?.liveChatPollId
  if (!id) return undefined
  const choices: SourceLiveChatPollChoice[] = (poll.choices ?? []).map((choice, index) => {
    const label = rawText(choice.text)
    const selected = choice.selected === true
    const ratio = selected ? choice.voteRatioIfSelected : choice.voteRatioIfNotSelected
    const pct = rawText(selected ? choice.votePercentageIfSelected : choice.votePercentageIfNotSelected)
    const voteParams = parseVoteParams(choice)
    return {
      id: String(index),
      text: label,
      runs: rawRuns(choice.text),
      ...(pct ? { votePercentage: pct } : {}),
      ...(typeof ratio === 'number' && Number.isFinite(ratio) ? { voteRatio: ratio } : {}),
      ...(selected ? { selected: true } : {}),
      ...(voteParams ? { voteParams } : {}),
    }
  })
  return {
    id,
    question: rawText(poll.header?.pollHeaderRenderer?.pollQuestion),
    questionRuns: rawRuns(poll.header?.pollHeaderRenderer?.pollQuestion),
    metadataText: rawText(poll.header?.pollHeaderRenderer?.metadataText) || undefined,
    choices,
    ...(poll.header?.pollHeaderRenderer?.liveChatPollType === 'LIVE_CHAT_POLL_TYPE_CLOSED' ? { finished: true } : {}),
  }
}

const parseRawPinned = (banner: unknown): SourceLiveChatPinnedMessage | undefined => {
  const node = banner as {
    liveChatBannerRenderer?: {
      actionId?: string
      targetId?: string
      bannerType?: string
      header?: { liveChatBannerHeaderRenderer?: { text?: RawText } }
      contents?: RawItemEnvelope
    }
  } | undefined
  const renderer = node?.liveChatBannerRenderer
  if (!renderer?.contents) return undefined
  if (renderer.bannerType && renderer.bannerType !== 'LIVE_CHAT_BANNER_TYPE_PINNED_MESSAGE') return undefined
  const parsed = parseRawChatItem(renderer.contents).message
  if (!parsed) return undefined
  const id = renderer.actionId ?? renderer.targetId ?? parsed.id
  const header = rawText(renderer.header?.liveChatBannerHeaderRenderer?.text) || undefined
  return { id, ...(header ? { header } : {}), message: parsed }
}

const parseRawTickerItem = (envelope: unknown): SourceLiveChatTickerItem | undefined => {
  const item = envelope as {
    liveChatTickerPaidMessageItemRenderer?: {
      id?: string
      amount?: RawText
      amountTextColor?: number
      startBackgroundColor?: number
      durationSec?: number
      authorUsername?: RawText
      authorName?: RawText
      authorPhoto?: RawThumbList
      showItemEndpoint?: {
        showLiveChatItemEndpoint?: { renderer?: { liveChatPaidMessageRenderer?: { message?: RawText } } }
      }
    }
    liveChatTickerPaidStickerItemRenderer?: {
      id?: string
      purchaseAmountText?: RawText
      amountTextColor?: number
      startBackgroundColor?: number
      durationSec?: number
      authorPhoto?: RawThumbList
    }
    liveChatTickerSponsorItemRenderer?: {
      id?: string
      detailText?: RawText
      durationSec?: number
      sponsorPhoto?: RawThumbList
    }
  } | undefined
  if (!item) return undefined
  if (item.liveChatTickerPaidMessageItemRenderer) {
    const t = item.liveChatTickerPaidMessageItemRenderer
    const label = rawText(t.amount).trim()
    if (!t.id || !label) return undefined
    const detailText = rawText(t.showItemEndpoint?.showLiveChatItemEndpoint?.renderer?.liveChatPaidMessageRenderer?.message).trim()
    return {
      id: t.id,
      label,
      avatar: rawThumb(t.authorPhoto, AVATAR_WIDTH),
      authorName: rawText(t.authorUsername ?? t.authorName).trim() || undefined,
      backgroundColor: argbColor(t.startBackgroundColor),
      textColor: argbColor(t.amountTextColor) ?? '#ffffff',
      ...(typeof t.durationSec === 'number' ? { durationSeconds: t.durationSec } : {}),
      ...(detailText ? { detailText } : {}),
    }
  }
  if (item.liveChatTickerPaidStickerItemRenderer) {
    const t = item.liveChatTickerPaidStickerItemRenderer
    if (!t.id) return undefined
    return {
      id: t.id,
      label: rawText(t.purchaseAmountText).trim() || 'Sticker',
      avatar: rawThumb(t.authorPhoto, AVATAR_WIDTH),
      backgroundColor: argbColor(t.startBackgroundColor),
      textColor: argbColor(t.amountTextColor) ?? '#ffffff',
      ...(typeof t.durationSec === 'number' ? { durationSeconds: t.durationSec } : {}),
    }
  }
  if (item.liveChatTickerSponsorItemRenderer) {
    const t = item.liveChatTickerSponsorItemRenderer
    if (!t.id) return undefined
    return {
      id: t.id,
      label: rawText(t.detailText).trim() || 'Member',
      avatar: rawThumb(t.sponsorPhoto, AVATAR_WIDTH),
      backgroundColor: '#0f7b3e',
      textColor: '#ffffff',
      ...(typeof t.durationSec === 'number' ? { durationSeconds: t.durationSec } : {}),
    }
  }
  return undefined
}

const parseRawActionPanel = (
  actionPanel: unknown,
): { inputState?: SourceLiveChatInputState, sendParams?: string, clearSendParams: boolean } => {
  const panel = actionPanel as {
    liveChatMessageInputRenderer?: {
      maxInputLength?: number
      inputField?: {
        liveChatTextInputFieldRenderer?: {
          placeholder?: RawText
          maxCharacterLimit?: number
        }
      }
      sendButton?: {
        buttonRenderer?: {
          serviceEndpoint?: {
            sendLiveChatMessageEndpoint?: { params?: string }
          }
        }
      }
      interactionMessage?: { messageRenderer?: { text?: RawText } }
    }
    liveChatRestrictedParticipationRenderer?: {
      message?: RawText
    }
    messageRenderer?: {
      text?: RawText
      button?: {
        buttonRenderer?: {
          text?: RawText
          navigationEndpoint?: { signInEndpoint?: unknown }
        }
      }
    }
  } | undefined

  if (!panel) return { clearSendParams: false }

  if (panel.liveChatMessageInputRenderer) {
    const input = panel.liveChatMessageInputRenderer
    const field = input.inputField?.liveChatTextInputFieldRenderer
    const placeholder = rawText(field?.placeholder).trim() || 'Chat…'
    const maxLength = field?.maxCharacterLimit ?? input.maxInputLength
    const sendParams = input.sendButton?.buttonRenderer?.serviceEndpoint?.sendLiveChatMessageEndpoint?.params
    const interaction = rawText(input.interactionMessage?.messageRenderer?.text).trim()
    const slowModeSeconds = interaction ? parseSlowModeSeconds(interaction) : undefined
    return {
      inputState: {
        status: 'ENABLED',
        placeholder,
        ...(typeof maxLength === 'number' && Number.isFinite(maxLength) ? { maxLength } : {}),
        ...(slowModeSeconds !== undefined ? { slowModeSeconds } : {}),
      },
      sendParams,
      clearSendParams: !sendParams,
    }
  }

  if (panel.liveChatRestrictedParticipationRenderer) {
    const restrictionMessage = rawText(panel.liveChatRestrictedParticipationRenderer.message).trim()
      || 'Chat participation is currently restricted.'
    const restrictionMode = classifyRestrictionMode(restrictionMessage)
    const slowModeSeconds = restrictionMode === 'SLOW_MODE' ? parseSlowModeSeconds(restrictionMessage) : undefined
    return {
      inputState: {
        status: 'RESTRICTED',
        restrictionMessage,
        restrictionMode,
        ...(slowModeSeconds !== undefined ? { slowModeSeconds } : {}),
      },
      clearSendParams: true,
    }
  }

  if (panel.messageRenderer) {
    const msg = rawText(panel.messageRenderer.text).trim()
    const btnText = rawText(panel.messageRenderer.button?.buttonRenderer?.text).trim()
    const isSignIn = Boolean(panel.messageRenderer.button?.buttonRenderer?.navigationEndpoint?.signInEndpoint)
      || /sign in/i.test(msg)
      || /sign in/i.test(btnText)
    if (isSignIn) {
      return {
        inputState: {
          status: 'SIGN_IN_REQUIRED',
          restrictionMessage: msg || btnText || 'Sign in to chat',
        },
        clearSendParams: true,
      }
    }
    const text = msg || btnText
    if (text) {
      return {
        inputState: {
          status: 'RESTRICTED',
          restrictionMessage: text,
          restrictionMode: classifyRestrictionMode(text),
        },
        clearSendParams: true,
      }
    }
  }

  return { clearSendParams: false }
}

const parseLeaderboardEntryPoint = (node: unknown): SourceLiveChatLeaderboardEntryPoint | undefined => {
  const vm = (node as {
    liveViewerLeaderboardChatEntryPointViewModel?: {
      defaultButton?: { buttonViewModel?: RawButtonViewModel }
      pointsButton?: { buttonViewModel?: RawButtonViewModel }
    }
  } | undefined)?.liveViewerLeaderboardChatEntryPointViewModel
  if (!vm) return undefined
  const btn = vm.pointsButton?.buttonViewModel ?? vm.defaultButton?.buttonViewModel
  const ep = btn?.onTap?.innertubeCommand?.showEngagementPanelEndpoint
  const params = ep?.globalConfiguration?.params
  if (!params) return undefined
  return {
    label: btn?.title?.trim() || btn?.accessibilityText?.trim() || 'Top fans',
    panelId: ep?.identifier?.tag || 'PAlive_viewer_leaderboard',
    params,
  }
}

/** Extracts the live chat initial continuation from a `/next` response (excluding replays). */
export const liveChatToken = (input: unknown): string | undefined => {
  const parsed = input as {
    contents_memo?: { get(type: string): unknown[] | undefined }
    contents?: {
      twoColumnWatchNextResults?: {
        conversationBar?: {
          liveChatRenderer?: {
            isReplay?: boolean
            continuations?: { reloadContinuationData?: { continuation?: string } }[]
          }
        }
      }
    }
  } | undefined
  const parsedBar = parsed?.contents_memo?.get('TwoColumnWatchNextResults')?.[0] as {
    conversation_bar?: { is_replay?: boolean, continuation?: string } | null
  } | undefined
  if (parsedBar?.conversation_bar) {
    return parsedBar.conversation_bar.is_replay === true ? undefined : parsedBar.conversation_bar.continuation
  }
  const rawRenderer = parsed?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer
  if (!rawRenderer || rawRenderer.isReplay === true) return undefined
  return rawRenderer.continuations?.[0]?.reloadContinuationData?.continuation
}

/** Computes responsive polling delay in milliseconds without `SmoothedQueue`'s 2-second floor on active chat. */
export const nextLiveChatDelayMs = ({
  continuationType,
  timeoutMs,
  gotItems,
  quietStreak,
}: {
  continuationType?: 'timed' | 'invalidation'
  timeoutMs?: number
  gotItems: boolean
  quietStreak: number
}) => {
  if (continuationType === 'timed' && typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.min(3_000, Math.max(1_000, timeoutMs))
  }
  return gotItems ? 1_000 : Math.min(2_500, 1_200 + Math.max(0, quietStreak) * 400)
}

/** Merges `liveChatPollStateEntity` mutations onto an existing `SourceLiveChatPoll`. */
export const applyPollPatch = (
  poll: SourceLiveChatPoll | undefined,
  patch: LiveChatPollEntityPatch | undefined,
): SourceLiveChatPoll | undefined => {
  if (!poll || !patch) return poll
  return {
    ...poll,
    metadataText: patch.metadataText ?? poll.metadataText,
    choices: poll.choices.map((choice, index) => {
      const state = patch.choices.get(index)
      if (!state) return choice
      return {
        ...choice,
        ...(state.votePercentage ? { votePercentage: state.votePercentage } : {}),
        ...(state.voteRatio !== undefined ? { voteRatio: state.voteRatio } : {}),
      }
    }),
  }
}

/** Parses a raw `live_chat/get_live_chat` InnerTube response into messages, controls, polls, leaderboard, and entity updates. */
export const parseLiveChatResponse = (raw: unknown): ParsedLiveChatResponse => {
  const data = raw as {
    continuationContents?: {
      liveChatContinuation?: {
        continuations?: {
          timedContinuationData?: { continuation?: string, timeoutMs?: number }
          invalidationContinuationData?: { continuation?: string, timeoutMs?: number }
        }[]
        header?: {
          liveChatHeaderRenderer?: {
            viewSelector?: {
              sortFilterSubMenuRenderer?: {
                subMenuItems?: {
                  selected?: boolean
                  continuation?: string | { reloadContinuationData?: { continuation?: string } }
                }[]
              }
            }
            viewerLeaderboardEntryPoint?: unknown
          }
        }
        emojis?: {
          emojiId?: string
          shortcuts?: string[]
          image?: RawThumbList
          isCustomEmoji?: boolean
        }[]
        actionPanel?: unknown
        actions?: Record<string, unknown>[]
      }
    }
    frameworkUpdates?: {
      entityBatchUpdate?: {
        mutations?: {
          payload?: {
            liveChatPollStateEntity?: {
              metadataText?: RawText
              pollChoiceStates?: {
                key?: number | string
                value?: {
                  voteRatio?: number
                  votePercentage?: RawText
                }
              }[]
            }
            emojiFountainDataEntity?: {
              reactionBuckets?: { totalReactions?: number }[]
            }
          }
        }[]
      }
    }
  } | undefined

  const lcc = data?.continuationContents?.liveChatContinuation
  if (!lcc) {
    return {
      ended: true,
      items: [],
      removedIds: [],
      removedAuthorIds: [],
      removedBannerIds: [],
      customEmojis: [],
      clearSendParams: false,
      pollCleared: false,
      tickerItems: [],
      reactionBurst: 0,
    }
  }

  const contEntry = lcc.continuations?.[0]
  const timed = contEntry?.timedContinuationData
  const invalidation = contEntry?.invalidationContinuationData
  const token = timed?.continuation ?? invalidation?.continuation
  const continuation = token
    ? {
        token,
        type: timed ? ('timed' as const) : ('invalidation' as const),
        timeoutMs: timed?.timeoutMs ?? invalidation?.timeoutMs,
      }
    : undefined

  const subItems = lcc.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems ?? []
  const extractToken = (item: (typeof subItems)[number] | undefined) =>
    typeof item?.continuation === 'string'
      ? item.continuation
      : item?.continuation?.reloadContinuationData?.continuation
  const topToken = extractToken(subItems[0])
  const allToken = extractToken(subItems[1])
  const viewTokens = topToken || allToken ? { TOP: topToken, ALL: allToken } : undefined
  const selectedView: SourceChatReplayView | undefined = subItems[1]?.selected === true
    ? 'ALL'
    : subItems[0]?.selected === true
      ? 'TOP'
      : undefined

  const seenEmoji = new Set<string>()
  const customEmojis: SourceLiveChatEmoji[] = []
  for (const entry of lcc.emojis ?? []) {
    if (entry.isCustomEmoji === false) continue
    const shortcut = entry.shortcuts?.find((s) => Boolean(s?.trim()))
    const url = rawThumb(entry.image, EMOJI_WIDTH)
    if (!shortcut || !url || seenEmoji.has(shortcut)) continue
    seenEmoji.add(shortcut)
    customEmojis.push({ id: entry.emojiId ?? shortcut, shortcut, url })
  }

  const { inputState, sendParams, clearSendParams } = parseRawActionPanel(lcc.actionPanel)
  const leaderboard = parseLeaderboardEntryPoint(lcc.header?.liveChatHeaderRenderer?.viewerLeaderboardEntryPoint)

  const items: SourceLiveChatMessage[] = []
  const removedIds: string[] = []
  const removedAuthorIds: string[] = []
  const removedBannerIds: string[] = []
  const tickerItems: SourceLiveChatTickerItem[] = []
  let pinned: SourceLiveChatPinnedMessage | undefined
  let poll: SourceLiveChatPoll | undefined
  let pollCleared = false
  let slowModeUpdate: number | undefined

  for (const action of lcc.actions ?? []) {
    const addItem = action.addChatItemAction as { item?: unknown } | undefined
    if (addItem?.item) {
      const parsed = parseRawChatItem(addItem.item)
      if (parsed.message) items.push(parsed.message)
      if (parsed.slowModeUpdate !== undefined) slowModeUpdate = parsed.slowModeUpdate
      continue
    }

    const replaceItem = action.replaceChatItemAction as { replacementItem?: unknown } | undefined
    if (replaceItem?.replacementItem) {
      const parsed = parseRawChatItem(replaceItem.replacementItem)
      if (parsed.message) items.push(parsed.message)
      continue
    }

    const removeItem = (action.removeChatItemAction ?? action.markChatItemAsDeletedAction) as { targetItemId?: string } | undefined
    if (removeItem?.targetItemId) {
      removedIds.push(removeItem.targetItemId)
      continue
    }

    const removeByAuthor = (action.removeChatItemByAuthorAction ?? action.markChatItemsByAuthorAsDeletedAction) as {
      externalChannelId?: string
    } | undefined
    if (removeByAuthor?.externalChannelId) {
      removedAuthorIds.push(removeByAuthor.externalChannelId)
      continue
    }

    const addBanner = action.addBannerToLiveChatCommand as { bannerRenderer?: unknown } | undefined
    if (addBanner?.bannerRenderer) {
      const parsedPin = parseRawPinned(addBanner.bannerRenderer)
      if (parsedPin) pinned = parsedPin
      continue
    }

    const removeBanner = action.removeBannerForLiveChatCommand as { targetActionId?: string } | undefined
    if (removeBanner?.targetActionId) {
      removedBannerIds.push(removeBanner.targetActionId)
      continue
    }

    const showPanel = action.showLiveChatActionPanelAction as {
      panelToShow?: { liveChatActionPanelRenderer?: { contents?: { pollRenderer?: RawPollRenderer } } }
    } | undefined
    const shownPoll = showPanel?.panelToShow?.liveChatActionPanelRenderer?.contents?.pollRenderer
    if (shownPoll) {
      const parsedPoll = parseRawPoll(shownPoll)
      if (parsedPoll) {
        poll = parsedPoll
        pollCleared = false
      }
      continue
    }

    const updatePoll = action.updateLiveChatPollAction as {
      pollToUpdate?: { pollRenderer?: RawPollRenderer }
    } | undefined
    if (updatePoll?.pollToUpdate?.pollRenderer) {
      const parsedPoll = parseRawPoll(updatePoll.pollToUpdate.pollRenderer)
      if (parsedPoll) {
        poll = parsedPoll
        pollCleared = false
      }
      continue
    }

    if (action.closeLiveChatActionPanelAction) {
      poll = undefined
      pollCleared = true
      continue
    }

    const ticker = action.addLiveChatTickerItemAction as { item?: unknown } | undefined
    if (ticker?.item) {
      const parsedTicker = parseRawTickerItem(ticker.item)
      if (parsedTicker) tickerItems.push(parsedTicker)
    }
  }

  let pollPatch: LiveChatPollEntityPatch | undefined
  let totalReactions = 0

  for (const mutation of data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? []) {
    const pollState = mutation.payload?.liveChatPollStateEntity
    if (pollState) {
      const choices = new Map<number, { votePercentage?: string, voteRatio?: number }>()
      for (const state of pollState.pollChoiceStates ?? []) {
        const index = Number(state.key)
        if (!Number.isInteger(index) || index < 0) continue
        const ratio = state.value?.voteRatio
        const pct = rawText(state.value?.votePercentage).trim()
          || (typeof ratio === 'number' && Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : undefined)
        choices.set(index, {
          ...(pct ? { votePercentage: pct } : {}),
          ...(typeof ratio === 'number' && Number.isFinite(ratio) ? { voteRatio: ratio } : {}),
        })
      }
      pollPatch = {
        metadataText: rawText(pollState.metadataText).trim() || undefined,
        choices,
      }
    }

    const fountain = mutation.payload?.emojiFountainDataEntity
    if (fountain?.reactionBuckets) {
      for (const bucket of fountain.reactionBuckets) {
        if (typeof bucket.totalReactions === 'number' && bucket.totalReactions > 0) {
          totalReactions += bucket.totalReactions
        }
      }
    }
  }

  if (poll && pollPatch) poll = applyPollPatch(poll, pollPatch)

  return {
    continuation,
    ended: !continuation,
    viewTokens,
    selectedView,
    items,
    removedIds,
    removedAuthorIds,
    removedBannerIds,
    pinned,
    customEmojis,
    inputState,
    sendParams,
    clearSendParams,
    slowModeUpdate,
    leaderboard,
    poll,
    pollCleared,
    pollPatch: poll ? undefined : pollPatch,
    tickerItems,
    reactionBurst: Math.min(MAX_REACTION_BURST, totalReactions),
  }
}

/** Parses `/get_panel` `PAlive_viewer_leaderboard` JSON into ranked Top fans items. */
export const parseLiveChatLeaderboard = (raw: unknown): SourceLiveChatLeaderboard => {
  const data = raw as {
    content?: {
      engagementPanelSectionListRenderer?: {
        header?: { engagementPanelTitleHeaderRenderer?: { title?: RawText } }
        content?: {
          sectionListRenderer?: {
            contents?: {
              itemSectionRenderer?: {
                contents?: {
                  liveLeaderboardItemViewModel?: {
                    rank?: RawText
                    points?: RawText
                    avatar?: { avatarViewModel?: { image?: RawThumbList } }
                    content?: {
                      liveLeaderboardItemChannelContentViewModel?: {
                        displayName?: RawText
                        badge?: { buttonViewModel?: RawButtonViewModel }
                      }
                    }
                  }
                }[]
              }
            }[]
          }
        }
      }
    }
  } | undefined

  const panel = data?.content?.engagementPanelSectionListRenderer
  const title = rawText(panel?.header?.engagementPanelTitleHeaderRenderer?.title).trim() || 'Top fans'
  const items: SourceLiveChatLeaderboardItem[] = []
  for (const section of panel?.content?.sectionListRenderer?.contents ?? []) {
    for (const entry of section.itemSectionRenderer?.contents ?? []) {
      const vm = entry.liveLeaderboardItemViewModel
      if (!vm) continue
      const rank = rawText(vm.rank).trim()
      const channelContent = vm.content?.liveLeaderboardItemChannelContentViewModel
      const displayName = rawText(channelContent?.displayName).trim()
      if (!rank || !displayName) continue
      const badge = channelContent?.badge?.buttonViewModel
      const badgeLabel = badge?.title?.trim() || badge?.accessibilityText?.trim()
      items.push({
        rank,
        displayName,
        avatar: rawThumb(vm.avatar?.avatarViewModel?.image, AVATAR_WIDTH),
        points: rawText(vm.points).trim() || undefined,
        ...(badgeLabel ? { badgeLabel } : {}),
        ...(argbColor(badge?.customBackgroundColor) ? { badgeBackgroundColor: argbColor(badge?.customBackgroundColor) } : {}),
        ...(argbColor(badge?.customFontColor) ? { badgeTextColor: argbColor(badge?.customFontColor) } : {}),
      })
    }
  }
  return { title, items }
}

/** Extracts immediate sent-message echo or readable restriction/cooldown error from `/live_chat/send_message`. */
export const parseSendLiveChatResult = (
  raw: unknown,
): { addedMessages: SourceLiveChatMessage[], errorMessage?: string } => {
  const data = raw as {
    error?: { message?: string }
    actions?: {
      addChatItemAction?: { item?: unknown }
      addBannerToLiveChatCommand?: {
        bannerRenderer?: { liveChatBannerRenderer?: { header?: { liveChatBannerHeaderRenderer?: { text?: RawText } }, contents?: RawItemEnvelope } }
      }
      showLiveChatTooltipCommand?: {
        tooltip?: { tooltipRenderer?: { text?: RawText, detailsText?: RawText } }
      }
      liveChatErrorMessageRenderer?: { errorText?: RawText }
    }[]
  } | undefined

  const addedMessages: SourceLiveChatMessage[] = []
  let errorMessage = data?.error?.message?.trim() || undefined

  for (const action of data?.actions ?? []) {
    if (action.addChatItemAction?.item) {
      const parsed = parseRawChatItem(action.addChatItemAction.item).message
      if (parsed) addedMessages.push(parsed)
    }
    const tooltip = action.showLiveChatTooltipCommand?.tooltip?.tooltipRenderer
    if (!errorMessage && tooltip) {
      errorMessage = [rawText(tooltip.text).trim(), rawText(tooltip.detailsText).trim()].filter(Boolean).join(' ') || undefined
    }
    const errRenderer = action.liveChatErrorMessageRenderer
    if (!errorMessage && errRenderer) {
      errorMessage = rawText(errRenderer.errorText).trim() || undefined
    }
    if (!errorMessage && action.addBannerToLiveChatCommand && addedMessages.length === 0) {
      const msg = parseRawChatItem(action.addBannerToLiveChatCommand.bannerRenderer?.liveChatBannerRenderer?.contents).message
      if (msg?.kind === 'SYSTEM' && msg.text) errorMessage = msg.text
    }
  }

  return { addedMessages, errorMessage }
}
