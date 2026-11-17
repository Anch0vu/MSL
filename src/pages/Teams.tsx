import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MatchList } from '../components/MatchList'
import { Empty, PlayerAvatar, SectionHead, StatusBadge, TeamLogo, TeamName } from '../components/ui'
import { avatarUrl, teamMediaUrl, useDB } from '../lib/data'
import { config } from '../config'
import { RoleIcon, roleDef } from '../lib/roles'
import { allMatches, byDate, type MatchView } from '../lib/matches'
import { dotabuffUrl, opendotaUrl, rankLabel } from '../lib/dota'
import type { GameEntry, Player } from '../lib/types'
import { TrophyShelf } from '../components/Trophy'
import { gameDef, gameName, tourGame } from '../lib/games'
import { SteamStats, useGameStats } from '../components/SteamStats'
import { BADGE_DEFS, headClass, nickClass, personaVars } from '../lib/persona'
import { VoidSoundMark } from '../components/VoidSound'
import { deadlockRank, faceitColor, premierColor } from '../lib/ranks'
import { ShareButton } from '../components/Share'
import { CalendarLink } from '../components/Calendar'

/** Среднее по заполненным значениям (0 и пустые не считаются). */
const avgOf = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && x > 0)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function Teams() {
  const { db, roster } = useDB()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'' | 'name' | 'faceit' | 'mmr'>('')
  const list = db.teams
    .filter((t) => `${t.name} ${t.tag} ${t.faculty ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .map((t) => {
      const r = roster(t.id)
      return { t, n: r.length, fc: avgOf(r.map((p) => p.faceitLevel)), mmr: avgOf(r.map((p) => p.mmr)) }
    })
    .sort((x, y) => (sort === 'faceit' ? (y.fc ?? -1) - (x.fc ?? -1) : sort === 'mmr' ? (y.mmr ?? -1) - (x.mmr ?? -1) : sort === 'name' ? x.t.name.localeCompare(y.t.name, 'ru') : 0))
  return (
    <div className="wrap page">
      <div className="page-title-row">
        <h1 className="page-title">Команды</h1>
        <div className="list-tools">
          <select className="search sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка">
            <option value="">По порядку</option>
            <option value="name">По названию</option>
            <option value="faceit">По FACEIT состава</option>
            <option value="mmr">По ММР состава</option>
          </select>
          <input className="search" placeholder="Поиск команды" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="team-grid">
        {list.map(({ t, n, fc, mmr }) => (
          <Link key={t.id} to={`/teams/${t.id}`} className="team-card">
            <TeamLogo team={t} size={56} />
            <b>{t.name}</b>
            <small>
              {db.orgs?.find((o) => o.id === t.orgId)?.short || t.faculty} · {n} игроков
            </small>
            {(fc != null || mmr != null) && (
              <span className="team-avg">
                {fc != null && (
                  <i className="fc-avg" style={{ '--lvl': faceitColor(Math.round(fc)) } as React.CSSProperties} title="Средний уровень FACEIT состава">
                    FACEIT {fc.toFixed(1)}
                  </i>
                )}
                {mmr != null && <span title="Средний ММР состава">ММР {Math.round(mmr)}</span>}
              </span>
            )}
          </Link>
        ))}
      </div>
      {!list.length && <Empty>Ничего не найдено</Empty>}
    </div>
  )
}

type TeamTab = 'info' | 'roster' | 'matches' | 'events'

/** Силуэт игрока без фото, как в составах на HLTV. */
function Silhouette() {
  return (
    <svg viewBox="0 0 100 120" className="tp-sil" aria-hidden>
      <path d="M50 14c-12 0-20 9-20 21 0 8 3 14 8 18-14 4-24 14-26 30l-2 37h80l-2-37c-2-16-12-26-26-30 5-4 8-10 8-18 0-12-8-21-20-21z" fill="currentColor" />
    </svg>
  )
}

export function TeamPage() {
  const { id = '' } = useParams()
  const { db, team, roster, player } = useDB()
  const [tab, setTab] = useState<TeamTab>('info')
  const t = team(id)
  if (!t) return <div className="wrap page"><Empty>Команда не найдена</Empty></div>
  const matches = allMatches(db).filter((m) => m.a === t.id || m.b === t.id)
  const finished = matches.filter((m) => m.status === 'finished')
  const wins = finished.filter((m) => (m.a === t.id ? (m.scoreA ?? 0) > (m.scoreB ?? 0) : (m.scoreB ?? 0) > (m.scoreA ?? 0))).length
  const tours = db.tournaments.filter((x) => x.teams.includes(t.id))
  const captain = player(t.captainId)
  const org = db.orgs?.find((o) => o.id === t.orgId)
  const game = t.game ? gameName(t.game) : tours[0] ? tourGame(tours[0]) : config.game
  const awards = (db.awards ?? []).filter((a) => a.teamId === t.id && !a.playerId)
  const banner = teamMediaUrl(t, 'banner')
  const players = roster(t.id).sort((a, b) => roleOrder(a.role) - roleOrder(b.role))
  const recent = [...matches].sort(byDate).reverse()
  const tabs: [TeamTab, string][] = [
    ['info', 'Обзор'],
    ['roster', `Состав (${players.length})`],
    ['matches', `Матчи (${matches.length})`],
    ['events', `Турниры (${tours.length})`],
  ]

  const card = (p: Player) => {
    const r = roleDef(p.role)
    const photo = avatarUrl(p)
    const rank = rankLabel(p.rankTier, p.leaderboard)
    return (
      <Link key={p.id} to={`/players/${p.id}`} className="tp-card" style={{ '--rc': r.color } as React.CSSProperties}>
        <div className="tp-photo">
          {photo ? <img src={photo} alt="" loading="lazy" /> : <Silhouette />}
          {p.id === captain?.id && (
            <span className="tp-cap" title="Капитан">
              ♛
            </span>
          )}
        </div>
        <div className="tp-pbody">
          <b>{p.nick}</b>
          <span className="tp-role">
            <RoleIcon k={r.key} />
            {r.label || 'Игрок'}
          </span>
          {(rank || p.csPremier != null) && <small>{rank ? `${rank}${p.mmr != null ? ` · ${p.mmr}` : ''}` : `Premier ${p.csPremier?.toLocaleString('ru-RU')}`}</small>}
          {p.faceitLevel != null && (
            <small className="tp-fc">
              <i className="faceit-lvl sm" style={{ '--lvl': faceitColor(p.faceitLevel) } as React.CSSProperties}>
                {p.faceitLevel}
              </i>
              FACEIT{p.faceitElo ? ` · ${p.faceitElo}` : ''}
            </small>
          )}
        </div>
      </Link>
    )
  }

  return (
    <div className="wrap page tp" style={{ '--tc': t.color ?? '#0054b8' } as React.CSSProperties}>
      <div className="crumbs">
        <Link to="/teams">Команды</Link> / {t.tag}
      </div>
      <section className="panel tp-head">
        <div className={`tp-banner${banner ? ' has-img' : ''}`} style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
          {t.slogan && <span className="tp-slogan">{t.slogan}</span>}
        </div>
        <div className="tp-id">
          <TeamLogo team={t} size={96} />
          <div className="tp-title">
            <div className="tp-game">
              <i />
              {game}
              {org && (
                <>
                  {' · '}
                  <Link to={`/orgs/${org.id}`}>{org.short || org.name}</Link>
                </>
              )}
            </div>
            <h1>{t.name}</h1>
            <span className="tp-tag">{t.tag}</span>
          </div>
          <ShareButton q={`team=${encodeURIComponent(t.id)}`} title={t.name} className="tp-btn tp-share" />
          <CalendarLink q={`team=${encodeURIComponent(t.id)}`} className="tp-btn tp-share" />
          {t.links && t.links.length > 0 && (
            <div className="tp-links">
              {t.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="tp-btn">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <dl className="tp-facts">
          <div>
            <dt>{org ? 'Организация' : 'Институт'}</dt>
            <dd>{org ? org.short || org.name : t.faculty || '—'}</dd>
          </div>
          <div>
            <dt>Капитан</dt>
            <dd>{captain ? <Link to={`/players/${captain.id}`}>{captain.nick}</Link> : '—'}</dd>
          </div>
          <div>
            <dt>Матчи</dt>
            <dd>
              {wins}–{finished.length - wins}
              <span className="muted"> · {finished.length ? Math.round((wins / finished.length) * 100) : 0}%</span>
            </dd>
          </div>
          <div>
            <dt>Трофеи</dt>
            <dd>{awards.length ? `🏆 ${awards.length}` : '—'}</dd>
          </div>
          {t.founded && (
            <div>
              <dt>Основана</dt>
              <dd>{t.founded}</dd>
            </div>
          )}
          {t.contact && (
            <div>
              <dt>Контакт</dt>
              <dd>{t.contact}</dd>
            </div>
          )}
        </dl>
      </section>

      <nav className="tp-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'info' && (
        <div className="layout-2">
          <div className="col-main">
            {t.about && (
              <section className="panel pad">
                <div className="panel-head">О команде</div>
                <p>{t.about}</p>
              </section>
            )}
            <section>
              <SectionHead title="Состав" />
              {players.length ? <div className="tp-strip">{players.map(card)}</div> : <div className="empty small">Состав пока не заполнен</div>}
            </section>
            <section>
              <SectionHead title="Последние матчи" />
              <MatchList matches={recent.slice(0, 5)} />
            </section>
          </div>
          <aside className="col-side">
            {awards.length > 0 && (
              <section className="panel pad">
                <div className="panel-head">Награды</div>
                <TrophyShelf db={db} awards={awards} />
              </section>
            )}
            <section className="panel">
              <div className="panel-head">Турниры</div>
              {tours.map((x) => (
                <Link key={x.id} to={`/t/${x.id}`} className="side-tour">
                  <b>{x.name}</b>
                  <StatusBadge status={x.status} />
                </Link>
              ))}
              {!tours.length && <div className="empty small">Пока нет</div>}
            </section>
          </aside>
        </div>
      )}

      {tab === 'roster' && (players.length ? <div className="tp-roster">{players.map(card)}</div> : <div className="empty">Состав пока не заполнен</div>)}

      {tab === 'matches' && <MatchList matches={recent} />}

      {tab === 'events' && (
        <section className="panel">
          {tours.map((x) => (
            <Link key={x.id} to={`/t/${x.id}`} className="side-tour">
              <b>{x.name}</b>
              <StatusBadge status={x.status} />
            </Link>
          ))}
          {!tours.length && <div className="empty small">Пока нет</div>}
        </section>
      )}
    </div>
  )
}

/** Порядок в составе: 1–5 позиции, затем остальные. */
const ROLE_ORDER = ['carry', 'mid', 'offlane', 'soft', 'hard', 'other']
const roleOrder = (role?: string) => ROLE_ORDER.indexOf(roleDef(role).key)

/** ММР игрока; подтверждённый OpenDota помечен. */
function Mmr({ p }: { p: Player }) {
  if (p.mmr == null) return null
  return (
    <span className="mmr" title={p.mmrVerified ? 'Подтверждено OpenDota' : 'Указано игроком'}>
      {p.mmr}
      {p.mmrVerified && <i className="mmr-ok">✓</i>}
    </span>
  )
}

/** Premier и уровень FACEIT игрока (подтягиваются из Steam). */
function CsRank({ p }: { p: Player }) {
  if (p.csPremier == null && p.faceitLevel == null) return null
  return (
    <span className="cs-rank">
      {p.faceitLevel != null && (
        <i className="faceit-lvl sm" style={{ '--lvl': faceitColor(p.faceitLevel) } as React.CSSProperties} title={`FACEIT ${p.faceitLevel}${p.faceitElo ? ` · ${p.faceitElo} ELO` : ''}`}>
          {p.faceitLevel}
        </i>
      )}
      {p.csPremier != null && (
        <b className="premier" style={{ '--pc': premierColor(p.csPremier) } as React.CSSProperties} title="CS2 Premier">
          {p.csPremier.toLocaleString('ru-RU')}
        </b>
      )}
    </span>
  )
}

/** Ранг в игре для карточки «Игры»: Dota — медаль, CS2 — Premier/FACEIT, Deadlock — значок. */
function autoRank(p: Player, g: string, dota: string) {
  if (g === 'dota2') return p.rankTier ? dota : ''
  if (g === 'cs2') return [p.csPremier != null && `Premier ${p.csPremier.toLocaleString('ru-RU')}`, p.faceitLevel != null && `FACEIT ${p.faceitLevel}`].filter(Boolean).join(' · ')
  if (g === 'deadlock') return deadlockRank(p.dlBadge)
  return ''
}

export function Players({ agents = false }: { agents?: boolean }) {
  const { db, team } = useDB()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'' | 'mmr' | 'faceit' | 'premier' | 'nick'>(agents ? 'mmr' : '')
  const base = agents ? db.players.filter((p) => !p.teamId && (p.lft || p.role === 'Свободный игрок')) : db.players
  const list = base
    .filter((p) => `${p.nick} ${p.name ?? ''} ${p.role ?? ''} ${team(p.teamId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'mmr'
        ? (b.mmr ?? -1) - (a.mmr ?? -1)
        : sort === 'faceit'
          ? (b.faceitLevel ?? -1) - (a.faceitLevel ?? -1) || (b.faceitElo ?? 0) - (a.faceitElo ?? 0)
          : sort === 'premier'
            ? (b.csPremier ?? -1) - (a.csPremier ?? -1)
            : sort === 'nick'
              ? a.nick.localeCompare(b.nick, 'ru')
              : 0,
    )
  return (
    <div className="wrap page">
      <div className="page-title-row">
        <h1 className="page-title">{agents ? 'Свободные агенты' : 'Игроки'}</h1>
        <div className="list-tools">
          <select className="search sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка">
            <option value="">По порядку</option>
            <option value="nick">По нику</option>
            <option value="mmr">По ММР Dota 2</option>
            <option value="faceit">По FACEIT</option>
            <option value="premier">По CS2 Premier</option>
          </select>
          <input className="search" placeholder={agents ? 'Ник или позиция' : 'Ник или команда'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="seg">
        <Link to="/players" className={agents ? '' : 'on'}>
          Все игроки
        </Link>
        <Link to="/agents" className={agents ? 'on' : ''}>
          Ищут команду
        </Link>
      </div>
      {agents && <p className="muted small">Игроки без команды. Отметиться можно в личном кабинете галочкой «Ищу команду».</p>}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th className="left">Игрок</th>
              <th className="left">{agents ? 'О себе' : 'Команда'}</th>
              <th className="left hide-sm">Позиция</th>
              <th className="hide-sm">Рейтинг</th>
              <th className="left hide-sm">{agents ? 'Контакт' : 'Институт'}</th>
              {!agents && <th className="hide-sm">Курс</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="left">
                  <Link to={`/players/${p.id}`} className="tn">
                    <PlayerAvatar p={p} color={team(p.teamId)?.color} />
                    <b>{p.nick}</b>
                  </Link>
                </td>
                <td className="left">
                  {agents ? <span className="muted small">{p.lftNote || p.about}</span> : p.teamId ? <TeamName id={p.teamId} logo={20} /> : <span className="muted">Свободный агент</span>}
                </td>
                <td className="left hide-sm">{p.role}</td>
                <td className="hide-sm">
                  <Mmr p={p} />
                  {p.rankTier ? <div className="muted small">{rankLabel(p.rankTier, p.leaderboard)}</div> : null}
                  <CsRank p={p} />
                  {p.dlBadge ? <div className="muted small">Deadlock: {deadlockRank(p.dlBadge)}</div> : null}
                </td>
                <td className="left hide-sm">{agents ? [p.discord && `Discord: ${p.discord}`, p.contact].filter(Boolean).join(' · ') : p.faculty}</td>
                {!agents && <td className="hide-sm">{p.course}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty>{agents ? 'Сейчас никто не ищет команду' : 'Ничего не найдено'}</Empty>}
      </div>
    </div>
  )
}

interface TourStat {
  id: string
  name: string
  played: number
  wins: number
  mapsW: number
  mapsL: number
}

/** Итоги команды игрока по сыгранным матчам каждого турнира. */
function teamStats(matches: MatchView[], teamId: string, tours: { id: string; name: string }[]): TourStat[] {
  return tours.map((t) => {
    const fin = matches.filter((m) => m.tid === t.id && m.status === 'finished')
    let wins = 0
    let mapsW = 0
    let mapsL = 0
    for (const m of fin) {
      const my = m.a === teamId ? (m.scoreA ?? 0) : (m.scoreB ?? 0)
      const their = m.a === teamId ? (m.scoreB ?? 0) : (m.scoreA ?? 0)
      if (my > their) wins++
      mapsW += my
      mapsL += their
    }
    return { id: t.id, name: t.name, played: fin.length, wins, mapsW, mapsL }
  })
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export function PlayerPage() {
  const { id = '' } = useParams()
  const { db, player, team } = useDB()
  const p = player(id)
  const gs = useGameStats(p?.steamId)
  if (!p) return <div className="wrap page"><Empty>Игрок не найден</Empty></div>
  const dota = gs.s?.dota
  const t = team(p.teamId)
  const matches = t ? allMatches(db).filter((m) => m.a === t.id || m.b === t.id).sort(byDate).reverse() : []
  const played = t ? db.tournaments.filter((x) => x.teams.includes(t.id)) : []
  const stats = t ? teamStats(matches, t.id, played) : []
  const total = stats.reduce((a, x) => ({ played: a.played + x.played, wins: a.wins + x.wins }), { played: 0, wins: 0 })
  const org = db.orgs?.find((o) => o.name === p.faculty || o.short === p.faculty)
  const rank = rankLabel(p.rankTier, p.leaderboard)
  const games: GameEntry[] = [...(p.games ?? [])]
  if (p.rankTier && !games.some((g) => g.g === 'dota2')) games.push({ g: 'dota2' })
  if ((p.csPremier != null || p.faceitLevel != null) && !games.some((g) => g.g === 'cs2')) games.push({ g: 'cs2' })
  if (p.dlBadge && !games.some((g) => g.g === 'deadlock')) games.push({ g: 'deadlock' })
  const awards = (db.awards ?? []).filter((a) => a.playerId === p.id)
  const badges = [
    ...(p.badges ?? []),
    t && t.captainId === p.id && 'captain',
    awards.some((a) => a.tier === 'gold') && 'champion',
    db.tournaments.filter((x) => x.teams.some((tid) => tid === p.teamId)).length >= 3 && 'veteran',
    p.steamOk && 'steam',
  ].filter((b): b is string => !!b && !!BADGE_DEFS[b])
  return (
    <>
      <section className={headClass(p)} style={personaVars(p, t?.color)}>
        <div className="wrap profile-in">
          <PlayerAvatar p={p} cls="huge" />
          <div>
            <div className="crumbs">
              <Link to="/players">Игроки</Link> / {p.nick}
            </div>
            <h1 className={nickClass(p)}>
              {p.persona?.emoji && <span className="nick-emoji">{p.persona.emoji}</span>}
              <span>{p.nick}</span>
            </h1>
            {badges.length > 0 && (
              <div className="badges">
                {badges.map((b) => {
                  const d = BADGE_DEFS[b]
                  return (
                    <span key={b} className={`badge-p b-${b}`} title={d.desc} style={{ '--b1': d.c1, '--b2': d.c2 } as React.CSSProperties}>
                      {b === 'partner' ? <VoidSoundMark size={12} /> : <i>{d.emoji}</i>}
                      {d.name}
                    </span>
                  )
                })}
              </div>
            )}
            {p.tagline && <div className="profile-tagline">{p.tagline}</div>}
            <div className="profile-facts">
              {p.name && <span>{p.name}</span>}
              {p.role && <span>{p.role}</span>}
              {rank && <span>{rank}</span>}
              {awards.length > 0 && <span>🏆 {awards.length}</span>}
              {p.mmr != null && (
                <span>
                  ММР <Mmr p={p} />
                </span>
              )}
              {(p.csPremier != null || p.faceitLevel != null) && (
                <span>
                  CS2 <CsRank p={p} />
                </span>
              )}
              {p.faculty && <span>{p.faculty}</span>}
              {p.course && <span>{p.course} курс</span>}
              {t ? <TeamName id={t.id} logo={20} /> : <span>Свободный агент</span>}
            </div>
          </div>
          <div className="profile-stats">
            {dota ? (
              <>
                <div title="Все матчи Dota 2 по данным OpenDota">
                  <b>{(dota.win + dota.lose).toLocaleString('ru-RU')}</b>
                  <small>Матчей в Dota</small>
                </div>
                <div>
                  <b>{pct(dota.win, dota.win + dota.lose)}%</b>
                  <small>Винрейт</small>
                </div>
                {dota.avg ? (
                  <div title={`Средние за ${dota.avg.n} последних матчей`}>
                    <b>{((dota.avg.k + dota.avg.a) / Math.max(1, dota.avg.d)).toFixed(2)}</b>
                    <small>KDA</small>
                  </div>
                ) : (
                  <div>
                    <b>{total.played}</b>
                    <small>Матчей в лиге</small>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <b>{total.played}</b>
                  <small>Матчей в лиге</small>
                </div>
                <div>
                  <b>{total.wins}</b>
                  <small>Побед</small>
                </div>
                <div>
                  <b>{pct(total.wins, total.played)}%</b>
                  <small>Винрейт</small>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      <div className="wrap page">
        {p.lft && !t && (
          <div className="panel pad lft-banner">
            <b>Ищет команду</b>
            {p.lftNote && <span>{p.lftNote}</span>}
          </div>
        )}
        {p.about && <div className="panel pad">{p.about}</div>}
        {(p.contact || p.discord || p.twitch || p.steamId || p.links?.length || org) && (
          <div className="panel pad profile-contacts">
            {p.contact && <span>Telegram: {p.contact}</span>}
            {p.discord && <span>Discord: {p.discord}</span>}
            {p.twitch && (
              <a href={`https://twitch.tv/${p.twitch}`} target="_blank" rel="noreferrer">
                twitch.tv/{p.twitch}
              </a>
            )}
            {p.steamId && (
              <a href={dotabuffUrl(p.steamId)} target="_blank" rel="noreferrer">
                Dotabuff
              </a>
            )}
            {p.steamId && (
              <a href={opendotaUrl(p.steamId)} target="_blank" rel="noreferrer">
                OpenDota
              </a>
            )}
            {p.links?.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer nofollow">
                {l.label}
              </a>
            ))}
            {org && <Link to={`/orgs/${org.id}`}>{org.name}</Link>}
          </div>
        )}
        {games.length > 0 && (
          <>
            <SectionHead title="Игры" />
            <div className="game-grid">
              {games.map((g) => {
                const def = gameDef(g.g)
                const auto = autoRank(p, g.g, rank)
                return (
                  <div key={g.g} className={`game-card g-${g.g}${g.main ? ' main' : ''}`}>
                    <small>{g.main ? 'Основная игра' : 'Игра'}</small>
                    <b>{def?.name ?? g.g}</b>
                    {(auto || g.rank) && (
                      <span>
                        {auto || g.rank}
                        {auto && g.g === 'dota2' && p.mmr != null ? ` · ${p.mmr}` : ''}
                      </span>
                    )}
                    {g.role && <span className="muted">{g.role}</span>}
                    {g.url ? (
                      <a href={g.url} target="_blank" rel="noreferrer nofollow">
                        Профиль
                      </a>
                    ) : (
                      g.g === 'dota2' &&
                      p.steamId && (
                        <a href={dotabuffUrl(p.steamId)} target="_blank" rel="noreferrer">
                          Dotabuff
                        </a>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {p.steamId && (
          <>
            <SectionHead title="Статистика из Steam" />
            <SteamStats steamId={p.steamId} dotaRank={rank} mmr={p.mmr} data={gs} />
          </>
        )}
        {!p.steamId && p.userId && <div className="empty small">Статистика Dota 2, CS2 и Deadlock подтянется сама, когда игрок привяжет Steam в Кабинете.</div>}
        <SectionHead title="Награды" />
        <TrophyShelf db={db} awards={awards} empty="Наград пока нет" />
        <SectionHead title="Турниры" />
        {stats.length ? (
          <div className="panel">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Турнир</th>
                  <th className="left hide-sm">Команда</th>
                  <th>Матчи</th>
                  <th>В–П</th>
                  <th className="hide-sm">Карты</th>
                  <th>Винрейт</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((x) => (
                  <tr key={x.id}>
                    <td className="left">
                      <Link to={`/t/${x.id}`}>
                        <b>{x.name}</b>
                      </Link>
                    </td>
                    <td className="left hide-sm">{t && <TeamName id={t.id} logo={20} />}</td>
                    <td>{x.played}</td>
                    <td>
                      {x.wins}–{x.played - x.wins}
                    </td>
                    <td className="hide-sm">
                      {x.mapsW}–{x.mapsL}
                    </td>
                    <td>{x.played ? `${pct(x.wins, x.played)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Пока не участвовал в турнирах</Empty>
        )}
        <SectionHead title="Матчи команды" />
        <MatchList matches={matches} empty="Матчей пока нет" />
      </div>
    </>
  )
}
