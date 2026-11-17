import { useNavigate } from 'react-router-dom'
import { resolveBracket, type BracketRound, type ResolvedMatch } from '../lib/bracket'
import { useDB } from '../lib/data'
import { fmtDate, matchHref } from '../lib/matches'
import type { BracketStage, Seed } from '../lib/types'
import { TeamLogo } from './ui'

function Row({ seed, hint, score, win, lose }: { seed: Seed; hint: string; score?: number; win: boolean; lose: boolean }) {
  const { team } = useDB()
  const t = team(seed)
  return (
    <div className={`bm-row ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}>
      <TeamLogo team={t} size={20} />
      <span className={`bm-name ${t ? '' : 'muted'}`}>{seed === 'BYE' ? '—' : t ? t.name : hint}</span>
      <span className="bm-score">{score ?? ''}</span>
    </div>
  )
}

function BracketMatch({ m, tid, stageId }: { m: ResolvedMatch; tid: string; stageId: string }) {
  const nav = useNavigate()
  const clickable = m.status !== 'bye' && (m.record || (m.a.team && m.b.team))
  const showScore = m.status === 'finished' || m.status === 'live'
  return (
    <div
      className={`bm ${m.status === 'live' ? 'bm-live' : ''} ${m.status === 'bye' ? 'bm-bye' : ''} ${clickable ? 'clickable' : ''}`}
      onClick={() => clickable && nav(matchHref({ tid, stageId, key: m.key }))}
      title={clickable ? 'Открыть матч' : undefined}
    >
      <div className="bm-head">
        <span>{m.key}</span>
        <span>{m.status === 'live' ? <b className="live-dot">LIVE</b> : m.record?.date ? fmtDate(m.record.date) : `Bo${m.bo}`}</span>
      </div>
      <Row seed={m.a.team} hint={m.a.hint} score={showScore ? m.record?.scoreA : undefined} win={!!m.winner && m.winner === m.a.team && m.status !== 'bye'} lose={!!m.loser && m.loser === m.a.team} />
      <Row seed={m.b.team} hint={m.b.hint} score={showScore ? m.record?.scoreB : undefined} win={!!m.winner && m.winner === m.b.team && m.status !== 'bye'} lose={!!m.loser && m.loser === m.b.team} />
    </div>
  )
}

function Section({ title, rounds, tid, stageId }: { title?: string; rounds: BracketRound[]; tid: string; stageId: string }) {
  return (
    <div className="br-section">
      {title && <div className="br-section-title">{title}</div>}
      <div className="br-rounds">
        {rounds.map((r, i) => {
          const next = rounds[i + 1]
          const link = !next ? '' : next.matches.length * 2 === r.matches.length ? 'halving' : 'straight'
          return (
            <div key={`${r.side}${r.round}`} className={`br-round ${link}`}>
              <div className="br-round-title"><span>{r.title}</span></div>
              <div className="br-cells">
                {r.matches.map((m) => (
                  <div className={`br-cell ${m.winner && m.status === 'finished' ? 'decided' : ''}`} key={m.key}>
                    <BracketMatch m={m} tid={tid} stageId={stageId} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Bracket({ stage, tid }: { stage: BracketStage; tid: string }) {
  const { records } = useDB()
  const rounds = resolveBracket(stage, records(tid, stage.id))
  const upper = rounds.filter((r) => r.side === 'upper' || r.side === 'final')
  const lower = rounds.filter((r) => r.side === 'lower')
  const third = rounds.filter((r) => r.side === 'third')
  return (
    <div className="bracket-scroll">
      <div className="bracket">
        <Section title={stage.type === 'double' ? 'Верхняя сетка' : undefined} rounds={upper} tid={tid} stageId={stage.id} />
        {lower.length > 0 && <Section title="Нижняя сетка" rounds={lower} tid={tid} stageId={stage.id} />}
        {third.length > 0 && <Section rounds={third} tid={tid} stageId={stage.id} />}
      </div>
    </div>
  )
}
