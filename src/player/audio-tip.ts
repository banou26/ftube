/**
 * Returns a one-line instruction for granting audio autoplay permission in the
 * browser identified by `userAgent`, defaulting to Chrome/Chromium guidance.
 */
export const audioPermissionTip = (
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string => {
  if (/firefox/i.test(userAgent)) {
    return 'Click the autoplay icon in the address bar and allow Audio and Video.'
  }
  if (/safari/i.test(userAgent) && !/(chrome|chromium|crios|edg|opr|fxios)/i.test(userAgent)) {
    return 'Open Safari > Settings for This Website and set Auto-Play to Allow All Auto-Play.'
  }
  return 'Click the site settings icon in the address bar and set Sound to Allow.'
}
