import { allBracketMatches } from './bracket'
import type { DB, MatchRecord, MatchStatus, Seed, Tournament } from './types'

export interface MatchView {
  tid: string
  tournament: string
  stageId: string
  stage: string
  key: string
  label: string
  a: Seed
  b: Seed
  hintA: string
  hintB: string
  scoreA?: number
  scoreB?: number
  status: MatchStatus | 'bye' | 'waiting'
  date?: string
  bo: number
  record?: MatchRecord
}

const sideLabel: Record<string, string> = { upper: 'Верхняя сетка', lower: 'Нижняя сетка', final: 'Финал', third: 'За 3-е место' }

export function tournamentMatches(db: DB, t: Tournament): MatchView[] {
  const out: MatchView[] = []
  for (const stage of t.stages) {
    const recs = db.matches.filter((m) => m.tournamentId === t.id && m.stageId === stage.id)
    if (stage.type === 'groups') {
      for (const r of recs) {
        out.push({
          tid: t.id,
          tournament: t.name,
          stageId: stage.id,
          stage: stage.name,
          key: r.key,
          label: `Группа ${r.group ?? ''}`.trim(),
          a: r.teamA ?? null,
          b: r.teamB ?? null,
          hintA: 'TBD',
          hintB: 'TBD',
          scoreA: r.scoreA,
          scoreB: r.scoreB,
          status: r.status ?? 'scheduled',
          date: r.date,
          bo: stage.bo,
          record: r,
        })
      }
    } else {
      for (const m of allBracketMatches(stage, recs)) {
        if (m.status === 'bye') continue
        out.push({
          tid: t.id,
          tournament: t.name,
          stageId: stage.id,
          stage: stage.name,
          key: m.key,
          label: `${sideLabel[m.side]} · ${m.key}`,
          a: m.a.team,
          b: m.b.team,
          hintA: m.a.hint,
          hintB: m.b.hint,
          scoreA: m.record?.scoreA,
          scoreB: m.record?.scoreB,
          status: m.status,
          date: m.record?.date,
          bo: m.bo,
          record: m.record,
        })
      }
    }
  }
  return out
}

export function allMatches(db: DB): MatchView[] {
  return db.tournaments.flatMap((t) => tournamentMatches(db, t))
}

export function byDate(a: MatchView, b: MatchView) {
  return (a.date ?? '9999').localeCompare(b.date ?? '9999')
}

export const matchHref = (m: { tid: string; stageId: string; key: string }) => `/t/${m.tid}/m/${m.stageId}/${m.key}`

const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function fmtDate(s?: string, withTime = true): string {
  if (!s) return 'Дата не назначена'
  const [d, t] = s.split('T')
  const [, mo, day] = d.split('-').map(Number)
  return `${day} ${months[mo - 1]}${withTime && t ? `, ${t.slice(0, 5)} МСК` : ''}`
}

export function fmtRange(a: string, b?: string) {
  return b && b !== a ? `${fmtDate(a, false)} — ${fmtDate(b, false)}` : fmtDate(a, false)
}
