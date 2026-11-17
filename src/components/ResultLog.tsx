import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useData, useDB } from '../lib/data'
import { allMatches, matchHref } from '../lib/matches'

interface Score {
  status: string
  a: number | null
  b: number | null
}

interface LogRow {
  id: number
  t: string
  s: string
  k: string
  actor: string
  source: string
  from: Score
  to: Score
  note: string
  at: string
}

const fmt = (x: Score) => (x.a != null && x.b != null ? `${x.a}:${x.b}, ${x.status}` : x.status)
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Публичный журнал: кто, когда и откуда менял счёт и статус матча. */
export function ResultLog({ tid, stageId, mkey, title = 'История результата' }: { tid: string; stageId?: string; mkey?: string; title?: string }) {
  const { mode } = useData()
  const { db, team } = useDB()
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [open, setOpen] = useState(false)
  const q = `t=${encodeURIComponent(tid)}${stageId && mkey ? `&s=${encodeURIComponent(stageId)}&k=${encodeURIComponent(mkey)}` : ''}`
  useEffect(() => {
    if (mode !== 'api') return
    api<LogRow[]>('resultlog', { query: q }).then(setRows, () => setRows([]))
  }, [q, mode, db])
  if (!rows?.length) return null
  const ms = mkey ? [] : allMatches(db)
  const label = (r: LogRow) => {
    const m = ms.find((x) => x.tid === r.t && x.stageId === r.s && x.key === r.k)
    return m ? `${team(m.a)?.tag || team(m.a)?.name || 'TBD'} — ${team(m.b)?.tag || team(m.b)?.name || 'TBD'}` : r.k
  }
  return (
    <section className="rlog">
      <button className="rlog-toggle" onClick={() => setOpen((o) => !o)}>
        {title} ({rows.length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="panel rlog-panel">
          <table className="table rlog-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="left muted small">{when(r.at)}</td>
                  {!mkey && (
                    <td className="left">
                      <Link to={matchHref({ tid: r.t, stageId: r.s, key: r.k })}>{label(r)}</Link>
                    </td>
                  )}
                  <td className="left">
                    <span className="muted">{fmt(r.from)}</span> → <b>{fmt(r.to)}</b>
                    {r.note && <small className="muted rlog-note">{r.note}</small>}
                  </td>
                  <td className="left">
                    {r.actor}
                    <small className="muted"> · {r.source}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
