import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useData, useDB } from '../lib/data'
import { tournamentMatches } from '../lib/matches'
import type { Tournament } from '../lib/types'
import { Empty, SectionHead, TeamName } from './ui'

interface Stats {
  totals: { games: number; radiantWins: number; duration: number; kills: number; longest: { matchId: number; duration: number } | null; bloodiest: { matchId: number; kills: number } | null }
  heroes: { id: number; name: string; img: string; picks: number; wins: number }[]
  players: {
    acc: number
    playerId: string | null
    nick: string
    teamId: string
    games: number
    wins: number
    k: number
    d: number
    a: number
    kda: number
    gpm: number
    xpm: number
    dmg: number
    mvp: number
    heroes: { id: number; name: string; img: string }[]
  }[]
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const min = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const avg = (x: number, n: number) => (n ? (x / n).toFixed(1) : '0')

/** Винрейт команд по стадиям — из сыгранных матчей документа. */
function StageWinrate({ t }: { t: Tournament }) {
  const { db } = useDB()
  const ms = tournamentMatches(db, t).filter((m) => m.status === 'finished' && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE')
  if (!ms.length) return null
  const stages = t.stages.filter((s) => ms.some((m) => m.stageId === s.id))
  const rows = new Map<string, Record<string, [number, number]>>()
  for (const m of ms) {
    const aw = (m.scoreA ?? 0) > (m.scoreB ?? 0)
    const bw = (m.scoreB ?? 0) > (m.scoreA ?? 0)
    for (const [id, w, l] of [
      [m.a as string, aw, bw],
      [m.b as string, bw, aw],
    ] as const) {
      const r = rows.get(id) ?? {}
      const c = r[m.stageId] ?? [0, 0]
      r[m.stageId] = [c[0] + (w ? 1 : 0), c[1] + (l ? 1 : 0)]
      rows.set(id, r)
    }
  }
  const total = (r: Record<string, [number, number]>) => Object.values(r).reduce((s, [w, l]) => [s[0] + w, s[1] + l], [0, 0])
  const list = [...rows].sort((x, y) => {
    const [xw, xl] = total(x[1])
    const [yw, yl] = total(y[1])
    return pct(yw, yw + yl) - pct(xw, xw + xl) || yw - xw
  })
  return (
    <section>
      <SectionHead title="Команды по стадиям" />
      <div className="panel table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="left">Команда</th>
              {stages.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
              <th>Всего</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([id, r]) => {
              const [w, l] = total(r)
              return (
                <tr key={id}>
                  <td className="left">
                    <TeamName id={id} logo={20} />
                  </td>
                  {stages.map((s) => (
                    <td key={s.id}>{r[s.id] ? `${r[s.id][0]}–${r[s.id][1]} · ${pct(r[s.id][0], r[s.id][0] + r[s.id][1])}%` : '—'}</td>
                  ))}
                  <td>
                    <b>{pct(w, w + l)}%</b> <span className="muted small">{w}–{l}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Вкладка «Статистика» турнира: команды по стадиям и данные игр из OpenDota (герои, игроки, KDA, MVP). */
export function TourStats({ t }: { t: Tournament }) {
  const { mode } = useData()
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    if (mode !== 'api') return
    api<Stats>('tstats', { query: `t=${encodeURIComponent(t.id)}` }).then(setS, () => setS(null))
  }, [t.id, mode])
  const tt = s?.totals
  return (
    <>
      <StageWinrate t={t} />
      {tt && tt.games > 0 ? (
        <>
          <section>
            <SectionHead title="Игры турнира" />
            <div className="ts-totals">
              <div>
                <b>{tt.games}</b>
                <small>игр</small>
              </div>
              <div>
                <b>{min(tt.duration / tt.games)}</b>
                <small>средняя длительность</small>
              </div>
              <div>
                <b>{avg(tt.kills, tt.games)}</b>
                <small>убийств за игру</small>
              </div>
              <div>
                <b>{pct(tt.radiantWins, tt.games)}%</b>
                <small>побед Radiant</small>
              </div>
              {tt.longest && (
                <a href={`https://www.opendota.com/matches/${tt.longest.matchId}`} target="_blank" rel="noreferrer">
                  <b>{min(tt.longest.duration)}</b>
                  <small>самая долгая игра</small>
                </a>
              )}
              {tt.bloodiest && (
                <a href={`https://www.opendota.com/matches/${tt.bloodiest.matchId}`} target="_blank" rel="noreferrer">
                  <b>{tt.bloodiest.kills}</b>
                  <small>убийств в самой кровавой</small>
                </a>
              )}
            </div>
          </section>
          <section>
            <SectionHead title="Лучшие игроки по KDA" />
            <div className="panel table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th className="pos">#</th>
                    <th className="left">Игрок</th>
                    <th className="left hide-sm">Команда</th>
                    <th>Игр</th>
                    <th>K/D/A</th>
                    <th>KDA</th>
                    <th className="hide-sm">GPM</th>
                    <th className="hide-sm">Урон</th>
                    <th>MVP</th>
                    <th className="left hide-sm">Герои</th>
                  </tr>
                </thead>
                <tbody>
                  {s!.players.map((p, i) => (
                    <tr key={p.acc}>
                      <td className="pos">{i + 1}</td>
                      <td className="left">{p.playerId ? <Link to={`/players/${p.playerId}`}>{p.nick}</Link> : p.nick}</td>
                      <td className="left hide-sm">
                        <TeamName id={p.teamId} logo={18} />
                      </td>
                      <td>{p.games}</td>
                      <td>
                        {avg(p.k, p.games)}/{avg(p.d, p.games)}/{avg(p.a, p.games)}
                      </td>
                      <td>
                        <b>{p.kda}</b>
                      </td>
                      <td className="hide-sm">{p.gpm}</td>
                      <td className="hide-sm">{(p.dmg / 1000).toFixed(1)}k</td>
                      <td>{p.mvp || '—'}</td>
                      <td className="left hide-sm">
                        {p.heroes.map((h) => (
                          <img key={h.id} className="mo-hero" src={h.img} alt="" title={h.name} loading="lazy" />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <SectionHead title="Популярные герои" />
            <div className="ts-heroes">
              {s!.heroes.map((h) => (
                <div key={h.id} className="ts-hero">
                  {h.img && <img src={h.img} alt="" loading="lazy" />}
                  <b>{h.name}</b>
                  <small>
                    {h.picks} пик · {pct(h.wins, h.picks)}% побед
                  </small>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <Empty>Статистика игр появится, когда к матчам добавят Match ID из Dota 2 (капитаны при отправке результата или организатор).</Empty>
      )}
    </>
  )
}
