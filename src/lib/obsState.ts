import { useSyncExternalStore } from 'react'
import { api } from './data'

/*
 * Состояние эфира: общее для пульта режиссёра и OBS-сцен. Хранится на сервере (kv obs:state),
 * сцены опрашивают его каждые 1,5 секунды и держат последнюю удачную копию в localStorage,
 * поэтому обрыв связи не гасит графику посреди трансляции.
 */

export type Side = 'a' | 'b'

export interface ObsLiveRef {
  tid: string
  stageId: string
  key: string
}

export interface ObsMap {
  name: string
  /** Кто выбрал карту: команда или оставшаяся (decider). */
  picker?: Side | 'd'
  a?: number
  b?: number
  status?: 'next' | 'live' | 'done'
  /** Стартовая сторона команды A (CT / T, Attack / Defense). */
  sideA?: string
}

export interface ObsVetoStep {
  team: Side | 'd'
  action: 'ban' | 'pick' | 'decider'
  map: string
  /** Кто выбрал сторону и какую взял (для pick). */
  sideTeam?: Side
  side?: string
}

export interface ObsDraft {
  phase?: 'ban' | 'pick' | 'done'
  a: { bans: number[]; picks: number[] }
  b: { bans: number[]; picks: number[] }
  /** Сторона команды A. */
  sideA?: 'radiant' | 'dire'
}

export interface ObsCaster {
  name: string
  role: string
  social?: string
}

export interface ObsLower {
  name: string
  role: string
  social?: string
  /** Метка запуска: меняется при каждом показе. */
  fire: number
  /** Сколько секунд держать плашку на экране (0 — до скрытия). */
  hold: number
  /** Показана ли плашка сейчас. */
  on?: boolean
}

export interface ObsState {
  rev?: number
  at?: string
  live?: ObsLiveRef | null
  series?: { a: number; b: number } | null
  bo?: number
  maps?: ObsMap[]
  pool?: string[]
  veto?: ObsVetoStep[]
  vetoMode?: 'bo1' | 'bo3' | 'bo5'
  draft?: ObsDraft
  casters?: ObsCaster[]
  lower?: ObsLower
  ticker?: { on: boolean; items: string[] }
  brk?: { title?: string; sub?: string; until?: string }
  title?: string
  /** Метки повторного показа сцен (интро, итог): меняются на каждый запуск. */
  fire?: Record<string, number>
}

interface Reply {
  state: ObsState
  now: number
  can: boolean
}

const CACHE = 'obs-state-v1'

function readCache(): ObsState {
  try {
    const raw = localStorage.getItem(CACHE)
    return raw ? (JSON.parse(raw) as ObsState) : {}
  } catch {
    return {}
  }
}

function writeCache(s: ObsState) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(s))
  } catch {
    /* хранилище недоступно: не страшно */
  }
}

/* Один общий опрос на страницу: любое число сцен и виджетов читает одну копию состояния. */
interface Store {
  state: ObsState
  can: boolean
  ok: boolean
  loaded: boolean
}
let store: Store = { state: readCache(), can: false, ok: true, loaded: false }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let pollMs = 1500
let pulling = false

function emit(next: Store) {
  store = next
  listeners.forEach((l) => l())
}

async function pull() {
  if (pulling) return
  pulling = true
  try {
    const r = await api<Reply>('obs')
    // A GET started before a successful write may arrive afterwards.
    if (store.loaded && (r.state.rev ?? 0) < (store.state.rev ?? 0)) return
    const same = store.loaded && (store.state.rev ?? 0) === (r.state.rev ?? 0) && store.state.at === r.state.at
    if (!same) writeCache(r.state)
    // No React re-render for an unchanged broadcast snapshot.
    if (!same || store.can !== r.can || !store.ok || !store.loaded)
      emit({ state: same ? store.state : r.state, can: r.can, ok: true, loaded: true })
  } catch {
    if (store.ok || !store.loaded) emit({ ...store, ok: false, loaded: true })
  } finally {
    pulling = false
  }
}

function resume() {
  if (!document.hidden) void pull()
}
function subscribe(l: () => void) {
  listeners.add(l)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    void pull()
    timer = setInterval(() => {
      if (!document.hidden) void pull()
    }, pollMs)
  }
  return () => {
    listeners.delete(l)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }
}

/** Queue writes from this tab, while rejecting conflicting writes from other operators. */
let writeQueue: Promise<unknown> = Promise.resolve()
export function patchObs(p: Partial<Record<keyof ObsState, unknown>>): Promise<void> {
  const operation = writeQueue.then(async () => {
    const expectedRev = store.state.rev ?? 0
    try {
      const r = await api<{ state: ObsState }>('obsset', { method: 'POST', body: { patch: p, expectedRev } })
      writeCache(r.state)
      emit({ ...store, state: r.state })
    } catch (e) {
      await pull()
      throw e
    }
  })
  writeQueue = operation.catch(() => undefined)
  return operation
}

/** Состояние эфира. Ошибки сети молча игнорируются: остаётся последнее известное состояние. */
export function useObs(ms = 1500) {
  pollMs = Math.min(pollMs, ms)
  const s = useSyncExternalStore(subscribe, () => store)
  // ?demo=1 показывает пробные данные: оформление можно посмотреть, пока в эфире ничего нет
  if (isDemo()) return { state: DEMO_STATE, can: false, ok: true, loaded: true, patch: patchObs, reload: pull }
  return { state: s.state, can: s.can, ok: s.ok, loaded: s.loaded, patch: patchObs, reload: pull }
}

function isDemo() {
  return /[?&]demo=1\b/.test(location.hash)
}

const T0 = Date.now()
const DEMO_STATE: ObsState = {
  series: { a: 1, b: 1 },
  bo: 3,
  maps: [
    { name: 'Mirage', picker: 'a', a: 13, b: 9, status: 'done', sideA: 'CT' },
    { name: 'Inferno', picker: 'b', a: 7, b: 13, status: 'done', sideA: 'T' },
    { name: 'Nuke', picker: 'd', a: 8, b: 6, status: 'live', sideA: 'CT' },
  ],
  brk: { until: new Date(T0 + 9.5 * 60_000).toISOString() },
  vetoMode: 'bo3',
  veto: [
    { team: 'a', action: 'ban', map: 'Overpass' },
    { team: 'b', action: 'ban', map: 'Dust2' },
    { team: 'a', action: 'pick', map: 'Mirage', sideTeam: 'b', side: 'T' },
    { team: 'b', action: 'pick', map: 'Inferno', sideTeam: 'a', side: 'CT' },
    { team: 'a', action: 'ban', map: 'Anubis' },
    { team: 'b', action: 'ban', map: 'Ancient' },
    { team: 'd', action: 'decider', map: 'Nuke', sideTeam: 'a', side: 'CT' },
  ],
  draft: {
    phase: 'pick',
    sideA: 'radiant',
    a: { bans: [74, 11, 41, 86], picks: [2, 14, 26, 44] },
    b: { bans: [1, 8, 53], picks: [21, 35, 5] },
  },
  casters: [
    { name: 'Имя Фамилия', role: 'Комментатор', social: '@nick' },
    { name: 'Имя Фамилия', role: 'Аналитик', social: '@nick' },
  ],
  lower: { name: 'Имя Фамилия', role: 'Комментатор', social: '@nick', fire: T0, hold: 0, on: true },
  ticker: { on: true, items: ['Киберлига: ближайший игровой день в субботу, 18:00 МСК', 'Расписание и сетка на cup.rut-miit.su', 'Подписывайтесь на трансляцию'] },
}

/** Счёт серии: адрес (?sa= ?sb=) → пульт → запись матча. Для чужого матча (?m=, ?demo=) пульт не применяется. */
export function seriesOf(state: ObsState, q: URLSearchParams, m?: { scoreA?: number; scoreB?: number; bo?: number }) {
  const own = !q.get('m') && !q.get('demo')
  const sa = Number(q.get('sa') ?? (own ? state.series?.a : undefined) ?? m?.scoreA ?? 0)
  const sb = Number(q.get('sb') ?? (own ? state.series?.b : undefined) ?? m?.scoreB ?? 0)
  const bo = (own ? state.bo : undefined) ?? m?.bo ?? 1
  return { sa, sb, bo }
}

/** Классические карты CS2 (Active Duty); пул можно менять в пульте. */
export const CS2_POOL = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Overpass']

/** Шаблоны вето: кто и что делает на каждом шаге. */
export const VETO_TEMPLATES: Record<'bo1' | 'bo3' | 'bo5', { team: Side | 'd'; action: 'ban' | 'pick' | 'decider' }[]> = {
  bo1: [
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'd', action: 'decider' },
  ],
  bo3: [
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'a', action: 'pick' },
    { team: 'b', action: 'pick' },
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'd', action: 'decider' },
  ],
  bo5: [
    { team: 'a', action: 'ban' },
    { team: 'b', action: 'ban' },
    { team: 'a', action: 'pick' },
    { team: 'b', action: 'pick' },
    { team: 'a', action: 'pick' },
    { team: 'b', action: 'pick' },
    { team: 'd', action: 'decider' },
  ],
}
