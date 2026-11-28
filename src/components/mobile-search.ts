import { useEffect, useState } from 'preact/hooks'

export const MOBILE_SEARCH_MAX_WIDTH = 656

let mobileSearchOpen = false
const listeners = new Set<() => void>()

export const getMobileSearchOpen = () => mobileSearchOpen

export const setMobileSearchOpen = (open: boolean) => {
  if (mobileSearchOpen === open) return
  mobileSearchOpen = open
  for (const listener of listeners) listener()
}

export const subscribeMobileSearchOpen = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useMobileSearchOpen = () => {
  const [open, setOpen] = useState(getMobileSearchOpen)
  useEffect(() => {
    setOpen(getMobileSearchOpen())
    return subscribeMobileSearchOpen(() => setOpen(getMobileSearchOpen()))
  }, [])
  return open
}

let searchFocusHandler: (() => boolean) | undefined

/** Registers Header's synchronous search-focus callback and returns a cleanup function. */
export const registerHeaderSearchFocus = (handler: () => boolean) => {
  searchFocusHandler = handler
  return () => {
    if (searchFocusHandler === handler) searchFocusHandler = undefined
  }
}

/** Opens mobile Search when needed and focuses the global header search input. */
export const focusHeaderSearch = () => {
  if (searchFocusHandler) return searchFocusHandler()
  if (typeof document === 'undefined') return false
  if (typeof window !== 'undefined' && window.matchMedia?.(`(max-width: ${MOBILE_SEARCH_MAX_WIDTH}px)`).matches) {
    setMobileSearchOpen(true)
  }
  const input = document.querySelector<HTMLInputElement>('header form[role="search"] input[name="search_query"]')
  if (!input) return false
  input.focus()
  return document.activeElement === input
}

export const shouldCollapseMiniplayer = ({
  docked,
  viewportWidth,
  mobileSearchOpen: open,
}: {
  docked: boolean
  viewportWidth: number
  mobileSearchOpen: boolean
}) => docked && open && viewportWidth <= MOBILE_SEARCH_MAX_WIDTH
