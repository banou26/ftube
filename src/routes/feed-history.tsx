import type { WatchHistoryQuery } from '../generated/graphql'
import type { HistoryEntry, ImportedHistory } from '../history/browser-history'
import type { HistoryTypeFilter } from './history-filter'

import { css } from '@emotion/react'
import { Download, History, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure, lineFor } from '../components/data-failure'
import { useExtensionExposed } from '../components/extension-notice'
import { SignedOutPrompt } from '../components/signed-out-prompt'
import { Dialog } from '../components/ui/dialog'
import { showToast } from '../components/ui/toast'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import { groupChannelsWithDescendants, groupTreeOrder, useGroups } from '../groups/store'
import { canImportBrowserHistory, dayHeading, importBrowserHistory, importFailure, keptBrowserHistory, SignedOutError } from '../history/browser-history'
import { deleteImportedHistory, readImportedHistory } from '../history/store'
import { startPlatform } from '../engine/platform'
import { useSession } from '../session'
import { useSetting } from '../settings'
import { signIn } from '../sign-in'
import { EMPTY_HISTORY_PAGES_LIMIT, emptyHistoryPagesInARow, matchesHistoryFilter } from './history-filter'

const WATCH_HISTORY_QUERY = gql(`
  query WatchHistory($query: String, $cursor: String) {
    history(query: $query, cursor: $cursor) {
      sections {
        title
        items {
          id
          title
          thumbnail
          thumbnailSrcset
          durationSeconds
          viewCount
          publishedText
          isLive
          isShort
          progressPercent
          channel { id name avatar isVerified isVerifiedArtist }
          byline { text isVerified isVerifiedArtist }
          collaborators { id name avatar handle subscriberCountText isVerified isVerifiedArtist }
        }
      }
      cursor
    }
  }
`)

const REMOVE_FROM_HISTORY = gql(`
  mutation RemoveFromHistory($videoId: ID!) {
    removeFromHistory(videoId: $videoId)
  }
`)

const CLEAR_HISTORY = gql(`
  mutation ClearHistory {
    clearHistory
  }
`)

type HistoryPage = WatchHistoryQuery['history']
type HistoryVideo = HistoryPage['sections'][number]['items'][number] & { sectionTitle: string }
type HistorySection = { title: string, items: HistoryVideo[] }

const SKELETON_ROWS = 8

const style = css`
  max-width: 88rem;
  padding: 2.4rem 1.6rem;

  &.signed-out {
    max-width: none;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem 1.6rem;
    margin-bottom: 2rem;
  }

  .heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .clear-history {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clear-history:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .clear-history:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    margin-bottom: 2.4rem;
  }

  .search-form {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    max-width: 40rem;
    height: 3.6rem;
    padding: 0 0.8rem 0 1.2rem;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .search-form:focus-within {
    border-bottom-color: var(--text-primary);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    outline: none;
  }

  .search-clear {
    flex: none;
    width: 2.8rem;
    height: 2.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .search-clear:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.2rem 2.4rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  .chip {
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
    transition: background 0.15s ease;
  }

  .chip:hover {
    background: var(--bg-chip-hover);
  }

  .chip[aria-pressed='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .chip .emoji {
    margin-right: 0.6rem;
  }

  .manage {
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--accent);
  }

  .section + .section {
    margin-top: 3.2rem;
  }

  .section-title {
    margin: 0 0 1.6rem;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  .entries {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
  }

  .entry {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .card {
    flex: 1;
    min-width: 0;
  }

  .remove {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .entry:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    background: var(--bg-hover);
  }

  .remove:disabled {
    cursor: default;
  }

  .more {
    display: block;
    height: 3.6rem;
    margin: 2.4rem auto 0;
    padding: 0 1.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .more:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .prompt {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .prompt h2 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  > .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 0.8rem;
    margin: 0 0 2.4rem;
  }

  > .actions .sign-in {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    min-height: 3.6rem;
    max-width: 100%;
    padding: 0.6rem 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  > .actions .sign-in svg {
    flex: none;
  }

  > .actions .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  > .actions .sign-in:disabled {
    cursor: default;
    opacity: 0.6;
  }
`

const confirmStyle = css`
  .confirm-note {
    margin: 0 0 2rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.8rem;
  }

  .cancel,
  .confirm {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .cancel {
    background: transparent;
    color: var(--text-primary);
  }

  .cancel:hover {
    background: var(--bg-hover);
  }

  .confirm {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .confirm:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .confirm:disabled {
    cursor: default;
    opacity: 0.6;
  }
`

const HistoryControls = (
  {
    draftQuery, onQueryInput, onSubmit, onClearSearch, showClear,
    type, onType, hideShorts, group, orderedGroups, onGroup,
  }: {
    draftQuery: string
    onQueryInput: (value: string) => void
    onSubmit: (event: Event) => void
    onClearSearch: () => void
    showClear: boolean
    type: HistoryTypeFilter
    onType: (next: HistoryTypeFilter) => void
    hideShorts: boolean
    group: ReturnType<typeof useGroups>[number] | undefined
    orderedGroups: ReturnType<typeof groupTreeOrder>
    onGroup: (groupId: string | undefined) => void
  },
) => (
  <div className='controls'>
    <form className='search-form' role='search' onSubmit={onSubmit}>
      <Search size={18} strokeWidth={1.5} aria-hidden='true' />
      <input
        type='search'
        className='search-input'
        aria-label='Search watch history'
        placeholder='Search watch history'
        value={draftQuery}
        onInput={(event: Event) => onQueryInput((event.currentTarget as HTMLInputElement).value)}
      />
      {showClear
        ? (
          <button type='button' className='search-clear' aria-label='Clear search' onClick={onClearSearch}>
            <X size={16} strokeWidth={1.5} />
          </button>
        )
        : undefined}
    </form>
    <div className='filters'>
      <div className='chips' role='group' aria-label='Filter by type'>
        <button type='button' className='chip' aria-pressed={type === 'all'} onClick={() => onType('all')}>All</button>
        <button type='button' className='chip' aria-pressed={type === 'videos'} onClick={() => onType('videos')}>Videos</button>
        {hideShorts
          ? undefined
          : <button type='button' className='chip' aria-pressed={type === 'shorts'} onClick={() => onType('shorts')}>Shorts</button>}
      </div>
      {orderedGroups.length > 0
        ? (
          <div className='chips' role='group' aria-label='Groups'>
            <button type='button' className='chip' aria-pressed={!group} onClick={() => onGroup(undefined)}>All channels</button>
            {orderedGroups.map(({ group: candidate }) => (
              <button
                key={candidate.id}
                type='button'
                className='chip'
                aria-pressed={candidate.id === group?.id}
                onClick={() => onGroup(candidate.id)}
              >
                <span className='emoji' aria-hidden='true'>{candidate.emoji}</span>
                {candidate.name}
              </button>
            ))}
            <Link href='/feed/groups' className='manage'>Manage</Link>
          </div>
        )
        : undefined}
    </div>
  </div>
)

const useHistoryFilter = (query?: string) => {
  const hideShorts = useSetting('hideShorts')
  const groups = useGroups()
  const orderedGroups = groupTreeOrder(groups)
  const [type, setType] = useState<HistoryTypeFilter>('all')
  const [groupId, setGroupId] = useState<string | undefined>(undefined)

  const effectiveType: HistoryTypeFilter = hideShorts && type === 'shorts' ? 'all' : type
  const group = groups.find(candidate => candidate.id === groupId)
  const channelIds = group ? new Set(groupChannelsWithDescendants(groups, group.id).map(channel => channel.id)) : undefined
  const filter = { type: effectiveType, channelIds, query, hideShorts }
  const hasFilter = effectiveType !== 'all' || group !== undefined || (query?.trim() ?? '') !== ''

  return { hideShorts, orderedGroups, group, setGroupId, type: effectiveType, setType, filter, hasFilter }
}

const HistorySkeleton = () => (
  <main css={style}>
    <div className='head'>
      <h1 className='heading'>Watch history</h1>
    </div>
    <div className='entries'>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => <VideoCardCompactSkeleton key={index} />)}
    </div>
  </main>
)

const HistoryFeedPage = () => {
  useDocumentTitle('History')
  const { ready, signedIn } = useSession()
  const [draftQuery, setDraftQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [loaded, setLoaded] = useState<HistoryPage[]>([])
  const { hideShorts, orderedGroups, group, setGroupId, type, setType, filter, hasFilter } = useHistoryFilter(submittedQuery)

  const expectedQuery = submittedQuery || undefined
  const [{ data, error, fetching, operation }, reexecute] = useQuery({
    query: WATCH_HISTORY_QUERY,
    variables: { query: expectedQuery, cursor: loaded[loaded.length - 1]?.cursor },
    // the source refuses this feed when signed out and errors are unmasked, so the refusal would land in the UI verbatim
    pause: !ready || !signedIn,
  })
  const [, removeFromHistory] = useMutation(REMOVE_FROM_HISTORY)
  const [, clearHistory] = useMutation(CLEAR_HISTORY)
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removing, setRemoving] = useState<string[]>([])

  const matchedOperation = operation?.variables.query === expectedQuery
  const page = matchedOperation ? data?.history : undefined
  // urql keeps the previous result while the next page is in flight, so the live page can repeat one already consumed
  const pages = page && loaded[loaded.length - 1] !== page ? [...loaded, page] : loaded
  const { items, cursor } = useInfiniteFeed({
    pages: pages.map(entry => ({
      items: entry.sections.flatMap(section =>
        section.items.map(video => ({ ...video, sectionTitle: section.title ?? '' }))),
      cursor: entry.cursor,
    })),
    key: video => video.id,
  })

  const stalled = emptyHistoryPagesInARow(pages, filter) >= EMPTY_HISTORY_PAGES_LIMIT

  const sections: HistorySection[] = []
  const byTitle = new Map<string, HistorySection>()
  const clientFilter = { type: filter.type, channelIds: filter.channelIds, hideShorts }
  for (const video of items) {
    if (removed.has(video.id) || !matchesHistoryFilter(video, clientFilter)) continue
    let section = byTitle.get(video.sectionTitle)
    if (!section) {
      section = { title: video.sectionTitle, items: [] }
      byTitle.set(video.sectionTitle, section)
      sections.push(section)
    }
    section.items.push(video)
  }

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }

  const onRemove = (videoId: string) => {
    if (removing.includes(videoId)) return
    setRemoving(previous => [...previous, videoId])
    void removeFromHistory({ videoId }).then((result) => {
      setRemoving(previous => previous.filter(id => id !== videoId))
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setRemoved(previous => new Set(previous).add(videoId))
      showToast('Removed from watch history')
    })
  }

  const onSearchSubmit = (event: Event) => {
    event.preventDefault()
    const nextQuery = draftQuery.trim()
    if (nextQuery === submittedQuery) return
    setLoaded([])
    setSubmittedQuery(nextQuery)
  }

  const onSearchClear = () => {
    setDraftQuery('')
    if (submittedQuery === '') return
    setLoaded([])
    setSubmittedQuery('')
  }

  const onClearAll = () => {
    if (clearing) return
    setClearing(true)
    void clearHistory({}).then((result) => {
      setClearing(false)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setClearOpen(false)
      setLoaded([])
      setRemoved(new Set())
      setDraftQuery('')
      setSubmittedQuery('')
      reexecute({ requestPolicy: 'network-only' })
      showToast('Watch history cleared')
    })
  }

  if (!ready) return <HistorySkeleton />

  if (!signedIn) return <SignedOutHistory onSignIn={signIn} />

  return (
    <main css={style}>
      <div className='head'>
        <h1 className='heading'>Watch history</h1>
        <button
          type='button'
          className='clear-history'
          disabled={clearing}
          onClick={() => setClearOpen(true)}
        >
          <Trash2 size={18} strokeWidth={1.5} />
          Clear all watch history
        </button>
      </div>
      <HistoryControls
        draftQuery={draftQuery}
        onQueryInput={setDraftQuery}
        onSubmit={onSearchSubmit}
        onClearSearch={onSearchClear}
        showClear={Boolean(draftQuery || submittedQuery)}
        type={type}
        onType={setType}
        hideShorts={hideShorts}
        group={group}
        orderedGroups={orderedGroups}
        onGroup={setGroupId}
      />
      {fetching && items.length === 0
        ? (
          <div className='entries'>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => <VideoCardCompactSkeleton key={index} />)}
          </div>
        )
        : undefined}
      {sections.map(section => (
        <section className='section' key={section.title}>
          {section.title ? <h2 className='section-title'>{section.title}</h2> : undefined}
          <div className='entries'>
            {section.items.map(video => (
              <div className='entry' key={video.id}>
                <div className='card'>
                  <VideoCardCompact video={video} />
                </div>
                <button
                  type='button'
                  className='remove'
                  aria-label={`Remove ${video.title} from watch history`}
                  disabled={removing.includes(video.id)}
                  onClick={() => onRemove(video.id)}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      {page && !fetching && !error && sections.length === 0 && (!hasFilter || stalled || !cursor)
        ? (
          <div className='prompt'>
            <h2>{hasFilter ? 'No matching videos' : 'Nothing watched yet'}</h2>
          </div>
        )
        : undefined}
      {fetching && items.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {stalled && cursor && !fetching && !error
        ? <button type='button' className='more' onClick={onMore}>Load more</button>
        : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor || stalled} />
      {clearOpen
        ? (
          <Dialog title='Clear watch history?' onClose={() => { if (!clearing) setClearOpen(false) }}>
            <div css={confirmStyle}>
              <p className='confirm-note'>Your YouTube watch history will be cleared from all devices.</p>
              <div className='confirm-actions'>
                <button type='button' className='cancel' disabled={clearing} onClick={() => setClearOpen(false)}>Cancel</button>
                <button type='button' className='confirm' disabled={clearing} onClick={onClearAll}>
                  {clearing ? 'Clearing…' : 'Clear watch history'}
                </button>
              </div>
            </div>
          </Dialog>
        )
        : undefined}
    </main>
  )
}

type ImportedSection = { key: string, title?: string, entries: HistoryEntry[] }

const importedSections = (entries: HistoryEntry[], now: Date) => {
  const sections: ImportedSection[] = []
  for (const entry of entries) {
    const key = entry.watchedOn ?? entry.heading ?? ''
    const last = sections[sections.length - 1]
    if (last?.key === key) last.entries.push(entry)
    else sections.push({ key, title: entry.watchedOn ? dayHeading(entry.watchedOn, now) : entry.heading, entries: [entry] })
  }
  return sections
}

const SignedOutHistory = ({ onSignIn }: { onSignIn: () => void }) => {
  const exposed = useExtensionExposed()
  const [draftQuery, setDraftQuery] = useState('')
  const { hideShorts, orderedGroups, group, setGroupId, type, setType, filter, hasFilter } = useHistoryFilter(draftQuery)
  const offered = exposed === true && canImportBrowserHistory()
  const [imported, setImported] = useState<ImportedHistory | undefined>()
  // a kept copy this page cannot match to the browser's YouTube session: never listed, still deletable
  const [unmatched, setUnmatched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<number | undefined>()
  const [failure, setFailure] = useState<string | undefined>()

  useEffect(() => {
    let current = true
    const settle = (shown: ImportedHistory | undefined, kept = shown !== undefined) => {
      if (!current) return
      setImported(shown)
      setUnmatched(kept && !shown)
      setLoaded(true)
    }
    void readImportedHistory().then(async (kept) => {
      if (!kept || !offered) return settle(undefined, kept !== undefined)
      settle(await keptBrowserHistory((await startPlatform()).browserSession, kept))
    }).catch(() => settle(undefined, true))
    return () => {
      current = false
    }
  }, [offered])

  const runImport = () => {
    if (progress !== undefined) return
    setFailure(undefined)
    setProgress(0)
    void startPlatform().then(({ browserSession }) => importBrowserHistory(browserSession, setProgress)).then((history) => {
      setImported(history)
      setUnmatched(false)
    }, (error: unknown) => {
      setFailure(importFailure(error))
      if (!(error instanceof SignedOutError)) return
      setImported(undefined)
      setUnmatched(false)
    }).finally(() => setProgress(undefined))
  }

  const onDelete = () => {
    void deleteImportedHistory().then(() => {
      setImported(undefined)
      setUnmatched(false)
      showToast('Imported history deleted')
    }, () => showToast('Could not delete the imported history'))
  }

  const deleteButton = (
    <button type='button' className='sign-in' onClick={onDelete}>
      <Trash2 size={20} strokeWidth={1.5} />
      Delete imported history
    </button>
  )

  const importButton = (label: string) => (
    <button type='button' className='sign-in' disabled={progress !== undefined} onClick={runImport}>
      <Download size={20} strokeWidth={1.5} />
      {progress === undefined ? label : `Importing… ${progress} videos`}
    </button>
  )

  if (!loaded) return <HistorySkeleton />

  if (!imported) {
    return (
      <main css={style} className='signed-out'>
        <h1 className='heading'>Watch history</h1>
        <SignedOutPrompt
          icon={History}
          title='Keep track of what you watch'
          subtitle="Watch history isn't viewable when signed out."
          onSignIn={onSignIn}
          actions={(
            <>
              {offered ? importButton('Import from YouTube on this browser') : undefined}
              {unmatched ? deleteButton : undefined}
            </>
          )}
        >
          {failure ? <p className='notice'>{failure}</p> : undefined}
        </SignedOutPrompt>
      </main>
    )
  }

  const visibleEntries = imported.entries.filter(entry => matchesHistoryFilter(entry, filter))

  return (
    <main css={style}>
      <h1 className='heading'>Watch history</h1>
      <div className='actions'>
        {offered ? importButton('Import again') : undefined}
        {deleteButton}
      </div>
      <HistoryControls
        draftQuery={draftQuery}
        onQueryInput={setDraftQuery}
        onSubmit={(event: Event) => event.preventDefault()}
        onClearSearch={() => setDraftQuery('')}
        showClear={Boolean(draftQuery)}
        type={type}
        onType={setType}
        hideShorts={hideShorts}
        group={group}
        orderedGroups={orderedGroups}
        onGroup={setGroupId}
      />
      {failure ? <p className='notice'>{failure}</p> : undefined}
      {importedSections(visibleEntries, new Date()).map(section => (
        <section className='section' key={section.key}>
          {section.title ? <h2 className='section-title'>{section.title}</h2> : undefined}
          <div className='entries'>
            {section.entries.map(entry => <VideoCardCompact key={entry.id} video={entry} />)}
          </div>
        </section>
      ))}
      {visibleEntries.length === 0
        ? (
          <div className='prompt'>
            <h2>{hasFilter ? 'No matching videos' : 'Nothing watched yet'}</h2>
          </div>
        )
        : undefined}
    </main>
  )
}

export default HistoryFeedPage
