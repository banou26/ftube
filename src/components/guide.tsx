import type { FunctionComponent } from 'preact'

import { css } from '@emotion/react'
import { ChevronDown, ChevronRight, ChevronUp, CircleUserRound, Clapperboard, Clock, Download, Gamepad2, History, House, Layers, ListVideo, LockKeyholeOpen, Menu, Music2, Newspaper, Radio, Scissors, SquarePlay, SquareUser, ThumbsUp, Trophy } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { gql } from '../generated'
import { groupHrefFor, groupTreeOrder, useGroups } from '../groups/store'
import { checkGroups, useGroupSyncStatus } from '../groups/sync-live'
import { warmShaka } from '../player/prefetch'
import { atHandle, useSession } from '../session'
import { useSetting } from '../settings'
import { signIn } from '../sign-in'
import { sortGuideSubscriptions } from '../sources/youtube/normalize'
import { Logo } from './header'
import { LIKED_VIDEOS_ID, playlistHrefFor, WATCH_LATER_ID } from './playlist'

const GUIDE_SUBSCRIPTIONS_QUERY = gql(`
  query GuideSubscriptions {
    subscribedChannels {
      id
      name
      avatar
      isLive
      hasNewContent
    }
  }
`)

type GuideEntry = {
  label: string
  href: string
  Icon: FunctionComponent<{ size?: number, strokeWidth?: number }>
  match?: string
  exact?: boolean
}

const HOME_ENTRY: GuideEntry = { label: 'Home', href: '/', Icon: House, match: '/' }
const SHORTS_ENTRY: GuideEntry = { label: 'Shorts', href: '/shorts', Icon: Clapperboard }
const SUBSCRIPTIONS_ENTRY: GuideEntry = { label: 'Subscriptions', href: '/feed/subscriptions', Icon: ListVideo, match: '/feed/subscriptions' }

const MAIN_ENTRIES: GuideEntry[] = [HOME_ENTRY, SHORTS_ENTRY, SUBSCRIPTIONS_ENTRY]

const YOU_ENTRY: GuideEntry = { label: 'You', href: '/feed/you', Icon: CircleUserRound, match: '/feed/you' }

const HISTORY_ENTRY: GuideEntry = { label: 'History', href: '/feed/history', Icon: History, match: '/feed/history' }

const DOWNLOADS_ENTRY: GuideEntry = { label: 'Downloads', href: '/downloads', Icon: Download, match: '/downloads' }

// youtube.com signed out keeps these two in its first section and puts a Sign in button where the rest of You would be
const SIGNED_OUT_ENTRIES: GuideEntry[] = [YOU_ENTRY, HISTORY_ENTRY, DOWNLOADS_ENTRY]

const topicEntry = (label: string, channelId: string, Icon: GuideEntry['Icon']): GuideEntry =>
  ({ label, href: `/channel/${channelId}`, Icon, match: `/channel/${channelId}` })

// youtube.com's topic channels
const EXPLORE_ENTRIES: GuideEntry[] = [
  topicEntry('Music', 'UC-9-kyTW8ZkZNDHQJ6FgpwQ', Music2),
  topicEntry('Live', 'UC4R8DWoMoI7CAwX8_LjQHig', Radio),
  topicEntry('Gaming', 'UCOpNcN46UbXVtpKMrmU4Abg', Gamepad2),
  topicEntry('News', 'UCYfdidRxbB8Qhf0Nx7ioOYw', Newspaper),
  topicEntry('Sports', 'UCEgdi0XIXXZ-qJOFPf4JSKw', Trophy),
]

const MINI_ENTRIES: GuideEntry[] = [...MAIN_ENTRIES, YOU_ENTRY]

// prefix rather than equality, so a nested route keeps its entry lit; Home's prefix is every path, so it only ever matches exactly
const isActive = (match: string | undefined, path: string, search: string, exact = false) => {
  if (match === undefined) return false
  // wouter's useSearch keeps the leading '?', so it is stripped before joining or the result is '/results??search_query=...' and never matches
  const query = search.startsWith('?') ? search.slice(1) : search
  const current = match.includes('?') && query ? `${path}?${query}` : path
  return exact ? current === match : current === match || current.startsWith(`${match}/`)
}

const GuideLink = ({ entry }: { entry: GuideEntry }) => {
  const [path] = useLocation()
  const search = useSearch()
  const active = isActive(entry.match, path, search, entry.exact)
  return (
    <Link
      href={entry.href}
      className={active ? 'item active' : 'item'}
      aria-current={active ? 'page' : undefined}
      onPointerDown={entry.href === '/shorts' ? () => { void warmShaka().catch(() => {}) } : undefined}
    >
      <entry.Icon size={24} strokeWidth={1.5} />
      <span className='label'>{entry.label}</span>
    </Link>
  )
}

const SUBSCRIPTIONS_COLLAPSED_LIMIT = 7

const SubscriptionRail = () => {
  const { signedIn } = useSession()
  const [path] = useLocation()
  const [expanded, setExpanded] = useState(false)
  const [{ data }] = useQuery({ query: GUIDE_SUBSCRIPTIONS_QUERY, pause: !signedIn })
  const channels = data?.subscribedChannels ?? []

  const sorted = sortGuideSubscriptions(channels)
  const visible = expanded ? sorted : sorted.slice(0, SUBSCRIPTIONS_COLLAPSED_LIMIT)
  const subscriptionsActive = isActive('/feed/subscriptions', path, '')

  return (
    <div className='section'>
      <Link
        href='/feed/subscriptions'
        className={subscriptionsActive ? 'section-title section-link active' : 'section-title section-link'}
        aria-current={subscriptionsActive ? 'page' : undefined}
      >
        Subscriptions
        <ChevronRight size={20} strokeWidth={1.5} />
      </Link>
      {visible.map(channel => {
        const href = `/channel/${channel.id}`
        const active = isActive(href, path, '')
        return (
          <Link
            key={channel.id}
            href={href}
            className={active ? 'item active' : 'item'}
            aria-current={active ? 'page' : undefined}
          >
            {channel.avatar
              ? <img className='avatar' src={channel.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
              : <span className='avatar fallback' aria-hidden='true'>{channel.name.slice(0, 1).toUpperCase()}</span>}
            <span className='label channel-name'>{channel.name}</span>
            {channel.isLive
              ? (
                <span className='sub-live-icon' role='img' aria-label='Live' title='Live'>
                  <Radio size={16} strokeWidth={2} aria-hidden='true' />
                </span>
              )
              : channel.hasNewContent
                ? <span className='sub-new-dot' role='img' aria-label='New content' title='New content' />
                : undefined}
          </Link>
        )
      })}
      {sorted.length > SUBSCRIPTIONS_COLLAPSED_LIMIT
        ? (
          <button
            type='button'
            className='item show-toggle'
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded
              ? <ChevronUp size={20} strokeWidth={1.5} aria-hidden='true' />
              : <ChevronDown size={20} strokeWidth={1.5} aria-hidden='true' />}
            <span className='label'>{expanded ? 'Show fewer' : 'Show more'}</span>
          </button>
        )
        : undefined}
    </div>
  )
}

const GroupsSection = () => {
  const groups = useGroups()
  const sync = useGroupSyncStatus()
  const [path] = useLocation()
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState<string[]>([])

  if (groups.length === 0 && sync.state !== 'locked') return null

  const collapsedSet = new Set(collapsed)
  const tree = groupTreeOrder(groups)
  const visible: typeof tree = []
  let hiddenBelow: number | undefined
  for (const node of tree) {
    if (hiddenBelow !== undefined) {
      if (node.depth > hiddenBelow) continue
      hiddenBelow = undefined
    }
    visible.push(node)
    if (node.hasChildren && collapsedSet.has(node.group.id)) hiddenBelow = node.depth
  }

  const toggleCollapse = (id: string) => {
    setCollapsed(current => current.includes(id) ? current.filter(kept => kept !== id) : [...current, id])
  }

  return (
    <div className='section'>
      <button
        type='button'
        className='section-title section-link section-toggle'
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        Groups
        {expanded ? <ChevronUp size={20} strokeWidth={1.5} /> : <ChevronDown size={20} strokeWidth={1.5} />}
      </button>
      {expanded
        ? (
          <>
            {visible.map(({ group, depth, hasChildren }) => {
              const href = groupHrefFor(group.id)
              const active = path === href
              const isCollapsed = collapsedSet.has(group.id)
              return (
                <div
                  key={group.id}
                  className={depth > 0 ? 'group-row nested' : 'group-row'}
                  data-depth={depth}
                  style={depth > 0 ? { paddingLeft: `${Math.min(depth, 4) * 1.6}rem` } : undefined}
                >
                  <Link
                    href={href}
                    className={active ? 'item active' : 'item'}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className='emoji' aria-hidden='true'>{group.emoji}</span>
                    <span className='label channel-name'>{group.name}</span>
                  </Link>
                  {hasChildren
                    ? (
                      <button
                        type='button'
                        className='folder-toggle'
                        aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleCollapse(group.id)}
                      >
                        {isCollapsed ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
                      </button>
                    )
                    : undefined}
                </div>
              )
            })}
            {sync.state === 'locked' && sync.lib
              ? (
                <button
                  type='button'
                  className='item'
                  onClick={() => void sync.lib!.fs.unlock().then(() => void checkGroups().catch(() => {}), () => {})}
                >
                  <LockKeyholeOpen size={24} strokeWidth={1.5} />
                  <span className='label'>Unlock to sync groups</span>
                </button>
              )
              : undefined}
          </>
        )
        : undefined}
    </div>
  )
}

type YouGuideEntry = GuideEntry & { collapsible: boolean }

const YouSection = ({ handle }: { handle?: string }) => {
  const [path] = useLocation()
  const [expanded, setExpanded] = useState(false)
  const active = isActive(YOU_ENTRY.match, path, '')
  const channelBase = handle ? `/channel/${atHandle(handle)}` : '/account'
  const entries: YouGuideEntry[] = [
    { label: 'Your channel', href: channelBase, Icon: SquareUser, match: channelBase, exact: true, collapsible: true },
    { label: 'Groups', href: '/feed/groups', Icon: Layers, match: '/feed/groups', collapsible: false },
    { label: 'History', href: '/feed/history', Icon: History, match: '/feed/history', collapsible: false },
    { label: 'Playlists', href: '/feed/playlists', Icon: ListVideo, match: '/feed/playlists', collapsible: true },
    { label: 'Watch later', href: playlistHrefFor(WATCH_LATER_ID), Icon: Clock, match: playlistHrefFor(WATCH_LATER_ID), collapsible: false },
    { label: 'Liked videos', href: playlistHrefFor(LIKED_VIDEOS_ID), Icon: ThumbsUp, match: playlistHrefFor(LIKED_VIDEOS_ID), collapsible: true },
    { label: 'Your videos', href: handle ? `${channelBase}/videos` : '/account', Icon: SquarePlay, match: handle ? `${channelBase}/videos` : '/account', collapsible: true },
    { label: 'Downloads', href: '/downloads', Icon: Download, match: '/downloads', collapsible: false },
    { label: 'Clips', href: '/feed/clips', Icon: Scissors, match: '/feed/clips', collapsible: true },
  ]
  const visible = expanded ? entries : entries.filter(entry => !entry.collapsible)

  return (
    <div className='section'>
      <Link
        href={YOU_ENTRY.href}
        className={active ? 'section-title section-link active' : 'section-title section-link'}
        aria-current={active ? 'page' : undefined}
      >
        You
        <ChevronRight size={20} strokeWidth={1.5} />
      </Link>
      {visible.map(entry => <GuideLink key={entry.label} entry={entry} />)}
      <button
        type='button'
        className='item show-toggle'
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        {expanded
          ? <ChevronUp size={20} strokeWidth={1.5} aria-hidden='true' />
          : <ChevronDown size={20} strokeWidth={1.5} aria-hidden='true' />}
        <span className='label'>{expanded ? 'Show less' : 'Show more'}</span>
      </button>
    </div>
  )
}

const sectionsStyle = css`
  .section {
    padding-bottom: 1.2rem;
  }

  .section + .section {
    border-top: 1px solid var(--border-subtle);
    margin-top: 1.2rem;
    padding-top: 1.2rem;
  }

  .section-title {
    padding: 0.6rem 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .section-link {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: fit-content;
    border-radius: 1rem;
    transition: background 0.15s ease;
  }

  .section-toggle {
    border: none;
    background: transparent;
    font-family: inherit;
    cursor: pointer;
  }

  .section-link:hover {
    background: var(--bg-hover);
  }

  .section-link.active {
    background: var(--bg-selected);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    height: 4rem;
    padding: 0 1.2rem;
    border-radius: 1rem;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 400;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  button.item {
    width: 100%;
    border: none;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .item svg {
    flex: none;
  }

  .emoji {
    flex: none;
    width: 2.4rem;
    font-size: 2rem;
    line-height: 2.4rem;
    text-align: center;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.active {
    background: var(--bg-selected);
    font-weight: 500;
  }

  .group-row {
    display: flex;
    align-items: center;
  }

  .group-row .item {
    flex: 1;
    min-width: 0;
  }

  .group-row.nested .item {
    gap: 1.2rem;
    height: 3.6rem;
  }

  .folder-toggle {
    flex: none;
    width: 2.8rem;
    height: 2.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .folder-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: 500;
  }

  .channel-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub-live-icon {
    flex: none;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    color: #ff4e45;
  }

  .sub-new-dot {
    flex: none;
    margin-left: auto;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: #3ea6ff;
  }

  .show-toggle {
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .sign-in-note {
    margin: 0 1.2rem 1.2rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
  }

  .sign-in {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    margin: 0 1.2rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-family: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  .footer {
    border-top: 1px solid var(--border-subtle);
    margin-top: 1.2rem;
    padding: 1.6rem 1.2rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    line-height: 1.8rem;
  }

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    font-weight: 500;
    margin-bottom: 1.2rem;
  }

  .copyright {
    color: var(--text-tertiary);
  }
`

const GuideSections = () => {
  const { handle, ready, signedIn } = useSession()
  const hideShorts = useSetting('hideShorts')
  const mainEntries = hideShorts ? MAIN_ENTRIES.filter(entry => entry.href !== '/shorts') : MAIN_ENTRIES
  // until the session answers, keep the signed-in layout, so a signed-in guide never rearranges itself on load
  const signedOut = ready && !signedIn
  const topEntries = signedOut ? mainEntries : mainEntries.filter(entry => entry !== SUBSCRIPTIONS_ENTRY)
  return (
    <div css={sectionsStyle}>
      <div className='section'>
        {topEntries.map(entry => <GuideLink key={entry.label} entry={entry} />)}
        {signedOut ? SIGNED_OUT_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />) : undefined}
      </div>
      {signedOut
        ? (
          <div className='section'>
            <p className='sign-in-note'>Sign in to like videos, comment, and subscribe.</p>
            <button type='button' className='sign-in' onClick={signIn}>
              <CircleUserRound size={24} strokeWidth={1.5} />
              Sign in
            </button>
          </div>
        )
        : <SubscriptionRail />}
      <GroupsSection />
      {signedOut ? undefined : <YouSection handle={handle} />}
      <div className='section'>
        <div className='section-title'>Explore</div>
        {EXPLORE_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />)}
      </div>
      <div className='footer'>
        <div className='footer-links'>
          <Link href='/privacy'>Privacy</Link>
        </div>
        <div className='copyright'>© 2026 FTube</div>
      </div>
    </div>
  )
}

const expandedStyle = css`
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
  width: var(--guide-width);
  padding: 1.2rem;
  overflow-y: auto;
  background: var(--bg-base);
  z-index: var(--z-guide);
`

const miniStyle = css`
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
  width: var(--guide-mini-width);
  padding: 0 0.4rem;
  overflow-y: auto;
  background: var(--bg-base);
  z-index: var(--z-guide);

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 1.6rem 0;
    border-radius: 1rem;
    color: var(--text-primary);
    transition: background 0.15s ease;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item .label {
    font-size: 1rem;
  }

  .item.active .label {
    font-weight: 500;
  }
`

const drawerStyle = css`
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);

  .scrim {
    position: absolute;
    inset: 0;
    background: var(--bg-scrim);
  }

  .panel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--guide-width);
    overflow-y: auto;
    background: var(--bg-base);
    animation: guide-slide-in 0.2s ease;
  }

  @keyframes guide-slide-in {
    from {
      transform: translateX(-100%);
    }

    to {
      transform: translateX(0);
    }
  }

  .panel-header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 1.6rem;
    height: var(--header-height);
    padding: 0 1.6rem;
    background: var(--bg-base);
    z-index: 1;
  }

  .icon-button {
    flex: none;
    width: 4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .icon-button:hover {
    background: var(--bg-hover);
  }

  .panel-sections {
    padding: 1.2rem;
  }
`

export const Guide = (
  { variant, onClose }:
  { variant: 'expanded' | 'mini' | 'drawer', onClose?: () => void }
) => {
  const hideShorts = useSetting('hideShorts')
  const miniEntries = hideShorts ? MINI_ENTRIES.filter(entry => entry.href !== '/shorts') : MINI_ENTRIES

  useEffect(() => {
    if (variant !== 'drawer') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [variant, onClose])

  return (
    variant === 'mini'
      ? (
        <nav css={miniStyle} aria-label='Guide'>
          {miniEntries.map(entry => <GuideLink key={entry.label} entry={entry} />)}
        </nav>
      )
      : variant === 'drawer'
        ? (
          <div css={drawerStyle}>
            <div className='scrim' onClick={onClose} />
            <nav className='panel' role='dialog' aria-modal='true' aria-label='Guide'>
              <div className='panel-header'>
                <button type='button' className='icon-button' aria-label='Close guide' onClick={onClose}>
                  <Menu size={24} strokeWidth={1.5} />
                </button>
                <Logo />
              </div>
              <div className='panel-sections'>
                <GuideSections />
              </div>
            </nav>
          </div>
        )
        : (
          <nav css={expandedStyle} aria-label='Guide'>
            <GuideSections />
          </nav>
        )
  )
}

export default Guide
