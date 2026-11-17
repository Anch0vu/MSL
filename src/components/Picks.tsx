import { useEffect, useState } from 'react'
import { useAccount } from '../lib/account'
import { api, useData, useDB } from '../lib/data'

type Choice = 'radiant' | 'dire' | 'first' | 'second'

interface PickGame {
  game: number
  chooser: string
  toss: boolean
  c1: Choice
  c2: Choice
  result: Record<string, { side: Choice; order: Choice }>
}

interface PickState {
  next: { game: number; chooser: string | null; toss: boolean; c1: Choice | null; c2: Choice | null; step: 'toss' | 'c1' | 'c2' | 'done' } | null
  games: PickGame[]
  played: number
  side: 'a' | 'b' | null
  referee: boolean
}

const LABEL: Record<Choice, string> = { radiant: 'Radiant', dire: 'Dire', first: 'первый пик', second: 'второй пик' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Жеребьёвка и выбор стороны / очерёдности пика перед каждой игрой серии. */
export function Picks({ tid, stageId, mkey, a, b, status }: { tid: string; stageId: string; mkey: string; a: string; b: string; status: string }) {
  const { team } = useDB()
  const { readonly } = useData()
  const { user } = useAccount()
  const [st, setSt] = useState<PickState | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const q = `t=${encodeURIComponent(tid)}&s=${encodeURIComponent(stageId)}&k=${encodeURIComponent(mkey)}`
  const load = () => api<PickState>('picks', { query: q }).then(setSt, () => setSt(null))
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, user?.id, status])
  if (!st || (!st.next && !st.games.length)) return null
  const nx = st.next && st.next.step !== 'done' ? st.next : null
  const mine = st.side ? (st.side === 'a' ? a : b) : null
  const other = nx?.chooser ? (nx.chooser === a ? b : a) : null
  const name = (id: string | null) => (id ? team(id)?.name ?? id : '')
  const isSide = nx?.c1 === 'radiant' || nx?.c1 === 'dire'
  const post = async (route: string, body: object) => {
    setMsg('')
    setBusy(true)
    try {
      await api(route, { method: 'POST', body: { t: tid, s: stageId, k: mkey, ...body } })
      await load()
    } catch (e) {
      setMsg(err(e))
    }
    setBusy(false)
  }
  const opts = (list: Choice[]) => (
    <div className="pk-opts">
      {list.map((c) => (
        <button key={c} className="btn btn-ghost" disabled={busy} onClick={() => post('pickside', { choice: c })}>
          {cap(LABEL[c])}
        </button>
      ))}
    </div>
  )
  return (
    <section className="panel pad mo-picks">
      <div className="mo-head">
        <b>Стороны и пики</b>
        <span className="muted small">Игра 1 — монетка, дальше выбирает проигравший прошлую игру: сторону или очерёдность пика, соперник берёт оставшееся.</span>
      </div>
      {st.games.map((g) => (
        <div key={g.game} className="pk-row">
          <span className="pk-game">Игра {g.game}</span>
          {[a, b].map((id) =>
            g.result[id] ? (
              <span key={id} className="pk-team">
                <b>{name(id)}</b> {LABEL[g.result[id].side]}, {LABEL[g.result[id].order]}
              </span>
            ) : null,
          )}
          <small className="muted">выбирала {name(g.chooser)}{g.toss ? ' (монетка)' : ''}</small>
          {st.referee && !readonly && (
            <button className="btn-x" title="Сбросить выбор на эту игру" onClick={() => window.confirm(`Сбросить выбор на игру ${g.game}?`) && post('pickreset', { game: g.game })}>
              ✕
            </button>
          )}
        </div>
      ))}
      {nx && (
        <div className="pk-next">
          <span className="pk-game">Игра {nx.game}</span>
          {nx.step === 'toss' && (
            <>
              <span>Кто выбирает, решит монетка.</span>
              {(mine || st.referee) && !readonly && (
                <button className="btn btn-accent" disabled={busy} onClick={() => post('picktoss', {})}>
                  🪙 Бросить монетку
                </button>
              )}
            </>
          )}
          {nx.step === 'c1' && (
            <>
              <span>
                Выбирает <b>{name(nx.chooser)}</b> {nx.toss ? '(выиграла монетку)' : '(проиграла прошлую игру)'}: сторону или очерёдность пика.
              </span>
              {(mine === nx.chooser || st.referee) && !readonly && opts(['radiant', 'dire', 'first', 'second'])}
            </>
          )}
          {nx.step === 'c2' && (
            <>
              <span>
                <b>{name(nx.chooser)}</b> берёт: {LABEL[nx.c1!]}. Теперь <b>{name(other)}</b> выбирает {isSide ? 'очерёдность пика' : 'сторону'}.
              </span>
              {(mine === other || st.referee) && !readonly && opts(isSide ? ['first', 'second'] : ['radiant', 'dire'])}
            </>
          )}
        </div>
      )}
      {msg && <div className="error">{msg}</div>}
    </section>
  )
}
