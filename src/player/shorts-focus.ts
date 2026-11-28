export type ShortsFocusedRegion = 'slide' | 'prev-button' | 'next-button'

export type ShortsFocusDecision = 'none' | 'active-slide' | 'prev-button' | 'next-button'

/**
 * Decides where keyboard focus should land when the active Short changes or a pager control
 * becomes disabled at a feed boundary, keeping focus inside the active Short experience without
 * stealing focus from controls outside the Shorts scroller.
 */
export const resolveShortsFocusMove = ({
  trackedRegion,
  slideChanged,
  focusLostToDocument,
  focusInsideActiveSlide,
  activeIndex,
  itemCount,
}: {
  trackedRegion: ShortsFocusedRegion | null
  slideChanged: boolean
  focusLostToDocument: boolean
  focusInsideActiveSlide: boolean
  activeIndex: number
  itemCount: number
}): ShortsFocusDecision => {
  if (itemCount <= 0 || activeIndex < 0) return 'none'
  if (trackedRegion === 'next-button') {
    if (activeIndex < itemCount - 1) return 'none'
    return activeIndex > 0 ? 'prev-button' : 'active-slide'
  }
  if (trackedRegion === 'prev-button') {
    if (activeIndex > 0) return 'none'
    return activeIndex < itemCount - 1 ? 'next-button' : 'active-slide'
  }
  if (trackedRegion === 'slide' && !focusInsideActiveSlide && (slideChanged || focusLostToDocument)) {
    return 'active-slide'
  }
  return 'none'
}
