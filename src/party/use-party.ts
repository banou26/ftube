import type { PartyMessage, PartyMessageMeta } from './index'

import { useEffect, useRef, useState } from 'preact/hooks'

import { party } from './index'

/** Current Watch Together state, re-rendering on changes. */
export const useParty = () => {
  const [state, setState] = useState(() => party.getState())
  useEffect(() => {
    const unsubscribe = party.subscribe(setState)
    setState(party.getState())
    return unsubscribe
  }, [])
  return state
}

/** Subscribes to decoded party messages with a ref-backed listener that stays current across renders. */
export const usePartyMessages = (listener: (message: PartyMessage, meta: PartyMessageMeta) => void) => {
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => party.onMessage((message, meta) => latest.current(message, meta)), [])
}
