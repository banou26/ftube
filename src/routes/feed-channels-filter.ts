import type { Group } from '../groups/store'

import { groupChannelsWithDescendants } from '../groups/store'

export type ChannelSort = 'default' | 'name-asc' | 'name-desc' | 'subscribers' | 'latest-upload' | 'oldest-upload'

export type ActivityWindow = 'all' | '7d' | '30d' | '90d' | '365d' | 'inactive-365d'

export type SubscribedChannelItem = {
  id: string
  name: string
  avatar?: string | null
  handle?: string | null
  subscriberCountText?: string | null
  videoCountText?: string | null
  description?: string | null
  isSubscribed?: boolean | null
  isVerified?: boolean | null
  isVerifiedArtist?: boolean | null
}

const DAY_MS = 86_400_000

const WINDOW_DAYS: Record<Exclude<ActivityWindow, 'all' | 'inactive-365d'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
}

const SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }

/** Approximate subscriber count from text like '1.2M subscribers', or undefined when absent or unreadable. */
export const parseSubscribers = (text?: string | null): number | undefined => {
  if (!text) return undefined
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?\b/i)
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base)) return undefined
  const scale = match[2] ? SUFFIX[match[2].toLowerCase()] ?? 1 : 1
  return Math.round(base * scale)
}

export type ChannelFilterOptions = {
  query: string
  groupId: string
  groups: readonly Group[]
  activity: ActivityWindow
  sort: ChannelSort
  /** Channel id -> ISO timestamp of newest upload, or null when checked and empty. Undefined means not loaded yet. */
  lastUploadAt: Readonly<Record<string, string | null | undefined>>
  now?: number
}

const uploadMs = (iso: string | null | undefined) => {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

/** Filters subscribed channels by name/handle/description, group membership and last upload date, then sorts them. */
export const filterAndSortChannels = <Channel extends SubscribedChannelItem>(
  channels: readonly Channel[],
  { query, groupId, groups, activity, sort, lastUploadAt, now = Date.now() }: ChannelFilterOptions,
): Channel[] => {
  const needle = query.trim().toLowerCase()
  const groupedIds = groupId === 'ungrouped'
    ? new Set(groups.flatMap(group => group.channels.map(channel => channel.id)))
    : undefined
  const selectedGroupIds = groupId !== 'all' && groupId !== 'ungrouped'
    ? new Set(groupChannelsWithDescendants(groups, groupId).map(channel => channel.id))
    : undefined

  const filtered = channels.filter(channel => {
    if (needle) {
      const hay = `${channel.name} ${channel.handle ?? ''} ${channel.description ?? ''}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (groupedIds && groupedIds.has(channel.id)) return false
    if (selectedGroupIds && !selectedGroupIds.has(channel.id)) return false
    if (activity !== 'all') {
      const entry = lastUploadAt[channel.id]
      if (entry === undefined) return false
      const at = uploadMs(entry)
      if (activity === 'inactive-365d') {
        if (at !== undefined && now - at < 365 * DAY_MS) return false
      } else {
        if (at === undefined || now - at > WINDOW_DAYS[activity] * DAY_MS) return false
      }
    }
    return true
  })

  if (sort === 'default') return filtered
  const sorted = [...filtered]
  if (sort === 'name-asc') return sorted.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'name-desc') return sorted.sort((a, b) => b.name.localeCompare(a.name))
  if (sort === 'subscribers') {
    return sorted.sort((a, b) => (parseSubscribers(b.subscriberCountText) ?? -1) - (parseSubscribers(a.subscriberCountText) ?? -1))
  }
  const direction = sort === 'latest-upload' ? -1 : 1
  return sorted.sort((a, b) => {
    const aMs = uploadMs(lastUploadAt[a.id])
    const bMs = uploadMs(lastUploadAt[b.id])
    if (aMs === undefined && bMs === undefined) return 0
    if (aMs === undefined) return 1
    if (bMs === undefined) return -1
    return (aMs - bMs) * direction
  })
}
