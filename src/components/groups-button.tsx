import type { ChannelGroupHints } from '../groups/suggest'
import type { Group, GroupChannel } from '../groups/store'

import { css } from '@emotion/react'
import { FolderCheck, FolderPlus, Plus, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { gql } from '../generated'
import { groupStore, groupTreeOrder, useGroups } from '../groups/store'
import { suggestGroup } from '../groups/suggest'
import { showUndoableToast } from '../undo'
import GroupDialog from './group-dialog'
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

const includes = (group: Group, channelId: string) => group.channels.some(kept => kept.id === channelId)

/** Puts `channel` in or out of each group, or in a new one. */
export const GroupsButton = (
  { channel, hints }: {
    channel: GroupChannel
    hints?: Omit<ChannelGroupHints, 'id' | 'name'>
  },
) => {
  const groups = useGroups()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagsRequested, setTagsRequested] = useState(false)
  const [draft, setDraft] = useState<{ name?: string, emoji?: string } | undefined>(undefined)
  const [{ data: tagsData, fetching: tagsFetching }] = useQuery({
    query: CHANNEL_TAGS_QUERY,
    variables: { id: channel.id },
    pause: (!menuOpen && !tagsRequested) || hints?.tags != null,
    requestPolicy: 'cache-first',
  })
  const suggestion = useMemo(
    () => {
      if (hints?.tags == null && tagsFetching) return undefined
      return suggestGroup(
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
  const inAny = groups.some(group => includes(group, channel.id))
  const Icon = inAny ? FolderCheck : FolderPlus

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
          {suggestion
            ? (
              <>
                <MenuSection title='Suggested'>
                  {suggestion.kind === 'existing'
                    ? (
                      <MenuItem
                        icon={Sparkles}
                        label={(
                          <>
                            <span className='emoji' aria-hidden='true'>{suggestion.group.emoji}</span>
                            {suggestion.group.name}
                          </>
                        )}
                        ariaLabel={`Add to ${suggestion.group.name}`}
                        onSelect={() => {
                          groupStore.setChannel(suggestion.group.id, channel, true)
                          showUndoableToast(`Added to ${suggestion.group.name}`, {
                            label: `Add ${channel.name} to ${suggestion.group.name}`,
                            undo: () => groupStore.setChannel(suggestion.group.id, channel, false),
                            undoneMessage: `Removed from ${suggestion.group.name}`,
                          })
                        }}
                      />
                    )
                    : (
                      <MenuItem
                        icon={Plus}
                        label={(
                          <>
                            <span className='emoji' aria-hidden='true'>{suggestion.emoji}</span>
                            {suggestion.name}
                          </>
                        )}
                        detail='Create'
                        ariaLabel={`Create ${suggestion.name}`}
                        onSelect={() => setDraft({ name: suggestion.name, emoji: suggestion.emoji })}
                      />
                    )}
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
