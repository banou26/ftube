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

export const shouldCollapseMiniplayer = ({
  docked,
  viewportWidth,
  mobileSearchOpen: open,
}: {
  docked: boolean
  viewportWidth: number
  mobileSearchOpen: boolean
}) => docked && open && viewportWidth <= MOBILE_SEARCH_MAX_WIDTH
