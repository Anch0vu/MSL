import { Link, useParams } from 'react-router-dom'
import { Empty, TeamLogo } from '../components/ui'
import { useDB } from '../lib/data'
import type { OrgKind } from '../lib/types'

export const orgKindLabel: Record<OrgKind, string> = {
  institute: 'Институт',
  club: 'Клуб',
  department: 'Кафедра',
  other: 'Организация',
}

export function Orgs() {
  const { db } = useDB()
  const orgs = db.orgs ?? []
  return (
    <div className="wrap page">
      <h1 className="page-title">Организации</h1>
      {orgs.length === 0 ? (
        <Empty>Организаций пока нет</Empty>
      ) : (
        <div className="team-grid">
          {orgs.map((o) => (
            <Link key={o.id} to={`/orgs/${o.id}`} className="team-card">
              <b>{o.short || o.name}</b>
              <small>
                {o.short ? o.name : orgKindLabel[o.kind]} · команд: {db.teams.filter((t) => t.orgId === o.id).length}
              </small>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function OrgPage() {
  const { id } = useParams()
  const { db, roster } = useDB()
  const o = db.orgs?.find((x) => x.id === id)
  if (!o) return <div className="wrap page"><Empty>Организация не найдена</Empty></div>
  const teams = db.teams.filter((t) => t.orgId === o.id)
  const players = teams.reduce((n, t) => n + roster(t.id).length, 0)
  return (
    <div className="wrap page tp" style={{ '--tc': '#0054b8' } as React.CSSProperties}>
      <div className="crumbs">
        <Link to="/orgs">Организации</Link> / {o.short || o.name}
      </div>
      <section className="panel tp-head">
        <div className="tp-banner" />
        <div className="tp-id">
          <span className="tp-orgmark">{(o.short || o.name).slice(0, 4)}</span>
          <div className="tp-title">
            <div className="tp-game">
              <i />
              {orgKindLabel[o.kind]}
            </div>
            <h1>{o.name}</h1>
          </div>
          {o.site && (
            <div className="tp-links">
              <a href={o.site} target="_blank" rel="noreferrer" className="tp-btn">
                Сайт
              </a>
            </div>
          )}
        </div>
        <dl className="tp-facts">
          <div>
            <dt>Команд</dt>
            <dd>{teams.length}</dd>
          </div>
          <div>
            <dt>Игроков</dt>
            <dd>{players}</dd>
          </div>
        </dl>
      </section>
      {o.description && (
        <section className="panel pad">
          <div className="panel-head">Об организации</div>
          <p>{o.description}</p>
        </section>
      )}
      <h2>Команды</h2>
      {teams.length === 0 ? (
        <Empty>Команд пока нет</Empty>
      ) : (
        <div className="team-grid">
          {teams.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} className="team-card">
              <TeamLogo team={t} size={56} />
              <b>{t.name}</b>
              <small>{roster(t.id).length} игроков</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
