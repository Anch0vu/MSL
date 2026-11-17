import type { BracketStage, GroupStage, ID, MatchRecord, MatchStatus, Seed } from './types'

type Source =
  | { kind: 'seed'; index: number }
  | { kind: 'winner'; key: string }
  | { kind: 'loser'; key: string }

export type Side = 'upper' | 'lower' | 'final' | 'third'

interface MatchDef {
  key: string
  side: Side
  round: number
  a: Source
  b: Source
}

export interface Slot {
  team: Seed
  /** Подпись для пустого слота: «Победитель UB1-1». */
  hint: string
}

export interface ResolvedMatch {
  key: string
  side: Side
  round: number
  a: Slot
  b: Slot
  bo: number
  record?: MatchRecord
  status: MatchStatus | 'bye' | 'waiting'
  winner: Seed
  loser: Seed
}

export interface BracketRound {
  side: Side
  round: number
  title: string
  matches: ResolvedMatch[]
}

const log2 = (n: number) => Math.round(Math.log2(n))

function singleRoundTitle(round: number, total: number): string {
  const left = total - round
  if (left === 0) return 'Финал'
  if (left === 1) return 'Полуфинал'
  if (left === 2) return 'Четвертьфинал'
  return `1/${2 ** left} финала`
}

function buildSingle(size: number, thirdPlace: boolean): MatchDef[] {
  const k = log2(size)
  const defs: MatchDef[] = []
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r
    for (let m = 1; m <= count; m++) {
      const key = r === k ? 'F' : `R${r}-${m}`
      const prev = (i: number) => `R${r - 1}-${i}`
      defs.push({
        key,
        side: r === k ? 'final' : 'upper',
        round: r,
        a: r === 1 ? { kind: 'seed', index: 2 * m - 2 } : { kind: 'winner', key: prev(2 * m - 1) },
        b: r === 1 ? { kind: 'seed', index: 2 * m - 1 } : { kind: 'winner', key: prev(2 * m) },
      })
    }
  }
  if (thirdPlace && k >= 2) {
    const semi = (i: number) => `R${k - 1}-${i}`
    defs.push({ key: '3RD', side: 'third', round: k, a: { kind: 'loser', key: semi(1) }, b: { kind: 'loser', key: semi(2) } })
  }
  return defs
}

function buildDouble(size: number): MatchDef[] {
  const k = log2(size)
  const defs: MatchDef[] = []
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r
    for (let m = 1; m <= count; m++) {
      defs.push({
        key: `UB${r}-${m}`,
        side: 'upper',
        round: r,
        a: r === 1 ? { kind: 'seed', index: 2 * m - 2 } : { kind: 'winner', key: `UB${r - 1}-${2 * m - 1}` },
        b: r === 1 ? { kind: 'seed', index: 2 * m - 1 } : { kind: 'winner', key: `UB${r - 1}-${2 * m}` },
      })
    }
  }
  for (let i = 1; i <= k - 1; i++) {
    const count = size / 2 ** (i + 1)
    const odd = 2 * i - 1
    const even = 2 * i
    for (let m = 1; m <= count; m++) {
      defs.push({
        key: `LB${odd}-${m}`,
        side: 'lower',
        round: odd,
        a: i === 1 ? { kind: 'loser', key: `UB1-${2 * m - 1}` } : { kind: 'winner', key: `LB${odd - 1}-${2 * m - 1}` },
        b: i === 1 ? { kind: 'loser', key: `UB1-${2 * m}` } : { kind: 'winner', key: `LB${odd - 1}-${2 * m}` },
      })
    }
    for (let m = 1; m <= count; m++) {
      // проигравшие верхней сетки падают в обратном порядке, чтобы не было ранних реваншей
      defs.push({
        key: `LB${even}-${m}`,
        side: 'lower',
        round: even,
        a: { kind: 'winner', key: `LB${odd}-${m}` },
        b: { kind: 'loser', key: `UB${i + 1}-${count + 1 - m}` },
      })
    }
  }
  defs.push({
    key: 'GF',
    side: 'final',
    round: 1,
    a: { kind: 'winner', key: `UB${k}-1` },
    b: { kind: 'winner', key: `LB${2 * (k - 1)}-1` },
  })
  return defs
}

function hintFor(src: Source): string {
  if (src.kind === 'seed') return 'TBD'
  return `${src.kind === 'winner' ? 'Победитель' : 'Проигравший'} ${src.key}`
}

export function resolveBracket(stage: BracketStage, records: MatchRecord[]): BracketRound[] {
  const defs = stage.type === 'single' ? buildSingle(stage.size, !!stage.thirdPlace) : buildDouble(stage.size)
  const byKey = new Map(records.map((r) => [r.key, r]))
  const done = new Map<string, ResolvedMatch>()
  const k = log2(stage.size)

  const take = (src: Source): Slot => {
    if (src.kind === 'seed') return { team: stage.seeds[src.index] ?? null, hint: 'TBD' }
    const m = done.get(src.key)
    const team = m ? (src.kind === 'winner' ? m.winner : m.loser) : null
    return { team, hint: hintFor(src) }
  }

  for (const def of defs) {
    const a = take(def.a)
    const b = take(def.b)
    const record = byKey.get(def.key)
    const isFinal = def.side === 'final'
    const bo = isFinal ? stage.finalBo ?? stage.bo : stage.bo
    let winner: Seed = null
    let loser: Seed = null
    let status: ResolvedMatch['status'] = 'waiting'

    if (a.team === 'BYE' || b.team === 'BYE') {
      if (a.team === 'BYE' && b.team === 'BYE') {
        winner = loser = 'BYE'
        status = 'bye'
      } else if (a.team === 'BYE' && b.team) {
        winner = b.team
        loser = 'BYE'
        status = 'bye'
      } else if (b.team === 'BYE' && a.team) {
        winner = a.team
        loser = 'BYE'
        status = 'bye'
      }
    } else if (a.team && b.team) {
      status = record?.status ?? 'scheduled'
      if (status === 'finished' && record?.scoreA != null && record?.scoreB != null && record.scoreA !== record.scoreB) {
        const aWon = record.scoreA > record.scoreB
        winner = aWon ? a.team : b.team
        loser = aWon ? b.team : a.team
      }
    }
    done.set(def.key, { key: def.key, side: def.side, round: def.round, a, b, bo, record, status, winner, loser })
  }

  const rounds: BracketRound[] = []
  const push = (side: Side, round: number, title: string) => {
    const matches = [...done.values()].filter((m) => m.side === side && m.round === round)
    if (matches.length) rounds.push({ side, round, title, matches })
  }
  if (stage.type === 'single') {
    for (let r = 1; r < k; r++) push('upper', r, singleRoundTitle(r, k))
    push('final', k, 'Финал')
    push('third', k, 'Матч за 3-е место')
  } else {
    for (let r = 1; r <= k; r++) push('upper', r, r === k ? 'Финал верхней сетки' : `Раунд ${r}`)
    const lbTotal = 2 * (k - 1)
    for (let r = 1; r <= lbTotal; r++) push('lower', r, r === lbTotal ? 'Финал нижней сетки' : `Раунд ${r}`)
    push('final', 1, 'Гранд-финал')
  }
  return rounds
}

export function allBracketMatches(stage: BracketStage, records: MatchRecord[]): ResolvedMatch[] {
  return resolveBracket(stage, records).flatMap((r) => r.matches)
}

/** Чемпион и призёры сетки, если финал сыгран. */
export function bracketPlacings(stage: BracketStage, records: MatchRecord[]): Seed[] {
  const all = allBracketMatches(stage, records)
  const final = all.find((m) => m.side === 'final')
  if (!final?.winner) return []
  const out: Seed[] = [final.winner, final.loser]
  if (stage.type === 'single') {
    const third = all.find((m) => m.side === 'third')
    if (third?.winner) out.push(third.winner)
  } else {
    const lbFinal = all.filter((m) => m.side === 'lower').at(-1)
    if (lbFinal?.loser) out.push(lbFinal.loser)
  }
  return out
}

export interface StandingRow {
  team: ID
  played: number
  wins: number
  losses: number
  draws: number
  mapsWon: number
  mapsLost: number
  points: number
}

export function groupStandings(stage: GroupStage, group: string, records: MatchRecord[]): StandingRow[] {
  const def = stage.groups.find((g) => g.name === group)
  if (!def) return []
  const rows = new Map<ID, StandingRow>(
    def.teams.map((t) => [t, { team: t, played: 0, wins: 0, losses: 0, draws: 0, mapsWon: 0, mapsLost: 0, points: 0 }]),
  )
  for (const r of records) {
    if (r.group !== group || r.status !== 'finished' || !r.teamA || !r.teamB) continue
    const A = rows.get(r.teamA)
    const B = rows.get(r.teamB)
    if (!A || !B) continue
    const sa = r.scoreA ?? 0
    const sb = r.scoreB ?? 0
    A.played++
    B.played++
    A.mapsWon += sa
    A.mapsLost += sb
    B.mapsWon += sb
    B.mapsLost += sa
    if (sa > sb) {
      A.wins++
      B.losses++
      A.points += 3
    } else if (sb > sa) {
      B.wins++
      A.losses++
      B.points += 3
    } else {
      A.draws++
      B.draws++
      A.points++
      B.points++
    }
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.mapsWon - y.mapsLost - (x.mapsWon - x.mapsLost) ||
      y.mapsWon - x.mapsWon,
  )
}
