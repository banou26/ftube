import { describe, expect, it } from 'vite-plus/test'

import { readSettingsSection, SETTINGS_SECTIONS } from '../../../src/routes/settings-sections'

describe('SETTINGS_SECTIONS', () => {
  it('lists the 7 sections in the expected YouTube-style order', () => {
    expect(SETTINGS_SECTIONS.map(section => section.label)).toEqual([
      'General',
      'Notifications',
      'Customization',
      'Time management',
      'Playback and performance',
      'Privacy',
      'Advanced settings',
    ])
  })
})

describe('readSettingsSection', () => {
  it('defaults to general when search and hash are empty or unknown', () => {
    expect(readSettingsSection('', '')).toBe('general')
    expect(readSettingsSection('?section=unknown', '#unknown')).toBe('general')
  })

  it('resolves every section query value directly', () => {
    expect(readSettingsSection('?section=general', '')).toBe('general')
    expect(readSettingsSection('?section=notifications', '')).toBe('notifications')
    expect(readSettingsSection('?section=customization', '')).toBe('customization')
    expect(readSettingsSection('?section=time-management', '')).toBe('time-management')
    expect(readSettingsSection('?section=playback', '')).toBe('playback')
    expect(readSettingsSection('?section=privacy', '')).toBe('privacy')
    expect(readSettingsSection('?section=advanced', '')).toBe('advanced')
  })

  it('preserves legacy ?tab=appearance and hash deep links', () => {
    expect(readSettingsSection('?tab=appearance', '')).toBe('customization')
    expect(readSettingsSection('', '#appearance')).toBe('customization')
    expect(readSettingsSection('', '#custom-appearance')).toBe('customization')
    expect(readSettingsSection('?section=customization', '#custom-appearance')).toBe('customization')
    expect(readSettingsSection('', '#playback')).toBe('playback')
  })
})
