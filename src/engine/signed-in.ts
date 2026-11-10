/**
 * `localStorage['yt-client:signed-in']`, set once a sign-in through FKN's window ended signed in. It decides the jar
 * of the FKN page (`'persistent'` with it, `'ephemeral'` without), so a browser without it never attaches a page on
 * FKN's shared jar. A boolean, never an identity. Cleared on sign-out, and by the engine only on an answer that says
 * the jar holds no session (realm.ts), never on a timeout. Storage that cannot be read reads signed out.
 */
export const SIGNED_IN_KEY = 'yt-client:signed-in'

/**
 * `localStorage['yt-client:channel']`, the page ID of the brand channel the signed-in Google account acts as, which the
 * session lane sends as X-Goog-PageId (lanes.ts). Absent for the account's own channel. It lives with the signed-in
 * flag: a sign-in starts on the account's own channel and a sign-out removes it, as does an answer that says the
 * session ended. Read only when all digits.
 */
export const CHANNEL_KEY = 'yt-client:channel'

const PAGE_ID = /^\d+$/

export const readSignedIn = () => {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}

export const markSignedIn = () => {
  try {
    localStorage.setItem(SIGNED_IN_KEY, '1')
    localStorage.removeItem(CHANNEL_KEY)
  } catch {}
}

export const clearSignedIn = () => {
  try {
    localStorage.removeItem(SIGNED_IN_KEY)
    localStorage.removeItem(CHANNEL_KEY)
  } catch {}
}

export const readChannel = () => {
  try {
    const pageId = localStorage.getItem(CHANNEL_KEY)
    return pageId && PAGE_ID.test(pageId) ? pageId : undefined
  } catch {
    return undefined
  }
}

/** The channel the next engine acts as: a brand channel's page ID, or none for the account's own channel. */
export const storeChannel = (pageId?: string) => {
  try {
    if (pageId) localStorage.setItem(CHANNEL_KEY, pageId)
    else localStorage.removeItem(CHANNEL_KEY)
  } catch {}
}

/** Removes the stored channel only while it is still `pageId`, so a pick made since in another tab stays. */
export const forgetChannel = (pageId: string) => {
  if (readChannel() === pageId) storeChannel()
}
