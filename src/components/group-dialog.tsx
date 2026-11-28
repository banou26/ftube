import type { Group, GroupChannel } from '../groups/store'

import { css } from '@emotion/react'
import { X } from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { addGroupIcon, removeGroupIcon, useGroupIcons } from '../groups/icons'
import { groupDialogChannelPrompt } from '../groups/picker'
import { DEFAULT_EMOJI, groupStore, groupTreeOrder, isDescendant, NAME_LIMIT, useGroups } from '../groups/store'
import { useSession } from '../session'
import { signIn } from '../sign-in'
import { showUndoableToast } from '../undo'
import { ChannelPreviewCard } from './channel-preview'
import { DataFailure } from './data-failure'
import { EmojiButton } from './emoji-picker'
import Dialog from './ui/dialog'

// `all` pages the whole list, so it is asked only here and never by the guide, which keeps the first page
const GROUP_SUBSCRIPTIONS_QUERY = gql(`
  query GroupSubscriptions {
    subscribedChannels(all: true) {
      id
      name
      avatar
    }
  }
`)

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .field-label {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .text {
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .text:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .emoji-controls {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .emoji-row {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .emoji {
    width: 3.6rem;
    height: 3.6rem;
    border: 1px solid transparent;
    border-radius: 0.8rem;
    background: transparent;
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
  }

  .emoji:hover {
    background: var(--bg-hover);
  }

  .emoji[aria-checked='true'] {
    border-color: var(--text-primary);
    background: var(--bg-selected);
  }

  .emoji-item {
    position: relative;
    display: inline-flex;
  }

  .emoji-remove {
    position: absolute;
    top: -0.5rem;
    right: -0.5rem;
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
    background: var(--bg);
    color: var(--text-secondary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
  }

  .emoji-item:hover .emoji-remove,
  .emoji-item:focus-within .emoji-remove {
    opacity: 1;
    pointer-events: auto;
  }

  @media (hover: none) {
    .emoji-remove {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .emoji-remove:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .select-all {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-height: 3.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .select-all input {
    flex: none;
    width: 1.8rem;
    height: 1.8rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .channels {
    display: flex;
    flex-direction: column;
    max-height: 24rem;
    overflow-y: auto;
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-height: 4rem;
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .channel input {
    flex: none;
    width: 1.8rem;
    height: 1.8rem;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .channel-link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0.4rem 0.6rem;
    margin-left: -0.6rem;
    border-radius: 0.8rem;
    color: inherit;
    transition: background 0.15s ease;
  }

  .channel-link:hover,
  .channel-option:hover {
    background: var(--bg-hover);
  }

  .channel-option {
    cursor: pointer;
    padding: 0 0.6rem;
    margin: 0 -0.6rem;
    border-radius: 0.8rem;
    transition: background 0.15s ease;
  }

  .channel-option-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1.2rem;
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
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove {
    flex: none;
    width: 3.2rem;
    height: 3.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .remove:hover {
    background: var(--bg-hover);
  }

  .status {
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .guest-subscriptions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    flex-wrap: wrap;
  }

  .guest-subscriptions .status {
    margin: 0;
  }

  .action-chip {
    flex: none;
    height: 3.4rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.7rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action-chip:hover {
    background: var(--bg-chip-hover);
  }

  [role='alert'] {
    margin: 0;
  }

  .row {
    display: flex;
    justify-content: flex-end;
    gap: 0.8rem;
  }

  .cancel,
  .save {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .cancel {
    background: transparent;
    color: var(--accent);
  }

  .cancel:hover {
    background: var(--accent-hover);
  }

  .save {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .save:not(:disabled):hover {
    background: var(--bg-inverse-hover);
  }

  .save:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

const PREVIEW_SHOW_MS = 250
const PREVIEW_HIDE_MS = 150

type PreviewHover = {
  onEnter: (channel: GroupChannel, anchor: HTMLElement) => void
  onLeave: () => void
  onNavigate: (event: MouseEvent) => void
}

const Avatar = ({ channel }: { channel: GroupChannel }) => (
  channel.avatar
    ? <img className='avatar' src={channel.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
    : <span className='avatar fallback' aria-hidden='true'>{channel.name.slice(0, 1).toUpperCase()}</span>
)

const ChannelLink = ({ channel, preview }: { channel: GroupChannel, preview: PreviewHover }) => (
  <Link
    href={`/channel/${channel.id}`}
    className='channel-link'
    onClick={preview.onNavigate}
    onPointerEnter={(event: PointerEvent) => {
      if (event.pointerType === 'mouse') preview.onEnter(channel, event.currentTarget as HTMLElement)
    }}
    onPointerLeave={preview.onLeave}
  >
    <Avatar channel={channel} />
    <span className='channel-name'>{channel.name}</span>
  </Link>
)

const SubscriptionPicker = (
  { chosen, onToggle, onToggleMany, preview }: {
    chosen: GroupChannel[]
    onToggle: (channel: GroupChannel, included: boolean) => void
    onToggleMany: (channels: GroupChannel[], included: boolean) => void
    preview: PreviewHover
  },
) => {
  const [filter, setFilter] = useState('')
  const [{ data, error, fetching }, reexecute] = useQuery({ query: GROUP_SUBSCRIPTIONS_QUERY })
  const allChannels = data?.subscribedChannels ?? []
  const allCount = allChannels.length
  const query = filter.trim().toLowerCase()
  const channels = allChannels
    .filter(channel => channel.name.toLowerCase().includes(query))
  const entries: GroupChannel[] = channels.map(channel => ({
    id: channel.id,
    name: channel.name,
    avatar: channel.avatar ?? undefined,
  }))
  const chosenIds = new Set(chosen.map(kept => kept.id))
  const selectedCount = entries.filter(entry => chosenIds.has(entry.id)).length
  const allSelected = entries.length > 0 && selectedCount === entries.length
  const someSelected = selectedCount > 0 && selectedCount < entries.length
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  return (
    <div className='field'>
      <span className='field-label'>Your subscriptions</span>
      {fetching || error || allCount > 0
        ? (
          <input
            className='text'
            type='search'
            value={filter}
            placeholder='Filter'
            aria-label='Filter subscriptions'
            onInput={(event: Event) => setFilter((event.currentTarget as HTMLInputElement).value)}
          />
        )
        : undefined}
      {fetching ? <p className='status'>Loading…</p> : undefined}
      {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {!fetching && !error && allCount === 0
        ? <p className='status'>No subscriptions yet. Use Add to group on any channel page.</p>
        : undefined}
      {!fetching && !error && allCount > 0 && entries.length === 0
        ? <p className='status'>No matching subscriptions</p>
        : undefined}
      {!fetching && entries.length > 0
        ? (
          <label className='select-all'>
            <input
              ref={selectAllRef}
              type='checkbox'
              checked={allSelected}
              onChange={() => onToggleMany(entries, !allSelected)}
            />
            <span>{query ? `Select all (${entries.length})` : 'Select all'}</span>
          </label>
        )
        : undefined}
      <div className='channels'>
        {entries.map(entry => {
          const checked = chosenIds.has(entry.id)
          return (
            <label
              key={entry.id}
              className='channel channel-option'
              onPointerEnter={(event: PointerEvent) => {
                if (event.pointerType === 'mouse') preview.onEnter(entry, event.currentTarget as HTMLElement)
              }}
              onPointerLeave={preview.onLeave}
            >
              <input
                type='checkbox'
                checked={checked}
                onChange={() => onToggle(entry, !checked)}
              />
              <span className='channel-option-body'>
                <Avatar channel={entry} />
                <span className='channel-name'>{entry.name}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Creates a group, or edits `group`: its name, its icon and its channels. A new group starts with `channels`.
 * `onSaved` gets the group as stored, after the dialog has asked to close.
 */
export const GroupDialog = (
  { group, parentId: initialParentId, channels: initialChannels = [], initialName, initialEmoji, onClose, onSaved }: {
    group?: Group
    parentId?: string
    channels?: GroupChannel[]
    initialName?: string
    initialEmoji?: string
    onClose: () => void
    onSaved?: (group: Group) => void
  },
) => {
  const { signedIn, ready } = useSession()
  const allGroups = useGroups()
  const iconLabel = useId()
  // Dialog re-runs its focus effect whenever onClose changes, which would pull focus out of the field being typed in
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  const close = useCallback(() => latestClose.current(), [])
  const storedIcons = useGroupIcons()
  const [name, setName] = useState(group?.name ?? initialName ?? '')
  const [emoji, setEmoji] = useState(group?.emoji ?? initialEmoji ?? storedIcons[0] ?? DEFAULT_EMOJI)
  const [extraIcon, setExtraIcon] = useState<string | undefined>(() =>
    storedIcons.includes(emoji) ? undefined : emoji,
  )
  const [parentId, setParentId] = useState(group?.parentId ?? initialParentId ?? '')
  const [channels, setChannels] = useState(group?.channels ?? initialChannels)
  const [hovered, setHovered] = useState<{ channel: GroupChannel, anchor: HTMLElement } | undefined>(undefined)
  const emptyPrompt = groupDialogChannelPrompt({ signedIn, selectedCount: channels.length })

  const choices = extraIcon && !storedIcons.includes(extraIcon) ? [extraIcon, ...storedIcons] : storedIcons
  const canRemoveIcon = (choice: string) => choice === extraIcon || storedIcons.length > 1

  const pickGroupEmoji = (picked: string) => {
    const next = picked.trim()
    if (!next) return
    setEmoji(next)
    if (next === extraIcon) setExtraIcon(undefined)
    addGroupIcon(next)
  }

  const onRemoveIcon = (choice: string) => {
    if (!canRemoveIcon(choice)) return
    if (choice === extraIcon) setExtraIcon(undefined)
    const nextStored = removeGroupIcon(choice)
    const remaining = extraIcon && extraIcon !== choice && !nextStored.includes(extraIcon)
      ? [extraIcon, ...nextStored]
      : nextStored
    if (choice === emoji) {
      const fallback = remaining[0]
      if (fallback) setEmoji(fallback)
    }
  }
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const parentOptions = groupTreeOrder(allGroups)
    .filter(({ group: candidate }) => !group || !isDescendant(allGroups, candidate.id, group.id))

  useEffect(() => () => clearTimeout(previewTimer.current), [])

  const preview: PreviewHover = {
    onEnter: (channel, anchor) => {
      clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(() => setHovered({ channel, anchor }), PREVIEW_SHOW_MS)
    },
    onLeave: () => {
      clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(() => setHovered(undefined), PREVIEW_HIDE_MS)
    },
    onNavigate: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      clearTimeout(previewTimer.current)
      setHovered(undefined)
      close()
    },
  }

  const onToggle = (channel: GroupChannel, included: boolean) => setChannels(current => included
    ? [...current.filter(kept => kept.id !== channel.id), channel]
    : current.filter(kept => kept.id !== channel.id))

  const onToggleMany = (targets: GroupChannel[], included: boolean) => setChannels(current => {
    const ids = new Set(targets.map(channel => channel.id))
    const rest = current.filter(kept => !ids.has(kept.id))
    return included ? [...rest, ...targets] : rest
  })

  const onSubmit = (event: Event) => {
    event.preventDefault()
    if (name.trim().length === 0) return
    const fields = { name, emoji, channels, parentId: parentId || undefined }
    const previous = group
      ? { name: group.name, emoji: group.emoji, channels: [...group.channels], parentId: group.parentId }
      : undefined
    let saved: Group | undefined
    if (group) {
      groupStore.updateGroup(group.id, fields)
      saved = groupStore.getGroups().find(kept => kept.id === group.id)
    } else {
      saved = groupStore.createGroup(fields)
    }
    close()
    if (saved && onSaved) {
      onSaved(saved)
    } else if (saved && previous && group) {
      const groupId = group.id
      const savedName = saved.name
      showUndoableToast(`Updated ${savedName}`, {
        label: `Update ${savedName}`,
        undo: () => groupStore.updateGroup(groupId, previous),
        undoneMessage: `Restored ${previous.name}`,
      })
    } else if (saved) {
      const groupId = saved.id
      const savedName = saved.name
      showUndoableToast(`Created ${savedName}`, {
        label: `Create ${savedName}`,
        undo: () => groupStore.deleteGroup(groupId),
        undoneMessage: `Deleted ${savedName}`,
      })
    }
  }

  // portalled: it opens from the guide and the channel header, whose own `.avatar` and `.item` rules would reach into it
  return createPortal(
    <>
      <Dialog title={group ? 'Edit group' : 'New group'} onClose={close}>
        <form css={style} onSubmit={onSubmit}>
          <label className='field'>
            <span className='field-label'>Name</span>
            <input
              className='text'
              type='text'
              value={name}
              maxLength={NAME_LIMIT}
              onInput={(event: Event) => setName((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {parentOptions.length > 0
            ? (
              <label className='field'>
                <span className='field-label'>Parent folder</span>
                <select
                  className='text'
                  value={parentId}
                  onChange={(event: Event) => setParentId((event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value=''>None (top level)</option>
                  {parentOptions.map(({ group: candidate, depth }) => (
                    <option key={candidate.id} value={candidate.id}>
                      {`${'\u00a0\u00a0'.repeat(depth)}${candidate.emoji} ${candidate.name}`}
                    </option>
                  ))}
                </select>
              </label>
            )
            : undefined}
          <div className='field'>
            <span className='field-label' id={iconLabel}>Icon</span>
            <div className='emoji-controls'>
              <div className='emoji-row' role='radiogroup' aria-labelledby={iconLabel}>
                {choices.map(choice => (
                  <span key={choice} className='emoji-item'>
                    <button
                      type='button'
                      className='emoji'
                      role='radio'
                      aria-checked={choice === emoji}
                      aria-label={choice}
                      onClick={() => setEmoji(choice)}
                    >
                      {choice}
                    </button>
                    {canRemoveIcon(choice)
                      ? (
                        <button
                          type='button'
                          className='emoji-remove'
                          aria-label={`Remove ${choice} icon`}
                          onClick={() => onRemoveIcon(choice)}
                        >
                          <X size={12} strokeWidth={2.2} aria-hidden='true' />
                        </button>
                      )
                      : undefined}
                  </span>
                ))}
              </div>
              <EmojiButton label='More emojis' closeOnPick onPick={pickGroupEmoji} />
            </div>
          </div>
          <div className='field'>
            <span className='field-label'>Channels</span>
            {emptyPrompt ? <p className='status'>{emptyPrompt}</p> : undefined}
            <div className='channels'>
              {channels.map(channel => (
                <div key={channel.id} className='channel'>
                  <ChannelLink channel={channel} preview={preview} />
                  <button
                    type='button'
                    className='remove'
                    aria-label={`Remove ${channel.name}`}
                    onClick={() => onToggle(channel, false)}
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {signedIn
            ? <SubscriptionPicker chosen={channels} onToggle={onToggle} onToggleMany={onToggleMany} preview={preview} />
            : ready
              ? (
                <div className='field'>
                  <span className='field-label'>Your subscriptions</span>
                  <div className='guest-subscriptions'>
                    <p className='status'>Sign in to pick from subscriptions.</p>
                    <button type='button' className='action-chip' onClick={signIn}>Sign in</button>
                  </div>
                </div>
              )
              : undefined}
          <div className='row'>
            <button type='button' className='cancel' onClick={close}>Cancel</button>
            <button type='submit' className='save' disabled={name.trim().length === 0}>
              {group ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </Dialog>
      {hovered
        ? (
          <ChannelPreviewCard
            channel={hovered.channel}
            anchor={hovered.anchor}
            onPointerEnter={() => clearTimeout(previewTimer.current)}
            onPointerLeave={preview.onLeave}
            onNavigate={preview.onNavigate}
          />
        )
        : undefined}
    </>,
    document.body,
  )
}

export default GroupDialog
