import type { PlaybackState } from '../party'

import { useEffect, useRef } from 'preact/hooks'

import { party } from '../party'
import { toLocalTime } from '../party/clock'
import { expectedTime, partyPlaybackMode, playbackCorrection } from '../party/playback'
import { videoIdOfPath } from '../party/protocol'
import { useParty, usePartyMessages } from '../party/use-party'

const HOST_HEARTBEAT_MS = 5_000

const readVideoState = (video: HTMLVideoElement): PlaybackState => ({
  paused: video.paused,
  time: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
  rate: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1,
  at: Date.now(),
})

/**
 * Syncs `<video>` play/pause, position, and playback rate with the active Watch Together room.
 * Hosts publish only from the undocked watch page; followers stay synced on both the watch page and the docked miniplayer.
 */
export const PartyPlayback = ({ video, videoId, isLive, docked }: { video: HTMLVideoElement, videoId: string, isLive: boolean, docked: boolean }) => {
  const state = useParty()
  const role = state.status === 'active' ? state.role : undefined
  const invite = state.status === 'active' ? state.invite : undefined
  const { publish, follow } = partyPlaybackMode({ role, isLive, docked })
  const following = party.following()
  const wanted = useRef<PlaybackState | undefined>(undefined)

  useEffect(() => {
    wanted.current = undefined
  }, [videoId, invite])

  // Host publishes playback state on transitions and on a 5 s heartbeat while playing.
  useEffect(() => {
    if (!publish) {
      party.setPlayback(undefined)
      return
    }
    const publishState = () => {
      if (video.readyState < 1) return
      const next = readVideoState(video)
      party.setPlayback(next)
      party.send({ t: 'playback', s: next })
    }
    publishState()
    const events = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'] as const
    for (const event of events) video.addEventListener(event, publishState)
    const timer = setInterval(() => {
      if (!video.paused) publishState()
    }, HOST_HEARTBEAT_MS)
    return () => {
      clearInterval(timer)
      for (const event of events) video.removeEventListener(event, publishState)
      party.setPlayback(undefined)
    }
  }, [publish, video, videoId, invite])

  const apply = (target: PlaybackState, force: boolean) => {
    if (!follow || (!force && !party.following())) return
    const correction = playbackCorrection(
      { paused: video.paused, time: video.currentTime, rate: video.playbackRate },
      target,
      Date.now(),
      true,
    )
    if (!correction) return
    if (correction.rate !== undefined) video.playbackRate = correction.rate
    if (correction.seekTo !== undefined && video.readyState >= 1) {
      const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : correction.seekTo
      video.currentTime = Math.max(0, Math.min(correction.seekTo, limit))
    }
    if (correction.paused === true && !video.paused) video.pause()
    if (correction.paused === false && video.paused) {
      void video.play().catch(() => {
        if (!video.muted) {
          video.muted = true
          void video.play().catch(() => {})
        }
      })
    }
  }

  // Re-apply the latest host playback snapshot once metadata/data arrives or Follow is turned back on.
  useEffect(() => {
    if (!follow) return
    const seed = () => {
      if (wanted.current) return
      const initial = party.hostPlayback()
      if (!initial || videoIdOfPath(initial.path) !== videoId) return
      const clock = party.hostClock()
      const told = clock ? { ...initial.state, at: toLocalTime(initial.state.at, clock.offset) } : initial.state
      const now = Date.now()
      wanted.current = { ...told, time: expectedTime(told, now, Boolean(clock)), at: now }
    }
    const reapply = () => {
      seed()
      if (wanted.current && party.following()) apply(wanted.current, false)
    }
    reapply()
    video.addEventListener('loadedmetadata', reapply)
    video.addEventListener('loadeddata', reapply)
    video.addEventListener('canplay', reapply)
    return () => {
      video.removeEventListener('loadedmetadata', reapply)
      video.removeEventListener('loadeddata', reapply)
      video.removeEventListener('canplay', reapply)
    }
  }, [follow, video, videoId, following])

  usePartyMessages((message, { replayed }) => {
    if (!follow) return
    const next = message.t === 'playback' ? message.s : message.t === 'state' ? message.s : undefined
    if (!next) return
    const sourcePath = message.t === 'state' ? message.path : party.hostPath()
    if (videoIdOfPath(sourcePath) !== videoId) return
    const clock = party.hostClock()
    const told = clock ? { ...next, at: toLocalTime(next.at, clock.offset) } : next
    const now = Date.now()
    const normalized: PlaybackState = { ...told, time: expectedTime(told, now, Boolean(clock)), at: now }
    wanted.current = normalized
    apply(normalized, replayed)
  })

  return null
}

export default PartyPlayback
