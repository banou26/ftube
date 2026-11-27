import type { ComponentChildren, TargetedKeyboardEvent } from 'preact'
import type { SleepTimer } from '../player/sleep-timer'
import type { QualityPreference, Settings, ThemePreference } from '../settings'
import type { SettingsSectionId } from './settings-sections'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { CustomAppearance } from '../components/custom-appearance'
import { clearDismissed, getDismissed, restoreDismissed, useDismissed } from '../components/dismissed-videos'
import { EXTENSION_URL, useExtensionExposed } from '../components/extension-notice'
import { showToast } from '../components/ui/toast'
import {
  resetFeedViewSettings,
  setFeedLayout,
  updateFeedViewSettings,
  useFeedViewSettings,
} from '../feeds/settings'
import { COMMON_CAPTION_LANGUAGES, normalizeLanguageCode } from '../frame/captions'
import {
  AMBIENT_AREA_OPTIONS,
  AMBIENT_FILL_MODE_OPTIONS,
  AMBIENT_SPREAD_MAX,
  AMBIENT_SPREAD_MIN,
  AMBIENT_SPREAD_PRESETS,
} from '../player/ambient-options'
import { getSleepTimer, setSleepTimer, SLEEP_MINUTES, sleepDuration, subscribeSleepTimer } from '../player/sleep-timer'
import { SpeedPicker } from '../player/speed-picker'
import { SPONSORBLOCK_URL } from '../player/sponsorblock'
import { THEATER_MODES } from '../player/theater'
import { atHandle, useSession } from '../session'
import { getSettings, subscribeSettings, updateSettings } from '../settings'
import { showUndoableToast } from '../undo'
import { readSettingsSection, SETTINGS_SECTIONS } from './settings-sections'

export { readSettingsSection, SETTINGS_SECTIONS }
export type { SettingsSectionId }

const THEMES: { value: ThemePreference, label: string }[] = [
  { value: 'device', label: 'Device theme' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const QUALITIES: { value: QualityPreference, label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 2160, label: '2160p' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
  { value: 240, label: '240p' },
]

const SLEEP_CHOICES: { label: string, value: number | 'end' | undefined }[] = [
  { label: 'Off', value: undefined },
  ...SLEEP_MINUTES.map(minutes => ({ label: `${minutes} min`, value: minutes })),
  { label: 'End of video', value: 'end' },
]

const page = css`
  max-width: 112rem;
  margin: 0 auto;
  padding: 2.4rem 3.2rem 6.4rem;
  display: grid;
  grid-template-columns: 23rem minmax(0, 1fr);
  gap: 3.6rem;
  align-items: start;

  .sidebar {
    position: sticky;
    top: calc(var(--header-height) + 2rem);
    min-width: 0;
  }

  .sidebar-title {
    margin: 0 0 1.4rem;
    padding: 0 1.4rem;
    font-size: 2rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .nav-item {
    width: 100%;
    padding: 1rem 1.4rem;
    border: none;
    border-radius: 0.8rem;
    background: transparent;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.45rem;
    font-weight: 400;
    line-height: 2rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .nav-item:hover {
    background: var(--bg-hover);
  }

  .nav-item.active {
    background: var(--bg-chip);
    font-weight: 500;
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: -2px;
  }

  .panel {
    min-width: 0;
    max-width: 84rem;
  }

  .panel-header {
    padding-bottom: 2.4rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .eyebrow {
    margin: 0 0 1.2rem;
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .headline {
    margin: 0;
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3.2rem;
    color: var(--text-primary);
  }

  .setting-row {
    display: grid;
    grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
    gap: 1.2rem 2.4rem;
    align-items: start;
    padding: 2.2rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .setting-row.appearance-group {
    display: block;
    padding-top: 0;
    border-bottom: none;
  }

  .group-label {
    margin: 0;
    padding-top: 0.2rem;
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 2rem;
    color: var(--text-primary);
  }

  .group-controls {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.6rem;
    min-height: 3.2rem;
  }

  .row-label {
    min-width: 0;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
  }

  .sub-note {
    margin: 0;
    font-size: 1.35rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  .link {
    color: var(--accent);
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .credit {
    margin-left: 0.4rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  .choice,
  .action-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 3.4rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.35rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .choice:hover,
  .action-pill:hover {
    background: var(--bg-chip-hover);
  }

  .choice.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .choice:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .choice:focus-visible,
  .action-pill:focus-visible,
  .toggle:focus-visible,
  .readonly-input:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 2px;
  }

  .toggle {
    flex: none;
    width: 1.8rem;
    height: 1.8rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .copy-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  .readonly-input {
    flex: 1 1 20rem;
    min-width: 0;
    max-width: 34rem;
    height: 3.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-subtle);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font-family: var(--font-mono, inherit);
    font-size: 1.35rem;
  }

  .select,
  .lang-input {
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.35rem;
  }

  .lang-input {
    width: 12rem;
  }

  .select:focus-visible,
  .lang-input:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 2px;
  }

  .lang-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .lang-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3rem;
    padding: 0 0.8rem 0 1rem;
    border: none;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.3rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .lang-chip:hover {
    background: var(--bg-chip-hover);
  }

  .inline-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  .spread-slider {
    width: 14rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .spread-value {
    min-width: 4.4rem;
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 2rem;
    padding: 2rem 1.6rem 4.8rem;

    .sidebar {
      position: static;
    }

    .sidebar-title {
      padding: 0;
      margin-bottom: 1.2rem;
      font-size: 2.2rem;
      color: var(--text-primary);
    }

    .side-nav {
      flex-direction: row;
      gap: 0.6rem;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 0.4rem;
    }

    .side-nav::-webkit-scrollbar {
      display: none;
    }

    .nav-item {
      width: auto;
      flex: none;
      white-space: nowrap;
      padding: 0.8rem 1.4rem;
      font-size: 1.4rem;
    }
  }

  @media (max-width: 720px) {
    .setting-row {
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
      padding: 1.8rem 0;
    }
  }
`

const sleepStatusLabel = (timer: SleepTimer | undefined): string => {
  if (!timer) return 'Timer off'
  if (timer === 'end') return 'Pauses at the end of the current video'
  return `Pauses in ${sleepDuration(Math.max(1, (timer.endsAt - Date.now()) / 1_000))}`
}

const isSleepChoiceActive = (
  current: SleepTimer | undefined,
  choice: number | 'end' | undefined,
): boolean => {
  if (choice === undefined) return current === undefined
  if (choice === 'end') return current === 'end'
  return typeof current === 'object' && current.minutes === choice
}

const CheckboxRow = (
  { label, checked, onChange, extra }: {
    label: string
    checked: boolean
    onChange: () => void
    extra?: ComponentChildren
  },
) => (
  <div className='row'>
    <div className='row-label'>
      {label}
      {extra}
    </div>
    <input
      type='checkbox'
      className='toggle'
      aria-label={label}
      checked={checked}
      onChange={onChange}
    />
  </div>
)

const RecommendationsResetRow = (
  { dismissedCount }: { dismissedCount: number },
) => (
  <div className='row'>
    <div className='row-label'>Hidden videos and channels ({dismissedCount})</div>
    <button
      type='button'
      className='choice'
      disabled={dismissedCount === 0}
      onClick={() => {
        const snapshot = getDismissed()
        clearDismissed()
        showUndoableToast('Hidden recommendations reset', {
          label: 'Reset hidden recommendations',
          undo: () => restoreDismissed(snapshot),
          undoneMessage: 'Hidden recommendations restored',
        })
      }}
    >
      Reset hidden recommendations
    </button>
  </div>
)

export const SettingsPage = () => {
  useDocumentTitle('Settings')
  const search = useSearch()
  const [, navigate] = useLocation()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() =>
    readSettingsSection(search, typeof window !== 'undefined' ? window.location.hash : ''),
  )
  const navRefs = useRef<Partial<Record<SettingsSectionId, HTMLButtonElement | null>>>({})
  const [settings, setSettings] = useState<Settings>(getSettings)
  const [sleepTimer, setSleepTimerState] = useState<SleepTimer | undefined>(getSleepTimer)
  const [, setClockTick] = useState(0)
  const [copiedHandle, setCopiedHandle] = useState(false)
  const [customLangOpen, setCustomLangOpen] = useState(false)
  const [customLangDraft, setCustomLangDraft] = useState('')
  const [skipLangDraft, setSkipLangDraft] = useState('')
  const extension = useExtensionExposed()
  const dismissed = useDismissed()
  const feedSettings = useFeedViewSettings()
  const session = useSession()
  const dismissedCount = dismissed.videos.size + dismissed.channels.size

  useEffect(() => subscribeSettings(setSettings), [])

  useEffect(() => subscribeSleepTimer(() => setSleepTimerState(getSleepTimer())), [])

  useEffect(() => {
    if (!sleepTimer || sleepTimer === 'end') return
    const interval = window.setInterval(() => setClockTick(tick => tick + 1), 30_000)
    return () => window.clearInterval(interval)
  }, [sleepTimer])

  useEffect(() => {
    const sync = () => setActiveSection(readSettingsSection(window.location.search, window.location.hash))
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [search])

  useEffect(() => {
    if (activeSection !== 'customization') return
    if (typeof window === 'undefined' || window.location.hash !== '#custom-appearance') return
    document.getElementById('custom-appearance')?.scrollIntoView({ block: 'start' })
  }, [activeSection])

  const selectSection = (next: SettingsSectionId) => {
    setActiveSection(next)
    navigate(next === 'general' ? '/settings' : `/settings?section=${next}`, { replace: true })
  }

  const onNavKeyDown = (index: number, event: TargetedKeyboardEvent<HTMLButtonElement>) => {
    let targetIndex: number | undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      targetIndex = (index + 1) % SETTINGS_SECTIONS.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      targetIndex = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    } else if (event.key === 'Home') {
      targetIndex = 0
    } else if (event.key === 'End') {
      targetIndex = SETTINGS_SECTIONS.length - 1
    }
    if (targetIndex === undefined) return
    event.preventDefault()
    const next = SETTINGS_SECTIONS[targetIndex]
    if (!next) return
    selectSection(next.id)
    navRefs.current[next.id]?.focus()
  }

  const set = (patch: Partial<Settings>) => setSettings(updateSettings(patch))
  const currentMeta = SETTINGS_SECTIONS.find(section => section.id === activeSection) ?? SETTINGS_SECTIONS[0]!

  const copyHandle = async (handle: string) => {
    const formatted = atHandle(handle)
    try {
      await navigator.clipboard?.writeText(formatted)
      setCopiedHandle(true)
      showToast('Channel handle copied')
      window.setTimeout(() => setCopiedHandle(false), 2_000)
    } catch {
      showToast('Copy failed')
    }
  }

  return (
    <main css={page}>
      <aside className='sidebar'>
        <h1 className='sidebar-title'>Settings</h1>
        <nav className='side-nav' aria-label='Settings'>
          {SETTINGS_SECTIONS.map((section, index) => {
            const active = activeSection === section.id
            return (
              <button
                type='button'
                key={section.id}
                ref={(el: HTMLButtonElement | null) => { navRefs.current[section.id] = el }}
                id={`settings-nav-${section.id}`}
                aria-current={active ? 'page' : undefined}
                className={active ? 'nav-item active' : 'nav-item'}
                onClick={() => selectSection(section.id)}
                onKeyDown={(event: TargetedKeyboardEvent<HTMLButtonElement>) => onNavKeyDown(index, event)}
              >
                {section.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <section className='panel' aria-labelledby='settings-section-heading'>
        <header className='panel-header'>
          <p className='eyebrow'>{currentMeta.label}</p>
          <h2 id='settings-section-heading' className='headline'>{currentMeta.title}</h2>
        </header>

        {activeSection === 'general'
          ? (
            <>
              <div className='setting-row'>
                <h3 className='group-label'>Shorts</h3>
                <div className='group-controls'>
                  <CheckboxRow
                    label='Hide Shorts'
                    checked={settings.hideShorts}
                    onChange={() => set({ hideShorts: !settings.hideShorts })}
                  />
                </div>
              </div>

              <div className='setting-row'>
                <h3 className='group-label'>Feeds</h3>
                <div className='group-controls'>
                  <div className='row'>
                    <div className='row-label'>Subscriptions layout</div>
                    <div className='choices' role='group' aria-label='Subscriptions layout'>
                      {(['grid', 'list'] as const).map(mode => (
                        <button
                          type='button'
                          key={mode}
                          className={feedSettings.layouts.subscriptions === mode ? 'choice active' : 'choice'}
                          aria-pressed={feedSettings.layouts.subscriptions === mode}
                          onClick={() => setFeedLayout('subscriptions', mode)}
                        >
                          {mode === 'grid' ? 'Grid' : 'List'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className='row'>
                    <div className='row-label'>Channel Videos layout</div>
                    <div className='choices' role='group' aria-label='Channel Videos layout'>
                      {(['grid', 'list'] as const).map(mode => (
                        <button
                          type='button'
                          key={mode}
                          className={feedSettings.layouts.channel === mode ? 'choice active' : 'choice'}
                          aria-pressed={feedSettings.layouts.channel === mode}
                          onClick={() => setFeedLayout('channel', mode)}
                        >
                          {mode === 'grid' ? 'Grid' : 'List'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <CheckboxRow
                    label='Show video durations'
                    checked={feedSettings.showDuration}
                    onChange={() => updateFeedViewSettings({ showDuration: !feedSettings.showDuration })}
                  />
                  <CheckboxRow
                    label='Show descriptions on channel Videos'
                    checked={feedSettings.showChannelDescriptions}
                    onChange={() => updateFeedViewSettings({ showChannelDescriptions: !feedSettings.showChannelDescriptions })}
                  />
                </div>
              </div>

              <div className='setting-row'>
                <h3 className='group-label'>Recommendations</h3>
                <div className='group-controls'>
                  <RecommendationsResetRow dismissedCount={dismissedCount} />
                </div>
              </div>
            </>
          )
          : activeSection === 'notifications'
            ? (
              <>
                <div className='setting-row'>
                  <h3 className='group-label'>Channel notifications</h3>
                  <div className='group-controls'>
                    <div className='row'>
                      <div className='row-label'>Per-channel notification levels</div>
                      <Link className='action-pill' href='/feed/channels'>Manage channel notifications</Link>
                    </div>
                  </div>
                </div>

                <div className='setting-row'>
                  <h3 className='group-label'>Account</h3>
                  <div className='group-controls'>
                    <div className='row'>
                      <div className='row-label'>
                        {session.signedIn
                          ? `Signed in as ${session.handle ? atHandle(session.handle) : session.name ?? 'YouTube account'}`
                          : 'Sign in to sync subscriptions'}
                      </div>
                      <Link className='action-pill' href={session.signedIn ? '/account' : '/signin'}>
                        {session.signedIn ? 'Manage account' : 'Sign in'}
                      </Link>
                    </div>
                  </div>
                </div>
              </>
            )
            : activeSection === 'customization'
              ? (
                <>
                  <div className='setting-row'>
                    <h3 className='group-label'>Theme</h3>
                    <div className='group-controls'>
                      <div className='choices'>
                        {THEMES.map(theme => (
                          <button
                            type='button'
                            key={theme.value}
                            className={settings.theme === theme.value ? 'choice active' : 'choice'}
                            aria-pressed={settings.theme === theme.value}
                            onClick={() => set({ theme: theme.value })}
                          >
                            {theme.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className='setting-row'>
                    <h3 className='group-label'>Display</h3>
                    <div className='group-controls'>
                      <CheckboxRow
                        label='Ambient mode'
                        checked={settings.ambientMode}
                        onChange={() => set({ ambientMode: !settings.ambientMode })}
                      />
                      {settings.ambientMode
                        ? (
                          <>
                            <div className='row'>
                              <div className='row-label'>Ambient area</div>
                              <div className='choices' role='group' aria-label='Ambient area'>
                                {AMBIENT_AREA_OPTIONS.map(option => (
                                  <button
                                    type='button'
                                    key={option.value}
                                    className={settings.ambientArea === option.value ? 'choice active' : 'choice'}
                                    aria-pressed={settings.ambientArea === option.value}
                                    onClick={() => set({ ambientArea: option.value })}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className='row'>
                              <div>
                                <div className='row-label'>Ambient spread</div>
                                <p className='sub-note'>Controls how far ambient colors bleed around the player.</p>
                              </div>
                              <div className='inline-fields'>
                                <input
                                  type='range'
                                  className='spread-slider'
                                  min={AMBIENT_SPREAD_MIN}
                                  max={AMBIENT_SPREAD_MAX}
                                  step={5}
                                  aria-label='Ambient spread'
                                  value={settings.ambientSpread}
                                  onInput={(event: { currentTarget: HTMLInputElement }) => set({
                                    ambientSpread: Number(event.currentTarget.value),
                                  })}
                                />
                                <span className='spread-value' data-ambient-spread-value='true'>
                                  {`${settings.ambientSpread}%`}
                                </span>
                                <div className='choices' role='group' aria-label='Ambient spread presets'>
                                  {AMBIENT_SPREAD_PRESETS.map(preset => (
                                    <button
                                      type='button'
                                      key={preset}
                                      className={settings.ambientSpread === preset ? 'choice active' : 'choice'}
                                      aria-pressed={settings.ambientSpread === preset}
                                      onClick={() => set({ ambientSpread: preset })}
                                    >
                                      {`${preset}%`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className='row'>
                              <div className='row-label'>Filling mode</div>
                              <div className='choices' role='group' aria-label='Filling mode'>
                                {AMBIENT_FILL_MODE_OPTIONS.map(option => (
                                  <button
                                    type='button'
                                    key={option.value}
                                    className={settings.ambientFillMode === option.value ? 'choice active' : 'choice'}
                                    aria-pressed={settings.ambientFillMode === option.value}
                                    onClick={() => set({ ambientFillMode: option.value })}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )
                        : undefined}
                    </div>
                  </div>

                  <div className='setting-row appearance-group'>
                    <CustomAppearance settings={settings} onUpdate={set} />
                  </div>
                </>
              )
              : activeSection === 'time-management'
                ? (
                  <div className='setting-row'>
                    <h3 className='group-label'>Sleep timer</h3>
                    <div className='group-controls'>
                      <CheckboxRow
                        label='Enable sleep timer'
                        checked={settings.sleepTimerEnabled}
                        onChange={() => set({ sleepTimerEnabled: !settings.sleepTimerEnabled })}
                      />
                      {settings.sleepTimerEnabled
                        ? (
                          <div className='choices' role='group' aria-label='Sleep timer'>
                            {SLEEP_CHOICES.map(choice => {
                              const active = isSleepChoiceActive(sleepTimer, choice.value)
                              return (
                                <button
                                  type='button'
                                  key={choice.label}
                                  className={active ? 'choice active' : 'choice'}
                                  aria-pressed={active}
                                  onClick={() => setSleepTimer(choice.value)}
                                >
                                  {choice.label}
                                </button>
                              )
                            })}
                          </div>
                        )
                        : undefined}
                      <p className='sub-note' data-sleep-status='true'>
                        {settings.sleepTimerEnabled
                          ? sleepStatusLabel(sleepTimer)
                          : 'Sleep timer is disabled and hidden from the player.'}
                      </p>
                    </div>
                  </div>
                )
                : activeSection === 'playback'
                  ? (
                    <>
                      <div className='setting-row'>
                        <h3 className='group-label'>Quality</h3>
                        <div className='group-controls'>
                          <div className='choices'>
                            {QUALITIES.map(quality => (
                              <button
                                type='button'
                                key={String(quality.value)}
                                className={settings.quality === quality.value ? 'choice active' : 'choice'}
                                aria-pressed={settings.quality === quality.value}
                                onClick={() => set({ quality: quality.value })}
                              >
                                {quality.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className='setting-row'>
                        <h3 className='group-label'>Theater mode</h3>
                        <div className='group-controls'>
                          <div className='choices' role='group' aria-label='Theater mode'>
                            {THEATER_MODES.map(mode => {
                              const active = settings.theater === mode.value
                              return (
                                <button
                                  type='button'
                                  key={mode.value}
                                  className={active ? 'choice active' : 'choice'}
                                  aria-pressed={active}
                                  onClick={() => set({ theater: mode.value })}
                                >
                                  {mode.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>

                      <div className='setting-row'>
                        <h3 className='group-label'>Playback</h3>
                        <div className='group-controls'>
                          <CheckboxRow
                            label='Stable Volume'
                            checked={settings.stableVolume}
                            onChange={() => set({ stableVolume: !settings.stableVolume })}
                          />
                          <CheckboxRow
                            label='Autoplay'
                            checked={settings.autoplay}
                            onChange={() => set({ autoplay: !settings.autoplay })}
                          />
                          <CheckboxRow
                            label='Annotations'
                            checked={settings.annotations}
                            onChange={() => set({ annotations: !settings.annotations })}
                          />
                          <CheckboxRow
                            label='Show dislike counts'
                            checked={settings.showDislikes}
                            onChange={() => set({ showDislikes: !settings.showDislikes })}
                            extra={
                              <>
                                {' '}
                                <span className='credit'>
                                  Using{' '}
                                  <a className='link' href='https://returnyoutubedislike.com' target='_blank' rel='noreferrer'>
                                    Return YouTube Dislike
                                  </a>
                                </span>
                              </>
                            }
                          />
                          <CheckboxRow
                            label='Skip sponsors'
                            checked={settings.skipSponsors}
                            onChange={() => set({ skipSponsors: !settings.skipSponsors })}
                            extra={
                              <>
                                {' '}
                                <span className='credit'>
                                  Using{' '}
                                  <a className='link' href={SPONSORBLOCK_URL} target='_blank' rel='noreferrer'>
                                    SponsorBlock
                                  </a>
                                </span>
                              </>
                            }
                          />
                        </div>
                      </div>

                      <div className='setting-row'>
                        <h3 className='group-label'>Speed</h3>
                        <div className='group-controls'>
                          <SpeedPicker rate={settings.playbackRate} onRate={(playbackRate: number) => set({ playbackRate })} />
                        </div>
                      </div>

                      <div className='setting-row'>
                        <h3 className='group-label'>Subtitles and closed captions</h3>
                        <div className='group-controls'>
                          <CheckboxRow
                            label='Always show captions'
                            checked={settings.captionsEnabled}
                            onChange={() => set({ captionsEnabled: !settings.captionsEnabled })}
                          />
                          <div className='row'>
                            <div className='row-label'>Preferred subtitle language</div>
                            <div className='inline-fields'>
                              <select
                                className='select'
                                aria-label='Preferred subtitle language'
                                value={customLangOpen ? '__custom__' : (settings.captionsLanguage ?? '')}
                                onChange={(event: { currentTarget: HTMLSelectElement }) => {
                                  const nextValue = event.currentTarget.value
                                  if (nextValue === '__custom__') {
                                    setCustomLangDraft(settings.captionsLanguage ?? '')
                                    setCustomLangOpen(true)
                                    return
                                  }
                                  setCustomLangOpen(false)
                                  set({ captionsLanguage: nextValue || undefined })
                                }}
                              >
                                <option value=''>Auto (browser language)</option>
                                {COMMON_CAPTION_LANGUAGES.map(lang => (
                                  <option key={lang.code} value={lang.code}>
                                    {`${lang.label} (${lang.code})`}
                                  </option>
                                ))}
                                {settings.captionsLanguage
                                  && !COMMON_CAPTION_LANGUAGES.some(lang => lang.code === settings.captionsLanguage)
                                  ? <option value={settings.captionsLanguage}>{settings.captionsLanguage}</option>
                                  : undefined}
                                <option value='__custom__'>Custom code…</option>
                              </select>
                              {customLangOpen
                                ? (
                                  <>
                                    <input
                                      type='text'
                                      className='lang-input'
                                      aria-label='Custom preferred subtitle language code'
                                      placeholder='e.g. pt-BR'
                                      value={customLangDraft}
                                      onInput={(event: { currentTarget: HTMLInputElement }) => setCustomLangDraft(event.currentTarget.value)}
                                    />
                                    <button
                                      type='button'
                                      className='choice'
                                      onClick={() => {
                                        const normalized = normalizeLanguageCode(customLangDraft)
                                        if (!normalized) {
                                          showToast('Enter a valid language code (for example en or pt-BR)')
                                          return
                                        }
                                        set({ captionsLanguage: normalized })
                                        setCustomLangOpen(false)
                                      }}
                                    >
                                      Apply
                                    </button>
                                    <button
                                      type='button'
                                      className='choice'
                                      onClick={() => setCustomLangOpen(false)}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                )
                                : undefined}
                            </div>
                          </div>
                          <div className='row'>
                            <div>
                              <div className='row-label'>Never show subtitles for video languages</div>
                              <p className='sub-note'>Skip automatic subtitles when the video speaks one of these languages.</p>
                            </div>
                            <div className='inline-fields'>
                              <select
                                className='select'
                                aria-label='Add skipped video language'
                                value=''
                                onChange={(event: { currentTarget: HTMLSelectElement }) => {
                                  const nextCode = event.currentTarget.value
                                  if (!nextCode) return
                                  set({ captionsSkipLanguages: [...settings.captionsSkipLanguages, nextCode] })
                                }}
                              >
                                <option value=''>Add language…</option>
                                {COMMON_CAPTION_LANGUAGES
                                  .filter(lang => !settings.captionsSkipLanguages.some(entry => entry.toLowerCase() === lang.code.toLowerCase()))
                                  .map(lang => (
                                    <option key={lang.code} value={lang.code}>
                                      {`${lang.label} (${lang.code})`}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type='text'
                                className='lang-input'
                                aria-label='Custom skipped video language code'
                                placeholder='e.g. pt-BR'
                                value={skipLangDraft}
                                onInput={(event: { currentTarget: HTMLInputElement }) => setSkipLangDraft(event.currentTarget.value)}
                              />
                              <button
                                type='button'
                                className='choice'
                                onClick={() => {
                                  const normalized = normalizeLanguageCode(skipLangDraft)
                                  if (!normalized) {
                                    showToast('Enter a valid language code (for example en or pt-BR)')
                                    return
                                  }
                                  set({ captionsSkipLanguages: [...settings.captionsSkipLanguages, normalized] })
                                  setSkipLangDraft('')
                                }}
                              >
                                Add
                              </button>
                            </div>
                          </div>
                          {settings.captionsSkipLanguages.length > 0
                            ? (
                              <div className='lang-chips' role='list' aria-label='Skipped video languages'>
                                {settings.captionsSkipLanguages.map(code => {
                                  const known = COMMON_CAPTION_LANGUAGES.find(lang => lang.code.toLowerCase() === code.toLowerCase())
                                  const display = known ? `${known.label} (${code})` : code
                                  return (
                                    <button
                                      key={code}
                                      type='button'
                                      className='lang-chip'
                                      aria-label={`Remove ${display} from skipped subtitle languages`}
                                      onClick={() => set({
                                        captionsSkipLanguages: settings.captionsSkipLanguages.filter(entry => entry !== code),
                                      })}
                                    >
                                      <span>{display}</span>
                                      <span aria-hidden='true'>×</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )
                            : undefined}
                        </div>
                      </div>
                    </>
                  )
                  : activeSection === 'privacy'
                    ? (
                      <>
                        <div className='setting-row'>
                          <h3 className='group-label'>Privacy</h3>
                          <div className='group-controls'>
                            <p className='sub-note'>
                              <Link className='link' href='/privacy'>What FTube keeps and where requests go</Link>
                            </p>
                          </div>
                        </div>

                        <div className='setting-row'>
                          <h3 className='group-label'>Watch history</h3>
                          <div className='group-controls'>
                            <div className='row'>
                              <div className='row-label'>Recently watched videos</div>
                              <Link className='action-pill' href='/feed/history'>Watch history</Link>
                            </div>
                          </div>
                        </div>

                        <div className='setting-row'>
                          <h3 className='group-label'>Recommendations</h3>
                          <div className='group-controls'>
                            <RecommendationsResetRow dismissedCount={dismissedCount} />
                          </div>
                        </div>
                      </>
                    )
                    : (
                      <>
                        {/* The one place the header offer can be brought back */}
                        <div className='setting-row'>
                          <h3 className='group-label'>Connection</h3>
                          <div className='group-controls'>
                            <p className='sub-note'>
                              {extension === true
                                ? 'Through the FKN extension'
                                : (
                                  <>
                                    Through the FKN relay.{' '}
                                    <a className='link' href={EXTENSION_URL} target='_blank' rel='noreferrer'>
                                      Get the extension
                                    </a>
                                  </>
                                )}
                            </p>
                            {extension === false
                              ? (
                                <CheckboxRow
                                  label='Offer the extension in the header'
                                  checked={settings.suggestExtension}
                                  onChange={() => set({ suggestExtension: !settings.suggestExtension })}
                                />
                              )
                              : undefined}
                          </div>
                        </div>

                        {session.signedIn && session.handle
                          ? (
                            <div className='setting-row'>
                              <h3 className='group-label'>Channel handle</h3>
                              <div className='group-controls'>
                                <div className='copy-field'>
                                  <input
                                    type='text'
                                    readOnly
                                    className='readonly-input'
                                    aria-label='Channel handle'
                                    value={atHandle(session.handle)}
                                  />
                                  <button
                                    type='button'
                                    className='choice'
                                    onClick={() => void copyHandle(session.handle!)}
                                  >
                                    {copiedHandle ? 'Copied' : 'Copy'}
                                  </button>
                                  <Link className='action-pill' href='/account'>Manage account</Link>
                                </div>
                              </div>
                            </div>
                          )
                          : undefined}

                        <div className='setting-row'>
                          <h3 className='group-label'>Feed display</h3>
                          <div className='group-controls'>
                            <div className='row'>
                              <div className='row-label'>Restore default grid, list, and card style options</div>
                              <button
                                type='button'
                                className='choice'
                                onClick={() => {
                                  resetFeedViewSettings()
                                  showToast('Feed display settings reset')
                                }}
                              >
                                Reset feed display settings
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
      </section>
    </main>
  )
}

export default SettingsPage
