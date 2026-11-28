import type { ChannelGroupHints, GroupSuggestion } from '../groups/suggest'
import type { Group, GroupChannel } from '../groups/store'

import { css } from '@emotion/react'
import { FolderCheck, FolderPlus, Plus, Sparkles, Square, SquareCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { gql } from '../generated'
import { buildGroupPickerEntries, groupButtonLabel } from '../groups/picker'
import { groupStore, useGroups } from '../groups/store'
import { suggestGroups } from '../groups/suggest'
import { useSession } from '../session'
import { showUndoableToast } from '../undo'
import GroupDialog from './group-dialog'
import Dialog from './ui/dialog'
import { Menu, MenuItem, MenuSection, MenuSeparator } from './ui/menu'

const CHANNEL_TAGS_QUERY = gql(`
  query ChannelTags($id: ID!) {
    channelTags(id: $id)
  }
`)

const triggerStyle = css`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: var(--action-height, 3.6rem);
  padding: 0 1.6rem;
  border: none;
  border-radius: calc(var(--action-height, 3.6rem) / 2);
  background: var(--bg-chip);
  color: var(--text-primary);
  font-size: 1.4rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-chip-hover);
  }
`

const panelStyle = css`
  min-width: 26rem;
  max-width: min(36rem, calc(100vw - 1.6rem));

  .emoji {
    margin-right: 0.8rem;
  }

  .search-wrap {
    padding: 0.4rem 1.2rem 0.8rem;
  }

  .search {
    width: 100%;
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.3rem;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .group-list {
    max-height: 24rem;
    overflow-y: auto;
  }

  .group-row {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0.4rem 0;
  }

  .group-name {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .group-path {
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-note {
    margin: 0;
    padding: 0.6rem 1.6rem;
    font-size: 1.3rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
  }
`

const dialogStyle = css`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  .search {
    width: 100%;
    height: 3.6rem;
    margin-bottom: 0.4rem;
    padding: 0 1rem;
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

  .section-title {
    padding: 0.4rem 0.8rem;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .list {
    display: flex;
    flex-direction: column;
    max-height: 28rem;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-height: 4rem;
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 0.8rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .emoji {
    margin-right: 0.8rem;
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  .group-row {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0.2rem 0;
  }

  .group-name {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .group-path {
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-note {
    margin: 0;
    padding: 0.6rem 0.8rem;
    font-size: 1.3rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
  }

  .detail {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .divider {
    height: 1px;
    margin: 0.6rem 0;
    background: var(--border-subtle);
  }
`

const includes = (group: Group, channelId: string) => group.channels.some(kept => kept.id === channelId)

const emptyPickerMessage = (ready: boolean, signedIn: boolean) =>
  ready && !signedIn
    ? 'No sign-in needed. Create a group below to add this channel.'
    : 'No groups yet. Create a group below to add this channel.'

const onSearchKeyDown = (event: KeyboardEvent) => {
  if (event.key !== 'ArrowDown') return
  event.preventDefault()
  const menu = (event.currentTarget as HTMLElement).closest('[role="menu"]')
  const firstItem = menu?.querySelector<HTMLElement>('[role="menuitemcheckbox"], [role="menuitem"]')
  firstItem?.focus()
}

const useChannelGroups = (
  { channel, hints, active }: {
    channel: GroupChannel
    hints?: Omit<ChannelGroupHints, 'id' | 'name'>
    active: boolean
  },
) => {
  const { signedIn, ready } = useSession()
  const groups = useGroups()
  const [filter, setFilter] = useState('')
  const [tagsRequested, setTagsRequested] = useState(false)
  const [draft, setDraft] = useState<{ name?: string, emoji?: string } | undefined>(undefined)

  useEffect(() => {
    if (!active) setFilter('')
  }, [active])

  const [{ data: tagsData, fetching: tagsFetching }] = useQuery({
    query: CHANNEL_TAGS_QUERY,
    variables: { id: channel.id },
    pause: (!active && !tagsRequested) || hints?.tags != null,
    requestPolicy: 'cache-first',
  })
  const suggestions = useMemo<GroupSuggestion[]>(
    () => {
      if (hints?.tags == null && tagsFetching) return []
      return suggestGroups(
        {
          id: channel.id,
          name: channel.name,
          handle: hints?.handle,
          description: hints?.description,
          isVerifiedArtist: hints?.isVerifiedArtist,
          tags: hints?.tags ?? tagsData?.channelTags,
        },
        groups,
      )
    },
    [channel.id, channel.name, hints?.handle, hints?.description, hints?.isVerifiedArtist, hints?.tags, tagsData?.channelTags, tagsFetching, groups],
  )
  const entries = useMemo(() => buildGroupPickerEntries(groups, channel.id, filter), [groups, channel.id, filter])
  const buttonLabel = groupButtonLabel(groups, channel.id)

  const onToggle = (group: Group) => {
    const wasIncluded = includes(group, channel.id)
    const included = !wasIncluded
    groupStore.setChannel(group.id, channel, included)
    showUndoableToast(
      included ? `Added to ${group.name}` : `Removed from ${group.name}`,
      {
        label: included ? `Add ${channel.name} to ${group.name}` : `Remove ${channel.name} from ${group.name}`,
        undo: () => groupStore.setChannel(group.id, channel, wasIncluded),
        undoneMessage: wasIncluded ? `Added back to ${group.name}` : `Removed from ${group.name}`,
      },
    )
  }

  const onAddSuggested = (group: Group) => {
    groupStore.setChannel(group.id, channel, true)
    showUndoableToast(`Added to ${group.name}`, {
      label: `Add ${channel.name} to ${group.name}`,
      undo: () => groupStore.setChannel(group.id, channel, false),
      undoneMessage: `Removed from ${group.name}`,
    })
  }

  return {
    signedIn,
    ready,
    groups,
    entries,
    filter,
    setFilter,
    buttonLabel,
    suggestions,
    draft,
    setDraft,
    setTagsRequested,
    onToggle,
    onAddSuggested,
  }
}

const suggestionKey = (item: GroupSuggestion) =>
  item.kind === 'existing' ? `existing:${item.group.id}` : `new:${item.name}`

/** Controlled dialog for managing a channel's group memberships when accessed from More actions. */
export const GroupsDialog = (
  { open = true, onClose, channel, hints }: {
    open?: boolean
    onClose: () => void
    channel: GroupChannel
    hints?: Omit<ChannelGroupHints, 'id' | 'name'>
  },
) => {
  const {
    signedIn,
    ready,
    groups,
    entries,
    filter,
    setFilter,
    suggestions,
    draft,
    setDraft,
    onToggle,
    onAddSuggested,
  } = useChannelGroups({
    channel,
    hints,
    active: open,
  })
  const isFiltering = filter.trim().length > 0

  if (!open) return null

  if (draft) {
    return (
      <GroupDialog
        channels={[channel]}
        initialName={draft.name}
        initialEmoji={draft.emoji}
        onClose={() => setDraft(undefined)}
        onSaved={(group: Group) => showUndoableToast(`Added to ${group.name}`, {
          label: `Create ${group.name}`,
          undo: () => groupStore.deleteGroup(group.id),
          undoneMessage: `Deleted ${group.name}`,
        })}
      />
    )
  }

  return (
    <Dialog title='Groups' onClose={onClose}>
      <div css={dialogStyle}>
        {groups.length > 0
          ? (
            <input
              className='search'
              type='search'
              value={filter}
              placeholder='Search groups'
              aria-label='Filter groups'
              onInput={(event: Event) => setFilter((event.currentTarget as HTMLInputElement).value)}
            />
          )
          : undefined}
        {!isFiltering && suggestions.length > 0
          ? (
            <>
              <div className='section-title'>Suggested</div>
              {suggestions.map(item => (
                item.kind === 'existing'
                  ? (
                    <button
                      type='button'
                      key={suggestionKey(item)}
                      className='item'
                      aria-label={`Add to ${item.group.name}`}
                      onClick={() => onAddSuggested(item.group)}
                    >
                      <Sparkles size={20} strokeWidth={1.5} />
                      <span className='title'>
                        <span className='emoji' aria-hidden='true'>{item.group.emoji}</span>
                        {item.group.name}
                      </span>
                    </button>
                  )
                  : (
                    <button
                      type='button'
                      key={suggestionKey(item)}
                      className='item'
                      aria-label={`Create ${item.name}`}
                      onClick={() => setDraft({ name: item.name, emoji: item.emoji })}
                    >
                      <Plus size={20} strokeWidth={1.5} />
                      <span className='title'>
                        <span className='emoji' aria-hidden='true'>{item.emoji}</span>
                        {item.name}
                      </span>
                      <span className='detail'>Create</span>
                    </button>
                  )
              ))}
              <div className='divider' />
            </>
          )
          : undefined}
        {groups.length === 0
          ? <p className='picker-note' role='status'>{emptyPickerMessage(ready, signedIn)}</p>
          : (
            <div className='list'>
              {entries.length === 0
                ? <p className='picker-note' role='status'>No matching groups</p>
                : entries.map((entry) => (
                  <button
                    type='button'
                    key={entry.group.id}
                    className='item'
                    role='checkbox'
                    aria-checked={entry.checked}
                    aria-label={entry.path}
                    onClick={() => onToggle(entry.group)}
                  >
                    {entry.checked
                      ? <SquareCheck size={20} strokeWidth={1.5} />
                      : <Square size={20} strokeWidth={1.5} />}
                    <span className='title'>
                      <span
                        className='group-row'
                        style={!isFiltering && entry.depth > 0 ? { paddingLeft: `${Math.min(entry.depth, 4) * 1.4}rem` } : undefined}
                      >
                        <span className='group-name'>
                          <span className='emoji' aria-hidden='true'>{entry.group.emoji}</span>
                          {entry.group.name}
                        </span>
                        {entry.parentPath ? <span className='group-path'>{entry.parentPath}</span> : undefined}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        {groups.length > 0 ? <div className='divider' /> : undefined}
        <button type='button' className='item' onClick={() => setDraft({})}>
          <Plus size={20} strokeWidth={1.5} />
          <span className='title'>New group</span>
        </button>
      </div>
    </Dialog>
  )
}

/** Puts `channel` in or out of each group, or in a new one. */
export const GroupsButton = (
  { channel, hints }: {
    channel: GroupChannel
    hints?: Omit<ChannelGroupHints, 'id' | 'name'>
  },
) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const {
    signedIn,
    ready,
    groups,
    entries,
    filter,
    setFilter,
    buttonLabel,
    suggestions,
    draft,
    setDraft,
    setTagsRequested,
    onToggle,
    onAddSuggested,
  } = useChannelGroups({
    channel,
    hints,
    active: menuOpen,
  })
  const isFiltering = filter.trim().length > 0
  const inAny = buttonLabel === 'Edit groups'
  const Icon = inAny ? FolderCheck : FolderPlus

  return (
    <>
      <Menu
        label={buttonLabel}
        align='start'
        onOpenChange={setMenuOpen}
        trigger={(
          <button
            type='button'
            css={triggerStyle}
            onPointerEnter={() => setTagsRequested(true)}
            onFocus={() => setTagsRequested(true)}
          >
            <Icon size={18} strokeWidth={1.5} />
            {buttonLabel}
          </button>
        )}
      >
        <div css={panelStyle} role='presentation'>
          {groups.length > 0
            ? (
              <div className='search-wrap'>
                <input
                  className='search'
                  type='search'
                  value={filter}
                  placeholder='Search groups'
                  aria-label='Filter groups'
                  onInput={(event: Event) => setFilter((event.currentTarget as HTMLInputElement).value)}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
            )
            : undefined}
          {!isFiltering && suggestions.length > 0
            ? (
              <>
                <MenuSection title='Suggested'>
                  {suggestions.map(item => (
                    item.kind === 'existing'
                      ? (
                        <MenuItem
                          key={suggestionKey(item)}
                          icon={Sparkles}
                          label={(
                            <>
                              <span className='emoji' aria-hidden='true'>{item.group.emoji}</span>
                              {item.group.name}
                            </>
                          )}
                          ariaLabel={`Add to ${item.group.name}`}
                          onSelect={() => onAddSuggested(item.group)}
                        />
                      )
                      : (
                        <MenuItem
                          key={suggestionKey(item)}
                          icon={Plus}
                          label={(
                            <>
                              <span className='emoji' aria-hidden='true'>{item.emoji}</span>
                              {item.name}
                            </>
                          )}
                          detail='Create'
                          ariaLabel={`Create ${item.name}`}
                          onSelect={() => setDraft({ name: item.name, emoji: item.emoji })}
                        />
                      )
                  ))}
                </MenuSection>
                <MenuSeparator />
              </>
            )
            : undefined}
          {groups.length === 0
            ? <p className='picker-note' role='status'>{emptyPickerMessage(ready, signedIn)}</p>
            : (
              <div className='group-list'>
                {entries.length === 0
                  ? <p className='picker-note' role='status'>No matching groups</p>
                  : entries.map(entry => (
                    <MenuItem
                      key={entry.group.id}
                      label={(
                        <span
                          className='group-row'
                          style={!isFiltering && entry.depth > 0 ? { paddingLeft: `${Math.min(entry.depth, 4) * 1.4}rem` } : undefined}
                        >
                          <span className='group-name'>
                            <span className='emoji' aria-hidden='true'>{entry.group.emoji}</span>
                            {entry.group.name}
                          </span>
                          {entry.parentPath ? <span className='group-path'>{entry.parentPath}</span> : undefined}
                        </span>
                      )}
                      ariaLabel={entry.path}
                      checked={entry.checked}
                      onSelect={() => onToggle(entry.group)}
                    />
                  ))}
              </div>
            )}
          {groups.length > 0 ? <MenuSeparator /> : undefined}
          <MenuItem icon={Plus} label='New group' onSelect={() => setDraft({})} />
        </div>
      </Menu>
      {draft
        ? (
          <GroupDialog
            channels={[channel]}
            initialName={draft.name}
            initialEmoji={draft.emoji}
            onClose={() => setDraft(undefined)}
            onSaved={(group: Group) => showUndoableToast(`Added to ${group.name}`, {
              label: `Create ${group.name}`,
              undo: () => groupStore.deleteGroup(group.id),
              undoneMessage: `Deleted ${group.name}`,
            })}
          />
        )
        : undefined}
    </>
  )
}

export default GroupsButton
