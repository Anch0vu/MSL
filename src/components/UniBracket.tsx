import { useNavigate } from 'react-router-dom'
import { resolveBracket, type ResolvedMatch } from '../lib/bracket'
import { teamMediaUrl, useDB } from '../lib/data'
import { fmtDate, matchHref } from '../lib/matches'
import type { BracketStage, Seed } from '../lib/types'
import '../styles/uni.css'

/*
 * Сетка в стиле Uniswap Cup: симметрично от центра, финал посередине, розовым подсвечен путь победителей.
 * Только одиночное выбывание; двойная сетка рисуется прежним компонентом.
 */

/** Квадрат команды: логотип или тег на чёрном. */
export function UcIco({ seed, size = 28 }: { seed: Seed; size?: number }) {
  const { team } = useDB()
  const t = team(seed)
  const img = teamMediaUrl(t, 'logo')
  return (
    <span className="uc-ico" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.34) }}>
      {img ? <img src={img} alt="" loading="lazy" /> : seed === 'BYE' ? '—' : t ? t.tag.slice(0, 3) : '?'}
    </span>
  )
}

function Row({ seed, score, win, lose }: { seed: Seed; score?: number; win: boolean; lose: boolean }) {
  const { team } = useDB()
  const t = team(seed)
  return (
    <div className={`uc-row${win ? ' win' : ''}${lose ? ' lose' : ''}`}>
      <UcIco seed={seed} />
      <span className={`uc-tag${t ? '' : ' tbd'}`}>{seed === 'BYE' ? 'BYE' : t ? t.tag : 'TBD'}</span>
      <span className="uc-sc">{score ?? ''}</span>
    </div>
  )
}

function Match({ m, tid, stageId, no }: { m: ResolvedMatch; tid: string; stageId: string; no: number }) {
  const nav = useNavigate()
  const clickable = m.status !== 'bye' && (m.record || (m.a.team && m.b.team))
  const show = m.status === 'finished' || m.status === 'live'
  return (
    <div className={`uc-m${m.status === 'live' ? ' live' : ''}${m.status === 'bye' ? ' bye' : ''}${clickable ? ' click' : ''}`} onClick={() => clickable && nav(matchHref({ tid, stageId, key: m.key }))}>
      {no > 0 && <span className="uc-no">#{no}</span>}
      <Row seed={m.a.team} score={show ? m.record?.scoreA : undefined} win={!!m.winner && m.winner === m.a.team && m.status !== 'bye'} lose={!!m.winner && m.winner !== m.a.team && m.status !== 'bye'} />
      <Row seed={m.b.team} score={show ? m.record?.scoreB : undefined} win={!!m.winner && m.winner === m.b.team && m.status !== 'bye'} lose={!!m.winner && m.winner !== m.b.team && m.status !== 'bye'} />
      {m.status === 'live' && <span className="uc-live">LIVE</span>}
    </div>
  )
}

function Finalist({ slot, score, win }: { slot: ResolvedMatch['a']; score?: number; win: boolean }) {
  const { team } = useDB()
  const t = team(slot.team)
  return (
    <div className={`uc-fin${win ? ' win' : ''}`}>
      {win && <span className="uc-winner">WINNER</span>}
      <UcIco seed={slot.team} size={120} />
      <b>{t ? t.name : 'TBD'}</b>
      <span className="uc-fsc">{score ?? ''}</span>
    </div>
  )
}

const stageTag = (left: number) => (left === 1 ? '1/2' : left === 2 ? '1/4' : `1/${2 ** left}`)

export function UniBracket({ stage, tid }: { stage: BracketStage; tid: string }) {
  const { records } = useDB()
  const rounds = resolveBracket(stage, records(tid, stage.id))
  const upper = rounds.filter((r) => r.side === 'upper')
  const fm = rounds.find((r) => r.side === 'final')?.matches[0]
  const third = rounds.find((r) => r.side === 'third')?.matches[0]
  if (!fm) return null
  const k = upper.length + 1
  const half = (ms: ResolvedMatch[], right: boolean) => (right ? ms.slice(ms.length / 2) : ms.slice(0, ms.length / 2))
  // сквозная нумерация: левая половина, правая, финал
  let n = 0
  const numbered = new Map<string, number>()
  for (const r of upper) for (const m of half(r.matches, false)) numbered.set(m.key, ++n)
  for (const r of upper) for (const m of half(r.matches, true)) numbered.set(m.key, ++n)
  numbered.set(fm.key, ++n)
  const maxHalf = Math.max(1, ...upper.map((r) => r.matches.length / 2))
  const col = (r: (typeof upper)[number], right: boolean) => {
    const ms = half(r.matches, right)
    const left = k - r.round
    return (
      <div key={`${right ? 'r' : 'l'}${r.round}`} className={`uc-col ${right ? 'r' : 'l'} ${ms.length > 1 ? 'halving' : 'straight'}`}>
        <span className="uc-stage">{stageTag(left)}</span>
        <div className="uc-cells">
          {ms.map((m) => (
            <div key={m.key} className={`uc-cell${m.winner && m.status === 'finished' ? ' decided' : ''}`}>
              <Match m={m} tid={tid} stageId={stage.id} no={numbered.get(m.key) ?? 0} />
            </div>
          ))}
        </div>
      </div>
    )
  }
  const showF = fm.status === 'finished' || fm.status === 'live'
  const champ = fm.winner
  return (
    <div className="uc uc-bracket-wrap">
      <div className="uc-bracket" style={{ '--n': maxHalf } as React.CSSProperties}>
        {upper.map((r) => col(r, false))}
        <div className="uc-center">
          <div className="uc-road">Road to final</div>
          <div className="uc-ring" />
          <div className="uc-final">
            <Finalist slot={fm.a} score={showF ? fm.record?.scoreA : undefined} win={!!champ && champ === fm.a.team} />
            <div className="uc-vs">
              <span className="uc-ftag">Final</span>
              <span className="uc-vs-t">VS</span>
              <span className="uc-bo">Bo{fm.bo}</span>
            </div>
            <Finalist slot={fm.b} score={showF ? fm.record?.scoreB : undefined} win={!!champ && champ === fm.b.team} />
          </div>
          <div className="uc-date">
            {fm.record?.date ? (
              <>
                <span className="uc-dd">{fmtDate(fm.record.date, false)}</span> <u>{fm.record.date.split('T')[1]?.slice(0, 5)} МСК</u>
              </>
            ) : (
              'Дата не назначена'
            )}
          </div>
          {third && (
            <div className="uc-third">
              <span className="uc-stage">3 место</span>
              <Match m={third} tid={tid} stageId={stage.id} no={0} />
            </div>
          )}
        </div>
        {[...upper].reverse().map((r) => col(r, true))}
      </div>
    </div>
  )
}
