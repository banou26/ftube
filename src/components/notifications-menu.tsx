import type { NotificationsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { Bell } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { useLocation } from 'wouter'

import { gql } from '../generated'
import {
  clearDismissedNotifications,
  dismissNotificationIds,
  useDismissedNotifications,
} from '../notifications/dismissed'
import { useSession } from '../session'
import { lineFor, MenuDataFailure } from './data-failure'
import { Menu, MenuItem } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'
import { watchHrefFor } from './video-card'

type NotificationPage = NotificationsQuery['notifications']

const NOTIFICATIONS_QUERY = gql(`
  query Notifications($cursor: String) {
    notifications(cursor: $cursor) {
      items {
        id
        message
        sentText
        avatar
        thumbnail
        videoId
        read
      }
      cursor
    }
  }
`)

const UNSEEN_COUNT_QUERY = gql(`
  query UnseenNotificationCount {
    unseenNotificationCount
  }
`)

const MARK_READ = gql(`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id)
  }
`)

const DISMISS_NOTIFICATIONS = gql(`
  mutation DismissNotifications($ids: [ID!]!) {
    dismissNotifications(ids: $ids)
  }
`)

// Every poll is a tunneled round trip on EVERY page, so this is deliberately slow
const POLL_MS = 5 * 60_000

const style = css`
  .bell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .bell:hover {
    background: var(--bg-hover);
  }

  .badge {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.4rem;
    border-radius: 0.8rem;
    background: var(--brand-red);
    color: #fff;
    font-size: 1.1rem;
    line-height: 1.6rem;
    text-align: center;
  }
`

const panelStyle = css`
  &,
  &.anchored {
    width: min(48rem, calc(100vw - 2.4rem));
    max-height: min(64rem, calc(100vh - 8rem));
  }

  .panel-header {
    position: sticky;
    top: -0.8rem;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    margin-top: -0.8rem;
    margin-bottom: 0.4rem;
    padding: 1rem 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-menu);
  }

  .panel-title {
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .dismiss-all,
  .panel-header [role='menuitem'].dismiss-all {
    width: auto;
    height: auto;
    padding: 0.4rem 1rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .dismiss-all:hover:not(:disabled),
  .panel-header [role='menuitem'].dismiss-all:hover:not(:disabled),
  .dismiss-all:focus-visible,
  .panel-header [role='menuitem'].dismiss-all:focus-visible {
    background: var(--bg-hover);
  }

  .dismiss-all:disabled {
    opacity: 0.6;
    cursor: default;
  }

  [role='menuitem'] {
    height: auto;
    padding: 1rem 1.6rem;
    white-space: normal;
    line-height: 1.4;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 1.2rem;
    width: 100%;
    text-align: left;
  }

  .row-avatar {
    flex: none;
    width: 4rem;
    height: 4rem;
    margin-top: 0.2rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .row-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .row-message {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding: 0;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
    word-break: break-word;
  }

  .row-time {
    display: block;
    font-size: 1.2rem;
    line-height: 1.6rem;
    color: var(--text-secondary);
  }

  .row-thumb {
    flex: none;
    width: 8.6rem;
    aspect-ratio: 16 / 9;
    height: auto;
    border-radius: 0.6rem;
    object-fit: cover;
    background: var(--bg-chip);
  }

  /* An unread row is marked by a dot rather than a background wash: the panel
     is a menu, and a filled row would fight the focus highlight. */
  .unread {
    position: relative;
    padding-left: 1.2rem;
  }

  .unread::before {
    content: '';
    position: absolute;
    left: 0;
    top: 1.7rem;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--accent);
  }
`

export const NotificationsMenu = () => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [open, setOpen] = useState(false)
  const dismissAllRef = useRef<HTMLButtonElement>(null)
  const [loaded, setLoaded] = useState<NotificationPage[]>([])
  const [dismissing, setDismissing] = useState(false)
  const dismissedIds = useDismissedNotifications()
  const [, markRead] = useMutation(MARK_READ)
  const [, dismissNotifications] = useMutation(DISMISS_NOTIFICATIONS)

  useEffect(() => {
    if (ready && !signedIn) clearDismissedNotifications()
  }, [ready, signedIn])

  const [{ data: countData }, refetchCount] = useQuery({
    query: UNSEEN_COUNT_QUERY,
    pause: !ready || !signedIn,
  })

  useEffect(() => {
    if (!ready || !signedIn) return
    const tick = () => {
      if (!document.hidden) refetchCount({ requestPolicy: 'network-only' })
    }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ready, signedIn, refetchCount])

  const [{ data, error, fetching }, reexecute] = useQuery({
    query: NOTIFICATIONS_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !open || !ready || !signedIn,
  })
  const page = data?.notifications
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: notification => notification.id,
  })
  const visibleItems = items.filter(notification => !dismissedIds.has(notification.id))
  const hasVisibleItems = visibleItems.length > 0

  // Move focus onto Dismiss all when async items replace Loading... and unmount the initially focused row.
  useLayoutEffect(() => {
    if (!open || !hasVisibleItems) return
    const button = dismissAllRef.current
    if (!button) return
    const menuPanel = button.closest('[role="menu"]')
    if (menuPanel && !menuPanel.contains(document.activeElement)) button.focus()
  }, [open, hasVisibleItems])

  if (ready && !signedIn) return null

  const unseen = countData?.unseenNotificationCount ?? 0

  const onSelect = (id: string, videoId?: string | null) => {
    void markRead({ id }).then((result) => {
      if (result.error) showToast(lineFor(result.error))
    })
    if (videoId) navigate(watchHrefFor(videoId))
  }

  const onDismissAll = () => {
    if (dismissing || visibleItems.length === 0) return
    const ids = visibleItems.map(notification => notification.id)
    setDismissing(true)
    void dismissNotifications({ ids }).then((result) => {
      setDismissing(false)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      dismissNotificationIds(result.data?.dismissNotifications ?? ids)
      setLoaded([])
      reexecute({ requestPolicy: 'network-only' })
      refetchCount({ requestPolicy: 'network-only' })
    })
  }

  return (
    <div css={style}>
      <Menu
        label='Notifications'
        align='end'
        panelCss={panelStyle}
        onOpenChange={setOpen}
        trigger={
          <button type='button' className='bell' aria-label='Notifications'>
            <Bell size={24} strokeWidth={1.5} />
            {unseen > 0 ? <span className='badge'>{unseen > 99 ? '99+' : unseen}</span> : undefined}
          </button>
        }
      >
        <div className='panel-header'>
          <span className='panel-title'>Notifications</span>
          {visibleItems.length > 0
            ? (
              <button
                ref={dismissAllRef}
                type='button'
                role='menuitem'
                tabIndex={-1}
                className='dismiss-all'
                onClick={onDismissAll}
                disabled={dismissing}
              >
                {dismissing ? 'Dismissing…' : 'Dismiss all'}
              </button>
            )
            : undefined}
        </div>
        {fetching && visibleItems.length === 0 ? <MenuItem label='Loading…' disabled /> : undefined}
        {!fetching && !error && visibleItems.length === 0
          ? <MenuItem label='No notifications' disabled />
          : undefined}
        {visibleItems.map(notification => (
          <MenuItem
            key={notification.id}
            onSelect={() => onSelect(notification.id, notification.videoId)}
            ariaLabel={notification.message}
            label={
              <span className={notification.read ? 'row' : 'row unread'}>
                {notification.avatar
                  ? <img className='row-avatar' src={notification.avatar} alt='' loading='lazy' />
                  : <span className='row-avatar' aria-hidden='true' />}
                <span className='row-body'>
                  <span className='row-message'>{notification.message}</span>
                  {notification.sentText ? <span className='row-time'>{notification.sentText}</span> : undefined}
                </span>
                {notification.thumbnail
                  ? <img className='row-thumb' src={notification.thumbnail} alt='' loading='lazy' />
                  : undefined}
              </span>
            }
          />
        ))}
        {error && !fetching ? <MenuDataFailure error={error} reexecute={reexecute} /> : undefined}
        {cursor && !fetching && !error
          ? (
            <MenuItem
              label='Show more'
              closeOnSelect={false}
              onSelect={() => setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page!])}
            />
          )
          : undefined}
      </Menu>
    </div>
  )
}

export default NotificationsMenu
