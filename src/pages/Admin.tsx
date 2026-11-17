import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../config'
import { allBracketMatches, bracketPlacings } from '../lib/bracket'
import { GAMES } from '../lib/games'
import { TIERS, TrophyIcon } from '../components/Trophy'
import { TeamMediaEdit } from '../components/TeamMediaEdit'
import { api, isPreview, readDraft, setPreview, useData, writeDraft } from '../lib/data'
import { fmtDate } from '../lib/matches'
import { TZ_LABEL, autoSchedule, findConflicts, seedSlots, shiftDate } from '../lib/schedule'
import { ADMIN_BADGES, BADGE_DEFS } from '../lib/persona'
import { DEFAULT_PARTNERS } from '../components/Partners'
import { HooksAdmin, RefereePanel, ResultsAdmin, rebase } from './AdminFx'
import type { Application, Award, AwardTier, BracketStage, DB, MatchRecord, OrgKind, Organization, MatchStatus, NewsItem, Player, Seed, Stage, Team, Tournament, TournamentStatus } from '../lib/types'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '') || `id${Date.now()}`

const AUTO_KEY = 'tsite:auto'

type Tab = 'apps' | 'results' | 'orgs' | 'users' | 'questions' | 'players' | 'teams' | 'tournaments' | 'matches' | 'news' | 'awards' | 'settings' | 'json'

function Login({ onDone, password }: { onDone: () => void; password: boolean }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="wrap page narrow">
      <h1 className="page-title">Вход для организатора</h1>
      <div className="panel pad form">
        <p>Организаторы и судьи входят своим аккаунтом сайта: через Steam или по логину. Роль выдаёт организатор в разделе «Аккаунты».</p>
        <div className="form-actions">
          <a className="btn btn-accent" href={`${config.apiBase}?r=steamlogin&to=admin`}>
            Войти через Steam
          </a>
          <Link className="btn btn-ghost" to="/account">
            Войти по логину
          </Link>
        </div>
      </div>
      {password && (
        <form
          className="panel pad form"
          onSubmit={(e) => {
            e.preventDefault()
            api('login', { method: 'POST', body: { password: pw } }).then(onDone, (er) => setErr(String(er.message ?? er)))
          }}
        >
          <p className="muted small">Или общий пароль организатора:</p>
          <label>
            Пароль
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          {err && <div className="error">{err}</div>}
          <div className="form-actions">
            <button className="btn btn-ghost" type="submit">
              Войти по паролю
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export function Admin() {
  const { mode } = useData()
  const [auth, setAuth] = useState<'checking' | 'in' | 'referee' | 'out' | 'unconfigured'>(mode === 'api' ? 'checking' : 'in')
  const [byPw, setByPw] = useState(false)
  const check = () =>
    api<{ admin: boolean; role?: string; password?: boolean; configured: boolean }>('me').then(
      (r) => {
        setByPw(!!r.password)
        setAuth(r.admin ? 'in' : r.role === 'referee' ? 'referee' : r.configured ? 'out' : 'unconfigured')
      },
      () => setAuth('out'),
    )
  useEffect(() => {
    if (mode !== 'api') return
    check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  // выход: снимается пароль организатора, а вошедший по роли выходит из аккаунта целиком
  const logout = () =>
    api('logout', { method: 'POST' })
      .then(() => (byPw ? undefined : api('signout', { method: 'POST', body: {} })))
      .finally(() => window.location.reload())
  if (auth === 'checking') return <div className="wrap page">Проверяем доступ…</div>
  if (auth === 'out' || auth === 'unconfigured') return <Login password={auth === 'out'} onDone={() => void check()} />
  if (auth === 'referee') return <RefereePanel onLogout={logout} />
  return <AdminPanel onLogout={logout} />
}

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const { published, refresh, mode, rev, reload, readonly } = useData()
  const [db, setDb] = useState<DB>(() => readDraft() ?? clone(published))
  const [tab, setTab] = useState<Tab>(mode === 'api' ? 'apps' : 'matches')
  const [preview, setPrev] = useState(isPreview())
  const [saving, setSaving] = useState<{ s: 'idle' | 'saving' | 'ok' | 'err'; msg?: string }>({ s: 'idle' })
  const dirty = JSON.stringify(db) !== JSON.stringify(published)
  const dbRef = useRef(db)
  dbRef.current = db
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) !== '0'
    } catch {
      return true
    }
  })

  const update = (fn: (d: DB) => void) => {
    const next = clone(db)
    fn(next)
    setDb(next)
    writeDraft(next)
    setSaving({ s: 'idle' })
    if (preview) refresh()
  }

  const download = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'db.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const publish = async () => {
    const sent = db
    setSaving({ s: 'saving' })
    try {
      try {
        await api('db', { method: 'PUT', body: { db: sent, rev } })
      } catch (e) {
        // сервер сам меняет документ (заявки, результаты капитанов, игры OpenDota): переносим правки на свежую версию
        if (!(e instanceof Error) || !e.message.startsWith('Данные на сервере изменились')) throw e
        const srv = await api<{ db: DB; rev: number }>('db')
        await api('db', { method: 'PUT', body: { db: rebase(published, sent, srv.db), rev: srv.rev } })
      }
      // правки, сделанные пока шла отправка, остаются черновиком и уйдут следующей публикацией
      writeDraft(JSON.stringify(dbRef.current) === JSON.stringify(sent) ? null : dbRef.current)
      await reload()
      setSaving({ s: 'ok' })
    } catch (e) {
      setSaving({ s: 'err', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  // автопубликация: через 1.5 с после последней правки; при ошибке ждёт следующей правки
  useEffect(() => {
    if (mode !== 'api' || !auto || !dirty || saving.s === 'saving' || saving.s === 'err') return
    const t = setTimeout(publish, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, auto, dirty, saving.s, mode, published])

  // после reload() опубликованная версия совпадает с черновиком — подтягиваем её как новую базу
  useEffect(() => {
    if (!readDraft()) setDb(clone(published))
  }, [published])

  return (
    <div className="wrap page admin">
      <div className="page-title-row">
        <h1 className="page-title">Панель организатора</h1>
        <div className="form-actions">
          <Link className="btn btn-accent" to="/obs">Пульт OBS</Link>
          {mode === 'api' && (
            <button className="btn btn-ghost" onClick={onLogout}>
              Выйти
            </button>
          )}
        </div>
      </div>
      {readonly && <div className="warn-text">Сайт работает на резервном сервере: правки сейчас не сохраняются, подождите возврата основного.</div>}
      <div className="panel pad admin-info">
        {mode === 'api' ? (
          <p>
            {auto ? (
              <>
                Правки <b>публикуются автоматически</b> через пару секунд после последнего изменения, сайт обновляется у всех. Каждая публикация сохраняется в резервную копию.
              </>
            ) : (
              <>
                Изменения копятся в черновике в этом браузере. <b>Опубликовать</b> сохраняет их на сервер, и сайт обновляется у всех. Каждая публикация сохраняется в резервную копию.
              </>
            )}
          </p>
        ) : (
          <p>
            Сайт работает без сервера. Чтобы изменения увидели все: <b>Скачать db.json</b> → заменить файл <code>data/db.json</code> на хостинге.
          </p>
        )}
        <div className="form-actions">
          {mode === 'api' && (
            <button className="btn btn-accent" disabled={!dirty || saving.s === 'saving'} onClick={publish}>
              {saving.s === 'saving' ? 'Публикуем…' : dirty ? 'Опубликовать' : 'Всё опубликовано'}
            </button>
          )}
          {mode === 'api' && (
            <label className="check">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked)
                  try {
                    localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0')
                  } catch {
                    /* ignore */
                  }
                  if (e.target.checked && saving.s === 'err') setSaving({ s: 'idle' })
                }}
              />
              Публиковать автоматически
            </label>
          )}
          <button className={mode === 'api' ? 'btn btn-ghost' : 'btn btn-accent'} onClick={download}>
            Скачать db.json
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => {
                setPreview(e.target.checked)
                setPrev(e.target.checked)
                writeDraft(db)
                refresh()
              }}
            />
            Показывать черновик на сайте
          </label>
          <button
            className="btn btn-ghost"
            disabled={!dirty}
            onClick={() => {
              if (!window.confirm('Сбросить черновик к опубликованной версии?')) return
              writeDraft(null)
              setDb(clone(published))
              refresh()
            }}
          >
            Сбросить черновик
          </button>
          {saving.s === 'ok' && <span className="ok-text">Опубликовано</span>}
          {saving.s === 'err' && <span className="error">{saving.msg}</span>}
        </div>
      </div>

      <div className="seg">
        {(
          [
            ...(mode === 'api' ? [['apps', 'Заявки'], ['results', 'Результаты капитанов']] : []),
            ['matches', 'Матчи и счёт'],
            ['tournaments', 'Турниры и сетки'],
            ['teams', 'Команды и игроки'],
            ['orgs', 'Организации'],
            ...(mode === 'api' ? [['questions', 'Вопросы']] : []),
            ['news', 'Новости'],
            ['awards', 'Награды'],
            ['settings', 'Настройки'],
            ['json', 'JSON'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <AppsAdmin
          db={db}
          dirty={dirty}
          onChanged={async () => {
            await reload()
          }}
        />
      )}
      {tab === 'results' && (
        <ResultsAdmin
          db={db}
          dirty={dirty}
          onChanged={async () => {
            await reload()
          }}
        />
      )}
      {tab === 'teams' && <PeopleAdmin db={db} update={update} />}
      {tab === 'orgs' && <OrgsAdmin db={db} update={update} />}
      {tab === 'questions' && <QuestionsAdmin />}
      {tab === 'tournaments' && <TournamentsAdmin db={db} update={update} />}
      {tab === 'matches' && <MatchesAdmin db={db} update={update} />}
      {tab === 'news' && <NewsAdmin db={db} update={update} />}
      {tab === 'awards' && <AwardsAdmin db={db} update={update} />}
      {tab === 'settings' && <SettingsAdmin db={db} update={update} />}
      {tab === 'json' && (
        <JsonAdmin
          db={db}
          replace={(d) => {
            setDb(d)
            writeDraft(d)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function AppsAdmin({ db, dirty, onChanged }: { db: DB; dirty: boolean; onChanged: () => Promise<void> }) {
  const [apps, setApps] = useState<Application[] | null>(null)
  const [filter, setFilter] = useState<Application['status']>('pending')
  const [err, setErr] = useState('')
  const load = () => api<Application[]>('applications').then(setApps, (e) => setErr(String(e.message ?? e)))
  useEffect(() => {
    load()
  }, [])
  const decide = async (a: Application, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Причина отказа (необязательно)') ?? '' : ''
    try {
      await api('decide', { method: 'POST', body: { id: a.id, action, note } })
      await load()
      if (action === 'approve') await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const list = (apps ?? []).filter((a) => a.status === filter)
  const tname = (id?: string) => db.tournaments.find((t) => t.id === id)?.name ?? 'Без турнира'
  return (
    <div className="form">
      {dirty && (
        <div className="warn-text">
          В черновике есть неопубликованные изменения. Одобренная заявка сразу попадает на сервер. Перед одобрением опубликуйте черновик, иначе следующая публикация может конфликтовать.
        </div>
      )}
      <div className="seg">
        {(
          [
            ['pending', 'Новые'],
            ['approved', 'Одобренные'],
            ['rejected', 'Отклонённые'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {l} ({(apps ?? []).filter((a) => a.status === k).length})
          </button>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {!apps && !err && <div className="muted">Загрузка…</div>}
      {apps && !list.length && <div className="empty">Заявок нет</div>}
      {list.map((a) => (
        <div key={a.id} className={`panel pad app-card ${a.status}`}>
          <div className="app-head">
            <span className="badge badge-registration">{a.kind === 'team' ? 'Команда' : 'Игрок'}</span>
            <b>{a.kind === 'team' ? `${a.team?.name} [${a.team?.tag}]` : a.nick}</b>
            <span className="muted small">
              {tname(a.tournamentId)} · {fmtDate(a.createdAt.slice(0, 16))}
            </span>
          </div>
          <div className="app-body">
            <div>
              <small>Контакт</small>
              {a.contact}
            </div>
            {a.faculty && (
              <div>
                <small>Институт</small>
                {a.faculty}
              </div>
            )}
            {a.kind === 'team' ? (
              <div className="app-roster">
                <small>Состав</small>
                {a.players?.map((p, i) => (
                  <span key={i}>
                    {p.nick} <i className="muted">{p.role}</i>
                    {p.twitch && <i className="muted"> · twitch.tv/{p.twitch}</i>}
                  </span>
                ))}
              </div>
            ) : (
              <div>
                <small>Роль / курс</small>
                {a.role || '—'} {a.course ? `· ${a.course} курс` : ''}
              </div>
            )}
            {a.comment && (
              <div>
                <small>Комментарий</small>
                {a.comment}
              </div>
            )}
            {a.note && (
              <div>
                <small>Заметка</small>
                {a.note}
              </div>
            )}
          </div>
          {a.status === 'pending' && (
            <div className="form-actions">
              <button className="btn btn-accent" onClick={() => decide(a, 'approve')}>
                Одобрить{a.kind === 'team' && a.tournamentId ? ' и добавить в турнир' : ''}
              </button>
              <button className="btn btn-ghost" onClick={() => decide(a, 'reject')}>
                Отклонить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SettingsAdmin({ db, update }: P) {
  const { mode } = useData()
  const s = db.settings ?? {}
  const set = (patch: Partial<NonNullable<DB['settings']>>) => update((d) => (d.settings = { ...(d.settings ?? {}), ...patch }))
  return (
    <div className="panel pad form">
      <label>
        Twitch-канал лиги (логин, без ссылки)
        <input value={s.twitchChannel ?? ''} placeholder="например, miitcup" onChange={(e) => set({ twitchChannel: e.target.value.trim().toLowerCase() })} />
      </label>
      <p className="muted small">
        Плеер появится на главной. Статус «в эфире» работает, когда в api/config.php заданы twitch_client_id и twitch_client_secret. Чтобы показать трансляцию на странице матча, вставьте ссылку twitch.tv/канал в поле «Трансляция» у матча.
      </p>
      <div className="form-row">
        <label>
          Discord
          <input value={s.discordUrl ?? ''} placeholder="https://discord.gg/…" onChange={(e) => set({ discordUrl: e.target.value })} />
        </label>
        <label>
          Telegram
          <input value={s.telegramUrl ?? ''} placeholder="https://t.me/…" onChange={(e) => set({ telegramUrl: e.target.value })} />
        </label>
      </div>
      <label>
        VK
        <input value={s.vkUrl ?? ''} placeholder="https://vk.com/…" onChange={(e) => set({ vkUrl: e.target.value })} />
      </label>
      <label>
        Ключ FACEIT (client-side, developers.faceit.com) — K/D, ADR и уровень FACEIT в профилях
        <input value={s.faceitKey ?? ''} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(e) => set({ faceitKey: e.target.value.trim() })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={s.registrationOpen !== false} onChange={(e) => set({ registrationOpen: e.target.checked })} /> Принимать заявки через сайт
      </label>
      <label className="check">
        <input type="checkbox" checked={s.autoApprove !== false} onChange={(e) => set({ autoApprove: e.target.checked })} /> Заявки из аккаунта проходят без модерации
      </label>
      <label className="check">
        <input type="checkbox" checked={!!s.autoForfeit} onChange={(e) => set({ autoForfeit: e.target.checked })} /> Техническое поражение команде, не прошедшей чек-ин к началу матча
      </label>
      <div className="form-row">
        <label>
          Сезон рейтинга: название
          <input value={s.seasonName ?? ''} placeholder="Осень 2026" onChange={(e) => set({ seasonName: e.target.value })} />
        </label>
        <label>
          Начало сезона (в рейтинг Эло идут турниры с этой даты)
          <input type="date" value={s.seasonStart ?? ''} onChange={(e) => set({ seasonStart: e.target.value })} />
        </label>
      </div>
      {mode === 'api' && <HooksAdmin />}
      <h3>Партнёры</h3>
      <p className="muted small">VoidSound закреплён отдельно. Подпись показывается при наведении на карточку.</p>
      {(s.partners ?? DEFAULT_PARTNERS).map((p, i, all) => {
        const setPt = (patch: Partial<typeof p>) => set({ partners: all.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
        return (
          <div key={p.id} className="form-row">
            <label>
              Название
              <input value={p.name} onChange={(e) => setPt({ name: e.target.value })} />
            </label>
            <label>
              Ссылка
              <input value={p.url} placeholder="https://…" onChange={(e) => setPt({ url: e.target.value })} />
            </label>
            <label>
              Подпись при наведении
              <input value={p.hint ?? ''} onChange={(e) => setPt({ hint: e.target.value || undefined })} />
            </label>
            <label>
              Логотип (ссылка, необязательно)
              <input value={p.logo ?? ''} placeholder="https://…/logo.png" onChange={(e) => setPt({ logo: e.target.value || undefined })} />
            </label>
            <button className="btn-x" title="Удалить" onClick={() => set({ partners: all.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        )
      })}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={() => set({ partners: [...(s.partners ?? DEFAULT_PARTNERS), { id: `pt-${Date.now()}`, name: '', url: '' }] })}>
          + Партнёр
        </button>
      </div>
      <h3>Хайлайты</h3>
      {(db.highlights ?? []).map((h, i) => (
        <div key={h.id} className="form-row">
          <label>
            Название
            <input value={h.title} onChange={(e) => update((d) => (d.highlights![i].title = e.target.value))} />
          </label>
          <label>
            Ссылка (YouTube, Twitch, VK Видео)
            <input value={h.url ?? ''} onChange={(e) => update((d) => (d.highlights![i].url = e.target.value))} />
          </label>
          <label style={{ maxWidth: 170 }}>
            Дата
            <input type="date" value={h.date ?? ''} onChange={(e) => update((d) => (d.highlights![i].date = e.target.value))} />
          </label>
          <button className="btn-x" title="Удалить" onClick={() => update((d) => d.highlights!.splice(i, 1))}>
            ✕
          </button>
        </div>
      ))}
      <div className="form-actions">
        <button
          className="btn btn-ghost"
          onClick={() => update((d) => (d.highlights = [{ id: `h-${Date.now()}`, title: 'Новое видео', url: '', date: new Date().toISOString().slice(0, 10) }, ...(d.highlights ?? [])]))}
        >
          + Видео
        </button>
      </div>
    </div>
  )
}

type P = { db: DB; update: (fn: (d: DB) => void) => void }

function TeamSelect({ db, value, onChange, allowBye }: { db: DB; value: Seed | undefined; onChange: (v: Seed) => void; allowBye?: boolean }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as Seed))}>
      <option value="">TBD</option>
      {allowBye && <option value="BYE">BYE (пусто)</option>}
      {db.teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

function TeamsAdmin({ db, update, users = [] }: P & { users?: AdminUser[] }) {
  const [sel, setSel] = useState<string>(db.teams[0]?.id ?? '')
  const t = db.teams.find((x) => x.id === sel)
  const idx = db.teams.findIndex((x) => x.id === sel)
  const setT = (patch: Partial<Team>) => update((d) => Object.assign(d.teams[idx], patch))
  const [nick, setNick] = useState('')
  const { mode } = useData()
  return (
    <div className="admin-split">
      <div className="panel admin-list">
        <button
          className="btn btn-accent wide"
          onClick={() => {
            const name = window.prompt('Название команды')
            if (!name) return
            let id = slug(name)
            while (db.teams.some((x) => x.id === id)) id += '1'
            update((d) => d.teams.push({ id, name, tag: name.slice(0, 3).toUpperCase(), color: '#00b2ff' }))
            setSel(id)
          }}
        >
          + Команда
        </button>
        {db.teams.map((x) => (
          <button key={x.id} className={`admin-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
            <i style={{ background: x.color }} /> {x.name}
          </button>
        ))}
      </div>
      {t ? (
        <div className="panel pad form">
          <div className="form-row">
            <label>
              Название
              <input value={t.name} onChange={(e) => setT({ name: e.target.value })} />
            </label>
            <label>
              Тег
              <input value={t.tag} maxLength={4} onChange={(e) => setT({ tag: e.target.value })} />
            </label>
            <label>
              Цвет
              <input type="color" value={t.color ?? '#00b2ff'} onChange={(e) => setT({ color: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Институт
              <input value={t.faculty ?? ''} onChange={(e) => setT({ faculty: e.target.value })} />
            </label>
            <label>
              Организация
              <select value={t.orgId ?? ''} onChange={(e) => setT({ orgId: e.target.value || undefined })}>
                <option value="">—</option>
                {(db.orgs ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Капитан
              <select value={t.captainId ?? ''} onChange={(e) => setT({ captainId: e.target.value || undefined })}>
                <option value="">—</option>
                {db.players
                  .filter((p) => p.teamId === t.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nick}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            О команде
            <textarea rows={3} value={t.about ?? ''} onChange={(e) => setT({ about: e.target.value })} />
          </label>
          <div className="form-row">
            <label>
              Дисциплина
              <select value={t.game ?? ''} onChange={(e) => setT({ game: e.target.value || undefined })}>
                <option value="">как в турнирах</option>
                {GAMES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Год основания
              <input value={t.founded ?? ''} maxLength={4} placeholder="2026" onChange={(e) => setT({ founded: e.target.value.replace(/\D/g, '') || undefined })} />
            </label>
            <label>
              Девиз на баннере
              <input value={t.slogan ?? ''} maxLength={60} placeholder="One team, one goal" onChange={(e) => setT({ slogan: e.target.value || undefined })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Играть с ({TZ_LABEL})
              <input type="time" value={t.playFrom ?? ''} onChange={(e) => setT({ playFrom: e.target.value || undefined })} />
            </label>
            <label>
              до
              <input type="time" value={t.playTo ?? ''} onChange={(e) => setT({ playTo: e.target.value || undefined })} />
            </label>
            <label style={{ flex: 3 }}>
              Пожелание по времени
              <input value={t.timeNote ?? ''} maxLength={200} onChange={(e) => setT({ timeNote: e.target.value || undefined })} />
            </label>
          </div>
          {mode === 'api' && <TeamMediaEdit team={t} onDone={(kind, v) => setT({ [kind]: v || undefined })} />}
          <h3>Состав</h3>
          <div className="table-scroll">
          <table className="table roster-admin">
            <tbody>
              {db.players
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => p.teamId === t.id)
                .map(({ p, i }) => (
                  <tr key={p.id}>
                    <td className="left">
                      <input value={p.nick} onChange={(e) => update((d) => (d.players[i].nick = e.target.value))} />
                    </td>
                    <td className="left">
                      <input value={p.role ?? ''} placeholder="Роль" onChange={(e) => update((d) => (d.players[i].role = e.target.value))} />
                    </td>
                    <td className="left">
                      <input value={p.faculty ?? ''} placeholder="Институт" onChange={(e) => update((d) => (d.players[i].faculty = e.target.value))} />
                    </td>
                    <td className="left">
                      <AccountLink users={users} p={p} i={i} update={update} />
                    </td>
                    <td>
                      <button type="button" className={`btn btn-ghost cap-btn${t.captainId === p.id ? ' on' : ''}`} title={t.captainId === p.id ? 'Капитан' : 'Сделать капитаном'} onClick={() => setT({ captainId: p.id })}>
                        ♛
                      </button>
                    </td>
                    <td>
                      <button className="btn-x" title="Убрать из команды" onClick={() => update((d) => (d.players[i].teamId = undefined))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          </div>
          <div className="form-actions">
            <input placeholder="Ник нового игрока" value={nick} onChange={(e) => setNick(e.target.value)} />
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!nick.trim()) return
                update((d) => d.players.push({ id: `${t.id}-${slug(nick)}-${Date.now() % 10000}`, nick: nick.trim(), role: 'Игрок', teamId: t.id, faculty: t.faculty }))
                setNick('')
              }}
            >
              Добавить игрока
            </button>
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (id) update((d) => d.players.forEach((p) => p.id === id && (p.teamId = t.id)))
              }}
            >
              <option value="">+ из свободных игроков…</option>
              {db.players
                .filter((p) => !p.teamId || !db.teams.some((x) => x.id === p.teamId))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nick}
                    {p.userId ? ' (аккаунт)' : ''}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-actions danger">
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!window.confirm(`Удалить команду «${t.name}»? Игроки станут свободными агентами.`)) return
                update((d) => {
                  d.teams = d.teams.filter((x) => x.id !== t.id)
                  d.players.forEach((p) => p.teamId === t.id && (p.teamId = undefined))
                  d.tournaments.forEach((tr) => (tr.teams = tr.teams.filter((x) => x !== t.id)))
                })
                setSel(db.teams[0]?.id ?? '')
              }}
            >
              Удалить команду
            </button>
          </div>
        </div>
      ) : (
        <div className="panel pad">Выберите команду</div>
      )}
    </div>
  )
}

const statuses: [TournamentStatus, string][] = [
  ['upcoming', 'Скоро'],
  ['registration', 'Регистрация'],
  ['live', 'Идёт'],
  ['finished', 'Завершён'],
]

function TournamentsAdmin({ db, update }: P) {
  const [sel, setSel] = useState(db.tournaments[0]?.id ?? '')
  const ti = db.tournaments.findIndex((x) => x.id === sel)
  const t = db.tournaments[ti]
  const setT = (patch: Partial<Tournament>) => update((d) => Object.assign(d.tournaments[ti], patch))
  const setStage = (si: number, fn: (s: Stage) => void) => update((d) => fn(d.tournaments[ti].stages[si]))

  return (
    <div className="admin-split">
      <div className="panel admin-list">
        <button
          className="btn btn-accent wide"
          onClick={() => {
            const name = window.prompt('Название турнира')
            if (!name) return
            let id = slug(name)
            while (db.tournaments.some((x) => x.id === id)) id += '1'
            update((d) =>
              d.tournaments.push({
                id,
                name,
                status: 'registration',
                startDate: new Date().toISOString().slice(0, 10),
                format: 'Single Elimination · Bo1',
                maxTeams: 8,
                description: 'Описание турнира.',
                teams: [],
                stages: [{ id: 'playoff', type: 'single', name: 'Плей-офф', size: 8, seeds: Array(8).fill(null), bo: 1, finalBo: 3 }],
              }),
            )
            setSel(id)
          }}
        >
          + Турнир
        </button>
        {db.tournaments.map((x) => (
          <button key={x.id} className={`admin-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      {t ? (
        <div className="panel pad form">
          <div className="form-row">
            <label>
              Название
              <input value={t.name} onChange={(e) => setT({ name: e.target.value })} />
            </label>
            <label>
              Статус
              <select value={t.status} onChange={(e) => setT({ status: e.target.value as TournamentStatus })}>
                {statuses.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Начало
              <input type="date" value={t.startDate} onChange={(e) => setT({ startDate: e.target.value })} />
            </label>
            <label>
              Конец
              <input type="date" value={t.endDate ?? ''} onChange={(e) => setT({ endDate: e.target.value || undefined })} />
            </label>
            <label>
              Макс. команд
              <input type="number" min={2} value={t.maxTeams} onChange={(e) => setT({ maxTeams: Number(e.target.value) })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Дисциплина
              <select value={t.game ?? ''} onChange={(e) => setT({ game: e.target.value || undefined })}>
                <option value="">— общая —</option>
                {GAMES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Формат (текст)
              <input value={t.format} onChange={(e) => setT({ format: e.target.value })} />
            </label>
            <label>
              Призы
              <input value={t.prize ?? ''} onChange={(e) => setT({ prize: e.target.value })} />
            </label>
          </div>
          <label>
            Описание (Markdown)
            <textarea rows={3} value={t.description} onChange={(e) => setT({ description: e.target.value })} />
          </label>

          <h3>Участники ({t.teams.length}/{t.maxTeams})</h3>
          <div className="chips">
            {db.teams.map((tm) => {
              const on = t.teams.includes(tm.id)
              return (
                <button
                  key={tm.id}
                  className={`chip ${on ? 'on' : ''}`}
                  onClick={() => setT({ teams: on ? t.teams.filter((x) => x !== tm.id) : [...t.teams, tm.id] })}
                >
                  {on ? '✓ ' : '+ '}
                  {tm.name}
                </button>
              )
            })}
          </div>

          {t.stages.map((s, si) => (
            <div key={s.id} className="stage-edit">
              <h3>
                Этап: {s.name}{' '}
                <span className="muted small">
                  ({s.type === 'groups' ? 'группы' : s.type === 'single' ? 'Single Elimination' : 'Double Elimination'})
                </span>
              </h3>
              <div className="form-row">
                <label>
                  Название этапа
                  <input value={s.name} onChange={(e) => setStage(si, (x) => (x.name = e.target.value))} />
                </label>
                <label>
                  Bo
                  <select value={s.bo} onChange={(e) => setStage(si, (x) => (x.bo = Number(e.target.value)))}>
                    {[1, 2, 3, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {s.type !== 'groups' && (
                  <>
                    <label>
                      Bo финала
                      <select value={s.finalBo ?? s.bo} onChange={(e) => setStage(si, (x) => x.type !== 'groups' && (x.finalBo = Number(e.target.value)))}>
                        {[1, 2, 3, 5].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Размер сетки
                      <select
                        value={s.size}
                        onChange={(e) =>
                          setStage(si, (x) => {
                            if (x.type === 'groups') return
                            x.size = Number(e.target.value)
                            x.seeds = Array.from({ length: x.size }, (_, i) => x.seeds[i] ?? null)
                          })
                        }
                      >
                        {[4, 8, 16, 32].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {s.type === 'groups' ? (
                <>
                  {s.groups.map((g, gi) => (
                    <div key={g.name} className="form-row">
                      <label>
                        Группа {g.name}
                        <div className="chips">
                          {t.teams.map((id) => {
                            const on = g.teams.includes(id)
                            const tm = db.teams.find((x) => x.id === id)
                            return (
                              <button
                                key={id}
                                className={`chip ${on ? 'on' : ''}`}
                                onClick={() =>
                                  setStage(si, (x) => {
                                    if (x.type !== 'groups') return
                                    x.groups.forEach((gg) => (gg.teams = gg.teams.filter((y) => y !== id)))
                                    if (!on) x.groups[gi].teams.push(id)
                                  })
                                }
                              >
                                {tm?.name ?? id}
                              </button>
                            )
                          })}
                        </div>
                      </label>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      setStage(si, (x) => x.type === 'groups' && x.groups.push({ name: String.fromCharCode(65 + x.groups.length), teams: [] }))
                    }
                  >
                    + Группа
                  </button>
                </>
              ) : (
                <>
                  <p className="muted small">Слоты по порядку: 1 против 2, 3 против 4 и т.д. TBD — команда ещё не определена, BYE — соперник проходит без игры.</p>
                  <div className="seeds">
                    {s.seeds.map((seed, i) => (
                      <label key={i} className={i % 2 ? 'odd' : ''}>
                        <span>Слот {i + 1}</span>
                        <TeamSelect db={db} value={seed} allowBye onChange={(v) => setStage(si, (x) => x.type !== 'groups' && (x.seeds[i] = v))} />
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      setStage(si, (x) => {
                        if (x.type === 'groups') return
                        x.seeds = Array.from({ length: x.size }, (_, i) => t.teams[i] ?? null)
                      })
                    }
                  >
                    Заполнить слоты участниками по порядку
                  </button>
                  <button
                    className="btn btn-ghost"
                    title="Посев по среднему ММР пяти сильнейших: сильнейшие встречаются позже, недостающие места занимают BYE"
                    onClick={() =>
                      setStage(si, (x) => {
                        if (x.type === 'groups') return
                        x.seeds = seedSlots(db, t.teams, x.size, 'rating')
                      })
                    }
                  >
                    Жеребьёвка по рейтингу (ММР)
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (!window.confirm('Перемешать участников случайно?')) return
                      setStage(si, (x) => {
                        if (x.type === 'groups') return
                        x.seeds = seedSlots(db, t.teams, x.size, 'random')
                      })
                    }}
                  >
                    Случайная жеребьёвка
                  </button>
                </>
              )}
              <div className="form-actions danger">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (!window.confirm(`Удалить этап «${s.name}» и его матчи?`)) return
                    update((d) => {
                      d.tournaments[ti].stages.splice(si, 1)
                      d.matches = d.matches.filter((m) => !(m.tournamentId === t.id && m.stageId === s.id))
                    })
                  }}
                >
                  Удалить этап
                </button>
              </div>
            </div>
          ))}
          <div className="form-actions">
            {(['groups', 'single', 'double'] as const).map((type) => (
              <button
                key={type}
                className="btn btn-ghost"
                onClick={() =>
                  update((d) => {
                    const st = d.tournaments[ti].stages
                    let id = type === 'groups' ? 'groups' : 'playoff'
                    while (st.some((x) => x.id === id)) id += '2'
                    st.push(
                      type === 'groups'
                        ? { id, type, name: 'Групповой этап', bo: 1, advance: 2, groups: [{ name: 'A', teams: [] }, { name: 'B', teams: [] }] }
                        : { id, type, name: type === 'single' ? 'Плей-офф' : 'Плей-офф (Double)', size: 8, seeds: Array(8).fill(null), bo: 1, finalBo: 3 },
                    )
                  })
                }
              >
                + {type === 'groups' ? 'Группы' : type === 'single' ? 'Single Elim' : 'Double Elim'}
              </button>
            ))}
          </div>
          <div className="form-actions danger">
            <button
              className="btn btn-ghost"
              onClick={() => {
                const n = db.matches.filter((m) => m.tournamentId === t.id).length
                if (!window.confirm(`Удалить турнир «${t.name}» целиком: этапы, сетки и ${n} матчей? Новости останутся без привязки.`)) return
                const id = t.id
                update((d) => {
                  d.tournaments.splice(ti, 1)
                  d.matches = d.matches.filter((m) => m.tournamentId !== id)
                  d.news.forEach((x) => {
                    if (x.tournamentId === id) delete x.tournamentId
                  })
                  d.highlights?.forEach((x) => {
                    if (x.tournamentId === id) delete x.tournamentId
                  })
                })
                setSel('')
              }}
            >
              Удалить турнир
            </button>
          </div>
        </div>
      ) : (
        <div className="panel pad">Выберите турнир</div>
      )}
    </div>
  )
}

function MatchesAdmin({ db, update }: P) {
  const [tid, setTid] = useState(db.tournaments.find((t) => t.status === 'live')?.id ?? db.tournaments[0]?.id ?? '')
  const t = db.tournaments.find((x) => x.id === tid)
  const [sid, setSid] = useState(t?.stages[0]?.id ?? '')
  const stage = t?.stages.find((s) => s.id === sid) ?? t?.stages[0]
  const [sc, setSc] = useState({ start: '', len: 90, gap: 15, lanes: 1, from: '18:00', to: '23:30', only: true, shift: 0 })
  const teamName = (id: Seed | undefined) => (id === 'BYE' ? 'BYE' : db.teams.find((x) => x.id === id)?.name ?? 'TBD')

  const upsert = (key: string, patch: Partial<MatchRecord>) =>
    update((d) => {
      if (!t || !stage) return
      let r = d.matches.find((m) => m.tournamentId === t.id && m.stageId === stage.id && m.key === key)
      if (!r) {
        r = { tournamentId: t.id, stageId: stage.id, key, status: 'scheduled' }
        d.matches.push(r)
      }
      Object.assign(r, patch)
    })

  const rows: { key: string; a: Seed | undefined; b: Seed | undefined; rec?: MatchRecord; ready: boolean; round: number }[] = []
  if (t && stage) {
    const recs = db.matches.filter((m) => m.tournamentId === t.id && m.stageId === stage.id)
    if (stage.type === 'groups') recs.forEach((r) => rows.push({ key: r.key, a: r.teamA, b: r.teamB, rec: r, ready: true, round: 1 }))
    else
      allBracketMatches(stage, recs)
        .filter((m) => m.status !== 'bye')
        .forEach((m) => rows.push({ key: m.key, a: m.a.team, b: m.b.team, rec: m.record, ready: !!(m.a.team && m.b.team), round: m.round }))
  }

  const schedRows = rows.map((r) => ({ key: r.key, a: r.a, b: r.b, round: r.round, date: r.rec?.date }))
  const conflicts = findConflicts(schedRows, db.teams, sc.len, sc.gap)
  const wishTeams = db.teams.filter((x) => t?.teams.includes(x.id) && (x.playFrom || x.playTo || x.timeNote))
  const setDates = (m: Map<string, string | undefined>) =>
    update((d) => {
      if (!t || !stage) return
      m.forEach((date, key) => {
        let r = d.matches.find((x) => x.tournamentId === t.id && x.stageId === stage.id && x.key === key)
        if (!r) {
          r = { tournamentId: t.id, stageId: stage.id, key, status: 'scheduled' }
          d.matches.push(r)
        }
        if (date) r.date = date
        else delete r.date
      })
    })
  const runAuto = () =>
    setDates(
      autoSchedule(schedRows, db.teams, { start: sc.start, len: sc.len, gap: sc.gap, lanes: sc.lanes, dayFrom: sc.from, dayTo: sc.to, onlyEmpty: sc.only, barrier: stage?.type === 'single' })
    )
  const num = (v: string, def: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : def)

  return (
    <div className="panel pad form">
      <div className="form-row">
        <label>
          Турнир
          <select
            value={tid}
            onChange={(e) => {
              setTid(e.target.value)
              setSid(db.tournaments.find((x) => x.id === e.target.value)?.stages[0]?.id ?? '')
            }}
          >
            {db.tournaments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Этап
          <select value={stage?.id ?? ''} onChange={(e) => setSid(e.target.value)}>
            {t?.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="sched" open>
        <summary>Расписание: расставить время, сдвинуть, проверить конфликты</summary>
        <div className="form-row">
          <label>
            Начало ({TZ_LABEL})
            <input type="datetime-local" value={sc.start} onChange={(e) => setSc({ ...sc, start: e.target.value })} />
          </label>
          <label>
            Матч, мин
            <input type="number" min={10} value={sc.len} onChange={(e) => setSc({ ...sc, len: num(e.target.value, 90) })} />
          </label>
          <label>
            Перерыв, мин
            <input type="number" min={0} value={sc.gap} onChange={(e) => setSc({ ...sc, gap: num(e.target.value, 0) })} />
          </label>
          <label>
            Потоков одновременно
            <input type="number" min={1} max={8} value={sc.lanes} onChange={(e) => setSc({ ...sc, lanes: num(e.target.value, 1) })} />
          </label>
          <label>
            Играем с
            <input type="time" value={sc.from} onChange={(e) => setSc({ ...sc, from: e.target.value })} />
          </label>
          <label>
            до
            <input type="time" value={sc.to} onChange={(e) => setSc({ ...sc, to: e.target.value })} />
          </label>
        </div>
        <div className="form-actions">
          <label className="check">
            <input type="checkbox" checked={sc.only} onChange={(e) => setSc({ ...sc, only: e.target.checked })} /> только матчи без даты
          </label>
          <button className="btn btn-accent" disabled={!sc.start || rows.length === 0} onClick={runAuto}>
            Расставить время
          </button>
          <input type="number" style={{ width: 110 }} placeholder="± минут" value={sc.shift || ''} onChange={(e) => setSc({ ...sc, shift: num(e.target.value, 0) })} />
          <button
            className="btn btn-ghost"
            disabled={!sc.shift}
            onClick={() => setDates(new Map(rows.filter((r) => r.rec?.date).map((r) => [r.key, shiftDate(r.rec?.date as string, sc.shift)])))}
          >
            Сдвинуть все с датой
          </button>
          <button
            className="btn btn-ghost"
            disabled={!rows.some((r) => r.rec?.date)}
            onClick={() => window.confirm('Очистить даты всех матчей этапа?') && setDates(new Map(rows.filter((r) => r.rec?.date).map((r) => [r.key, undefined])))}
          >
            Очистить даты
          </button>
        </div>
        {wishTeams.length > 0 && (
          <p className="muted small">
            Пожелания команд: {wishTeams.map((x) => `${x.name} ${x.playFrom ?? '00:00'}–${x.playTo ?? '24:00'}${x.timeNote ? ` («${x.timeNote}»)` : ''}`).join('; ')}. Авто-расстановка их учитывает.
          </p>
        )}
        {conflicts.size > 0 ? <p className="warn-text">Конфликтов в расписании: {conflicts.size}. Наведите на ⚠ в строке матча.</p> : rows.some((r) => r.rec?.date) && <p className="ok-text small">Конфликтов нет.</p>}
      </details>
      <p className="muted small">
        Счёт в сериях (для Bo1 — 1:0). Статус «Завершён» с неравным счётом продвигает победителя по сетке автоматически.
      </p>
      <div className="table-scroll">
        <table className="table admin-matches">
          <thead>
            <tr>
              <th className="left">Матч</th>
              <th className="left">Команда A</th>
              <th>Счёт</th>
              <th className="left">Команда B</th>
              <th className="left">Статус</th>
              <th className="left">Дата и время</th>
              <th className="left">Трансляция</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`${r.ready ? '' : 'muted'}${conflicts.has(r.key) ? ' conflict' : ''}`}>
                <td className="left mono" title={conflicts.get(r.key)?.join('\n')}>
                  {conflicts.has(r.key) && <span className="warn-ico">⚠ </span>}
                  {r.key}
                </td>
                <td className="left">
                  {stage?.type === 'groups' ? (
                    <TeamSelect db={db} value={r.a} onChange={(v) => upsert(r.key, { teamA: v ?? undefined })} />
                  ) : (
                    teamName(r.a)
                  )}
                </td>
                <td className="score-edit">
                  <input type="number" min={0} value={r.rec?.scoreA ?? ''} disabled={!r.ready} onChange={(e) => upsert(r.key, { scoreA: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  :
                  <input type="number" min={0} value={r.rec?.scoreB ?? ''} disabled={!r.ready} onChange={(e) => upsert(r.key, { scoreB: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </td>
                <td className="left">
                  {stage?.type === 'groups' ? (
                    <TeamSelect db={db} value={r.b} onChange={(v) => upsert(r.key, { teamB: v ?? undefined })} />
                  ) : (
                    teamName(r.b)
                  )}
                </td>
                <td className="left">
                  <select value={r.rec?.status ?? 'scheduled'} disabled={!r.ready} onChange={(e) => upsert(r.key, { status: e.target.value as MatchStatus })}>
                    <option value="scheduled">Запланирован</option>
                    <option value="live">Идёт</option>
                    <option value="finished">Завершён</option>
                  </select>
                </td>
                <td className="left">
                  <input type="datetime-local" value={r.rec?.date ?? ''} onChange={(e) => upsert(r.key, { date: e.target.value || undefined })} />
                </td>
                <td className="left">
                  <input placeholder="https://" value={r.rec?.stream ?? ''} onChange={(e) => upsert(r.key, { stream: e.target.value || undefined })} />
                </td>
                <td>
                  <button
                    className="btn-x"
                    title={stage?.type === 'groups' ? 'Удалить матч' : 'Сбросить результат матча'}
                    disabled={!r.rec}
                    onClick={() => {
                      if (!t || !stage || !window.confirm(stage.type === 'groups' ? `Удалить матч ${r.key}?` : `Сбросить результат ${r.key}?`)) return
                      update((d) => {
                        d.matches = d.matches.filter((m) => !(m.tournamentId === t.id && m.stageId === stage.id && m.key === r.key))
                      })
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions danger">
        <button
          className="btn btn-ghost"
          disabled={!stage || !db.matches.some((m) => m.tournamentId === t?.id && m.stageId === stage.id)}
          onClick={() => {
            if (!t || !stage) return
            const n = db.matches.filter((m) => m.tournamentId === t.id && m.stageId === stage.id).length
            if (!window.confirm(`Удалить все матчи этапа «${stage.name}» (${n})?`)) return
            update((d) => {
              d.matches = d.matches.filter((m) => !(m.tournamentId === t.id && m.stageId === stage.id))
            })
          }}
        >
          Удалить все матчи этапа
        </button>
        <button
          className="btn btn-ghost"
          disabled={!db.matches.some((m) => m.tournamentId === t?.id)}
          onClick={() => {
            if (!t) return
            const n = db.matches.filter((m) => m.tournamentId === t.id).length
            if (!window.confirm(`Удалить все матчи турнира «${t.name}» (${n})?`)) return
            update((d) => {
              d.matches = d.matches.filter((m) => m.tournamentId !== t.id)
            })
          }}
        >
          Удалить все матчи турнира
        </button>
      </div>
      {stage?.type === 'groups' && (
        <div className="form-actions">
          {stage.groups.map((g) => (
            <button
              key={g.name}
              className="btn btn-ghost"
              onClick={() => {
                const n = db.matches.filter((m) => m.tournamentId === t!.id && m.stageId === stage.id && m.group === g.name).length + 1
                let key = `${g.name}${n}`
                while (db.matches.some((m) => m.tournamentId === t!.id && m.stageId === stage.id && m.key === key)) key += 'x'
                upsert(key, { group: g.name })
              }}
            >
              + Матч в группе {g.name}
            </button>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() =>
              update((d) => {
                for (const g of stage.groups)
                  for (let i = 0; i < g.teams.length; i++)
                    for (let j = i + 1; j < g.teams.length; j++) {
                      const [a, b] = [g.teams[i], g.teams[j]]
                      const exists = d.matches.some(
                        (m) => m.tournamentId === t!.id && m.stageId === stage.id && [m.teamA, m.teamB].includes(a) && [m.teamA, m.teamB].includes(b),
                      )
                      if (!exists) d.matches.push({ tournamentId: t!.id, stageId: stage.id, key: `${g.name}-${a}-${b}`, group: g.name, teamA: a, teamB: b, status: 'scheduled' })
                    }
              })
            }
          >
            Создать круговое расписание
          </button>
        </div>
      )}
    </div>
  )
}

function NewsAdmin({ db, update }: P) {
  const [sel, setSel] = useState(db.news[0]?.id ?? '')
  const i = db.news.findIndex((x) => x.id === sel)
  const n = db.news[i]
  const setN = (patch: Partial<NewsItem>) => update((d) => Object.assign(d.news[i], patch))
  return (
    <div className="admin-split">
      <div className="panel admin-list">
        <button
          className="btn btn-accent wide"
          onClick={() => {
            const id = `news-${Date.now()}`
            update((d) => d.news.unshift({ id, title: 'Новая новость', date: new Date().toISOString().slice(0, 10), tag: 'Лига', excerpt: '', body: '' }))
            setSel(id)
          }}
        >
          + Новость
        </button>
        {db.news.map((x) => (
          <button key={x.id} className={`admin-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
            {x.title}
          </button>
        ))}
      </div>
      {n ? (
        <div className="panel pad form">
          <label>
            Заголовок
            <input value={n.title} onChange={(e) => setN({ title: e.target.value })} />
          </label>
          <div className="form-row">
            <label>
              Дата
              <input type="date" value={n.date} onChange={(e) => setN({ date: e.target.value })} />
            </label>
            <label>
              Рубрика
              <input value={n.tag} onChange={(e) => setN({ tag: e.target.value })} />
            </label>
            <label>
              Турнир
              <select value={n.tournamentId ?? ''} onChange={(e) => setN({ tournamentId: e.target.value || undefined })}>
                <option value="">—</option>
                {db.tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!n.pinned} onChange={(e) => setN({ pinned: e.target.checked })} /> Закрепить
            </label>
          </div>
          <label>
            Подзаголовок
            <input value={n.excerpt} onChange={(e) => setN({ excerpt: e.target.value })} />
          </label>
          <label>
            Обложка (ссылка на картинку, необязательно)
            <input value={n.cover ?? ''} placeholder="https://…/image.jpg" onChange={(e) => setN({ cover: e.target.value || undefined })} />
          </label>
          <label>
            Текст (Markdown: ## заголовок, - список, **жирный**, [ссылка](url))
            <textarea rows={12} value={n.body} onChange={(e) => setN({ body: e.target.value })} />
          </label>
          <div className="form-actions danger">
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!window.confirm('Удалить новость?')) return
                update((d) => d.news.splice(i, 1))
                setSel('')
              }}
            >
              Удалить новость
            </button>
          </div>
        </div>
      ) : (
        <div className="panel pad">Выберите новость</div>
      )}
    </div>
  )
}

function JsonAdmin({ db, replace }: { db: DB; replace: (d: DB) => void }) {
  const [text, setText] = useState(() => JSON.stringify(db, null, 2))
  const [err, setErr] = useState('')
  return (
    <div className="panel pad form">
      <p className="muted small">Прямое редактирование всей базы. Также можно загрузить ранее скачанный db.json.</p>
      <input
        type="file"
        accept="application/json,.json"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setText(await f.text())
        }}
      />
      <textarea className="mono" rows={24} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <div className="form-actions">
        <button
          className="btn btn-accent"
          onClick={() => {
            try {
              const d = JSON.parse(text) as DB
              if (!Array.isArray(d.teams) || !Array.isArray(d.tournaments) || !Array.isArray(d.matches)) throw new Error('Нет teams / tournaments / matches')
              setErr('')
              replace(d)
            } catch (e) {
              setErr(String(e))
            }
          }}
        >
          Применить
        </button>
      </div>
    </div>
  )
}

const orgKinds: [OrgKind, string][] = [
  ['institute', 'Институт'],
  ['club', 'Клуб'],
  ['department', 'Кафедра'],
  ['other', 'Другое'],
]

function OrgsAdmin({ db, update }: P) {
  const orgs = db.orgs ?? []
  const [sel, setSel] = useState(orgs[0]?.id ?? '')
  const i = orgs.findIndex((x) => x.id === sel)
  const o = orgs[i]
  const setO = (patch: Partial<Organization>) => update((d) => Object.assign((d.orgs ??= [])[i], patch))
  return (
    <div className="admin-split">
      <div className="panel admin-list">
        <button
          className="btn btn-accent wide"
          onClick={() => {
            const id = `org-${Date.now()}`
            update((d) => (d.orgs ??= []).push({ id, name: 'Новая организация', kind: 'institute' }))
            setSel(id)
          }}
        >
          + Организация
        </button>
        {orgs.map((x) => (
          <button key={x.id} className={`admin-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
            {x.short || x.name}
          </button>
        ))}
      </div>
      {o ? (
        <div className="panel pad form">
          <label>
            Название
            <input value={o.name} onChange={(e) => setO({ name: e.target.value })} />
          </label>
          <div className="form-row">
            <label>
              Сокращение
              <input value={o.short ?? ''} placeholder="ИУИТ" onChange={(e) => setO({ short: e.target.value || undefined })} />
            </label>
            <label>
              Тип
              <select value={o.kind} onChange={(e) => setO({ kind: e.target.value as OrgKind })}>
                {orgKinds.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Сайт
              <input value={o.site ?? ''} placeholder="https://…" onChange={(e) => setO({ site: e.target.value || undefined })} />
            </label>
          </div>
          <label>
            Описание
            <textarea rows={4} value={o.description ?? ''} onChange={(e) => setO({ description: e.target.value || undefined })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={!!o.closed} onChange={(e) => setO({ closed: e.target.checked || undefined })} /> Закрытая: игроки не могут выбрать её сами, участников назначает организатор во вкладке «Аккаунты»
          </label>
          <p className="muted small">Команд: {db.teams.filter((t) => t.orgId === o.id).length}. Команде организация назначается во вкладке «Команды и игроки» или при заявке.</p>
          <div className="form-actions danger">
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!window.confirm('Удалить организацию? У команд она сбросится.')) return
                const id = o.id
                update((d) => {
                  d.orgs?.splice(i, 1)
                  d.teams.forEach((t) => {
                    if (t.orgId === id) delete t.orgId
                  })
                })
                setSel('')
              }}
            >
              Удалить организацию
            </button>
          </div>
        </div>
      ) : (
        <div className="panel pad">Выберите организацию</div>
      )}
    </div>
  )
}

interface AdminUser {
  id: string
  login: string
  name: string
  nick: string
  orgId: string
  contact: string
  banned?: boolean
  badges?: string[]
  role?: string
}

function UsersAdmin({ db, update, onLoaded }: { db: DB; update: P['update']; onLoaded?: (u: AdminUser[]) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [msg, setMsg] = useState('')
  const load = () =>
    api<AdminUser[]>('users').then(
      (list) => {
        setUsers(list)
        onLoaded?.(list)
      },
      (e) => setMsg(String(e.message ?? e))
    )
  useEffect(() => {
    load()
  }, [])
  if (!users) return <div className="panel pad">{msg || 'Загрузка…'}</div>
  return (
    <div className="panel pad">
      <h2>Аккаунты ({users.length})</h2>
      {msg && <div className="muted small">{msg}</div>}
      {users.length === 0 && <div className="muted">Пока никого</div>}
      {users.map((u) => (
        <div key={u.id} className="app-card">
          <div className="app-head">
            <b>{u.login}</b>
            {u.banned && <span className="badge badge-finished">бан</span>}
            {u.role && <span className="badge badge-registration">{u.role === 'admin' ? 'организатор' : 'судья'}</span>}
            <span className="muted small">
              {[u.name, u.nick, u.contact].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="form-actions">
            <select
              value={db.players.find((p) => p.userId === u.id)?.id ?? ''}
              title="Карточка игрока этого аккаунта. Привязка меняет черновик: опубликуйте его."
              onChange={(e) => {
                const cur = db.players.findIndex((p) => p.userId === u.id)
                const to = db.players.findIndex((p) => p.id === e.target.value)
                if (to >= 0) linkUser(update, to, u.id)
                else if (cur >= 0) linkUser(update, cur, '')
              }}
            >
              <option value="">Без карточки игрока</option>
              {db.players
                .filter((p) => !p.userId || p.userId === u.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nick} · {db.teams.find((t) => t.id === p.teamId)?.name ?? 'без команды'}
                  </option>
                ))}
            </select>
            <select
              value={u.role ?? ''}
              title="Роль: судья ведёт результаты, организатор — всю админку. Вход через свой аккаунт (Steam или логин)."
              onChange={async (e) => {
                try {
                  await api('setrole', { method: 'POST', body: { id: u.id, role: e.target.value } })
                  load()
                } catch (er) {
                  setMsg(er instanceof Error ? er.message : String(er))
                }
              }}
            >
              <option value="">Без роли</option>
              <option value="referee">Судья</option>
              <option value="obs_operator">Оператор эфира</option>
              <option value="admin">Организатор</option>
            </select>
            <select
              value={u.orgId}
              onChange={async (e) => {
                await api('setorg', { method: 'POST', body: { id: u.id, orgId: e.target.value } })
                load()
              }}
            >
              <option value="">Без организации</option>
              {(db.orgs ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.short || o.name}
                </option>
              ))}
            </select>
            {ADMIN_BADGES.map((b) => {
              const on = (u.badges ?? []).includes(b)
              return (
                <button
                  key={b}
                  type="button"
                  className={`btn btn-ghost badge-toggle${on ? ' on' : ''}`}
                  title={BADGE_DEFS[b].desc}
                  onClick={async () => {
                    const next = on ? (u.badges ?? []).filter((x) => x !== b) : [...(u.badges ?? []), b]
                    await api('setbadges', { method: 'POST', body: { id: u.id, badges: next } })
                    load()
                  }}
                >
                  {BADGE_DEFS[b].emoji} {BADGE_DEFS[b].name}
                </button>
              )
            })}
            <button
              className="btn btn-ghost"
              onClick={async () => {
                const pw = window.prompt(`Новый пароль для ${u.login} (от 8 символов)`)
                if (!pw) return
                try {
                  await api('resetpw', { method: 'POST', body: { id: u.id, password: pw } })
                  setMsg(`Пароль ${u.login} изменён`)
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Сбросить пароль
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api('banuser', { method: 'POST', body: { id: u.id, banned: !u.banned } })
                load()
              }}
            >
              {u.banned ? 'Разбанить' : 'Забанить'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (!window.confirm(`Удалить аккаунт ${u.login}?`)) return
                await api('deluser', { method: 'POST', body: { id: u.id } })
                load()
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Привязка аккаунта к карточке игрока: старая автокарточка аккаунта (pu_…, без команды) удаляется, иначе отвязывается. */
function linkUser(update: P['update'], i: number, userId: string) {
  update((d) => {
    const p = d.players[i]
    if (!p) return
    if (!userId) {
      delete p.userId
      return
    }
    const drop = new Set<string>()
    d.players.forEach((q) => {
      if (q === p || q.userId !== userId) return
      if (q.id.startsWith('pu_') && !q.teamId) drop.add(q.id)
      else delete q.userId
    })
    p.userId = userId
    if (drop.size) d.players = d.players.filter((q) => !drop.has(q.id))
  })
}

function AccountLink({ users, p, i, update }: { users: AdminUser[]; p: Player; i: number; update: P['update'] }) {
  const known = !p.userId || users.some((u) => u.id === p.userId)
  return (
    <select
      value={p.userId ?? ''}
      title="Аккаунт сайта. Ник, роль, ранг и контакты карточки берутся из его профиля после публикации."
      onChange={(e) => linkUser(update, i, e.target.value)}
    >
      <option value="">без аккаунта</option>
      {!known && <option value={p.userId}>{p.userId}</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.login}
          {u.nick && u.nick !== u.login ? ` · ${u.nick}` : ''}
        </option>
      ))}
    </select>
  )
}

/** Одна вкладка вместо трёх: команды, все игроки и аккаунты с привязкой друг к другу. */
function PeopleAdmin({ db, update }: P) {
  const { mode } = useData()
  const [view, setView] = useState<'teams' | 'players' | 'accounts'>('teams')
  const [users, setUsers] = useState<AdminUser[]>([])
  useEffect(() => {
    if (mode === 'api') api<AdminUser[]>('users').then(setUsers, () => setUsers([]))
  }, [mode])
  const noTeam = users.filter((u) => !db.players.some((p) => p.userId === u.id && p.teamId && db.teams.some((t) => t.id === p.teamId))).length
  const views: [typeof view, string][] = [
    ['teams', `Команды (${db.teams.length})`],
    ['players', `Все игроки (${db.players.length})`],
    ...(mode === 'api' ? ([['accounts', `Аккаунты (${users.length}${noTeam ? `, без команды ${noTeam}` : ''})`]] as [typeof view, string][]) : []),
  ]
  return (
    <>
      <div className="seg">
        {views.map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      {view === 'teams' && <TeamsAdmin db={db} update={update} users={users} />}
      {view === 'players' && <PlayersAdmin db={db} update={update} users={users} />}
      {view === 'accounts' && <UsersAdmin db={db} update={update} onLoaded={setUsers} />}
    </>
  )
}

interface AdminQ {
  id: string
  name: string
  contact: string
  text: string
  answer: string | null
  published: boolean
  createdAt: string
}

function QuestionsAdmin() {
  const [items, setItems] = useState<AdminQ[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const load = () => api<AdminQ[]>('questions').then(setItems, (e) => setMsg(String(e.message ?? e)))
  useEffect(() => {
    load()
  }, [])
  if (!items) return <div className="panel pad">{msg || 'Загрузка…'}</div>
  return (
    <div className="panel pad">
      <h2>Вопросы ({items.filter((i) => !i.answer).length} без ответа)</h2>
      {msg && <div className="muted small">{msg}</div>}
      {items.length === 0 && <div className="muted">Пока пусто</div>}
      {items.map((i) => (
        <div key={i.id} className="app-card">
          <div className="app-head">
            <b>{i.text}</b>
            <span className="muted small">{[i.name, i.contact].filter(Boolean).join(' · ')}</span>
          </div>
          <textarea
            rows={3}
            placeholder="Ответ"
            value={draft[i.id] ?? i.answer ?? ''}
            onChange={(e) => setDraft({ ...draft, [i.id]: e.target.value })}
          />
          <div className="form-actions">
            <button
              className="btn"
              onClick={async () => {
                await api('answerq', { method: 'POST', body: { id: i.id, answer: draft[i.id] ?? i.answer ?? '', published: true } })
                load()
              }}
            >
              Ответить и опубликовать
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api('delq', { method: 'POST', body: { id: i.id } })
                load()
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const PODIUM: AwardTier[] = ['gold', 'silver', 'bronze']
const tierName = (t: AwardTier) => TIERS.find(([k]) => k === t)?.[1] ?? t

/** Команды на 1–3 местах по последней сетке турнира (если финал сыгран). */
function podium(db: DB, t: Tournament): string[] {
  const st = [...t.stages].reverse().find((s) => s.type !== 'groups') as BracketStage | undefined
  if (!st) return []
  return bracketPlacings(st, db.matches.filter((m) => m.tournamentId === t.id && m.stageId === st.id)).filter((x): x is string => !!x && x !== 'BYE')
}

function AwardsAdmin({ db, update }: P) {
  const awards = db.awards ?? []
  const [f, setF] = useState({ who: '', tier: 'mvp' as AwardTier, title: 'MVP турнира', tournamentId: '' })
  const [q, setQ] = useState('')
  const issue = (t: Tournament) =>
    update((d) => {
      const list = (d.awards = d.awards ?? [])
      podium(d, t).forEach((teamId, i) => {
        const tier = PODIUM[i]
        const add = (playerId?: string) => {
          const id = `aw-${t.id}-${tier}-${playerId ?? teamId}`
          if (!list.some((a) => a.id === id)) list.push({ id, tier, title: tierName(tier), teamId, playerId, tournamentId: t.id, date: t.endDate || t.startDate })
        }
        add()
        d.players.filter((p) => p.teamId === teamId).forEach((p) => add(p.id))
      })
    })
  const addManual = () => {
    if (!f.who || !f.title.trim()) return
    const [kind, id] = f.who.split(':')
    const a: Award = { id: `aw-${Date.now().toString(36)}`, tier: f.tier, title: f.title.trim(), tournamentId: f.tournamentId || undefined, date: new Date().toISOString().slice(0, 10) }
    if (kind === 'p') a.playerId = id
    else a.teamId = id
    update((d) => (d.awards = [...(d.awards ?? []), a]))
  }
  const owner = (a: Award) => (a.playerId ? db.players.find((p) => p.id === a.playerId)?.nick : db.teams.find((t) => t.id === a.teamId)?.name) ?? '?'
  const shown = awards.map((a, i) => ({ a, i })).filter(({ a }) => `${a.title} ${owner(a)} ${db.tournaments.find((t) => t.id === a.tournamentId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="panel pad form">
      <h3>Кубки по итогам турниров</h3>
      <p className="muted small">Кубки получают команда и её текущий состав. Повторная выдача не создаёт дублей.</p>
      {db.tournaments.map((t) => {
        const pod = podium(db, t)
        return (
          <div key={t.id} className="form-row award-tour">
            <b>{t.name}</b>
            <span className="muted small">{pod.length ? pod.map((id, i) => `${i + 1}. ${db.teams.find((x) => x.id === id)?.name ?? id}`).join('  ') : 'финал ещё не сыгран'}</span>
            <button className="btn btn-ghost" disabled={!pod.length} onClick={() => issue(t)}>
              Выдать кубки
            </button>
          </div>
        )
      })}

      <h3>Особая награда</h3>
      <div className="form-row">
        <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
          <option value="">Кому…</option>
          <optgroup label="Игроки">
            {db.players.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.nick}
              </option>
            ))}
          </optgroup>
          <optgroup label="Команды">
            {db.teams.map((t) => (
              <option key={t.id} value={`t:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
        <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value as AwardTier })}>
          {TIERS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input placeholder="Название награды" value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <select value={f.tournamentId} onChange={(e) => setF({ ...f, tournamentId: e.target.value })}>
          <option value="">Без турнира</option>
          {db.tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-accent" disabled={!f.who} onClick={addManual}>
          Выдать
        </button>
      </div>

      <h3>Выданные награды ({awards.length})</h3>
      <input placeholder="Поиск: награда, игрок, команда, турнир" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-scroll">
        <table className="table">
          <tbody>
            {shown.map(({ a, i }) => (
              <tr key={a.id}>
                <td>
                  <TrophyIcon tier={a.tier} size={24} />
                </td>
                <td className="left">
                  <input value={a.title} onChange={(e) => update((d) => (d.awards![i].title = e.target.value))} />
                </td>
                <td className="left">{a.playerId ? `игрок ${owner(a)}` : `команда ${owner(a)}`}</td>
                <td className="left muted small">{db.tournaments.find((t) => t.id === a.tournamentId)?.name ?? a.date}</td>
                <td>
                  <button className="btn-x" title="Забрать награду" onClick={() => update((d) => (d.awards = (d.awards ?? []).filter((x) => x.id !== a.id)))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlayersAdmin({ db, update, users = [] }: P & { users?: AdminUser[] }) {
  const [q, setQ] = useState('')
  const [nick, setNick] = useState('')
  const rows = db.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => `${p.nick} ${p.faculty ?? ''} ${db.teams.find((t) => t.id === p.teamId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const free = db.players.filter((p) => !p.teamId || !db.teams.some((t) => t.id === p.teamId)).length
  const drop = (ids: Set<string>) =>
    update((d) => {
      d.players = d.players.filter((p) => !ids.has(p.id))
      d.teams.forEach((t) => {
        if (t.captainId && ids.has(t.captainId)) delete t.captainId
      })
    })
  return (
    <div className="panel pad form">
      <div className="form-row">
        <input placeholder="Поиск: ник, институт, команда" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="Ник нового игрока" value={nick} onChange={(e) => setNick(e.target.value)} />
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (!nick.trim()) return
            update((d) => d.players.push({ id: `p-${slug(nick)}-${Date.now() % 100000}`, nick: nick.trim(), role: 'Свободный игрок' }))
            setNick('')
          }}
        >
          + Игрок
        </button>
      </div>
      <p className="muted small">
        Всего игроков: {db.players.length}, без команды: {free}. Показано: {rows.length}.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="left">Ник</th>
              <th className="left">Роль</th>
              <th className="left">Институт</th>
              <th className="left">Команда</th>
              <th className="left">Аккаунт</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, i }) => (
              <tr key={p.id}>
                <td className="left">
                  <input value={p.nick} onChange={(e) => update((d) => (d.players[i].nick = e.target.value))} />
                </td>
                <td className="left">
                  <input value={p.role ?? ''} onChange={(e) => update((d) => (d.players[i].role = e.target.value))} />
                </td>
                <td className="left">
                  <input value={p.faculty ?? ''} onChange={(e) => update((d) => (d.players[i].faculty = e.target.value))} />
                </td>
                <td className="left">
                  <select value={p.teamId ?? ''} onChange={(e) => update((d) => (d.players[i].teamId = e.target.value || undefined))}>
                    <option value="">Свободный агент</option>
                    {db.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="left">
                  <AccountLink users={users} p={p} i={i} update={update} />
                </td>
                <td>
                  <button className="btn-x" title="Удалить игрока" onClick={() => window.confirm(`Удалить игрока ${p.nick}?`) && drop(new Set([p.id]))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions danger">
        <button
          className="btn btn-ghost"
          disabled={rows.length === 0}
          onClick={() => window.confirm(`Удалить показанных игроков (${rows.length})?`) && drop(new Set(rows.map(({ p }) => p.id)))}
        >
          Удалить показанных ({rows.length})
        </button>
        <button
          className="btn btn-ghost"
          disabled={free === 0}
          onClick={() =>
            window.confirm(`Удалить всех игроков без команды (${free})?`) &&
            drop(new Set(db.players.filter((p) => !p.teamId || !db.teams.some((t) => t.id === p.teamId)).map((p) => p.id)))
          }
        >
          Удалить свободных агентов ({free})
        </button>
        <button
          className="btn btn-ghost"
          disabled={db.players.length === 0}
          onClick={() => window.confirm(`Удалить ВСЕХ игроков (${db.players.length})?`) && drop(new Set(db.players.map((p) => p.id)))}
        >
          Удалить всех игроков
        </button>
      </div>
    </div>
  )
}
