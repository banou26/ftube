import { describe, expect, it } from 'vite-plus/test'

import { readCustomizationTab, readSettingsSection } from '../../src/routes/settings-sections'

describe('settings sections and customization tabs', () => {
  it('resolves Customization section, defaults to Appearance, and handles Player and Emoji picker tabs', () => {
    expect(readSettingsSection('?section=customization', '')).toBe('customization')
    expect(readSettingsSection('?section=customization&tab=player', '')).toBe('customization')
    expect(readSettingsSection('?section=customization&tab=emoji-picker', '')).toBe('customization')
    expect(readSettingsSection('?tab=emoji-picker', '')).toBe('customization')
    expect(readCustomizationTab('?section=customization', '')).toBe('appearance')
    expect(readCustomizationTab('?section=customization&tab=player', '')).toBe('player')
    expect(readCustomizationTab('?section=customization&tab=emoji-picker', '')).toBe('emoji-picker')
    expect(readCustomizationTab('?section=customization&tab=emoji-picker', '#custom-appearance')).toBe('appearance')
  })
})
