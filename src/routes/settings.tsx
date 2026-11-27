import type { TargetedKeyboardEvent } from 'preact'
import type { QualityPreference, Settings, ThemePreference } from '../settings'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { clearDismissed, getDismissed, restoreDismissed, useDismissed } from '../components/dismissed-videos'
import { CustomAppearance } from '../components/custom-appearance'
import { EXTENSION_URL, useExtensionExposed } from '../components/extension-notice'
import { SpeedPicker } from '../player/speed-picker'
import { SPONSORBLOCK_URL } from '../player/sponsorblock'
import { getSettings, subscribeSettings, updateSettings } from '../settings'
import { showUndoableToast } from '../undo'

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

type SettingsTab = 'general' | 'appearance'

const SETTINGS_TABS: { id: SettingsTab, label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
]

export const readSettingsTab = (search: string, hash: string): SettingsTab => {
  const tab = new URLSearchParams(search).get('tab')
  if (tab === 'appearance') return 'appearance'
  if (hash === '#appearance' || hash === '#custom-appearance') return 'appearance'
  return 'general'
}

const style = css`
  max-width: 78rem;
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 1.2rem;
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    min-height: 4.4rem;
    max-width: 100%;
    margin-bottom: 2.4rem;
    overflow-x: auto;
    scrollbar-width: none;
    box-shadow: inset 0 -1px var(--border-subtle);
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 4.4rem;
    padding: 0;
    border: none;
    border-bottom: 0.25rem solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 1.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--text-primary);
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: -2px;
  }

  .section {
    padding: 2.4rem 0;
    border-top: 1px solid var(--border-subtle);
  }

  .section:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  .section-title {
    margin: 0 0 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .section-note {
    margin: 0;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.6rem;
    padding: 0.8rem 0;
  }

  .row-label {
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .link {
    color: var(--accent);
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

  .choice {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .choice:hover {
    background: var(--bg-chip-hover);
  }

  .choice.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  /* A native checkbox rather than a custom switch: it is already keyboard
     operable and announced correctly, and a switch would be styling for its
     own sake. */
  .toggle {
    width: 1.8rem;
    height: 1.8rem;
    accent-color: var(--accent);
  }

  .choice:disabled {
    cursor: default;
    opacity: 0.5;
  }
`

export const SettingsPage = () => {
  useDocumentTitle('Settings')
  const search = useSearch()
  const [, navigate] = useLocation()
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    readSettingsTab(search, typeof window !== 'undefined' ? window.location.hash : ''),
  )
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({ general: null, appearance: null })
  const [settings, setSettings] = useState<Settings>(getSettings)
  const extension = useExtensionExposed()
  const dismissed = useDismissed()
  const dismissedCount = dismissed.videos.size + dismissed.channels.size

  // The store is shared, so this page follows it rather than owning a copy of it
  useEffect(() => subscribeSettings(setSettings), [])

  useEffect(() => {
    const sync = () => setActiveTab(readSettingsTab(window.location.search, window.location.hash))
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [search])

  const selectTab = (next: SettingsTab) => {
    setActiveTab(next)
    navigate(next === 'appearance' ? '/settings?tab=appearance' : '/settings', { replace: true })
  }

  const onTabKeyDown = (index: number, event: TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next = SETTINGS_TABS[(index + offset + SETTINGS_TABS.length) % SETTINGS_TABS.length]
    if (!next) return
    selectTab(next.id)
    tabRefs.current[next.id]?.focus()
  }

  const set = (patch: Partial<Settings>) => setSettings(updateSettings(patch))

  return (
    <main css={style}>
      <h1 className='heading'>Settings</h1>

      <div className='tabs' role='tablist' aria-label='Settings sections'>
        {SETTINGS_TABS.map((tab, index) => (
          <button
            type='button'
            key={tab.id}
            ref={(el: HTMLButtonElement | null) => { tabRefs.current[tab.id] = el }}
            id={`settings-tab-${tab.id}`}
            role='tab'
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            className={activeTab === tab.id ? 'tab active' : 'tab'}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event: TargetedKeyboardEvent<HTMLButtonElement>) => onTabKeyDown(index, event)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'appearance'
        ? (
          <div role='tabpanel' id='settings-panel-appearance' aria-labelledby='settings-tab-appearance'>
            <section className='section'>
              <h2 className='section-title'>Theme</h2>
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
              <div className='row' style={{ marginTop: '1.2rem' }}>
                <div className='row-label'>Ambient mode</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Ambient mode'
                  checked={settings.ambientMode}
                  onChange={() => set({ ambientMode: !settings.ambientMode })}
                />
              </div>
            </section>
            <CustomAppearance settings={settings} onUpdate={set} />
          </div>
        )
        : (
          <div role='tabpanel' id='settings-panel-general' aria-labelledby='settings-tab-general'>
            <section className='section'>
              <h2 className='section-title'>Playback</h2>
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
              <div className='row'>
                <div className='row-label'>Stable Volume</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Stable Volume'
                  checked={settings.stableVolume}
                  onChange={() => set({ stableVolume: !settings.stableVolume })}
                />
              </div>
              <div className='row'>
                <div className='row-label'>Autoplay</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Autoplay'
                  checked={settings.autoplay}
                  onChange={() => set({ autoplay: !settings.autoplay })}
                />
              </div>
              <div className='row'>
                <div className='row-label'>Theater mode</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Theater mode'
                  checked={settings.theater}
                  onChange={() => set({ theater: !settings.theater })}
                />
              </div>
              <div className='row'>
                <div className='row-label'>
                  Show dislike counts{' '}
                  <span className='credit'>
                    Using <a className='link' href='https://returnyoutubedislike.com' target='_blank' rel='noreferrer'>Return YouTube Dislike</a>
                  </span>
                </div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Show dislike counts'
                  checked={settings.showDislikes}
                  onChange={() => set({ showDislikes: !settings.showDislikes })}
                />
              </div>
              <div className='row'>
                <div className='row-label'>Annotations</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Annotations'
                  checked={settings.annotations}
                  onChange={() => set({ annotations: !settings.annotations })}
                />
              </div>
              <div className='row'>
                <div className='row-label'>
                  Skip sponsors{' '}
                  <span className='credit'>
                    Using <a className='link' href={SPONSORBLOCK_URL} target='_blank' rel='noreferrer'>SponsorBlock</a>
                  </span>
                </div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Skip sponsors'
                  checked={settings.skipSponsors}
                  onChange={() => set({ skipSponsors: !settings.skipSponsors })}
                />
              </div>
            </section>

            <section className='section'>
              <h2 className='section-title'>Speed</h2>
              <SpeedPicker rate={settings.playbackRate} onRate={(playbackRate: number) => set({ playbackRate })} />
            </section>

            <section className='section'>
              <h2 className='section-title'>Subtitles</h2>
              <div className='row'>
                <div className='row-label'>Always show captions</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Always show captions'
                  checked={settings.captionsEnabled}
                  onChange={() => set({ captionsEnabled: !settings.captionsEnabled })}
                />
              </div>
            </section>

            <section className='section'>
              <h2 className='section-title'>Shorts</h2>
              <div className='row'>
                <div className='row-label'>Hide Shorts</div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label='Hide Shorts'
                  checked={settings.hideShorts}
                  onChange={() => set({ hideShorts: !settings.hideShorts })}
                />
              </div>
            </section>

            {/* The one place the header offer can be brought back */}
            <section className='section'>
              <h2 className='section-title'>Connection</h2>
              <p className='section-note'>
                {extension === true
                  ? 'Through the FKN extension'
                  : (
                    <>
                      Through the FKN relay.{' '}
                      <a className='link' href={EXTENSION_URL} target='_blank' rel='noreferrer'>Get the extension</a>
                    </>
                  )}
              </p>
              {extension === false
                ? (
                  <div className='row'>
                    <div className='row-label'>Offer the extension in the header</div>
                    <input
                      type='checkbox'
                      className='toggle'
                      aria-label='Offer the extension in the header'
                      checked={settings.suggestExtension}
                      onChange={() => set({ suggestExtension: !settings.suggestExtension })}
                    />
                  </div>
                )
                : undefined}
            </section>

            <section className='section'>
              <h2 className='section-title'>Recommendations</h2>
              <div className='row'>
                <div className='row-label'>
                  Hidden videos and channels ({dismissedCount})
                </div>
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
            </section>

            <section className='section'>
              <h2 className='section-title'>Privacy</h2>
              <p className='section-note'>
                <Link className='link' href='/privacy'>What FTube keeps and where requests go</Link>
              </p>
            </section>
          </div>
        )}
    </main>
  )
}

export default SettingsPage
