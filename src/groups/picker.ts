import type { Group } from './store'

import { groupTreeOrder } from './store'

export type GroupPickerEntry = {
  group: Group
  depth: number
  checked: boolean
  path: string
  parentPath?: string
}

const buildTreePaths = (groups: readonly Group[]) => {
  const stack: string[] = []
  return groupTreeOrder(groups).map(({ group, depth }) => {
    stack.length = depth
    const parentPath = stack.length > 0 ? stack.join(' / ') : undefined
    const path = parentPath ? `${parentPath} / ${group.name}` : group.name
    stack.push(group.name)
    return { group, depth, path, parentPath }
  })
}

/** Returns the validated ancestor-to-group folder path (for example `Science / Space`), or `''` if unknown. */
export const groupFolderPath = (groups: readonly Group[], groupId: string): string =>
  buildTreePaths(groups).find(entry => entry.group.id === groupId)?.path ?? ''

/**
 * Returns every group (including nested subfolders) in depth-first tree order with membership state
 * and full validated folder paths, filtered case-insensitively across group names and ancestor paths.
 */
export const buildGroupPickerEntries = (
  groups: readonly Group[],
  channelId: string,
  query: string,
): GroupPickerEntry[] => {
  const normalized = query.trim().toLowerCase()
  const entries: GroupPickerEntry[] = []

  for (const { group, depth, path, parentPath } of buildTreePaths(groups)) {
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
  ready = true,
  selectedCount,
  hasSubscriptions = true,
}: {
  signedIn: boolean
  ready?: boolean
  selectedCount: number
  hasSubscriptions?: boolean
}): string | undefined => {
  if (selectedCount > 0) return undefined
  if (!ready) return 'No channels yet.'
  if (signedIn) {
    return hasSubscriptions
      ? 'No channels yet. Pick from your subscriptions below, or use Add to group on any channel page.'
      : 'No channels yet. Use Add to group on any channel page.'
  }
  return 'No channels yet. Create empty, then use Add to group on any channel page.'
}

/** Empty-group message and next step actions shown on `/feed/groups/:id`. */
export const groupEmptyPageAction = ({
  signedIn,
  hasSubgroups,
}: {
  signedIn: boolean
  hasSubgroups: boolean
}): {
  message: string
  primaryAction: 'pick-subscriptions' | 'sign-in'
  browseHref: '/feed/channels' | '/'
  browseLabel: 'Browse channels' | 'Browse home'
} => ({
  message: hasSubgroups
    ? 'No channels in this group or its subfolders yet. Use Add to group on any channel page.'
    : 'No channels in this group yet. Use Add to group on any channel page.',
  primaryAction: signedIn ? 'pick-subscriptions' : 'sign-in',
  browseHref: signedIn ? '/feed/channels' : '/',
  browseLabel: signedIn ? 'Browse channels' : 'Browse home',
})
