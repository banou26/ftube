/** Returns true when a feed or related item represents a Short. */
export const isShortVideo = (video: { isShort?: boolean | null }): boolean => video.isShort === true

/** Returns true when `hideShorts` allows keeping the video item. */
export const isAllowedWithHideShorts = (video: { isShort?: boolean | null }, hideShorts?: boolean): boolean =>
  !(hideShorts && isShortVideo(video))

/** Filters Short items out of a list when `hideShorts` is enabled. */
export const filterOutShorts = <T extends { isShort?: boolean | null }>(items: readonly T[], hideShorts: boolean): T[] =>
  (hideShorts ? items.filter(item => !isShortVideo(item)) : [...items])
