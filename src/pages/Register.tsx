import { useState } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../config'
import { useAccount } from '../lib/account'
import { api, useData, useDB } from '../lib/data'

type Kind = 'team' | 'player'
interface Row {
  nick: string
  role: string
  twitch: string
}

const emptyRows = (): Row[] => Array.from({ length: 5 }, (_, i) => ({ nick: '', role: i === 0 ? 'Капитан' : 'Игрок', twitch: '' }))

export function Register() {
  const { db } = useDB()
  const { mode } = useData()
  const { user } = useAccount()
  const open = db.tournaments.filter((t) => t.status === 'registration' || t.status === 'upcoming')
  const closed = db.settings?.registrationOpen === false
  const [kind, setKind] = useState<Kind>('team')
  const [tid, setTid] = useState(open[0]?.id ?? '')
  const [team, setTeam] = useState({ name: '', tag: '' })
  const [rows, setRows] = useState<Row[]>(emptyRows)
  const [f, setF] = useState({ faculty: '', contact: '', comment: '', nick: '', role: '', twitch: '', course: '', website: '', orgId: user?.orgId ?? '' })
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; msg?: string; auto?: boolean; teamId?: string }>({ status: 'idle' })
  const [copied, setCopied] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const setRow = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const tour = db.tournaments.find((t) => t.id === tid)

  const payload =
    kind === 'team'
      ? { kind, tournamentId: tid, team, players: rows.filter((r) => r.nick.trim()), captain: rows[0]?.nick, faculty: f.faculty, orgId: f.orgId, contact: f.contact, comment: f.comment, website: f.website }
      : { kind, tournamentId: tid, nick: f.nick, role: f.role, twitch: f.twitch, course: Number(f.course) || 0, faculty: f.faculty, orgId: f.orgId, contact: f.contact, comment: f.comment, website: f.website }

  const valid =
    f.contact.trim() &&
    (kind === 'team' ? team.name.trim() && team.tag.trim() && rows.filter((r) => r.nick.trim()).length >= 1 : f.nick.trim())

  const asText = () =>
    kind === 'team'
      ? `Заявка команды на «${tour?.name ?? '—'}»\nКоманда: ${team.name} [${team.tag}]\nИнститут: ${f.faculty}\nКонтакт: ${f.contact}\nСостав:\n${rows
          .filter((r) => r.nick)
          .map((r) => `- ${r.nick} (${r.role})${r.twitch ? ` twitch.tv/${r.twitch}` : ''}`)
          .join('\n')}\n${f.comment}`
      : `Заявка игрока\nНик: ${f.nick}\nРоль: ${f.role}\nКурс: ${f.course}\nИнститут: ${f.faculty}\nКонтакт: ${f.contact}\n${f.comment}`

  const submit = async () => {
    setState({ status: 'sending' })
    try {
      const r = await api<{ auto?: boolean; teamId?: string }>('apply', { method: 'POST', body: payload })
      setState({ status: 'done', auto: r.auto, teamId: r.teamId })
    } catch (e) {
      setState({ status: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  if (state.status === 'done')
    return (
      <div className="wrap page narrow">
        <div className="panel pad done-panel">
          <h1>{state.auto ? 'Готово' : 'Заявка отправлена'}</h1>
          {state.auto ? (
            <p>{kind === 'team' ? 'Команда уже на сайте.' : 'Профиль уже в списке игроков.'} Оформление, логотип и роли меняются в кабинете.</p>
          ) : (
            <p>Организатор проверит её и свяжется с вами по контакту «{f.contact}». После подтверждения {kind === 'team' ? 'команда появится в списке участников' : 'профиль появится в списке игроков'}. Войдите в аккаунт перед отправкой, и заявка пройдёт сразу.</p>
          )}
          <div className="form-actions">
            {state.teamId && (
              <Link className="btn btn-accent" to={`/teams/${state.teamId}`}>
                Страница команды
              </Link>
            )}
            <Link className={state.teamId ? 'btn btn-ghost' : 'btn btn-accent'} to="/">
              На главную
            </Link>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setState({ status: 'idle' })
                setTeam({ name: '', tag: '' })
                setRows(emptyRows())
              }}
            >
              Ещё одна заявка
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="wrap page narrow">
      <h1 className="page-title">Регистрация</h1>
      <p className="muted">
        Команда уже есть на сайте? Регистрировать заново не нужно: капитан забирает её в <Link to="/account">Кабинете</Link> → «Моя команда» → «Это моя команда».
      </p>
      {closed ? (
        <div className="empty">Приём заявок сейчас закрыт.</div>
      ) : (
        <>
          <div className="seg">
            <button className={kind === 'team' ? 'on' : ''} onClick={() => setKind('team')}>
              Команда
            </button>
            <button className={kind === 'player' ? 'on' : ''} onClick={() => setKind('player')}>
              Игрок без команды
            </button>
          </div>
          <div className="panel pad form">
            <label>
              Турнир
              <select value={tid} onChange={(e) => setTid(e.target.value)}>
                {open.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.teams.length}/{t.maxTeams})
                  </option>
                ))}
                <option value="">Без турнира / в общий список</option>
              </select>
            </label>

            {kind === 'team' ? (
              <>
                <div className="form-row">
                  <label>
                    Название команды *
                    <input value={team.name} maxLength={60} onChange={(e) => setTeam({ ...team, name: e.target.value })} />
                  </label>
                  <label style={{ maxWidth: 160 }}>
                    Тег, 2–4 символа *
                    <input value={team.tag} maxLength={4} onChange={(e) => setTeam({ ...team, tag: e.target.value.toUpperCase() })} />
                  </label>
                </div>
                <div className="roster-edit">
                  <div className="roster-edit-head">
                    <span>Ник *</span>
                    <span>Роль</span>
                    <span>Twitch</span>
                  </div>
                  {rows.map((r, i) => (
                    <div key={i} className="roster-edit-row">
                      <input placeholder={i === 0 ? 'Капитан' : `Игрок ${i + 1}`} value={r.nick} maxLength={32} onChange={(e) => setRow(i, 'nick', e.target.value)} />
                      <input value={r.role} maxLength={32} onChange={(e) => setRow(i, 'role', e.target.value)} />
                      <input placeholder="логин" value={r.twitch} maxLength={40} onChange={(e) => setRow(i, 'twitch', e.target.value)} />
                    </div>
                  ))}
                  {rows.length < 8 && (
                    <button className="btn btn-ghost" onClick={() => setRows([...rows, { nick: '', role: 'Запасной', twitch: '' }])}>
                      + Запасной
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="form-row">
                <label>
                  Ник *
                  <input value={f.nick} maxLength={32} onChange={set('nick')} />
                </label>
                <label>
                  Роль / позиция
                  <input value={f.role} maxLength={32} onChange={set('role')} />
                </label>
                <label style={{ maxWidth: 120 }}>
                  Курс
                  <input type="number" min={1} max={6} value={f.course} onChange={set('course')} />
                </label>
                <label>
                  Twitch
                  <input placeholder="логин" value={f.twitch} maxLength={40} onChange={set('twitch')} />
                </label>
              </div>
            )}

            <div className="form-row">
              <label>
                Организация
                <select
                  value={f.orgId}
                  onChange={(e) => {
                    const o = db.orgs?.find((x) => x.id === e.target.value)
                    setF({ ...f, orgId: e.target.value, faculty: o ? o.short || o.name : f.faculty })
                  }}
                >
                  <option value="">—</option>
                  {(db.orgs ?? []).filter((o) => !o.closed).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Контакт для связи (Telegram / Discord) *
                <input value={f.contact} maxLength={120} onChange={set('contact')} />
              </label>
            </div>
            <label>
              Комментарий
              <textarea rows={3} value={f.comment} maxLength={500} onChange={set('comment')} />
            </label>
            {/* поле-ловушка для ботов, скрыто от людей */}
            <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden />

            {!user && mode === 'api' && kind === 'team' && (
              <p className="muted small">
                Чтобы управлять командой после одобрения, <Link to="/account">войдите в кабинет</Link> до отправки заявки.
              </p>
            )}
            {state.status === 'error' && <div className="error">{state.msg}</div>}
            <div className="form-actions">
              {mode === 'api' ? (
                <button className="btn btn-accent" disabled={!valid || state.status === 'sending'} onClick={submit}>
                  {state.status === 'sending' ? 'Отправляем…' : 'Отправить заявку'}
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-accent"
                    disabled={!valid}
                    onClick={() => navigator.clipboard?.writeText(asText()).then(() => setCopied(true), () => setCopied(false))}
                  >
                    {copied ? 'Скопировано' : 'Скопировать заявку'}
                  </button>
                  {config.registrationUrl && (
                    <a className="btn btn-ghost" href={config.registrationUrl} target="_blank" rel="noreferrer">
                      Отправить организатору
                    </a>
                  )}
                </>
              )}
              <span className="muted small">Поля со * обязательны. Заявку проверяет организатор.</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
