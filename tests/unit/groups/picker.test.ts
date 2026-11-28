import type { Group } from '../../../src/groups/store'

import { describe, expect, it } from 'vite-plus/test'

import {
  buildGroupPickerEntries,
  groupButtonLabel,
  groupDialogChannelPrompt,
  groupEmptyPageAction,
  groupFolderPath,
} from '../../../src/groups/picker'

const CH_NASA = { id: 'UCLA_DiR1FfKNvjuUpBHmylQ', name: 'NASA' }
const CH_ESA = { id: 'UCIBaDdJYGcTwI733G7sKc4A', name: 'European Space Agency' }

const GROUPS: Group[] = [
  { id: 'g-science', name: 'Science', emoji: '🔬', channels: [], updatedAt: 1 },
  { id: 'g-space', name: 'Space', emoji: '🚀', parentId: 'g-science', channels: [], updatedAt: 2 },
  { id: 'g-missions', name: 'Missions', emoji: '🛰️', parentId: 'g-space', channels: [CH_NASA], updatedAt: 3 },
  { id: 'g-music', name: 'Music', emoji: '🎵', channels: [CH_ESA], updatedAt: 4 },
]

describe('groupFolderPath', () => {
  it('formats top-level, nested, deeply nested, and missing folder paths', () => {
    expect(groupFolderPath(GROUPS, 'g-science')).toBe('Science')
    expect(groupFolderPath(GROUPS, 'g-space')).toBe('Science / Space')
    expect(groupFolderPath(GROUPS, 'g-missions')).toBe('Science / Space / Missions')
    expect(groupFolderPath(GROUPS, 'missing-id')).toBe('')
  })
})

describe('buildGroupPickerEntries', () => {
  it('returns all nested groups in tree order with checked status and folder paths', () => {
    const entries = buildGroupPickerEntries(GROUPS, CH_NASA.id, '')
    expect(entries.map(entry => ({
      id: entry.group.id,
      depth: entry.depth,
      checked: entry.checked,
      path: entry.path,
      parentPath: entry.parentPath,
    }))).toEqual([
      { id: 'g-science', depth: 0, checked: false, path: 'Science', parentPath: undefined },
      { id: 'g-space', depth: 1, checked: false, path: 'Science / Space', parentPath: 'Science' },
      { id: 'g-missions', depth: 2, checked: true, path: 'Science / Space / Missions', parentPath: 'Science / Space' },
      { id: 'g-music', depth: 0, checked: false, path: 'Music', parentPath: undefined },
    ])
  })

  it('filters case-insensitively by child name, parent name, and full folder path', () => {
    expect(buildGroupPickerEntries(GROUPS, CH_NASA.id, 'missions').map(entry => entry.group.id)).toEqual(['g-missions'])
    expect(buildGroupPickerEntries(GROUPS, CH_NASA.id, 'SCIENCE').map(entry => entry.group.id)).toEqual([
      'g-science',
      'g-space',
      'g-missions',
    ])
    expect(buildGroupPickerEntries(GROUPS, CH_NASA.id, 'science / space').map(entry => entry.group.id)).toEqual([
      'g-space',
      'g-missions',
    ])
  })
})

describe('groupButtonLabel', () => {
  it('distinguishes channels with no memberships from channels already in top-level or nested groups', () => {
    expect(groupButtonLabel(GROUPS, 'UCunlisted00000000000000')).toBe('Add to group')
    expect(groupButtonLabel(GROUPS, CH_ESA.id)).toBe('Edit groups')
    expect(groupButtonLabel(GROUPS, CH_NASA.id)).toBe('Edit groups')
  })
})

describe('groupDialogChannelPrompt', () => {
  it('returns actionable empty-group guidance for guests and signed-in viewers and omits when channels exist', () => {
    expect(groupDialogChannelPrompt({ signedIn: false, selectedCount: 0 })).toBe(
      'No channels yet. Create empty, then use Add to group on any channel page.',
    )
    expect(groupDialogChannelPrompt({ signedIn: true, selectedCount: 0 })).toBe(
      'No channels yet. Pick from your subscriptions below, or use Add to group on any channel page.',
    )
    expect(groupDialogChannelPrompt({ signedIn: false, selectedCount: 1 })).toBeUndefined()
    expect(groupDialogChannelPrompt({ signedIn: true, selectedCount: 2 })).toBeUndefined()
  })
})

describe('groupEmptyPageAction', () => {
  it('returns the concise group page message and primary next step action', () => {
    expect(groupEmptyPageAction({ signedIn: false, hasSubgroups: false })).toEqual({
      message: 'No channels in this group yet. Use Add to group on any channel page.',
      primaryAction: 'sign-in',
    })
    expect(groupEmptyPageAction({ signedIn: true, hasSubgroups: true })).toEqual({
      message: 'No channels in this group or its subfolders yet. Use Add to group on any channel page.',
      primaryAction: 'pick-subscriptions',
    })
  })
})
