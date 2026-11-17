import type { DB, Seed, Team } from './types'

/** Время матчей хранится как «ГГГГ-ММ-ДДTЧЧ:ММ» без пояса и везде читается как московское. */
export const TZ_LABEL = 'МСК'

const DAY = 1440

/** Сила команды для жеребьёвки: среднее ММР пяти сильнейших игроков (у кого ММР не указан, не считаются). */
export function teamStrength(db: DB, t: Team): number {
  const m = db.players
    .filter((p) => p.teamId === t.id && typeof p.mmr === 'number')
    .map((p) => p.mmr as number)
    .sort((a, b) => b - a)
    .slice(0, 5)
  return m.length ? m.reduce((s, x) => s + x, 0) / m.length : 0
}

/** Порядок посева по слотам сетки: для 8 — 1,8,4,5,2,7,3,6, чтобы сильнейшие встречались как можно позже. */
export function seedOrder(size: number): number[] {
  let o = [1]
  while (o.length < size) {
    const m = o.length * 2
    o = o.flatMap((s) => [s, m + 1 - s])
  }
  return o
}

/** Слоты сетки: по рейтингу, случайно или в порядке списка; недостающие места занимают BYE (достаются сильнейшим). */
export function seedSlots(db: DB, teamIds: string[], size: number, mode: 'rating' | 'random' | 'order'): Seed[] {
  const teams = teamIds.map((id) => db.teams.find((t) => t.id === id)).filter((t): t is Team => !!t)
  let ranked = teams
  if (mode === 'rating') ranked = [...teams].sort((a, b) => teamStrength(db, b) - teamStrength(db, a))
  if (mode === 'random') {
    ranked = [...teams]
    for (let i = ranked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ranked[i], ranked[j]] = [ranked[j], ranked[i]]
    }
  }
  return seedOrder(size).map((rank) => (rank <= ranked.length ? ranked[rank - 1].id : 'BYE'))
}

const toMin = (s: string): number => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : NaN
}
export const fromMin = (n: number): string => new Date(n * 60000).toISOString().slice(0, 16)
const hm = (s: string | undefined, def: number): number => {
  const m = /^(\d\d):(\d\d)$/.exec(s ?? '')
  return m ? +m[1] * 60 + +m[2] : def
}

/** Сдвигает начало в допустимое окно «с … до …» (минуты суток), при нехватке места переносит на следующий день. */
function fit(t: number, len: number, from: number, to: number): number {
  for (let i = 0; i < 4; i++) {
    const day = Math.floor(t / DAY) * DAY
    const tod = t - day
    if (tod < from) t = day + from
    else if (tod + len > to) t = day + DAY + from
    else break
  }
  return t
}

export interface SchedRow {
  key: string
  a?: Seed
  b?: Seed
  round: number
  date?: string
}

export interface SchedOpts {
  start: string
  len: number
  gap: number
  lanes: number
  dayFrom: string
  dayTo: string
  onlyEmpty: boolean
  /** Ждать конца всего предыдущего раунда (одиночная сетка). */
  barrier: boolean
}

/** Раскладывает матчи по времени: потоки, окно дня, перерыв, отдых команд и их пожелания (playFrom/playTo). Возвращает ключ → дата. */
export function autoSchedule(rows: SchedRow[], teams: Team[], o: SchedOpts): Map<string, string> {
  const out = new Map<string, string>()
  const t0 = toMin(o.start)
  if (!Number.isFinite(t0)) return out
  const len = Math.max(10, o.len)
  const gap = Math.max(0, o.gap)
  const dFrom = hm(o.dayFrom, 0)
  const dTo = Math.max(hm(o.dayTo, DAY), dFrom + len)
  const lane = Array.from({ length: Math.max(1, o.lanes) }, () => t0)
  const free = new Map<string, number>()
  const wish = (id?: Seed) => teams.find((t) => t.id === id)
  const roundEnd = new Map<number, number>()
  const roundsDone = new Set<number>()
  let prevRound = rows[0]?.round ?? 0
  let barrierT = t0
  for (const r of rows) {
    if (o.barrier && r.round !== prevRound) {
      barrierT = Math.max(barrierT, roundEnd.get(prevRound) ?? t0)
      roundsDone.add(prevRound)
      prevRound = r.round
    }
    const ta = wish(r.a)
    const tb = wish(r.b)
    if (o.onlyEmpty && r.date && Number.isFinite(toMin(r.date))) {
      const s = toMin(r.date)
      for (const id of [r.a, r.b]) if (id && id !== 'BYE') free.set(id, Math.max(free.get(id) ?? 0, s + len + gap))
      roundEnd.set(r.round, Math.max(roundEnd.get(r.round) ?? 0, s + len))
      continue
    }
    let li = 0
    for (let i = 1; i < lane.length; i++) if (lane[i] < lane[li]) li = i
    let t = Math.max(lane[li], barrierT, free.get(String(r.a)) ?? 0, free.get(String(r.b)) ?? 0)
    for (let i = 0; i < 30; i++) {
      const before = t
      t = fit(t, len, dFrom, dTo)
      for (const x of [ta, tb]) if (x?.playFrom || x?.playTo) t = fit(t, len, hm(x.playFrom, 0), hm(x.playTo, DAY))
      if (t === before) break
    }
    out.set(r.key, fromMin(t))
    lane[li] = t + len + gap
    for (const id of [r.a, r.b]) if (id && id !== 'BYE') free.set(id, t + len + gap)
    roundEnd.set(r.round, Math.max(roundEnd.get(r.round) ?? 0, t + len))
  }
  return out
}

/** Проблемы расписания: пересечения матчей одной команды, мало отдыха, выход за пожелания по времени. */
export function findConflicts(rows: SchedRow[], teams: Team[], len: number, gap: number): Map<string, string[]> {
  const res = new Map<string, string[]>()
  const add = (k: string, msg: string) => res.set(k, [...(res.get(k) ?? []), msg])
  const dated = rows.filter((r) => r.date && Number.isFinite(toMin(r.date)))
  const name = (id?: Seed) => teams.find((t) => t.id === id)?.name ?? String(id)
  for (const r of dated) {
    const s = toMin(r.date as string)
    for (const id of [r.a, r.b]) {
      const t = teams.find((x) => x.id === id)
      if (!t) continue
      for (const q of dated) {
        if (q === r || (q.a !== id && q.b !== id)) continue
        const qs = toMin(q.date as string)
        if (s < qs + len && qs < s + len) add(r.key, `${name(id)}: пересечение с матчем ${q.key}`)
        else if (qs < s && s - qs - len < gap) add(r.key, `${name(id)}: меньше ${gap} мин отдыха после ${q.key}`)
      }
      const tod = ((s % DAY) + DAY) % DAY
      const from = hm(t.playFrom, 0)
      const to = hm(t.playTo, DAY)
      if (t.playFrom || t.playTo) if (tod < from || tod + len > to) add(r.key, `${name(id)} просит играть ${t.playFrom ?? '00:00'}–${t.playTo ?? '24:00'}`)
    }
  }
  return res
}

export const shiftDate = (s: string, min: number): string => {
  const v = toMin(s)
  return Number.isFinite(v) ? fromMin(v + min) : s
}
