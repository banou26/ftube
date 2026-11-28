import type { OverlayChatEvent } from '../components/use-live-chat-session'

import { css } from '@emotion/react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { COMMENTS_QUERY } from '../components/comments'
import { useOverScreenSettings } from '../components/over-screen-messages'
import { OverScreenOverlay } from '../components/over-screen-overlay'
import {
  beginTimedCommentSeek,
  createTimedCommentClockState,
  extractTimedCommentCues,
  finishTimedCommentSeek,
  formatTimedCommentAnnouncement,
  stepTimedCommentClock,
  timedCommentCueToChatRow,
} from './timed-comments'

const srOnlyCss = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  pointer-events: none;
`

/**
 * Fetches the first page of top-level comments when `Timed comments` is enabled on a regular
 * video and drives single-item `OverScreenOverlay` cues directly off `video`'s media clock.
 */
export const TimedCommentsOverlay = ({
  video,
  videoId,
  duration,
  enabled,
  isLive,
  docked,
  commentsHidden,
}: {
  video: HTMLVideoElement
  videoId: string
  duration: number
  enabled: boolean
  isLive: boolean
  docked: boolean
  commentsHidden: boolean
}) => {
  const overScreen = useOverScreenSettings()
  const active = Boolean(enabled && !isLive && !docked && !commentsHidden && videoId)
  const [{ data }] = useQuery({
    query: COMMENTS_QUERY,
    variables: { videoId, sort: 'TOP', cursor: null },
    pause: !active,
  })

  const page = data?.comments
  const cues = useMemo(
    () => (!active || !page || page.disabled ? [] : extractTimedCommentCues(page.items, videoId, duration)),
    [active, page, videoId, duration],
  )
  const cuesRef = useRef(cues)
  cuesRef.current = cues

  const clockRef = useRef(createTimedCommentClockState())
  const eventSeqRef = useRef(0)
  const showAuthorRef = useRef(overScreen.showAuthor)
  showAuthorRef.current = overScreen.showAuthor
  const [overlayEvent, setOverlayEvent] = useState<OverlayChatEvent | undefined>(undefined)
  const [announcement, setAnnouncement] = useState<{ seq: number, text: string } | undefined>(undefined)
  const [resetSeq, setResetSeq] = useState(0)

  const resetOverlay = (initialTime?: number) => {
    clockRef.current = createTimedCommentClockState(initialTime)
    setOverlayEvent(undefined)
    setAnnouncement(undefined)
    setResetSeq((seq) => seq + 1)
  }

  useEffect(() => {
    if (!active) {
      resetOverlay(undefined)
      return
    }
    resetOverlay(Number.isFinite(video.currentTime) ? video.currentTime : 0)

    const onSeeking = () => {
      clockRef.current = beginTimedCommentSeek(clockRef.current, video.currentTime)
      setOverlayEvent(undefined)
      setAnnouncement(undefined)
      setResetSeq((seq) => seq + 1)
    }

    const onSeeked = () => {
      clockRef.current = finishTimedCommentSeek(clockRef.current, video.currentTime)
      setOverlayEvent(undefined)
      setAnnouncement(undefined)
      setResetSeq((seq) => seq + 1)
    }

    const onTimeUpdate = () => {
      const result = stepTimedCommentClock(clockRef.current, video.currentTime, cuesRef.current)
      clockRef.current = result.state
      if (result.clear) {
        setOverlayEvent(undefined)
        setAnnouncement(undefined)
        setResetSeq((seq) => seq + 1)
        return
      }
      if (result.cue) {
        const seq = ++eventSeqRef.current
        setOverlayEvent({
          seq,
          items: [timedCommentCueToChatRow(result.cue)],
          removedIds: [],
          removedAuthorIds: [],
        })
        setAnnouncement({
          seq,
          text: formatTimedCommentAnnouncement(result.cue, showAuthorRef.current),
        })
      }
    }

    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [active, video, videoId])

  const overlaySettings = useMemo(
    () => ({
      ...overScreen,
      enabled: active,
      slowModeMs: 0,
      maxOnScreen: 1,
    }),
    [overScreen, active],
  )

  return (
    <>
      <OverScreenOverlay
        settings={overlaySettings}
        event={overlayEvent}
        resetSeq={resetSeq}
        previewSeq={0}
        contained
        source='timed-comments'
      />
      {active
        ? (
          <div
            css={srOnlyCss}
            role='status'
            aria-live='polite'
            aria-atomic='true'
            data-timed-comments-announcer='true'
            data-announcement-seq={announcement ? String(announcement.seq) : undefined}
          >
            {announcement?.text ?? ''}
          </div>
        )
        : undefined}
    </>
  )
}
