import type { Group } from '../groups/store'

import { groupChannelsWithDescendants } from '../groups/store'

export type ChannelSort = 'default' | 'name-asc' | 'name-desc' | 'subscribers' | 'latest-upload' | 'oldest-upload'

export type ActivityWindow = 'all' | '7d' | '30d' | '90d' | '365d' | 'inactive-365d' | 'custom'

export type UploadDateRange = {
  from?: string
  to?: string
}

export type ParsedDateRange = {
  fromMs?: number
  toMs?: number
  inverted: boolean
}

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

const WINDOW_DAYS: Record<Exclude<ActivityWindow, 'all' | 'inactive-365d' | 'custom'>, number> = {
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
  dateRange?: UploadDateRange
  sort: ChannelSort
  /** Channel id -> ISO timestamp of newest upload, or null when checked and empty. Undefined means not loaded yet. */
  lastUploadAt: Readonly<Record<string, string | null | undefined>>
  /** Keep unchecked channels visible (after confirmed matches) while upload dates are still fetching. */
  includePending?: boolean
  now?: number
}

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const parseLocalDate = (raw?: string): { year: number, month: number, day: number } | undefined => {
  if (!raw) return undefined
  const match = DATE_INPUT_RE.exec(raw.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(year, month - 1, day)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return undefined
  return { year, month, day }
}

/** Parses YYYY-MM-DD bounds into local day timestamps and flags inverted ranges. */
export const parseDateRange = (range?: UploadDateRange): ParsedDateRange => {
  const from = parseLocalDate(range?.from)
  const to = parseLocalDate(range?.to)
  const fromMs = from ? new Date(from.year, from.month - 1, from.day, 0, 0, 0, 0).getTime() : undefined
  const toMs = to ? new Date(to.year, to.month - 1, to.day, 23, 59, 59, 999).getTime() : undefined
  return {
    fromMs,
    toMs,
    inverted: Boolean(fromMs !== undefined && toMs !== undefined && fromMs > toMs),
  }
}

/** Formats an epoch timestamp as a local YYYY-MM-DD value for native date inputs. */
export const formatLocalDateInput = (ms: number): string => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Builds a local YYYY-MM-DD date range spanning `days` days up to today. */
export const relativeDateRange = (days: number, now = Date.now()): UploadDateRange => ({
  from: formatLocalDateInput(now - days * DAY_MS),
  to: formatLocalDateInput(now),
})

/** Builds a calendar-year YYYY-MM-DD range for the current or previous year. */
export const calendarYearRange = (offsetYears: 0 | -1, now = Date.now()): UploadDateRange => {
  const year = new Date(now).getFullYear() + offsetYears
  return {
    from: `${year}-01-01`,
    to: offsetYears === 0 ? formatLocalDateInput(now) : `${year}-12-31`,
  }
}

const uploadMs = (iso: string | null | undefined) => {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

/** Filters subscribed channels by name/handle/description, group membership and last upload date, then sorts them. */
export const filterAndSortChannels = <Channel extends SubscribedChannelItem>(
  channels: readonly Channel[],
  { query, groupId, groups, activity, dateRange, sort, lastUploadAt, includePending = false, now = Date.now() }: ChannelFilterOptions,
): Channel[] => {
  const needle = query.trim().toLowerCase()
  const groupedIds = groupId === 'ungrouped'
    ? new Set(groups.flatMap(group => group.channels.map(channel => channel.id)))
    : undefined
  const selectedGroupIds = groupId !== 'all' && groupId !== 'ungrouped'
    ? new Set(groupChannelsWithDescendants(groups, groupId).map(channel => channel.id))
    : undefined
  const customRange = activity === 'custom' ? parseDateRange(dateRange) : undefined
  const hasCustomBounds = Boolean(
    activity === 'custom'
    && customRange
    && !customRange.inverted
    && (customRange.fromMs !== undefined || customRange.toMs !== undefined),
  )
  const hasDateFilter = (activity !== 'all' && activity !== 'custom') || hasCustomBounds

  const filtered = channels.filter(channel => {
    if (needle) {
      const hay = `${channel.name} ${channel.handle ?? ''} ${channel.description ?? ''}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (groupedIds && groupedIds.has(channel.id)) return false
    if (selectedGroupIds && !selectedGroupIds.has(channel.id)) return false
    if (activity === 'custom') {
      if (customRange?.inverted) return false
      if (hasCustomBounds && customRange) {
        const entry = lastUploadAt[channel.id]
        if (entry === undefined) return includePending
        const at = uploadMs(entry)
        if (at === undefined) return false
        if (customRange.fromMs !== undefined && at < customRange.fromMs) return false
        if (customRange.toMs !== undefined && at > customRange.toMs) return false
      }
    } else if (activity !== 'all') {
      const entry = lastUploadAt[channel.id]
      if (entry === undefined) return includePending
      const at = uploadMs(entry)
      if (activity === 'inactive-365d') {
        if (at !== undefined && now - at < 365 * DAY_MS) return false
      } else {
        if (at === undefined || now - at > WINDOW_DAYS[activity] * DAY_MS) return false
      }
    }
    return true
  })

  const ordered = sort === 'default'
    ? filtered
    : sort === 'name-asc'
      ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      : sort === 'name-desc'
        ? [...filtered].sort((a, b) => b.name.localeCompare(a.name))
        : sort === 'subscribers'
          ? [...filtered].sort((a, b) => (parseSubscribers(b.subscriberCountText) ?? -1) - (parseSubscribers(a.subscriberCountText) ?? -1))
          : [...filtered].sort((a, b) => {
            const direction = sort === 'latest-upload' ? -1 : 1
            const aMs = uploadMs(lastUploadAt[a.id])
            const bMs = uploadMs(lastUploadAt[b.id])
            if (aMs === undefined && bMs === undefined) return 0
            if (aMs === undefined) return 1
            if (bMs === undefined) return -1
            return (aMs - bMs) * direction
          })

  if (!includePending || !hasDateFilter) return ordered
  return [
    ...ordered.filter(channel => lastUploadAt[channel.id] !== undefined),
    ...ordered.filter(channel => lastUploadAt[channel.id] === undefined),
  ]
}
