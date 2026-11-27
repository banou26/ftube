import type { TargetedEvent } from 'preact'

import type { ActivityWindow, ChannelSort, UploadDateRange } from './feed-channels-filter'

import { css } from '@emotion/react'
import { CircleUserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useClient, useQuery } from 'urql'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure } from '../components/data-failure'
import { formatAgo, formatCount } from '../components/format'
import { GroupsButton } from '../components/groups-button'
import { SubscribeButton } from '../components/subscribe-button'
import { VerifiedBadge } from '../components/verified-badge'
import { gql } from '../generated'
import { groupTreeOrder, useGroups } from '../groups/store'
import { useSession } from '../session'
import { signIn } from '../sign-in'
import {
  calendarYearRange,
  filterAndSortChannels,
  formatLocalDateInput,
  parseDateRange,
  relativeDateRange,
} from './feed-channels-filter'

const ALL_SUBSCRIBED_CHANNELS_QUERY = gql(`
  query AllSubscribedChannels {
    subscribedChannels(all: true) {
      id
      name
      avatar
      handle
      subscriberCountText
      videoCountText
      description
      isSubscribed
      notificationLevel
      isVerified
      isVerifiedArtist
    }
  }
`)

const CHANNEL_LAST_UPLOAD_QUERY = gql(`
  query ChannelLastUpload($channelId: ID!, $includeDurations: Boolean) {
    channelUploads(channelId: $channelId, includeDurations: $includeDurations) {
      id
      publishedAt
    }
  }
`)

const style = css`
  max-width: 108rem;
  padding: 2.4rem 1.6rem;

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    margin-bottom: 2rem;
  }

  .heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .count {
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.2rem;
    margin-bottom: 2rem;
  }

  .search {
    flex: 1 1 22rem;
    height: 3.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .select {
    height: 3.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .check-dates {
    height: 3.6rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .check-dates:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .check-dates:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .date-progress {
    width: 100%;
    height: 0.3rem;
    margin: -0.8rem 0 1.6rem;
    border-radius: 999px;
    background: var(--border-subtle);
    overflow: hidden;
  }

  .date-progress-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.15s ease;
  }

  .date-range-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.2rem;
    margin: -0.8rem 0 2rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
  }

  .date-field {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .date-input {
    height: 3.2rem;
    padding: 0 0.8rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
  }

  .date-input:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .range-presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .range-chip {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .range-chip:hover {
    background: var(--bg-chip-hover);
  }

  .range-chip.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .range-error {
    font-size: 1.2rem;
    color: var(--danger);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 1.4rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .avatar-link {
    flex: none;
    width: 7.2rem;
    height: 7.2rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-chip);
  }

  .avatar-link img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-link.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.8rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .description {
    margin: 0.4rem 0 0;
    font-size: 1.2rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .card {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .card h2 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .sign-in {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    margin-top: 1.6rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  @media (max-width: 680px) {
    .row {
      flex-wrap: wrap;
    }

    .avatar-link {
      width: 4.8rem;
      height: 4.8rem;
      font-size: 2rem;
    }

    .actions {
      width: 100%;
    }
  }
`

const newestUpload = (uploads: { publishedAt?: string | null }[]) => {
  let latest: string | null = null
  let latestMs = -Infinity
  for (const upload of uploads) {
    if (!upload.publishedAt) continue
    const ms = Date.parse(upload.publishedAt)
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms
      latest = upload.publishedAt
    }
  }
  return latest
}

const FeedChannelsPage = () => {
  useDocumentTitle('All subscriptions')
  const { ready, signedIn } = useSession()
  const groups = useGroups()
  const client = useClient()
  const [query, setQuery] = useState('')
  const [groupId, setGroupId] = useState('all')
  const [activity, setActivity] = useState<ActivityWindow>('all')
  const [dateRange, setDateRange] = useState<UploadDateRange>({})
  const [sort, setSort] = useState<ChannelSort>('default')
  const [loadDates, setLoadDates] = useState(false)
  const [lastUploadAt, setLastUploadAt] = useState<Record<string, string | null>>({})
  const lastUploadAtRef = useRef(lastUploadAt)
  lastUploadAtRef.current = lastUploadAt

  const [{ data, error, fetching }, reexecute] = useQuery({
    query: ALL_SUBSCRIBED_CHANNELS_QUERY,
    pause: !ready || !signedIn,
  })
  const channels = data?.subscribedChannels ?? []
  const baseChannels = filterAndSortChannels(channels, {
    query,
    groupId,
    groups,
    activity: 'all',
    sort: 'default',
    lastUploadAt,
  })
  const baseChannelKey = baseChannels.map(channel => channel.id).join(',')
  const needsDates = loadDates || activity !== 'all' || sort === 'latest-upload' || sort === 'oldest-upload'

  useEffect(() => {
    if (!needsDates || baseChannels.length === 0) return
    const ids = baseChannels.map(channel => channel.id).filter(id => !(id in lastUploadAtRef.current))
    if (ids.length === 0) return
    let cancelled = false
    let cursor = 0
    const worker = async () => {
      while (!cancelled && cursor < ids.length) {
        const channelId = ids[cursor++]!
        const result = await client.query(
          CHANNEL_LAST_UPLOAD_QUERY,
          { channelId, includeDurations: false },
          { requestPolicy: 'cache-first' },
        ).toPromise()
        if (cancelled) return
        const value = result.data ? newestUpload(result.data.channelUploads) : null
        setLastUploadAt(current => {
          if (current[channelId] === value) return current
          const next = { ...current, [channelId]: value }
          lastUploadAtRef.current = next
          return next
        })
      }
    }
    const workers = Array.from({ length: Math.min(4, ids.length) }, worker)
    void Promise.all(workers)
    return () => {
      cancelled = true
    }
  }, [client, needsDates, baseChannelKey])

  if (!ready) {
    return (
      <main css={style}>
        <div className='head'>
          <h1 className='heading'>All subscriptions</h1>
        </div>
        <p className='notice'>Loading…</p>
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main css={style}>
        <div className='head'>
          <h1 className='heading'>All subscriptions</h1>
        </div>
        <div className='card'>
          <h2>Sign in to see your subscriptions</h2>
          <button type='button' className='sign-in' onClick={signIn}>
            <CircleUserRound size={24} strokeWidth={1.5} />
            Sign in
          </button>
        </div>
      </main>
    )
  }

  const checkedCount = baseChannels.filter(channel => channel.id in lastUploadAt).length
  const datesLoading = needsDates && baseChannels.length > 0 && checkedCount < baseChannels.length
  const parsedRange = activity === 'custom' ? parseDateRange(dateRange) : undefined
  const hasDateFilter = activity === 'custom'
    ? Boolean(parsedRange && !parsedRange.inverted && (parsedRange.fromMs !== undefined || parsedRange.toMs !== undefined))
    : activity !== 'all'
  const todayYmd = formatLocalDateInput(Date.now())
  const datePresets: { label: string, range: UploadDateRange }[] = activity === 'custom'
    ? [
      { label: '14d', range: relativeDateRange(14) },
      { label: '60d', range: relativeDateRange(60) },
      { label: '6m', range: relativeDateRange(180) },
      { label: 'This year', range: calendarYearRange(0) },
      { label: 'Last year', range: calendarYearRange(-1) },
    ]
    : []
  const shown = filterAndSortChannels(channels, {
    query,
    groupId,
    groups,
    activity,
    dateRange,
    sort,
    lastUploadAt,
    includePending: datesLoading,
  })
  const confirmedCount = shown.filter(channel => channel.id in lastUploadAt).length

  return (
    <main css={style}>
      <div className='head'>
        <h1 className='heading'>All subscriptions</h1>
        {channels.length > 0
          ? (
            <span className='count'>
              {datesLoading
                ? hasDateFilter
                  ? `${confirmedCount} matched • checking ${checkedCount} of ${baseChannels.length}`
                  : `${shown.length} of ${formatCount(channels.length, 'channel')} • checked ${checkedCount} of ${baseChannels.length}`
                : shown.length === channels.length
                  ? formatCount(channels.length, 'channel')
                  : `${shown.length} of ${formatCount(channels.length, 'channel')}`}
            </span>
          )
          : undefined}
      </div>
      <div className='controls'>
        <input
          className='search'
          type='search'
          value={query}
          placeholder='Filter channels by name'
          aria-label='Filter channels'
          onInput={(event: TargetedEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
        />
        <select
          className='select'
          aria-label='Filter by group'
          value={groupId}
          onChange={(event: TargetedEvent<HTMLSelectElement>) => setGroupId(event.currentTarget.value)}
        >
          <option value='all'>All groups</option>
          <option value='ungrouped'>Not in any group</option>
          {groupTreeOrder(groups).map(({ group, depth }) => (
            <option key={group.id} value={group.id}>
              {depth > 0 ? `${'\u00a0\u00a0'.repeat(depth)}↳ ` : ''}{group.emoji} {group.name}
            </option>
          ))}
        </select>
        <select
          className='select'
          aria-label='Filter by last video posted'
          value={activity}
          onChange={(event: TargetedEvent<HTMLSelectElement>) => setActivity(event.currentTarget.value as ActivityWindow)}
        >
          <option value='all'>Any upload date</option>
          <option value='7d'>Posted in last 7 days</option>
          <option value='30d'>Posted in last 30 days</option>
          <option value='90d'>Posted in last 90 days</option>
          <option value='365d'>Posted in last year</option>
          <option value='inactive-365d'>Inactive (1+ year)</option>
          <option value='custom'>Custom date range…</option>
        </select>
        <select
          className='select'
          aria-label='Sort channels'
          value={sort}
          onChange={(event: TargetedEvent<HTMLSelectElement>) => setSort(event.currentTarget.value as ChannelSort)}
        >
          <option value='default'>Default order</option>
          <option value='name-asc'>Name (A to Z)</option>
          <option value='name-desc'>Name (Z to A)</option>
          <option value='subscribers'>Most subscribers</option>
          <option value='latest-upload'>Latest video posted</option>
          <option value='oldest-upload'>Oldest video posted</option>
        </select>
        {!needsDates && channels.length > 0
          ? (
            <button type='button' className='check-dates' onClick={() => setLoadDates(true)}>
              Load upload dates
            </button>
          )
          : undefined}
      </div>
      {activity === 'custom'
        ? (
          <div className='date-range-bar'>
            <label className='date-field'>
              <span>From</span>
              <input
                type='date'
                className='date-input'
                aria-label='Upload date from'
                max={dateRange.to || todayYmd}
                value={dateRange.from ?? ''}
                onInput={(event: TargetedEvent<HTMLInputElement>) => {
                  const next = event.currentTarget.value || undefined
                  setDateRange(prev => ({ ...prev, from: next }))
                }}
              />
            </label>
            <label className='date-field'>
              <span>To</span>
              <input
                type='date'
                className='date-input'
                aria-label='Upload date to'
                min={dateRange.from || undefined}
                max={todayYmd}
                value={dateRange.to ?? ''}
                onInput={(event: TargetedEvent<HTMLInputElement>) => {
                  const next = event.currentTarget.value || undefined
                  setDateRange(prev => ({ ...prev, to: next }))
                }}
              />
            </label>
            <div className='range-presets'>
              {datePresets.map(preset => {
                const active = dateRange.from === preset.range.from && dateRange.to === preset.range.to
                return (
                  <button
                    key={preset.label}
                    type='button'
                    className={active ? 'range-chip active' : 'range-chip'}
                    aria-pressed={active}
                    onClick={() => setDateRange(preset.range)}
                  >
                    {preset.label}
                  </button>
                )
              })}
              {dateRange.from || dateRange.to
                ? (
                  <button type='button' className='range-chip' onClick={() => setDateRange({})}>
                    Clear
                  </button>
                )
                : undefined}
            </div>
            {parsedRange?.inverted
              ? <span className='range-error' role='alert'>Start date must be on or before end date</span>
              : undefined}
          </div>
        )
        : undefined}
      {datesLoading
        ? (
          <div
            className='date-progress'
            role='progressbar'
            aria-label='Checking channel upload dates'
            aria-valuemin={0}
            aria-valuemax={baseChannels.length}
            aria-valuenow={checkedCount}
          >
            <div
              className='date-progress-fill'
              style={{ width: `${Math.round((checkedCount / baseChannels.length) * 100)}%` }}
            />
          </div>
        )
        : undefined}
      {fetching && channels.length === 0 ? <p className='notice'>Loading…</p> : undefined}
      {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {!fetching && !error && channels.length > 0 && shown.length === 0
        ? <p className='notice'>{datesLoading && !parsedRange?.inverted ? 'Checking channel upload dates…' : 'No matching channels'}</p>
        : undefined}
      {!fetching && !error && data && channels.length === 0
        ? <p className='notice'>No subscriptions yet</p>
        : undefined}
      <div className='list'>
        {shown.map(channel => {
          const href = `/channel/${channel.id}`
          const handle = channel.handle
            ? channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`
            : undefined
          const lastIso = lastUploadAt[channel.id]
          const checkingDate = needsDates && !(channel.id in lastUploadAt)
          const lastText = checkingDate
            ? 'Checking upload date…'
            : lastIso
              ? `Last video ${formatAgo(lastIso)}`
              : lastIso === null
                ? 'No recent videos'
                : undefined
          const meta = [handle, channel.subscriberCountText, channel.videoCountText, lastText]
            .filter((part): part is string => Boolean(part))
            .join(' • ')
          return (
            <div key={channel.id} className='row'>
              <Link
                href={href}
                className={channel.avatar ? 'avatar-link' : 'avatar-link fallback'}
                aria-label={channel.name}
              >
                {channel.avatar
                  ? <img src={channel.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
                  : channel.name.slice(0, 1).toUpperCase()}
              </Link>
              <div className='info'>
                <Link href={href} className='name'>
                  <span className='name-text'>{channel.name}</span>
                  <VerifiedBadge channel={channel} />
                </Link>
                {meta ? <div className='meta'>{meta}</div> : undefined}
                {channel.description ? <p className='description'>{channel.description}</p> : undefined}
              </div>
              <div className='actions'>
                <GroupsButton
                  channel={{ id: channel.id, name: channel.name, avatar: channel.avatar ?? undefined }}
                  hints={{ handle: channel.handle, description: channel.description, isVerifiedArtist: channel.isVerifiedArtist }}
                />
                <SubscribeButton
                  channelId={channel.id}
                  subscribed={channel.isSubscribed ?? true}
                  notificationLevel={channel.notificationLevel}
                />
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}

export default FeedChannelsPage
