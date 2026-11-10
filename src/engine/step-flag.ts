/**
 * Whether a migration step is on in this browser, read when an engine starts. The direct lane is on by default;
 * `localStorage['yt-client:step:direct']` set to '0' on the app's origin turns it off, a switch kept for one release.
 * On when storage cannot be read.
 */
export const stepEnabled = (step: 'direct') => {
  try {
    return localStorage.getItem(`yt-client:step:${step}`) !== '0'
  } catch {
    return true
  }
}
