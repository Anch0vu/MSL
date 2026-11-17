import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, TeamName } from '../components/ui'
import { api, useData, useDB } from '../lib/data'
import { fmtDate, matchHref } from '../lib/matches'

interface Form {
  r: 'W' | 'L'
  vs: string
  score: string
  delta: number
  tid: string
  s: string
  k: string
}

interface EloTeam {
  teamId: string
  elo: number
  peak: number
  games: number
  wins: number
  losses: number
  mapsWon: number
  mapsLost: number
  form: Form[]
}

interface Elo {
  season: string
  seasonName: string
  series: number
  teams: EloTeam[]
  start: number
}

/** Рейтинг команд по системе Эло: считается сервером по всем сыгранным сериям сезона. */
export function Rating() {
  const { mode, db } = useData()
  const { team } = useDB()
  const [d, setD] = useState<Elo | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (mode !== 'api') return
    api<Elo>('elo').then(setD, (e) => setMsg(e instanceof Error ? e.message : String(e)))
  }, [mode, db])
  if (mode !== 'api') return <div className="wrap page"><Empty>Рейтинг считается на сервере и недоступен в статическом режиме.</Empty></div>
  return (
    <div className="wrap page">
      <h1 className="page-title">Рейтинг команд{d?.seasonName ? `: ${d.seasonName}` : ''}</h1>
      {msg && <div className="error">{msg}</div>}
      {d && (
        <>
          <p className="muted elo-about">
            Система Эло по сыгранным сериям {d.season ? `турниров с ${fmtDate(d.season, false)}` : 'всех турниров'}: каждая команда начинает с {d.start}, победа над сильным соперником даёт больше очков, разгромная серия весит
            чуть больше. Серий в расчёте: {d.series}.
          </p>
          {d.teams.length ? (
            <div className="panel elo-panel">
              <table className="table elo-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="left">Команда</th>
                    <th>Эло</th>
                    <th className="hide-sm">Пик</th>
                    <th>Серии</th>
                    <th className="hide-sm">Карты</th>
                    <th className="left">Форма</th>
                  </tr>
                </thead>
                <tbody>
                  {d.teams.map((t, i) => (
                    <tr key={t.teamId}>
                      <td className="elo-pos">{i + 1}</td>
                      <td className="left">
                        <TeamName id={t.teamId} />
                      </td>
                      <td>
                        <b className="elo-val">{t.elo}</b>
                      </td>
                      <td className="hide-sm muted">{t.peak}</td>
                      <td>
                        {t.wins}–{t.losses}
                      </td>
                      <td className="hide-sm muted">
                        {t.mapsWon}:{t.mapsLost}
                      </td>
                      <td className="left">
                        <span className="elo-form">
                          {t.form.map((f, j) => (
                            <Link
                              key={j}
                              to={matchHref({ tid: f.tid, stageId: f.s, key: f.k })}
                              className={`elo-f ${f.r === 'W' ? 'w' : 'l'}`}
                              title={`${f.r === 'W' ? 'Победа' : 'Поражение'} ${f.score} против ${team(f.vs)?.name ?? f.vs} · ${f.delta > 0 ? '+' : ''}${f.delta}`}
                            >
                              {f.r === 'W' ? 'В' : 'П'}
                            </Link>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Рейтинг появится после первых сыгранных матчей.</Empty>
          )}
        </>
      )}
    </div>
  )
}
