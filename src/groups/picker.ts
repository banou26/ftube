import type { Group } from './store'

import { groupAncestors, groupTreeOrder } from './store'

export type GroupPickerEntry = {
  group: Group
  depth: number
  checked: boolean
  path: string
  parentPath?: string
}

/** Returns the readable ancestor-to-group folder path (for example `Science / Space`), or `''` if unknown. */
export const groupFolderPath = (groups: readonly Group[], groupId: string): string => {
  const target = groups.find(group => group.id === groupId)
  if (!target) return ''
  return [...groupAncestors(groups, groupId), target].map(group => group.name).join(' / ')
}

/**
 * Returns every group (including nested subfolders) in depth-first tree order with membership state
 * and full folder paths, filtered case-insensitively across group names and ancestor paths.
 */
export const buildGroupPickerEntries = (
  groups: readonly Group[],
  channelId: string,
  query: string,
): GroupPickerEntry[] => {
  const normalized = query.trim().toLowerCase()
  const entries: GroupPickerEntry[] = []

  for (const { group, depth } of groupTreeOrder(groups)) {
    const ancestors = groupAncestors(groups, group.id)
    const parentPath = ancestors.length > 0 ? ancestors.map(ancestor => ancestor.name).join(' / ') : undefined
    const path = parentPath ? `${parentPath} / ${group.name}` : group.name
    if (normalized && !path.toLowerCase().includes(normalized)) continue
    const checked = group.channels.some(channel => channel.id === channelId)
    entries.push({ group, depth, checked, path, parentPath })
  }

  return entries
}

/** Action label for the channel group picker trigger based on whether `channelId` is in any group. */
export const groupButtonLabel = (groups: readonly Group[], channelId: string): 'Edit groups' | 'Add to group' =>
  groups.some(group => group.channels.some(channel => channel.id === channelId)) ? 'Edit groups' : 'Add to group'

/** Actionable empty-channels prompt inside the New/Edit group dialog. */
export const groupDialogChannelPrompt = ({
  signedIn,
  selectedCount,
}: {
  signedIn: boolean
  selectedCount: number
}): string | undefined => {
  if (selectedCount > 0) return undefined
  return signedIn
    ? 'No channels yet. Pick from your subscriptions below, or use Add to group on any channel page.'
    : 'No channels yet. Create empty, then use Add to group on any channel page.'
}

/** Empty-group message and primary next step action shown on `/feed/groups/:id`. */
export const groupEmptyPageAction = ({
  signedIn,
  hasSubgroups,
}: {
  signedIn: boolean
  hasSubgroups: boolean
}): {
  message: string
  primaryAction: 'pick-subscriptions' | 'sign-in'
} => ({
  message: hasSubgroups
    ? 'No channels in this group or its subfolders yet. Use Add to group on any channel page.'
    : 'No channels in this group yet. Use Add to group on any channel page.',
  primaryAction: signedIn ? 'pick-subscriptions' : 'sign-in',
})
