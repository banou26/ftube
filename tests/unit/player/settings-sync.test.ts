import { describe, expect, it } from 'vite-plus/test'

import { planPlayerSettingsSync } from '../../../src/player/settings-sync'
import { DEFAULT_SETTINGS } from '../../../src/settings'

describe('planPlayerSettingsSync', () => {
  it('never clears autoMuted on unrelated setting changes', () => {
    const prev = { ...DEFAULT_SETTINGS, volume: 1, muted: false }
    for (const patch of [
      { theater: 'fullscreen' as const },
      { quality: 720 as const },
      { ambientMode: false },
      { playbackRate: 1.5 },
      { captionsEnabled: true },
    ]) {
      const plan = planPlayerSettingsSync(prev, { ...prev, ...patch }, { hasCaption: false })
      expect(plan.clearAutoMuted).toBe(false)
    }

    expect(planPlayerSettingsSync(prev, { ...prev, volume: 0.6 }, { hasCaption: false }).clearAutoMuted).toBe(true)
    expect(planPlayerSettingsSync({ ...prev, muted: true }, { ...prev, muted: false }, { hasCaption: false }).clearAutoMuted).toBe(true)
    expect(planPlayerSettingsSync(prev, { ...prev, volume: 0, muted: true }, { hasCaption: false }).clearAutoMuted).toBe(false)
  })

  it('skips overriding captions when player already applied a manual track pick', () => {
    const off = { ...DEFAULT_SETTINGS, captionsEnabled: false }
    const on = { ...DEFAULT_SETTINGS, captionsEnabled: true, captionsLanguage: 'en' }

    // Player-initiated pick sets hasCaption = true before updateSettings fires: do not override with startingCaption.
    expect(planPlayerSettingsSync(off, on, { hasCaption: true }).captionAction).toBe('none')
    // Player-initiated turn-off sets hasCaption = false before updateSettings fires: no redundant disable call.
    expect(planPlayerSettingsSync(on, off, { hasCaption: false }).captionAction).toBe('none')

    // External Settings toggle while player disagrees still syncs live.
    expect(planPlayerSettingsSync(off, on, { hasCaption: false }).captionAction).toBe('enable-default')
    expect(planPlayerSettingsSync(on, off, { hasCaption: true }).captionAction).toBe('disable')
  })

  it('refreshes captions when external Settings change language or flip the current video skip match, while respecting self-writes and manual overrides', () => {
    const enabledEn = { ...DEFAULT_SETTINGS, captionsEnabled: true, captionsLanguage: 'en', captionsSkipLanguages: [] }
    const enabledFr = { ...enabledEn, captionsLanguage: 'fr' }
    const skipFr = { ...enabledEn, captionsSkipLanguages: ['fr'] }
    const skipEn = { ...enabledEn, captionsSkipLanguages: ['en'] }

    expect(planPlayerSettingsSync(enabledEn, enabledFr, { hasCaption: true, videoLanguage: 'ja' }).captionAction).toBe('refresh')
    // Adding an unrelated language (fr) to skip list while playing an 'en' video does NOT disrupt the current video.
    expect(planPlayerSettingsSync(enabledEn, skipFr, { hasCaption: true, videoLanguage: 'en' }).captionAction).toBe('none')
    // Adding/removing the current video's language ('en') refreshes automatically unless manually overridden.
    expect(planPlayerSettingsSync(enabledEn, skipEn, { hasCaption: true, videoLanguage: 'en-US' }).captionAction).toBe('refresh')
    expect(planPlayerSettingsSync(skipEn, enabledEn, { hasCaption: false, videoLanguage: 'en-US' }).captionAction).toBe('refresh')

    // Manual caption picks on this video stay protected against external language or skip list changes.
    expect(planPlayerSettingsSync(enabledEn, skipEn, { hasCaption: true, manualOverride: true, videoLanguage: 'en' }).captionAction).toBe('none')
    expect(planPlayerSettingsSync(enabledEn, enabledFr, { hasCaption: true, selfWrite: true, videoLanguage: 'ja' }).captionAction).toBe('none')

    const disabledEn = { ...enabledEn, captionsEnabled: false }
    expect(planPlayerSettingsSync(disabledEn, { ...disabledEn, captionsSkipLanguages: ['en'] }, { hasCaption: false, videoLanguage: 'en' }).captionAction).toBe('none')
  })
})
