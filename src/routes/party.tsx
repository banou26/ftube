import type { TargetedEvent, TargetedSubmitEvent } from 'preact'
import type { PartyRosterMember } from '../party'

import { css } from '@emotion/react'
import { Ban, Check, Copy, LogOut, Play, UserX, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import { endMessage, failMessage } from '../components/party-widget'
import { inviteFromHash, party, partyLink } from '../party'
import { displayName, MAX_NAME_LENGTH } from '../party/protocol'
import { useParty } from '../party/use-party'

const style = css`
  max-width: 60rem;
  margin: 0 auto;
  padding: 2.4rem 1.6rem 4.8rem;

  h1 {
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3.2rem;
  }

  .status {
    margin-top: 0.8rem;
    color: var(--text-secondary);
    font-size: 1.4rem;
    line-height: 2rem;
  }

  .status a {
    color: var(--accent);
  }

  .status a:hover {
    text-decoration: underline;
  }

  .section {
    margin-top: 2.4rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border-subtle);
  }

  .label {
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 0.8rem;
  }

  .field {
    display: flex;
    gap: 0.8rem;
  }

  .field input {
    flex: 1;
    min-width: 0;
    height: 4rem;
    padding: 0 1.4rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent-focus);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 1.6rem;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action:hover {
    background: var(--bg-chip-hover);
  }

  .action.primary {
    border-color: transparent;
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .action.primary:hover {
    background: var(--bg-inverse-hover);
  }

  .action.danger {
    color: var(--danger);
  }

  .roster {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-subtle);
  }

  .member-name {
    font-weight: 500;
  }

  .member-id {
    color: var(--text-secondary);
    font-size: 1.2rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    padding: 0.2rem 0.8rem;
    border-radius: 1rem;
    background: var(--bg-chip);
    color: var(--text-secondary);
    font-size: 1.1rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge.you {
    color: var(--membership);
  }

  .member-actions {
    display: flex;
    gap: 0.6rem;
    margin-left: auto;
  }

  .member-actions .action {
    height: 3.2rem;
    padding: 0 1.2rem;
    font-size: 1.2rem;
  }

  .follow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 28rem;
    cursor: pointer;
  }

  .follow input {
    width: 1.8rem;
    height: 1.8rem;
    accent-color: var(--accent);
    cursor: pointer;
  }
`

const PartyPage = () => {
  useDocumentTitle('Watch together')
  const state = useParty()
  const [hash, setHash] = useState(() => window.location.hash)
  const [name, setName] = useState(() => party.name() ?? '')
  const [members, setMembers] = useState<PartyRosterMember[]>([])
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      clearTimeout(copyTimer.current)
    }
  }, [])

  const hasHash = hash.length > 1
  const invite = hasHash ? inviteFromHash(hash, window.location.origin) : undefined
  const broken = hasHash && !invite

  // Join automatically when opened with a valid fragment invite.
  useEffect(() => {
    if (!invite) return
    const current = party.getState()
    if (current.status === 'active' && current.invite === invite) return
    if (current.status === 'joining' && current.invite === invite) return
    void party.join(invite)
  }, [invite])

  const active = state.status === 'active'
  useEffect(() => {
    if (!active) {
      setMembers([])
      return
    }
    let live = true
    void party.roster().then((list) => {
      if (live) setMembers(list)
    })
    return () => {
      live = false
    }
  }, [state])

  const link = active ? partyLink(window.location.origin, state.invite) : ''

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2_000)
    } catch {}
  }

  const saveName = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = displayName(name)
    party.setName(clean)
    setName(clean ?? '')
  }

  return (
    <main css={style}>
      <h1>Watch together</h1>
      <div className='status'>
        {broken
          ? 'This invite link is invalid.'
          : state.status === 'joining'
            ? 'Connecting to the party…'
            : active && state.role === 'host'
              ? <>Hosting. <Link href='/'>Browse videos</Link></>
              : active && state.role === 'guest' && invite
                ? 'Connected. Waiting for the host…'
                : active && state.role === 'guest'
                  ? <>Following the host. <Link href='/'>Go home</Link></>
                  : state.status === 'failed'
                    ? failMessage(state.code)
                    : state.status === 'ended'
                      ? endMessage(state.reason)
                      : 'Not in a party.'}
      </div>

      {!active && state.status !== 'joining'
        ? (
          <div className='actions'>
            <button type='button' className='action primary' onClick={() => void party.create()}>
              <Users size={16} strokeWidth={1.75} />
              Start watch together
            </button>
            {state.status === 'failed' || state.status === 'ended'
              ? <button type='button' className='action' onClick={() => party.dismiss()}>OK</button>
              : undefined}
          </div>
        )
        : undefined}

      {active
        ? (
          <>
            <div className='section'>
              <div className='label'>Display name</div>
              <form className='field' onSubmit={saveName}>
                <input
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder='Name shown in party'
                  aria-label='Display name'
                  onInput={(event: TargetedEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
                />
                <button type='submit' className='action'>
                  <Check size={16} strokeWidth={1.75} />
                  Save
                </button>
              </form>
            </div>

            <div className='section'>
              <div className='label'>Invite link</div>
              <div className='field'>
                <input
                  readOnly
                  value={link}
                  aria-label='Invite link'
                  onFocus={(event: TargetedEvent<HTMLInputElement>) => event.currentTarget.select()}
                />
                <button type='button' className='action' onClick={() => void copy()}>
                  {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {state.role === 'guest'
              ? (
                <div className='section'>
                  <label className='follow'>
                    <span>Follow host</span>
                    <input
                      type='checkbox'
                      checked={party.following()}
                      onChange={(event: TargetedEvent<HTMLInputElement>) => party.setFollowing(event.currentTarget.checked)}
                    />
                  </label>
                  <div className='actions'>
                    <button type='button' className='action' onClick={() => party.replay()}>
                      <Play size={14} strokeWidth={1.75} />
                      Catch up
                    </button>
                  </div>
                </div>
              )
              : undefined}

            <div className='section'>
              <div className='label'>In the party ({members.length})</div>
              <div className='roster'>
                {members.map((member) => (
                  <div key={member.id} className='member' data-member={member.id}>
                    {member.name ? <span className='member-name'>{member.name}</span> : undefined}
                    <span className='member-id' title={member.id}>{member.id.slice(0, 8)}</span>
                    {member.host ? <span className='badge'>Host</span> : undefined}
                    {member.self ? <span className='badge you'>You</span> : undefined}
                    {state.role === 'host' && !member.self
                      ? (
                        <div className='member-actions'>
                          <button type='button' className='action danger' onClick={() => void party.kick(member.id)}>
                            <UserX size={14} strokeWidth={1.75} />
                            Kick
                          </button>
                          <button type='button' className='action danger' onClick={() => void party.ban(member.id)}>
                            <Ban size={14} strokeWidth={1.75} />
                            Ban
                          </button>
                        </div>
                      )
                      : undefined}
                  </div>
                ))}
              </div>
            </div>

            <div className='section'>
              <button type='button' className='action danger' onClick={() => void party.leave()}>
                <LogOut size={16} strokeWidth={1.75} />
                {state.role === 'host' ? 'End party' : 'Leave party'}
              </button>
            </div>
          </>
        )
        : undefined}
    </main>
  )
}

export default PartyPage
