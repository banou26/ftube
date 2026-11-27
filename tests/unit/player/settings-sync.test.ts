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
})
