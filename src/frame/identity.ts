import { clearStoredTokens, resetPoTokenSession } from './botguard'

// the names Scramjet's www.youtube.com realm stored these under (`<host>@<key>`), kept so a browser keeps its visitor id
export const VISITOR_DATA_KEY = 'www.youtube.com@yt-client:visitor-data'

export const GVS_ORIGIN_KEY = 'www.youtube.com@yt-client:gvs-origin'

const INNERTUBE_DB = 'youtubei.js'
const INNERTUBE_STORE = 'kv-store'
const INNERTUBE_SESSION_KEY = 'innertube_session_data'

const deleteInnertubeSessionData = () => new Promise<void>((resolve) => {
  try {
    const request = indexedDB.open(INNERTUBE_DB)
    // a versionless open creates an empty v1 db, which permanently poisons youtubei.js's own onupgradeneeded, so abort instead
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort()
      } catch {}
    }
    request.onerror = () => resolve()
    request.onsuccess = () => {
      const database = request.result
      try {
        const transaction = database.transaction(INNERTUBE_STORE, 'readwrite')
        const finish = () => {
          database.close()
          resolve()
        }
        transaction.oncomplete = finish
        transaction.onerror = finish
        transaction.onabort = finish
        transaction.objectStore(INNERTUBE_STORE).delete(INNERTUBE_SESSION_KEY)
      } catch {
        database.close()
        resolve()
      }
    }
  } catch {
    resolve()
  }
})

// the session is in FKN's jar, which only a sign-out clears (sign-in.ts)
export const resetIdentity = async () => {
  try {
    localStorage.removeItem(VISITOR_DATA_KEY)
  } catch {}
  try {
    localStorage.removeItem(GVS_ORIGIN_KEY)
  } catch {}
  clearStoredTokens()
  await resetPoTokenSession()
  await deleteInnertubeSessionData()
}
