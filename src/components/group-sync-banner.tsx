import { css } from '@emotion/react'
import { LockKeyholeOpen, LogIn, RefreshCw } from 'lucide-react'
import { useEffect } from 'preact/hooks'

import { checkGroups, useGroupSyncStatus } from '../groups/sync-live'

const style = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.2rem;
  flex-wrap: wrap;
  margin-bottom: 1.6rem;
  padding: 1rem 1.4rem;
  border: 1px solid var(--border-subtle);
  border-radius: 1rem;
  background: var(--bg-subtle);
  font-size: 1.3rem;
  color: var(--text-secondary);

  .message {
    min-width: 0;
  }

  .action {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.2rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .action.primary {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .action.primary:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .action:disabled {
    opacity: 0.55;
    cursor: default;
  }
`

const recheck = () => void checkGroups().catch(() => {})

/**
 * Displays FKN cloud group sync state and triggers synchronous sign-in or unlock cards on user click
 * so Safari preserves user activation when opening the FKN card.
 */
export const GroupSyncBanner = ({ showWhenSynced = true }: { showWhenSynced?: boolean }) => {
  const sync = useGroupSyncStatus()

  useEffect(() => {
    recheck()
  }, [])

  if (sync.state === 'loading' || sync.state === 'unavailable') return null
  if (sync.state === 'synced' && !showWhenSynced) return null

  const lib = sync.lib

  if (sync.state === 'signed-out') {
    if (!lib) return null
    return (
      <div css={style} role='status' data-group-sync={sync.state}>
        <span className='message'>Sign in to FKN to sync groups across devices.</span>
        <button
          type='button'
          className='action primary'
          disabled={sync.syncing}
          onClick={() => void lib.account.login().then(recheck, () => {})}
        >
          <LogIn size={16} strokeWidth={1.5} />
          Sign in to FKN
        </button>
      </div>
    )
  }

  if (sync.state === 'locked') {
    if (!lib) return null
    return (
      <div css={style} role='status' data-group-sync={sync.state}>
        <span className='message'>FKN storage is locked on this device. Unlock it to sync your groups.</span>
        <button
          type='button'
          className='action primary'
          disabled={sync.syncing}
          onClick={() => void lib.fs.unlock().then(recheck, () => {})}
        >
          <LockKeyholeOpen size={16} strokeWidth={1.5} />
          Unlock
        </button>
      </div>
    )
  }

  if (sync.state === 'error') {
    return (
      <div css={style} role='status' data-group-sync={sync.state}>
        <span className='message'>Could not sync groups with FKN.</span>
        <button type='button' className='action' disabled={sync.syncing} onClick={recheck}>
          <RefreshCw size={15} strokeWidth={1.5} />
          {sync.syncing ? 'Syncing…' : 'Try again'}
        </button>
      </div>
    )
  }

  return (
    <div css={style} role='status' data-group-sync={sync.state}>
      <span className='message'>Synced with FKN</span>
      <button type='button' className='action' disabled={sync.syncing} onClick={recheck}>
        <RefreshCw size={15} strokeWidth={1.5} />
        {sync.syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}

export default GroupSyncBanner
