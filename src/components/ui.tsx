import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Seed, Team, TournamentStatus } from '../lib/types'
import { avatarUrl, teamMediaUrl, useDB } from '../lib/data'
import type { Player } from '../lib/types'
import { avatarFx, personaVars } from '../lib/persona'

/** Круглый аватар игрока: загруженная картинка или первая буква ника. */
export function PlayerAvatar({ p, cls = '', color }: { p: Player; cls?: string; color?: string }) {
  const url = avatarUrl(p)
  const fx = avatarFx(p)
  const av = (
    <span className={`avatar ${cls}`} style={color ? ({ '--tc': color } as React.CSSProperties) : undefined}>
      {url ? <img src={url} alt="" loading="lazy" /> : p.nick[0]?.toUpperCase()}
    </span>
  )
  if (!fx) return av
  return (
    <span className={`avf ${fx}`} style={personaVars(p, color)}>
      {av}
    </span>
  )
}

export function TeamLogo({ team, size = 32 }: { team?: Team; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.34, '--tc': team?.color ?? '#3a4658' } as React.CSSProperties
  const img = teamMediaUrl(team, 'logo')
  return (
    <span className={`logo ${team ? '' : 'logo-empty'}${img ? ' logo-img' : ''}`} style={style} aria-hidden>
      {img ? <img src={img} alt="" loading="lazy" /> : team ? team.tag.slice(0, 3) : '?'}
    </span>
  )
}

export function TeamName({ id, hint, link = true, logo = 24 }: { id: Seed; hint?: string; link?: boolean; logo?: number }) {
  const { team } = useDB()
  const t = team(id)
  if (id === 'BYE') return <span className="tn muted">—</span>
  if (!t)
    return (
      <span className="tn muted">
        <TeamLogo size={logo} />
        <span className="tn-text">{hint ?? 'TBD'}</span>
      </span>
    )
  const inner = (
    <>
      <TeamLogo team={t} size={logo} />
      <span className="tn-text">{t.name}</span>
    </>
  )
  return link ? (
    <Link className="tn" to={`/teams/${t.id}`} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className="tn">{inner}</span>
  )
}

const statusText: Record<TournamentStatus, string> = {
  upcoming: 'Скоро',
  registration: 'Регистрация',
  live: 'Идёт',
  finished: 'Завершён',
}

export function StatusBadge({ status }: { status: TournamentStatus | 'scheduled' | 'waiting' | 'bye' }) {
  const text =
    status === 'scheduled' ? 'Запланирован' : status === 'waiting' ? 'Ожидание' : status === 'bye' ? 'Без игры' : statusText[status]
  return <span className={`badge badge-${status}`}>{status === 'live' && <i className="pulse" />}{text}</span>
}

export function SectionHead({ title, link, linkText = 'Все' }: { title: string; link?: string; linkText?: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {link && (
        <Link to={link} className="more">
          {linkText} →
        </Link>
      )}
    </div>
  )
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>)
    else {
      const href = /^(https?:|mailto:|\/|#)/.test(m[3]) ? m[3] : '#'
      out.push(
        <a key={m.index} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {m[2]}
        </a>,
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Минимальный Markdown: ## / ### заголовки, списки "- ", абзацы, **жирный**, [ссылки](url). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      )
    para = []
    list = []
  }
  for (const line of lines) {
    const l = line.trim()
    if (!l) flush()
    else if (l.startsWith('### ')) {
      flush()
      blocks.push(<h3 key={blocks.length}>{inline(l.slice(4))}</h3>)
    } else if (l.startsWith('## ')) {
      flush()
      blocks.push(<h2 key={blocks.length}>{inline(l.slice(3))}</h2>)
    } else if (l.startsWith('- ')) {
      if (para.length) flush()
      list.push(l.slice(2))
    } else {
      if (list.length) flush()
      para.push(l)
    }
  }
  flush()
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
