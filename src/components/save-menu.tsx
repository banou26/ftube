import type { VNode } from 'preact'

import { css } from '@emotion/react'
import { ListPlus, Plus, Square, SquareCheck } from 'lucide-react'
import { cloneElement } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'

import type { PlaylistPrivacy, SavePlaylistsQuery } from '../generated/graphql'

import { gql } from '../generated'
import { useSession } from '../session'
import { DataFailure, lineFor, MenuDataFailure } from './data-failure'
import { privacyIcon, WATCH_LATER_ID } from './playlist'
import Dialog from './ui/dialog'
import { Menu, MenuItem, MenuSection, MenuSeparator } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'
import { signIn } from '../sign-in'
import { showUndoableToast } from '../undo'

// no `privacy`: the library feed carries no visibility, and Playlist is keyed by id in graphcache, so it would overwrite what a /playlist read stored
const SAVE_PLAYLISTS_QUERY = gql(`
  query SavePlaylists($cursor: String) {
    playlists(cursor: $cursor) {
      items {
        id
        title
        videoCountText
      }
      cursor
    }
  }
`)

const ADD_TO_PLAYLIST = gql(`
  mutation AddToPlaylist($playlistId: ID!, $videoIds: [ID!]!) {
    addToPlaylist(playlistId: $playlistId, videoIds: $videoIds) {
      id
    }
  }
`)

const CREATE_PLAYLIST = gql(`
  mutation CreatePlaylist($title: String!, $videoIds: [ID!], $privacy: PlaylistPrivacy) {
    createPlaylist(title: $title, videoIds: $videoIds, privacy: $privacy) {
      id
      title
      videoCountText
      privacy
    }
  }
`)

const DELETE_CREATED_PLAYLIST = gql(`
  mutation DeleteCreatedPlaylist($id: ID!) {
    deletePlaylist(id: $id)
  }
`)

type PlaylistsPage = SavePlaylistsQuery['playlists']

type SaveRow = { id: string, title: string, videoCountText?: string | null, privacy?: string | null }

const triggerStyle = css`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  height: var(--action-height, 3.6rem);
  padding: 0 1.6rem;
  border: none;
  border-radius: calc(var(--action-height, 3.6rem) / 2);
  background: var(--bg-chip);
  color: var(--text-primary);
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-chip-hover);
  }
`

const panelStyle = css`
  min-width: 28rem;
`

const formStyle = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field-label {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .name {
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .name:focus,
  .privacy:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .privacy {
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .row {
    display: flex;
    justify-content: flex-end;
    gap: 0.8rem;
  }

  .cancel,
  .create {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .cancel {
    background: transparent;
    color: var(--accent);
  }

  .cancel:hover {
    background: var(--accent-hover);
  }

  /* --accent-inverse is the OPPOSITE theme's accent, meant as a foreground on
     an inverted surface: as a fill here it lands at #3ea6ff in the light theme
     and takes white text to 2.6:1, under the 4.5:1 this size needs. The filled
     pills elsewhere in the app use the inverse PAIR, which stays legible in
     both themes and needs no literal. */
  .create {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .create:not(:disabled):hover {
    background: var(--bg-inverse-hover);
  }

  .create:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

const dialogStyle = css`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  .list {
    display: flex;
    flex-direction: column;
    max-height: 28rem;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-height: 4rem;
    padding: 0 0.8rem;
    border: none;
    border-radius: 0.8rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .item:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .item .title {
    flex: 1;
    min-width: 0;
  }

  .item .count {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .status {
    padding: 0.8rem;
    font-size: 1.35rem;
    color: var(--text-secondary);
  }

  .divider {
    height: 1px;
    margin: 0.6rem 0;
    background: var(--border-subtle);
  }
`

const useSavePlaylists = (videoId: string, active: boolean) => {
  const { ready, signedIn } = useSession()
  const [loaded, setLoaded] = useState<PlaylistsPage[]>([])
  const [saved, setSaved] = useState<string[]>([])
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<SaveRow[]>([])
  const [name, setName] = useState('')
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>('PRIVATE')

  const [{ data, error, fetching }, reexecute] = useQuery({
    query: SAVE_PLAYLISTS_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !active || !ready || !signedIn,
  })
  const [, addToPlaylist] = useMutation(ADD_TO_PLAYLIST)
  const [createState, createPlaylist] = useMutation(CREATE_PLAYLIST)
  const [, deletePlaylist] = useMutation(DELETE_CREATED_PLAYLIST)

  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: playlist => playlist.id,
  })

  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page])
  }

  // a created playlist is shown from the mutation result: a refetch would fetch whichever page the cursor is on, not the first one it appears on
  const rows: SaveRow[] = [
    ...created,
    ...items.filter(playlist =>
      playlist.id !== WATCH_LATER_ID && !created.some(row => row.id === playlist.id)),
  ]

  const onSave = (playlistId: string, title: string) => {
    if (pending !== undefined || saved.includes(playlistId)) return
    setPending(playlistId)
    void addToPlaylist({ playlistId, videoIds: [videoId] }).then((result) => {
      setPending(undefined)
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      setSaved(ids => [...ids, playlistId])
      showToast(`Saved to ${title}`)
    })
  }

  const onName = (event: Event) => setName((event.currentTarget as HTMLInputElement).value)
  const onPrivacy = (event: Event) =>
    setPrivacy((event.currentTarget as HTMLSelectElement).value as PlaylistPrivacy)

  const onCreate = (event: Event) => {
    event.preventDefault()
    const title = name.trim()
    if (title.length === 0 || createState.fetching) return
    void createPlaylist({ title, videoIds: [videoId], privacy }).then((result) => {
      if (result.error) {
        showToast(lineFor(result.error))
        return
      }
      const playlist = result.data?.createPlaylist
      if (playlist) {
        setCreated(rows => [...rows, playlist])
        setSaved(ids => [...ids, playlist.id])
      }
      setCreating(false)
      setName('')
      if (playlist) {
        showUndoableToast(`Saved to ${title}`, {
          label: `Create playlist ${title}`,
          undo: async () => {
            const removed = await deletePlaylist({ id: playlist.id })
            if (removed.error) throw removed.error
            setCreated(rows => rows.filter(row => row.id !== playlist.id))
            setSaved(ids => ids.filter(id => id !== playlist.id))
          },
          undoneMessage: `Deleted ${title}`,
        })
      } else {
        showToast(`Saved to ${title}`)
      }
    })
  }

  return {
    ready,
    signedIn,
    rows,
    cursor,
    error,
    fetching,
    reexecute,
    saved,
    pending,
    creating,
    setCreating,
    name,
    privacy,
    createFetching: createState.fetching,
    onMore,
    onSave,
    onName,
    onPrivacy,
    onCreate,
  }
}

type NewPlaylistDialogProps = {
  name: string
  privacy: PlaylistPrivacy
  fetching: boolean
  onName: (event: Event) => void
  onPrivacy: (event: Event) => void
  onCreate: (event: Event) => void
  onClose: () => void
}

const NewPlaylistDialog = (
  { name, privacy, fetching, onName, onPrivacy, onCreate, onClose }: NewPlaylistDialogProps,
) => (
  <Dialog title='New playlist' onClose={onClose}>
    <form css={formStyle} onSubmit={onCreate}>
      <label className='field'>
        <span className='field-label'>Name</span>
        <input
          className='name'
          type='text'
          value={name}
          maxLength={150}
          placeholder='Enter playlist name'
          onInput={onName}
        />
      </label>
      {/* creation is the one endpoint that reliably applies privacy, so a wrong choice cannot be corrected from this panel later */}
      <label className='field'>
        <span className='field-label'>Visibility</span>
        <select className='privacy' value={privacy} onChange={onPrivacy}>
          <option value='PRIVATE'>Private</option>
          <option value='UNLISTED'>Unlisted</option>
          <option value='PUBLIC'>Public</option>
        </select>
      </label>
      <div className='row'>
        <button type='button' className='cancel' onClick={onClose}>Cancel</button>
        <button
          type='submit'
          className='create'
          disabled={name.trim().length === 0 || fetching}
        >
          {fetching ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  </Dialog>
)

/** Controlled dialog for saving a video to playlists when Save overflows out of the action bar. */
export const SaveDialog = (
  { open = true, onClose, videoId }: {
    open?: boolean
    onClose: () => void
    videoId: string
  },
) => {
  const state = useSavePlaylists(videoId, open)

  useEffect(() => {
    if (open && state.ready && !state.signedIn) {
      onClose()
      signIn()
    }
  }, [open, state.ready, state.signedIn, onClose])

  if (!open || (state.ready && !state.signedIn)) return null

  if (state.creating) {
    return (
      <NewPlaylistDialog
        name={state.name}
        privacy={state.privacy}
        fetching={state.createFetching}
        onName={state.onName}
        onPrivacy={state.onPrivacy}
        onCreate={state.onCreate}
        onClose={() => state.setCreating(false)}
      />
    )
  }

  return (
    <Dialog title='Save to playlist' onClose={onClose}>
      <div css={dialogStyle}>
        <div className='list'>
          <button
            type='button'
            className='item'
            role='checkbox'
            aria-checked={state.saved.includes(WATCH_LATER_ID)}
            disabled={state.pending !== undefined || state.saved.includes(WATCH_LATER_ID)}
            onClick={() => state.onSave(WATCH_LATER_ID, 'Watch later')}
          >
            {state.saved.includes(WATCH_LATER_ID)
              ? <SquareCheck size={20} strokeWidth={1.5} />
              : <Square size={20} strokeWidth={1.5} />}
            <span className='title'>Watch later</span>
          </button>
          {state.rows.map((playlist) => {
            const checked = state.saved.includes(playlist.id)
            const Privacy = privacyIcon(playlist.privacy)
            return (
              <button
                type='button'
                key={playlist.id}
                className='item'
                role='checkbox'
                aria-checked={checked}
                disabled={state.pending !== undefined || checked}
                onClick={() => state.onSave(playlist.id, playlist.title)}
              >
                {checked
                  ? <SquareCheck size={20} strokeWidth={1.5} />
                  : <Square size={20} strokeWidth={1.5} />}
                <span className='title'>{playlist.title}</span>
                {playlist.videoCountText ? <span className='count'>{playlist.videoCountText}</span> : undefined}
                {Privacy ? <Privacy size={16} strokeWidth={1.5} /> : undefined}
              </button>
            )
          })}
          {state.fetching && state.rows.length === 0 ? <div className='status'>Loading…</div> : undefined}
          {!state.fetching && !state.error && state.rows.length === 0
            ? <div className='status'>No playlists yet</div>
            : undefined}
          {state.error && !state.fetching ? <DataFailure error={state.error} reexecute={state.reexecute} /> : undefined}
          {state.cursor && !state.error
            ? (
              <button
                type='button'
                className='item'
                disabled={state.fetching}
                onClick={state.onMore}
              >
                <span className='title'>{state.fetching ? 'Loading more…' : 'Show more'}</span>
              </button>
            )
            : undefined}
        </div>
        <div className='divider' />
        <button type='button' className='item' disabled={state.pending !== undefined} onClick={() => state.setCreating(true)}>
          <Plus size={20} strokeWidth={1.5} />
          <span className='title'>Create new playlist</span>
        </button>
      </div>
    </Dialog>
  )
}

// membership is write-only: nothing upstream reports whether a video is already in a playlist, so a saved row goes inert rather than pretending it can undo
/**
 * Save to playlist.
 *
 * Membership is write-only here: nothing upstream reports whether a video is
 * already in a given playlist, so a row starts unchecked and only ticks once
 * this panel has put the video there. Unticking is out of reach for a different
 * reason: removeFromPlaylist addresses entries by setVideoId, the slot id, and
 * the only place that is readable is a loaded playlist page. So a saved row
 * goes inert rather than pretending it can undo.
 */
export const SaveMenu = (
  { videoId, align = 'end', class: className, trigger }: {
    videoId: string
    align?: 'start' | 'end'
    class?: string
    /** The button that opens it, in place of the watch page's Save pill. Signed out, it opens the sign-in window. */
    trigger?: VNode
  },
) => {
  const [open, setOpen] = useState(false)
  const state = useSavePlaylists(videoId, open)

  const triggerBody = () => (
    <>
      <ListPlus size={20} strokeWidth={1.5} />
      Save
    </>
  )

  if (state.ready && !state.signedIn) {
    if (trigger) return cloneElement(trigger, { onClick: signIn })
    return (
      <button
        type='button'
        css={triggerStyle}
        className={className}
        onClick={signIn}
      >
        {triggerBody()}
      </button>
    )
  }

  return (
    <>
      <Menu
        label='Save to playlist'
        align={align}
        class={className}
        onOpenChange={setOpen}
        trigger={trigger ?? <button type='button' css={triggerStyle}>{triggerBody()}</button>}
      >
        <div css={panelStyle} role='presentation'>
          <MenuSection title='Save video to…'>
            {/* the library aggregation does not reliably list Watch later, and it is filtered back out of the fetched rows below */}
            <MenuItem
              label='Watch later'
              checked={state.saved.includes(WATCH_LATER_ID)}
              disabled={state.pending !== undefined || state.saved.includes(WATCH_LATER_ID)}
              onSelect={() => state.onSave(WATCH_LATER_ID, 'Watch later')}
            />
            {state.rows.map(playlist => (
              <MenuItem
                key={playlist.id}
                label={playlist.title}
                detail={playlist.videoCountText ?? undefined}
                trailingIcon={privacyIcon(playlist.privacy)}
                checked={state.saved.includes(playlist.id)}
                disabled={state.pending !== undefined || state.saved.includes(playlist.id)}
                onSelect={() => state.onSave(playlist.id, playlist.title)}
              />
            ))}
            {/* placeholder rows are menu items rather than bare text so focus has somewhere to land when the panel opens */}
            {state.fetching && state.rows.length === 0
              ? <MenuItem label='Loading…' disabled />
              : undefined}
            {!state.fetching && !state.error && state.rows.length === 0
              ? <MenuItem label='No playlists yet' disabled />
              : undefined}
            {state.error && !state.fetching ? <MenuDataFailure error={state.error} reexecute={state.reexecute} /> : undefined}
            {state.cursor && !state.error
              ? (
                <MenuItem
                  label={state.fetching ? 'Loading more…' : 'Show more'}
                  disabled={state.fetching}
                  closeOnSelect={false}
                  onSelect={state.onMore}
                />
              )
              : undefined}
          </MenuSection>
          <MenuSeparator />
          <MenuItem
            icon={Plus}
            label='Create new playlist'
            disabled={state.pending !== undefined}
            onSelect={() => state.setCreating(true)}
          />
        </div>
      </Menu>
      {/* rendered outside the panel so the dialog's own focus trap owns the page alone */}
      {state.creating
        ? (
          <NewPlaylistDialog
            name={state.name}
            privacy={state.privacy}
            fetching={state.createFetching}
            onName={state.onName}
            onPrivacy={state.onPrivacy}
            onCreate={state.onCreate}
            onClose={() => state.setCreating(false)}
          />
        )
        : undefined}
    </>
  )
}

export default SaveMenu
