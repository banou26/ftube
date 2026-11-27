import type { FeedSurface } from '../feeds/settings'

import { css } from '@emotion/react'
import { LayoutGrid, List, Settings } from 'lucide-react'

import { setFeedLayout, toggleCustomFeedFilter, useFeedViewSettings } from '../feeds/settings'

const buttonsStyle = css`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;

  .view-btn {
    width: 3.6rem;
    height: 3.6rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .view-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .view-btn.active {
    background: var(--bg-chip);
    color: var(--text-primary);
  }
`

const filterChipsStyle = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;

  .custom-chip {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .custom-chip:hover {
    background: var(--bg-chip-hover);
  }

  .custom-chip[aria-pressed='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }
`

/** Top toolbar icon group matching the [Grid | List | Settings] action controls. */
export const FeedViewButtons = (
  { surface, panelOpen, onTogglePanel }: {
    surface: FeedSurface
    panelOpen: boolean
    onTogglePanel: () => void
  },
) => {
  const settings = useFeedViewSettings()
  const layout = settings.layouts[surface]

  return (
    <div css={buttonsStyle} className='feed-view-buttons' role='group' aria-label='Feed view controls'>
      <button
        type='button'
        className={layout === 'grid' ? 'view-btn active' : 'view-btn'}
        aria-label='Grid view'
        aria-pressed={layout === 'grid'}
        title='Grid view'
        onClick={() => setFeedLayout(surface, 'grid')}
      >
        <LayoutGrid size={18} strokeWidth={1.75} aria-hidden='true' />
      </button>
      <button
        type='button'
        className={layout === 'list' ? 'view-btn active' : 'view-btn'}
        aria-label='List view'
        aria-pressed={layout === 'list'}
        title='List view'
        onClick={() => setFeedLayout(surface, 'list')}
      >
        <List size={18} strokeWidth={1.75} aria-hidden='true' />
      </button>
      <button
        type='button'
        className={panelOpen ? 'view-btn active' : 'view-btn'}
        aria-label='Feed display settings'
        aria-expanded={panelOpen}
        title='Feed display settings'
        onClick={onTogglePanel}
      >
        <Settings size={18} strokeWidth={1.75} aria-hidden='true' />
      </button>
    </div>
  )
}

/** Custom filter chips created by the user in the Feed Settings side panel. */
export const FeedFilterChips = () => {
  const settings = useFeedViewSettings()
  if (settings.customFilters.length === 0) return null

  return (
    <div css={filterChipsStyle} className='feed-custom-chips' role='group' aria-label='Custom filters'>
      {settings.customFilters.map((filter) => {
        const active = settings.activeCustomFilterIds.includes(filter.id)
        return (
          <button
            key={filter.id}
            type='button'
            className='custom-chip'
            aria-pressed={active}
            onClick={() => toggleCustomFeedFilter(filter.id)}
          >
            {filter.name}
          </button>
        )
      })}
    </div>
  )
}
