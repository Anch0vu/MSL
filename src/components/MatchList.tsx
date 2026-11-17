import { useNavigate } from 'react-router-dom'
import { fmtDate, matchHref, type MatchView } from '../lib/matches'
import { TeamName } from './ui'

export function MatchRow({ m, showTournament = true }: { m: MatchView; showTournament?: boolean }) {
  const nav = useNavigate()
  const done = m.status === 'finished'
  const live = m.status === 'live'
  const aWin = done && (m.scoreA ?? 0) > (m.scoreB ?? 0)
  const bWin = done && (m.scoreB ?? 0) > (m.scoreA ?? 0)
  return (
    <div className={`mrow ${live ? 'mrow-live' : ''}`} onClick={() => nav(matchHref(m))}>
      <div className="mrow-time">{live ? <b className="live-dot">LIVE</b> : fmtDate(m.date)}</div>
      <div className={`mrow-team a ${aWin ? 'win' : ''} ${bWin ? 'lose' : ''}`}>
        <TeamName id={m.a} hint={m.hintA} link={false} />
      </div>
      <div className="mrow-score">
        {done || live ? (
          <>
            <span className={aWin ? 'w' : ''}>{m.scoreA ?? 0}</span>:<span className={bWin ? 'w' : ''}>{m.scoreB ?? 0}</span>
          </>
        ) : (
          <span className="vs">Bo{m.bo}</span>
        )}
      </div>
      <div className={`mrow-team b ${bWin ? 'win' : ''} ${aWin ? 'lose' : ''}`}>
        <TeamName id={m.b} hint={m.hintB} link={false} />
      </div>
      <div className="mrow-meta">
        {showTournament && <span>{m.tournament}</span>}
        <span className="muted">{m.label}</span>
      </div>
    </div>
  )
}

export function MatchList({ matches, showTournament = true, empty = 'Матчей нет' }: { matches: MatchView[]; showTournament?: boolean; empty?: string }) {
  if (!matches.length) return <div className="empty">{empty}</div>
  return (
    <div className="mlist">
      {matches.map((m) => (
        <MatchRow key={`${m.tid}/${m.stageId}/${m.key}`} m={m} showTournament={showTournament} />
      ))}
    </div>
  )
}
