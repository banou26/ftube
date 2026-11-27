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
