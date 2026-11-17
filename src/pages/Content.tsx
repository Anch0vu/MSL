import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Empty, Markdown } from '../components/ui'
import { useDB } from '../lib/data'
import { fmtDate } from '../lib/matches'

export function News() {
  const { db } = useDB()
  const [tag, setTag] = useState('')
  const tags = [...new Set(db.news.map((n) => n.tag))]
  const list = [...db.news].filter((n) => !tag || n.tag === tag).sort((a, b) => b.date.localeCompare(a.date))
  return (
    <div className="wrap page">
      <h1 className="page-title">Новости</h1>
      <div className="seg">
        <button className={!tag ? 'on' : ''} onClick={() => setTag('')}>
          Все
        </button>
        {tags.map((t) => (
          <button key={t} className={tag === t ? 'on' : ''} onClick={() => setTag(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="news-grid list">
        {list.map((n) => (
          <Link key={n.id} to={`/news/${n.id}`} className="news-card">
            <div className="news-cover" aria-hidden style={n.cover ? { backgroundImage: `url(${n.cover})` } : undefined}>
              <span>{n.tag}</span>
            </div>
            <div className="news-body">
              <div className="news-meta">
                <span className="tag">{n.tag}</span>
                <span>{fmtDate(n.date, false)}</span>
              </div>
              <h3>{n.title}</h3>
              <p>{n.excerpt}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function Article() {
  const { id = '' } = useParams()
  const { db, tournament } = useDB()
  const n = db.news.find((x) => x.id === id)
  if (!n) return <div className="wrap page"><Empty>Новость не найдена</Empty></div>
  const t = tournament(n.tournamentId)
  const more = db.news.filter((x) => x.id !== n.id).slice(0, 3)
  return (
    <div className="wrap page article">
      <div className="crumbs">
        <Link to="/news">Новости</Link> / {n.tag}
      </div>
      <h1>{n.title}</h1>
      <div className="news-meta">
        <span className="tag">{n.tag}</span>
        <span>{fmtDate(n.date, false)}</span>
        {t && <Link to={`/t/${t.id}`}>{t.name}</Link>}
      </div>
      <p className="lead">{n.excerpt}</p>
      <Markdown text={n.body} />
      {more.length > 0 && (
        <div className="article-more">
          <h4>Ещё новости</h4>
          {more.map((x) => (
            <Link key={x.id} to={`/news/${x.id}`} className="news-line">
              <span className="tag">{x.tag}</span> {x.title}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function Rules() {
  const { db } = useDB()
  return (
    <div className="wrap page article">
      <h1>Регламент</h1>
      <p className="lead">Общие правила для всех турниров лиги. Отдельные турниры могут дополнять их на своей странице.</p>
      <Markdown text={db.rules} />
    </div>
  )
}
