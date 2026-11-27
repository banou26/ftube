import type { ChannelGroupHints, GroupSuggestion } from '../groups/suggest'
import type { Group, GroupChannel } from '../groups/store'

import { css } from '@emotion/react'
import { FolderCheck, FolderPlus, Plus, Sparkles, Square, SquareCheck } from 'lucide-react'
import { useMemo, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { gql } from '../generated'
import { groupStore, groupTreeOrder, useGroups } from '../groups/store'
import { suggestGroups } from '../groups/suggest'
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
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-chip-hover);
  }
`

const panelStyle = css`
  min-width: 24rem;

  .emoji {
    margin-right: 0.8rem;
  }
`

const dialogStyle = css`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

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
    padding: 0 0.8rem;
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

const useChannelGroups = (
  { channel, hints, active }: {
    channel: GroupChannel
    hints?: Omit<ChannelGroupHints, 'id' | 'name'>
    active: boolean
  },
) => {
  const groups = useGroups()
  const [tagsRequested, setTagsRequested] = useState(false)
  const [draft, setDraft] = useState<{ name?: string, emoji?: string } | undefined>(undefined)
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
    groups,
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
  const { groups, suggestions, draft, setDraft, onToggle, onAddSuggested } = useChannelGroups({
    channel,
    hints,
    active: open,
  })

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
        {suggestions.length > 0
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
        <div className='list'>
          {groupTreeOrder(groups).map(({ group, depth }) => {
            const checked = includes(group, channel.id)
            return (
              <button
                type='button'
                key={group.id}
                className='item'
                role='checkbox'
                aria-checked={checked}
                onClick={() => onToggle(group)}
              >
                {checked
                  ? <SquareCheck size={20} strokeWidth={1.5} />
                  : <Square size={20} strokeWidth={1.5} />}
                <span className='title' style={depth > 0 ? { paddingLeft: `${Math.min(depth, 4) * 1.4}rem` } : undefined}>
                  <span className='emoji' aria-hidden='true'>{group.emoji}</span>
                  {group.name}
                </span>
              </button>
            )
          })}
        </div>
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
  const { groups, suggestions, draft, setDraft, setTagsRequested, onToggle, onAddSuggested } = useChannelGroups({
    channel,
    hints,
    active: menuOpen,
  })
  const inAny = groups.some(group => includes(group, channel.id))
  const Icon = inAny ? FolderCheck : FolderPlus

  return (
    <>
      <Menu
        label='Groups'
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
            Groups
          </button>
        )}
      >
        <div css={panelStyle} role='presentation'>
          {suggestions.length > 0
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
          {groupTreeOrder(groups).map(({ group, depth }) => (
            <MenuItem
              key={group.id}
              label={(
                <span style={depth > 0 ? { paddingLeft: `${Math.min(depth, 4) * 1.4}rem` } : undefined}>
                  <span className='emoji' aria-hidden='true'>{group.emoji}</span>
                  {group.name}
                </span>
              )}
              ariaLabel={group.name}
              checked={includes(group, channel.id)}
              onSelect={() => onToggle(group)}
            />
          ))}
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
