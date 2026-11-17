import { Link, NavLink, useParams } from 'react-router-dom'
import { tourGame } from '../lib/games'
import { Bracket } from '../components/Bracket'
import { UniBracket } from '../components/UniBracket'
import { GroupTables } from '../components/GroupTable'
import { MatchList } from '../components/MatchList'
import { ShareButton } from '../components/Share'
import { CalendarLink } from '../components/Calendar'
import { ResultLog } from '../components/ResultLog'
import { TourStats } from '../components/TourStats'
import { Empty, Markdown, SectionHead, StatusBadge, TeamLogo, TeamName } from '../components/ui'
import { bracketPlacings } from '../lib/bracket'
import { useDB } from '../lib/data'
import { byDate, fmtRange, tournamentMatches } from '../lib/matches'
import type { Tournament } from '../lib/types'

export function TournamentCard({ t }: { t: Tournament }) {
  const left = Math.max(0, t.maxTeams - t.teams.length)
  return (
    <Link to={`/t/${t.id}`} className={`tour-card tour-row st-${t.status}`}>
      <div className="tr-main">
        <StatusBadge status={t.status} />
        <h3>{t.name}</h3>
        <span className="muted small">{tourGame(t)}</span>
      </div>
      <div className="tr-col">
        <small>Начало</small>
        <b>{fmtRange(t.startDate, t.endDate)}</b>
      </div>
      <div className="tr-col tr-fmt">
        <small>Формат</small>
        <b>{t.format}</b>
      </div>
      <div className="tr-col">
        <small>Команды</small>
        <b>
          {t.teams.length} / {t.maxTeams}
        </b>
        <div className="fill">
          <i style={{ width: `${Math.min(100, (t.teams.length / t.maxTeams) * 100)}%` }} />
        </div>
        {t.status === 'registration' && left > 0 && <span className="muted small">свободно {left}</span>}
      </div>
      <div className="tr-col">
        <small>Призовые</small>
        <b className="prize">{t.prize || '—'}</b>
      </div>
      <span className="tr-go" aria-hidden>
        ›
      </span>
    </Link>
  )
}

export function Tournaments() {
  const { db } = useDB()
  const groups: [string, Tournament[]][] = [
    ['Идут', db.tournaments.filter((t) => t.status === 'live')],
    ['Регистрация и анонсы', db.tournaments.filter((t) => t.status === 'registration' || t.status === 'upcoming')],
    ['Завершённые', db.tournaments.filter((t) => t.status === 'finished')],
  ]
  return (
    <div className="wrap page">
      <h1 className="page-title">Турниры</h1>
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <SectionHead title={title} />
            <div className="tour-grid">
              {list.map((t) => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  )
}

const tabs = [
  ['', 'Обзор'],
  ['bracket', 'Сетка'],
  ['matches', 'Матчи'],
  ['teams', 'Участники'],
  ['stats', 'Статистика'],
  ['rules', 'Регламент'],
] as const

export function TournamentPage() {
  const { id = '', tab = '' } = useParams()
  const { db, tournament, team } = useDB()
  const t = tournament(id)
  if (!t) return <div className="wrap page"><Empty>Турнир не найден</Empty></div>
  const matches = tournamentMatches(db, t).sort(byDate)
  const bracketStage = t.stages.find((s) => s.type !== 'groups')
  const placings = bracketStage?.type === 'single' || bracketStage?.type === 'double' ? bracketPlacings(bracketStage, db.matches.filter((m) => m.tournamentId === t.id && m.stageId === bracketStage.id)) : []
  const news = db.news.filter((n) => n.tournamentId === t.id)

  return (
    <>
      <section className="t-head">
        <div className="wrap">
          <div className="crumbs">
            <Link to="/tournaments">Турниры</Link> / {t.short ?? t.name}
          </div>
          <div className="t-head-row">
            <div>
              <div className="hero-kicker">
                <StatusBadge status={t.status} />
                <span>{tourGame(t)}</span>
              </div>
              <h1>{t.name}</h1>
              <ShareButton q={`t=${encodeURIComponent(t.id)}`} title={t.name} className="btn btn-outline-white t-share" />
              <CalendarLink q={`t=${encodeURIComponent(t.id)}`} className="btn btn-outline-white t-share" />
            </div>
            <div className="t-stats">
              <div>
                <small>Даты</small>
                <b>{fmtRange(t.startDate, t.endDate)}</b>
              </div>
              <div>
                <small>Команды</small>
                <b>
                  {t.teams.length}/{t.maxTeams}
                </b>
              </div>
              <div>
                <small>Призы</small>
                <b>{t.prize ?? '—'}</b>
              </div>
              <div>
                <small>Формат</small>
                <b>{t.format}</b>
              </div>
            </div>
          </div>
          <nav className="tabs">
            {tabs.map(([k, label]) => (
              <NavLink key={k} to={`/t/${t.id}${k ? `/${k}` : ''}`} end>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </section>

      <div className="wrap page">
        {tab === '' && (
          <div className="layout-2">
            <div className="col-main">
              <section className="panel pad">
                <Markdown text={t.description} />
                {(t.status === 'registration' || t.status === 'upcoming') && (
                  <Link to="/register" className="btn btn-accent">
                    Подать заявку
                  </Link>
                )}
              </section>
              {placings.length > 0 && (
                <section>
                  <SectionHead title="Итоги" />
                  <div className="podium">
                    {placings.map((p, i) => (
                      <div key={i} className={`podium-place p${i + 1}`}>
                        <span className="place">{i + 1}</span>
                        <TeamName id={p} logo={40} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <SectionHead title="Матчи" link={`/t/${t.id}/matches`} />
                <MatchList
                  matches={[...matches.filter((m) => m.status === 'live'), ...matches.filter((m) => m.status === 'scheduled')].slice(0, 5)}
                  showTournament={false}
                  empty="Нет запланированных матчей"
                />
              </section>
              {news.length > 0 && (
                <section>
                  <SectionHead title="Новости турнира" />
                  {news.map((n) => (
                    <Link key={n.id} to={`/news/${n.id}`} className="news-line">
                      <span className="tag">{n.tag}</span> {n.title}
                    </Link>
                  ))}
                </section>
              )}
            </div>
            <aside className="col-side">
              <section className="panel">
                <div className="panel-head">Участники</div>
                {t.teams.map((id) => (
                  <div className="side-team" key={id}>
                    <TeamName id={id} />
                    <span className="muted small">{team(id)?.faculty}</span>
                  </div>
                ))}
                {!t.teams.length && <div className="empty small">Пока никого</div>}
              </section>
            </aside>
          </div>
        )}

        {tab === 'bracket' &&
          (t.stages.length ? (
            t.stages.map((s) => (
              <section key={s.id}>
                <SectionHead title={s.name} />
                {s.type === 'groups' ? <GroupTables stage={s} tid={t.id} /> : s.type === 'single' ? <UniBracket stage={s} tid={t.id} /> : <Bracket stage={s} tid={t.id} />}
              </section>
            ))
          ) : (
            <Empty>Сетка появится после закрытия регистрации</Empty>
          ))}

        {tab === 'matches' && (
          <>
            <MatchList matches={matches} showTournament={false} />
            <ResultLog tid={t.id} title="Журнал изменений результатов" />
          </>
        )}

        {tab === 'teams' && (
          <div className="team-grid">
            {t.teams.map((id) => {
              const tm = team(id)
              return tm ? (
                <Link key={id} to={`/teams/${id}`} className="team-card">
                  <TeamLogo team={tm} size={56} />
                  <b>{tm.name}</b>
                  <small>{tm.faculty}</small>
                </Link>
              ) : null
            })}
            {Array.from({ length: Math.max(0, t.maxTeams - t.teams.length) }).map((_, i) => (
              <div key={i} className="team-card empty-slot">
                <TeamLogo size={56} />
                <b>Свободный слот</b>
                <small>Регистрация открыта</small>
              </div>
            ))}
          </div>
        )}

        {tab === 'stats' && <TourStats t={t} />}

        {tab === 'rules' && (
          <section className="panel pad">
            <Markdown text={t.rules ?? db.rules} />
          </section>
        )}
      </div>
    </>
  )
}
