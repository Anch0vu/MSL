import { useSyncExternalStore } from 'react'

export const CONSENT_VERSION = 1
const COOKIE_NAME = 'msl_consent'
const EVENT = 'msl:consent-change'
export const SETTINGS_EVENT = 'msl:consent-settings'

export interface ConsentState {
  necessary: true
  functional: boolean
  externalMedia: boolean
}

export type ConsentChoice = Pick<ConsentState, 'functional' | 'externalMedia'>

export function parseConsentValue(value?: string): ConsentState | null {
  if (!value) return null
  if (value === `v${CONSENT_VERSION}:necessary`) return { necessary: true, functional: false, externalMedia: false }
  if (value === `v${CONSENT_VERSION}:functional`) return { necessary: true, functional: true, externalMedia: true }
  return null
}

export function serializeConsentValue(choice: ConsentChoice): string {
  return `v${CONSENT_VERSION}:${choice.functional && choice.externalMedia ? 'functional' : 'necessary'}`
}

function cookieValue(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const item = document.cookie.split('; ').find((row) => row.startsWith(`${COOKIE_NAME}=`))
  return item ? decodeURIComponent(item.slice(COOKIE_NAME.length + 1)) : undefined
}

let snapshot: ConsentState | null = parseConsentValue(cookieValue())
const listeners = new Set<() => void>()

function publish(next: ConsentState | null) {
  snapshot = next
  listeners.forEach((listener) => listener())
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
}

export function saveConsent(choice: ConsentChoice): ConsentState {
  const value = serializeConsentValue(choice)
  if (typeof document !== 'undefined') {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`
  }
  const next = parseConsentValue(value)!
  publish(next)
  return next
}

export function useConsent(): ConsentState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => null,
  )
}

export function openConsentSettings() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function consentCookieName() {
  return COOKIE_NAME
}
