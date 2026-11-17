import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, useData } from './data'
import type { GameEntry } from './types'

export interface User {
  id: string
  login: string
  name: string
  nick: string
  orgId: string
  contact: string
  twitch: string
  bio: string
  position: string
  mmr: number | null
  discord: string
  showContact: boolean
  avatar: number
  steam: string
  rankTier: number | null
  leaderboard: number | null
  dotaMmr: number | null
  dotaName: string
  dotaAt: string | null
  lft: boolean
  lftNote: string
  steamVerified: boolean
  games: GameEntry[]
  links: { label: string; url: string }[]
  accent: string
  banner: string
  tagline: string
  persona: import('./types').Persona
  badges: string[]
  /** Роль аккаунта: admin (организатор) или referee (судья). */
  role?: string
  /** Telegram привязан к боту лиги. */
  tg?: boolean
}

interface Ctx {
  user: User | null
  ready: boolean
  setUser: (u: User | null) => void
  signout: () => Promise<void>
}

const AccountCtx = createContext<Ctx | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const { mode } = useData()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(mode !== 'api')

  useEffect(() => {
    if (mode !== 'api') return
    api<{ user: User | null }>('account')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [mode])

  const signout = async () => {
    await api('signout', { method: 'POST', body: {} }).catch(() => undefined)
    setUser(null)
  }

  return <AccountCtx.Provider value={{ user, ready, setUser, signout }}>{children}</AccountCtx.Provider>
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountCtx)
  if (!ctx) throw new Error('AccountProvider missing')
  return ctx
}
