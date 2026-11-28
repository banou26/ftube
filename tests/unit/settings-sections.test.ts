import { describe, expect, it } from 'vite-plus/test'

import { readCustomizationTab, readSettingsSection } from '../../src/routes/settings-sections'

describe('settings sections and customization tabs', () => {
  it('resolves Customization section and defaults to the Appearance tab', () => {
    expect(readSettingsSection('?section=customization', '')).toBe('customization')
    expect(readSettingsSection('?section=customization&tab=player', '')).toBe('customization')
    expect(readCustomizationTab('?section=customization', '')).toBe('appearance')
    expect(readCustomizationTab('?section=customization&tab=player', '')).toBe('player')
    expect(readCustomizationTab('?section=customization&tab=player', '#custom-appearance')).toBe('appearance')
  })
})
