import { useEffect, useRef } from 'preact/hooks'
import { useLocation, useSearch } from 'wouter'

import { party } from '../party'
import { normalizePartyPath } from '../party/protocol'
import { useParty, usePartyMessages } from '../party/use-party'

/**
 * Syncs route navigation between the Watch Together host and followers.
 * Mounted once above the router so navigation stays live across every route.
 */
export const PartySync = () => {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const state = useParty()
  const path = normalizePartyPath(location, search)
  const currentPath = useRef(path)
  currentPath.current = path

  const role = state.status === 'active' ? state.role : undefined
  const invite = state.status === 'active' ? state.invite : undefined
  const lastSent = useRef<string | undefined>(undefined)
  const synced = useRef(false)

  useEffect(() => {
    void party.resume()
  }, [])

  useEffect(() => {
    synced.current = false
    lastSent.current = undefined
  }, [invite])

  useEffect(() => {
    if (!path) return
    party.setLocation(path)
    if (role === 'host' && lastSent.current !== path) {
      lastSent.current = path
      party.send({ t: 'nav', path })
    }
  }, [path, role, invite])

  usePartyMessages((message, { replayed }) => {
    if (role !== 'guest') return
    if (message.t === 'nav') {
      if (!party.following() && !replayed) return
      synced.current = true
      if (message.path !== currentPath.current) navigate(message.path)
      return
    }
    if (message.t === 'state') {
      if (!synced.current || replayed) {
        synced.current = true
        if (message.path !== currentPath.current) navigate(message.path)
      }
    }
  })

  return null
}

export default PartySync
