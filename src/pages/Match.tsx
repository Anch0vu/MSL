import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MatchList } from '../components/MatchList'
import { Empty, PlayerAvatar, SectionHead, StatusBadge, TeamLogo } from '../components/ui'
import { twitchChannelFromUrl, useDB } from '../lib/data'
import { TwitchPlayer } from '../components/Twitch'
import { MatchOps } from '../components/MatchOps'
import { ShareButton } from '../components/Share'
import { ResultLog } from '../components/ResultLog'
import { allMatches, byDate, fmtDate, tournamentMatches } from '../lib/matches'
import type { Seed } from '../lib/types'

function Roster({ id }: { id: Seed }) {
  const { team, roster } = useDB()
  const t = team(id)
  if (!t) return <div className="panel"><div className="panel-head">TBD</div><div className="empty small">Команда не определена</div></div>
  return (
    <div className="panel">
      <div className="panel-head">
        <TeamLogo team={t} size={22} /> {t.name}
      </div>
      {roster(t.id).map((p) => (
        <Link key={p.id} to={`/players/${p.id}`} className="roster-row">
          <PlayerAvatar p={p} color={t.color} />
          <b>{p.nick}</b>
          <span className="muted small">{p.role}</span>
        </Link>
      ))}
    </div>
  )
}

export function MatchPage() {
  const { tid = '', stageId = '', mkey = '' } = useParams()
  const { db, tournament, team } = useDB()
  const t = tournament(tid)
  const m = t && tournamentMatches(db, t).find((x) => x.stageId === stageId && x.key === mkey)
  if (!t || !m) return <div className="wrap page"><Empty>Матч не найден</Empty></div>
  const A = team(m.a)
  const B = team(m.b)
  const done = m.status === 'finished'
  const aWin = done && (m.scoreA ?? 0) > (m.scoreB ?? 0)
  const bWin = done && (m.scoreB ?? 0) > (m.scoreA ?? 0)
  const h2h = allMatches(db)
    .filter((x) => x.status === 'finished' && !(x.tid === m.tid && x.key === m.key) && m.a && m.b && [x.a, x.b].includes(m.a) && [x.a, x.b].includes(m.b))
    .sort(byDate)

  return (
    <>
      <section className="match-head">
        <div className="wrap">
          <div className="crumbs">
            <Link to={`/t/${t.id}`}>{t.name}</Link> / <Link to={`/t/${t.id}/bracket`}>{m.stage}</Link> / {m.key}
          </div>
          <div className="scoreboard">
            <div className={`sb-team ${aWin ? 'win' : ''} ${bWin ? 'lose' : ''}`}>
              <TeamLogo team={A} size={84} />
              {A ? <Link to={`/teams/${A.id}`}>{A.name}</Link> : <span className="muted">{m.hintA}</span>}
            </div>
            <div className="sb-center">
              <div className="sb-meta">{m.label}</div>
              <div className="sb-score">
                {done || m.status === 'live' ? (
                  <>
                    <span className={aWin ? 'w' : ''}>{m.scoreA ?? 0}</span>
                    <i>:</i>
                    <span className={bWin ? 'w' : ''}>{m.scoreB ?? 0}</span>
                  </>
                ) : (
                  <span className="sb-vs">VS</span>
                )}
              </div>
              <StatusBadge status={m.status} />
              <div className="sb-meta">
                {fmtDate(m.date)} · Bo{m.bo}
              </div>
              {m.record?.stream && (
                <a className="btn btn-accent" href={m.record.stream} target="_blank" rel="noreferrer">
                  Трансляция
                </a>
              )}
              <ShareButton q={`m=${encodeURIComponent(`${t.id}|${m.stageId}|${m.key}`)}`} title={`${A?.name ?? 'TBD'} — ${B?.name ?? 'TBD'}`} className="btn btn-outline-white" />
            </div>
            <div className={`sb-team ${bWin ? 'win' : ''} ${aWin ? 'lose' : ''}`}>
              <TeamLogo team={B} size={84} />
              {B ? <Link to={`/teams/${B.id}`}>{B.name}</Link> : <span className="muted">{m.hintB}</span>}
            </div>
          </div>
        </div>
      </section>
      <div className="wrap page">
        {twitchChannelFromUrl(m.record?.stream) && (
          <section>
            <SectionHead title="Трансляция" />
            <TwitchPlayer channel={twitchChannelFromUrl(m.record?.stream)!} autoplay={m.status === 'live'} />
          </section>
        )}
        <MapsPanel maps={m.record?.maps ?? []} a={A?.tag ?? 'A'} b={B?.tag ?? 'B'} />
        {m.record?.note && <div className="panel pad">{m.record.note}</div>}
        <MatchOps tid={t.id} stageId={m.stageId} mkey={m.key} a={m.a} b={m.b} />
        <ResultLog tid={t.id} stageId={m.stageId} mkey={m.key} />
        <section>
          <SectionHead title="Составы" />
          <div className="two-col">
            <Roster id={m.a} />
            <Roster id={m.b} />
          </div>
        </section>
        {h2h.length > 0 && (
          <section>
            <SectionHead title="Личные встречи" />
            <MatchList matches={h2h} />
          </section>
        )}
      </div>
    </>
  )
}

function MapsPanel({ maps, a, b }: { maps: { name: string; a: number; b: number }[]; a: string; b: string }) {
  if (!maps.length) return null
  return (
    <section>
      <SectionHead title="Карты" />
      <div className="maps">
        {maps.map((mp, i) => (
          <div key={i} className="map-card">
            <div className="map-name">{mp.name}</div>
            <div className="map-score">
              <span className={mp.a > mp.b ? 'w' : ''}>
                {a} {mp.a}
              </span>
              <span className={mp.b > mp.a ? 'w' : ''}>
                {mp.b} {b}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function Matches() {
  const { db } = useDB()
  const all = allMatches(db)
  const [tab, setTab] = useState<'upcoming' | 'results'>('upcoming')
  const live = all.filter((m) => m.status === 'live')
  const list =
    tab === 'upcoming'
      ? [...live, ...all.filter((m) => m.status === 'scheduled').sort(byDate)]
      : all.filter((m) => m.status === 'finished').sort(byDate).reverse()
  return (
    <div className="wrap page">
      <h1 className="page-title">Матчи</h1>
      <div className="seg">
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>
          Предстоящие
        </button>
        <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>
          Результаты
        </button>
      </div>
      {groupByDay(list).map(([day, ms]) => (
        <section key={day} className="day-group">
          <h3 className="day-head">{day}</h3>
          <MatchList matches={ms} />
        </section>
      ))}
      {!list.length && <Empty>Матчей нет</Empty>}
    </div>
  )
}

function groupByDay<T extends { date?: string; status: string }>(list: T[]): [string, T[]][] {
  const out = new Map<string, T[]>()
  for (const m of list) {
    const day =
      m.status === 'live'
        ? 'Сейчас'
        : m.date
          ? new Date(m.date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
          : 'Дата не назначена'
    out.set(day, [...(out.get(day) ?? []), m])
  }
  return [...out]
}
