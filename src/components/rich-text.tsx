import type { TextRun } from '../generated/graphql'
import type preact from 'preact'

import { css } from '@emotion/react'
import { Link } from 'wouter'

import { seekTo } from '../player/seek'
import { watchHrefFor } from './video-card'

export type RichTextRun = Pick<TextRun, 'text'> & Partial<Pick<TextRun, 'browseId' | 'startSeconds' | 'url' | 'videoId'>>

const style = css`
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  a,
  .seek {
    color: var(--accent);
  }

  /* A seek reads as a link and has to look like one, but it is a button: it
     acts on the page rather than navigating, so anchor semantics would promise
     the wrong thing to a screen reader and to middle-click. */
  .seek {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  a:hover,
  .seek:hover {
    text-decoration: underline;
  }
`

/** Resolves an InnerTube `browseId` run to its in-app route, or `undefined` for non-routable browse tabs. */
export const browseHrefFor = (browseId: string, text: string): string | undefined => {
  if (browseId === 'FEhashtag') {
    const tag = text.trim()
    return tag.startsWith('#') && tag.length > 1 ? `/results?${new URLSearchParams({ search_query: tag })}` : undefined
  }
  if (browseId.startsWith('FE')) return undefined
  if (browseId.startsWith('VL')) return browseId.length > 2 ? `/playlist?${new URLSearchParams({ list: browseId.slice(2) })}` : undefined
  return `/channel/${browseId}`
}

// a run can point at a DIFFERENT video than `videoId`, which is what decides seek vs navigate; `renderRun` returning undefined defers to the default
/**
 * A rich text body rendered from its runs.
 *
 * `videoId` is the video the body belongs to, which is what decides whether a
 * timestamp seeks or navigates: a comment can link to a timestamp in a
 * DIFFERENT video, and that has to open it rather than jump the current one.
 *
 * `renderRun` lets a caller draw runs this component has no concept of, and
 * fall through for the rest. Live chat is the case: its custom emoji are images
 * with no meaningful text, while the words around them still want the mention,
 * link and timestamp handling below. Returning undefined defers to the default.
 */
export const RichText = <Run extends RichTextRun>(
  { runs, videoId, className, renderRun }: {
    runs: readonly Run[]
    videoId?: string
    className?: string
    renderRun?: (run: Run, key: string) => preact.ComponentChildren | undefined
  },
) => (
  <span css={style} className={className}>
    {runs.map((run, index) => {
      const key = `${index}:${run.text}`

      const custom = renderRun?.(run, key)
      if (custom !== undefined) return custom

      if (run.videoId) {
        const seconds = run.startSeconds ?? undefined
        const sameVideo = videoId !== undefined && run.videoId === videoId
        if (sameVideo && seconds !== undefined) {
          return (
            <button
              type='button'
              key={key}
              className='seek'
              onClick={() => {
                seekTo(run.videoId!, seconds)
              }}
            >
              {run.text}
            </button>
          )
        }
        return (
          <Link key={key} href={watchHrefFor(run.videoId)}>{run.text}</Link>
        )
      }

      if (run.browseId) {
        const href = browseHrefFor(run.browseId, run.text)
        return href ? <Link key={key} href={href}>{run.text}</Link> : <span key={key}>{run.text}</span>
      }

      if (run.url) {
        return (
          <a key={key} href={run.url} target='_blank' rel='noreferrer noopener'>{run.text}</a>
        )
      }

      return <span key={key}>{run.text}</span>
    })}
  </span>
)

export default RichText
