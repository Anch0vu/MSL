/** A scene key is available only in the operator's current browser tab.
 * Its SHA-256 digest, not the bearer token, is stored by the server. */
const KEY = 'cup:obs-scene-key-v2'
const EVENT = 'cup:obs-key-change'

export function readObsKey(): string {
  try { return sessionStorage.getItem(KEY) || '' } catch { return '' }
}
export function setObsKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY, key)
    else sessionStorage.removeItem(KEY)
  } catch { /* private browsing */ }
  window.dispatchEvent(new Event(EVENT))
}
export function onObsKeyChange(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}
