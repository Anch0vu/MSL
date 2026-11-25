import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { MatchList } from '../components/MatchList'
import { SectionHead } from '../components/ui'
import { PartnerStrip } from '../components/Partners'
import { TournamentCard } from './Tournaments'
import { TwitchBlock } from '../components/Twitch'
import { AnimatedNumber, HeroMotion, MotionReveal, ScrambleText } from '../components/Motion'
import { useDB } from '../lib/data'
import { allMatches, byDate, fmtDate, fmtRange, matchHref } from '../lib/matches'
import type { Tournament } from '../lib/types'

const order: Record<Tournament['status'], number> = { live: 0, registration: 1, upcoming: 2, finished: 3 }

const statusLabel: Record<Tournament['status'], string> = {
  live: 'Идёт',
  registration: 'Регистрация',
  upcoming: 'Скоро',
  finished: 'Завершён',
}

export function Home() {
  const { db, team } = useDB()
  const tours = [...db.tournaments].sort((a, b) => order[a.status] - order[b.status] || a.startDate.localeCompare(b.startDate))
  const matches = allMatches(db)
  const live = matches.filter((match) => match.status === 'live')
  const upcoming = matches.filter((match) => match.status === 'scheduled').sort(byDate)
  const results = matches.filter((match) => match.status === 'finished').sort(byDate).reverse()
  const primaryMatch = live[0] ?? upcoming[0]
  const featured = tours[0]
  const news = [...db.news].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date))
  const finished = matches.filter((match) => match.status === 'finished')
  const [filter, setFilter] = useState<'all' | Tournament['status']>('all')
  const shown = tours.filter((tour) => filter === 'all' || tour.status === filter)
  const stats: [string, number][] = [
    ['Команд', db.teams.length],
    ['Матчей', finished.length],
    ['Игроков', db.players.length],
  ]

  const primaryA = primaryMatch ? team(primaryMatch.a) : undefined
  const primaryB = primaryMatch ? team(primaryMatch.b) : undefined
  const participants = (db.orgs ?? []).filter((org) => !org.closed).slice(0, 8)

  return (
    <div className="arena-home">
      <section className="arena-hero">
        <div className="wrap">
          <HeroMotion className="arena-hero-frame">
            <div className="arena-grid" aria-hidden />
            <div className="arena-hero-copy">
              <div className="arena-season">
                <ScrambleText text="MSL / SEASON 01" />
                <span>MOSCOW</span>
              </div>
              <h1 className="msl-3d-wordmark" aria-label="Moscow Student's League">
                <span className="msl-3d-moscow" data-text="MOSCOW">MOSCOW</span>
                <span className="msl-3d-league" data-text="STUDENT’S LEAGUE">STUDENT’S LEAGUE</span>
              </h1>
              <p className="arena-hero-slogan">Твоя игра <i /> Твоя лига</p>
              <p className="hero-desc">
                Независимая студенческая киберспортивная лига Москвы. Открытые турниры, команды, игроки и прямые трансляции — на одной арене.
              </p>
              <div className="arena-actions">
                <Link className="btn btn-accent motion-magnetic" to="/tournaments">Открыть сезон</Link>
                <Link className="arena-text-link" to="/register">Подать заявку →</Link>
              </div>
            </div>
            <div className="brand-art arena-brand-art" aria-hidden>
              <img src="/brand/msl-current.jpg" alt="" />
            </div>
            <div className="arena-participants" aria-label="Организации-участники">
              {participants.length ? participants.map((org) => (
                <Link key={org.id} to={`/orgs/${org.id}`}>{org.short || org.name}</Link>
              )) : (
                <span>Открытая лига для студенческих команд и организаций</span>
              )}
            </div>
          </HeroMotion>
        </div>
      </section>

      <div className="wrap arena-primary">
        <MotionReveal className="arena-match-center">
          <div className="arena-panel-head">
            <div>
              <span className="arena-live-dot" aria-hidden />
              <b>{live.length ? 'Сейчас в эфире' : 'Следующий матч'}</b>
            </div>
            {primaryMatch && <span>BO{primaryMatch.bo}</span>}
          </div>
          {primaryMatch ? (
            <Link className="arena-match-main" to={matchHref(primaryMatch)}>
              <div className="arena-team">
                <i style={{ '--team-color': primaryA?.color || '#44464f' } as CSSProperties}>{primaryA?.tag ?? primaryMatch.hintA ?? 'TBD'}</i>
                <strong>{primaryA?.name ?? primaryMatch.hintA ?? 'TBD'}</strong>
              </div>
              <div className="arena-versus">
                {primaryMatch.status === 'live' ? <b>{primaryMatch.scoreA ?? 0}:{primaryMatch.scoreB ?? 0}</b> : <b>VS</b>}
                <small>{primaryMatch.label}</small>
              </div>
              <div className="arena-team">
                <i style={{ '--team-color': primaryB?.color || '#44464f' } as CSSProperties}>{primaryB?.tag ?? primaryMatch.hintB ?? 'TBD'}</i>
                <strong>{primaryB?.name ?? primaryMatch.hintB ?? 'TBD'}</strong>
              </div>
              <span className="arena-match-time">{fmtDate(primaryMatch.date)} · {primaryMatch.tournament}</span>
            </Link>
          ) : (
            <div className="arena-match-empty">
              <b>Расписание формируется</b>
              <span>Новые матчи появятся здесь после публикации сетки.</span>
              <Link to="/tournaments">Смотреть турниры →</Link>
            </div>
          )}
        </MotionReveal>

        <MotionReveal className="arena-stats" delay={60}>
          {stats.map(([label, value]) => (
            <div key={label}>
              <AnimatedNumber value={value} />
              <span>{label}</span>
            </div>
          ))}
        </MotionReveal>

        {featured && (
          <MotionReveal className="current-tour-strip arena-current-tour" delay={80}>
            <span className="current-tour-kicker">{statusLabel[featured.status]}</span>
            <div>
              <b>{featured.name}</b>
              <small>{fmtRange(featured.startDate, featured.endDate)} · {featured.format}</small>
            </div>
            <Link to={`/t/${featured.id}`}>Открыть →</Link>
          </MotionReveal>
        )}

        <section className="arena-section">
          <div className="arena-section-head">
            <div><span>01</span><h2>Турниры</h2></div>
            <div className="seg motion-tab-pill arena-filters">
              {([
                ['all', 'Все'],
                ['live', 'Идут'],
                ['registration', 'Регистрация'],
                ['finished', 'Завершены'],
              ] as const).map(([key, label]) => (
                <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="arena-tournament-rail">
            {shown.map((tour) => <TournamentCard key={tour.id} t={tour} />)}
          </div>
          {!shown.length && <div className="empty">Нет турниров в этой категории</div>}
        </section>

        <MotionReveal className="arena-scoreboard">
          <div className="arena-section-head compact">
            <div><span>02</span><h2>Результаты</h2></div>
            <Link to="/matches">Все матчи →</Link>
          </div>
          <div className="arena-result-list">
            {results.slice(0, 5).map((match) => (
              <Link key={`${match.tid}${match.key}`} to={matchHref(match)}>
                <small>{match.tournament}</small>
                <span>{team(match.a)?.tag ?? '?'}</span>
                <b>{match.scoreA}:{match.scoreB}</b>
                <span>{team(match.b)?.tag ?? '?'}</span>
                <em>FINAL</em>
              </Link>
            ))}
            {!results.length && <div className="arena-result-empty">Результатов пока нет</div>}
          </div>
        </MotionReveal>

        <MotionReveal className="arena-schedule">
          <SectionHead title="Ближайшие матчи" link="/matches" />
          <MatchList matches={upcoming.slice(0, 4)} empty="Расписание пока пустое" />
        </MotionReveal>

        {db.settings?.twitchChannel && (
          <MotionReveal className="arena-section">
            <SectionHead title="Трансляция" />
            <TwitchBlock channel={db.settings.twitchChannel} />
          </MotionReveal>
        )}

        <section className="arena-section">
          <div className="arena-section-head compact">
            <div><span>03</span><h2>Новости</h2></div>
            <Link to="/news">Все →</Link>
          </div>
          <div className="arena-news-grid">
            {news.slice(0, 3).map((item, index) => (
              <Link key={item.id} to={`/news/${item.id}`} className={index === 0 ? 'featured' : ''}>
                <div className="arena-news-cover" style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}>
                  <span>{item.tag}</span>
                </div>
                <div>
                  <small>{fmtDate(item.date, false)}</small>
                  <h3>{item.title}</h3>
                  <p>{item.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {!!db.highlights?.length && (
          <section className="arena-section">
            <SectionHead title="Хайлайты" />
            <div className="hl-grid">
              {db.highlights.slice(0, 4).map((highlight) => (
                <a key={highlight.id} className="hl-card" href={highlight.url || undefined}>
                  <div className="hl-thumb"><span className="hl-play">▶</span></div>
                  <div className="hl-body"><b>{highlight.title}</b><small>{fmtDate(highlight.date, false)}</small></div>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="arena-section arena-join">
          <div className="arena-section-head compact">
            <div><span>04</span><h2>Стать частью MSL</h2></div>
          </div>
          <div className="arena-join-grid">
            <Link to="/register?kind=team"><small>01</small><b>Заявить команду</b><span>Участвуйте в турнире или войдите в общий список лиги.</span><em>Подать заявку →</em></Link>
            <Link to="/league"><small>02</small><b>Подключить организацию</b><span>Представляйте вуз, клуб, кафедру или студенческое объединение.</span><em>Стать участником →</em></Link>
            <Link to="/register?kind=player"><small>03</small><b>Найти команду</b><span>Создайте профиль свободного игрока и заявите о себе.</span><em>В общий список →</em></Link>
          </div>
        </section>

        <section className="arena-section arena-partners">
          <SectionHead title="Партнёры" />
          <PartnerStrip />
        </section>

        <section className="cta-band arena-cta">
          <div>
            <span>JOIN THE LEAGUE</span>
            <h3>Собрали команду?</h3>
            <p>Подайте заявку — организатор добавит вас в сетку после подтверждения.</p>
          </div>
          <Link className="btn btn-white" to="/register">Подать заявку</Link>
        </section>
      </div>
    </div>
  )
}
