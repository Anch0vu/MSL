import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { config } from '../config'
import type { DB, ID, MatchRecord, Seed, Team, Tournament } from './types'

const DRAFT_KEY = 'tsite:draft'
const PREVIEW_KEY = 'tsite:preview'

export function readDraft(): DB | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as DB) : null
  } catch {
    return null
  }
}

export function writeDraft(db: DB | null) {
  try {
    if (db) localStorage.setItem(DRAFT_KEY, JSON.stringify(db))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* хранилище недоступно — черновик живёт только в памяти */
  }
}

export function isPreview(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}

export function setPreview(on: boolean) {
  try {
    if (on) localStorage.setItem(PREVIEW_KEY, '1')
    else localStorage.removeItem(PREVIEW_KEY)
  } catch {
    /* ignore */
  }
}

/** Запрос к PHP API (api/index.php?r=...). */
export async function api<T = unknown>(route: string, opts: { method?: string; body?: unknown; query?: string } = {}): Promise<T> {
  const res = await fetch(`${config.apiBase}?r=${route}${opts.query ? `&${opts.query}` : ''}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Cup': '1' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

/** Адрес аватара игрока (загружается в кабинете); null, если аватара нет. */
export function avatarUrl(p?: { userId?: string; avatar?: number }): string | null {
  return p?.userId && p.avatar ? `${config.apiBase}?r=avatar&id=${p.userId}&v=${p.avatar}` : null
}

export function teamMediaUrl(t: { id: string; logo?: number; banner?: number } | undefined, kind: 'logo' | 'banner'): string | null {
  const v = t?.[kind]
  return t && v ? `${config.apiBase}?r=teammedia&t=${encodeURIComponent(t.id)}&k=${kind}&v=${v}` : null
}

/** 'api' — данные с сервера, админ сохраняет онлайн; 'static' — только data/db.json, админ скачивает файл. */
export type Mode = 'api' | 'static'

interface Ctx {
  db: DB
  published: DB
  preview: boolean
  mode: Mode
  rev: number
  /** Резервный сервер: только просмотр (вход, заявки и правки отключены). */
  readonly: boolean
  refresh: () => void
  reload: () => Promise<void>
}

const DataCtx = createContext<Ctx | null>(null)

async function loadPublished(): Promise<{ db: DB; mode: Mode; rev: number; readonly: boolean }> {
  if (config.apiBase) {
    try {
      const doc = await api<{ db: DB; rev: number; readonly?: boolean }>('db')
      if (doc?.db?.teams) return { db: doc.db, mode: 'api', rev: doc.rev, readonly: !!doc.readonly }
    } catch {
      /* API нет или не настроен — работаем статически */
    }
  }
  const r = await fetch(`${import.meta.env.BASE_URL}data/db.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return { db: await r.json(), mode: 'static', rev: 0, readonly: false }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ db: DB; mode: Mode; rev: number; readonly: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const pending = useRef<Promise<void> | null>(null)
  const reload = useCallback(() => {
    if (pending.current) return pending.current
    const request = loadPublished()
      .then((next) => {
        setState((previous) => previous && previous.mode === next.mode && previous.rev === next.rev &&
          previous.readonly === next.readonly && JSON.stringify(previous.db) === JSON.stringify(next.db) ? previous : next)
        setError(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => { pending.current = null })
    pending.current = request
    return request
  }, [])

  useEffect(() => {
    reload()
  }, [])

  const value = useMemo<Ctx | null>(() => {
    if (!state) return null
    const draft = isPreview() ? readDraft() : null
    return {
      db: draft ?? state.db,
      published: state.db,
      preview: !!draft,
      mode: state.mode,
      rev: state.rev,
      readonly: state.readonly,
      refresh: () => setTick((t) => t + 1),
      reload,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tick])

  if (error && !value) return <div className="boot">Не удалось загрузить данные: {error}</div>
  if (!value) return <div className="boot">Загрузка…</div>
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}

export function useData(): Ctx {
  const ctx = useContext(DataCtx)
  if (!ctx) throw new Error('DataProvider missing')
  return ctx
}

export function useDB() {
  const { db } = useData()
  return useMemo(() => {
    const teams = new Map(db.teams.map((t) => [t.id, t]))
    const players = new Map(db.players.map((p) => [p.id, p]))
    const tournaments = new Map(db.tournaments.map((t) => [t.id, t]))
    return {
      db,
      team: (id?: Seed): Team | undefined => (id && id !== 'BYE' ? teams.get(id) : undefined),
      player: (id?: ID) => (id ? players.get(id) : undefined),
      tournament: (id?: ID): Tournament | undefined => (id ? tournaments.get(id) : undefined),
      roster: (teamId: ID) => db.players.filter((p) => p.teamId === teamId),
      records: (tid: ID, stageId: ID): MatchRecord[] =>
        db.matches.filter((m) => m.tournamentId === tid && m.stageId === stageId),
    }
  }, [db])
}

export interface TwitchStream {
  channel: string
  title: string
  game: string
  viewers: number
  startedAt: string
  thumbnail: string
}

/** Статус каналов Twitch через API (кэш на сервере 60 с). Пусто, если API нет или ключи не заданы. */
export function useTwitch(channels: string[]) {
  const { mode } = useData()
  const key = channels.filter(Boolean).map((c) => c.toLowerCase()).sort().join(',')
  const [streams, setStreams] = useState<TwitchStream[] | null>(null)
  useEffect(() => {
    if (mode !== 'api' || !key) return
    let alive = true
    const load = () =>
      api<{ streams: TwitchStream[] }>('twitch', { query: `channels=${encodeURIComponent(key)}` })
        .then((r) => alive && setStreams(r.streams))
        .catch(() => alive && setStreams([]))
    load()
    const t = setInterval(load, 90_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [mode, key])
  return streams
}

export function twitchChannelFromUrl(url?: string): string | null {
  const m = url?.match(/twitch\.tv\/([a-z0-9_]{3,25})/i)
  return m ? m[1].toLowerCase() : null
}
