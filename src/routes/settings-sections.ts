/** Identifier for a section in the `/settings` side navigation. */
export type SettingsSectionId =
  | 'general'
  | 'notifications'
  | 'customization'
  | 'time-management'
  | 'playback'
  | 'privacy'
  | 'advanced'

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId, label: string, title: string }[] = [
  { id: 'general', label: 'General', title: 'Choose your preferences' },
  { id: 'notifications', label: 'Notifications', title: 'Choose when and how to be notified' },
  { id: 'customization', label: 'Customization', title: 'Customize FTube' },
  { id: 'time-management', label: 'Time management', title: 'Manage your viewing time' },
  { id: 'playback', label: 'Playback and performance', title: 'Control your video viewing experience' },
  { id: 'privacy', label: 'Privacy', title: 'Manage what FTube stores and shares' },
  { id: 'advanced', label: 'Advanced settings', title: 'Connection and advanced options' },
]

const SECTION_ALIASES: Record<string, SettingsSectionId> = {
  general: 'general',
  notifications: 'notifications',
  customization: 'customization',
  appearance: 'customization',
  'emoji-picker': 'customization',
  'time-management': 'time-management',
  time: 'time-management',
  playback: 'playback',
  'playback-and-performance': 'playback',
  privacy: 'privacy',
  advanced: 'advanced',
  'advanced-settings': 'advanced',
}

/** Identifier for a sub-tab within the `/settings` Customization section. */
export type CustomizationTabId = 'appearance' | 'player' | 'emoji-picker'

/** Ordered tabs displayed under `/settings?section=customization`. */
export const CUSTOMIZATION_TABS: readonly { id: CustomizationTabId, label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'player', label: 'Player' },
  { id: 'emoji-picker', label: 'Emoji picker' },
]

/**
 * Resolves the active sub-tab within `/settings?section=customization`, keeping
 * `#custom-appearance` and default `/settings?section=customization` on the first tab.
 */
export const readCustomizationTab = (search: string, hash: string): CustomizationTabId => {
  if (hash.replace(/^#/, '') === 'custom-appearance') return 'appearance'
  const tab = new URLSearchParams(search).get('tab')
  if (tab === 'player') return 'player'
  if (tab === 'emoji-picker') return 'emoji-picker'
  return 'appearance'
}

/**
 * Resolves the active `/settings` section from query and hash parameters,
 * keeping legacy `?tab=appearance` and `#custom-appearance` deep links working.
 */
export const readSettingsSection = (search: string, hash: string): SettingsSectionId => {
  const query = new URLSearchParams(search)
  const rawSection = query.get('section') ?? query.get('tab')
  if (rawSection && Object.hasOwn(SECTION_ALIASES, rawSection)) {
    return SECTION_ALIASES[rawSection]!
  }
  const cleanHash = hash.replace(/^#/, '')
  if (cleanHash === 'custom-appearance') return 'customization'
  if (cleanHash && Object.hasOwn(SECTION_ALIASES, cleanHash)) {
    return SECTION_ALIASES[cleanHash]!
  }
  return 'general'
}
