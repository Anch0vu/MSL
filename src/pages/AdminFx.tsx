import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { config } from '../config'
import { MatchOps } from '../components/MatchOps'
import { api, useData, useDB } from '../lib/data'
import { ResultLog } from '../components/ResultLog'
import { allMatches, matchHref, type MatchView } from '../lib/matches'
import type { DB } from '../lib/types'

interface Report {
  id: string
  t: string
  s: string
  k: string
  teamId: string
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  status: 'pending' | 'conflict' | 'applied' | 'rejected'
  createdAt: string
  games: string[]
  shot: boolean
}

const STATUS: Record<Report['status'], string> = { pending: 'ждёт соперника', conflict: 'спор', applied: 'засчитан', rejected: 'отклонён' }
const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Отчёты капитанов о результатах и игры OpenDota по матчам. */
export function ResultsAdmin({ db, dirty, onChanged }: { db: DB; dirty: boolean; onChanged: () => Promise<void> }) {
  const [list, setList] = useState<Report[] | null>(null)
  const [open, setOpen] = useState(true)
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState('')
  const load = () => api<Report[]>('reports').then(setList, (e) => setMsg(err(e)))
  useEffect(() => {
    load()
  }, [])
  const name = (id: string) => db.teams.find((t) => t.id === id)?.name ?? id
  const where = (r: Report) => {
    const t = db.tournaments.find((x) => x.id === r.t)
    return `${t?.short ?? t?.name ?? r.t} · ${t?.stages.find((s) => s.id === r.s)?.name ?? r.s} · ${r.k}`
  }
  const decide = async (r: Report, action: 'apply' | 'reject') => {
    setMsg('')
    try {
      await api('reportdecide', { method: 'POST', body: { id: r.id, action } })
      await load()
      if (action === 'apply') await onChanged()
    } catch (e) {
      setMsg(err(e))
    }
  }
  const shown = (list ?? []).filter((r) => !open || r.status === 'pending' || r.status === 'conflict')
  const matches = allMatches(db).filter((m) => m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE')
  const cur = matches.find((m) => `${m.tid}|${m.stageId}|${m.key}` === pick)
  return (
    <div className="form">
      {dirty && <div className="warn-text">В черновике есть неопубликованные изменения: засчитанный результат сразу попадает на сервер, черновик объединится с ним при публикации.</div>}
      <p className="muted small">
        Капитаны отправляют счёт со скриншотом на странице матча. Одинаковые отчёты обеих команд засчитываются сами, расхождения попадают сюда как «спор».
      </p>
      <div className="seg">
        <button className={open ? 'on' : ''} onClick={() => setOpen(true)}>
          Требуют решения ({(list ?? []).filter((r) => r.status === 'pending' || r.status === 'conflict').length})
        </button>
        <button className={!open ? 'on' : ''} onClick={() => setOpen(false)}>
          Все ({list?.length ?? 0})
        </button>
      </div>
      {msg && <div className="error">{msg}</div>}
      {list && !shown.length && <div className="empty">Отчётов нет</div>}
      {shown.map((r) => (
        <div key={r.id} className={`panel pad app-card ${r.status === 'applied' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}`}>
          <div className="app-head">
            <span className={`badge ${r.status === 'conflict' ? 'badge-live' : 'badge-registration'}`}>{STATUS[r.status]}</span>
            <b>
              {name(r.teamA)} {r.scoreA}:{r.scoreB} {name(r.teamB)}
            </b>
            <Link className="muted small" to={matchHref({ tid: r.t, stageId: r.s, key: r.k })}>
              {where(r)}
            </Link>
          </div>
          <div className="app-body">
            <div>
              <small>Отправила</small> {name(r.teamId)} · {new Date(r.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
            {r.games.length > 0 && (
              <div>
                <small>Игры</small>{' '}
                {r.games.map((g) => (
                  <a key={g} href={`https://www.opendota.com/matches/${g}`} target="_blank" rel="noreferrer">
                    {g}{' '}
                  </a>
                ))}
              </div>
            )}
            {r.shot && (
              <a href={`${config.apiBase}?r=reportshot&id=${r.id}`} target="_blank" rel="noreferrer">
                <img className="mo-shot" src={`${config.apiBase}?r=reportshot&id=${r.id}`} alt="Скриншот" loading="lazy" />
              </a>
            )}
          </div>
          {(r.status === 'pending' || r.status === 'conflict') && (
            <div className="form-actions">
              <button className="btn btn-accent" onClick={() => decide(r, 'apply')}>
                Засчитать {r.scoreA}:{r.scoreB}
              </button>
              <button className="btn btn-ghost" onClick={() => decide(r, 'reject')}>
                Отклонить
              </button>
            </div>
          )}
        </div>
      ))}

      <h3>Игры Dota 2 из OpenDota</h3>
      <p className="muted small">Добавьте Match ID игр серии: счёт, карты и статистика турнира (герои, KDA, MVP) посчитаются сами.</p>
      <label>
        Матч
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— выберите матч —</option>
          {matches.map((m) => (
            <option key={`${m.tid}|${m.stageId}|${m.key}`} value={`${m.tid}|${m.stageId}|${m.key}`}>
              {m.tournament} · {m.stage} · {m.key}: {name(m.a as string)} — {name(m.b as string)} {m.status === 'finished' ? `(${m.scoreA}:${m.scoreB})` : ''}
            </option>
          ))}
        </select>
      </label>
      {cur && (
        <>
          <SetResult key={`sr${pick}`} m={cur} onDone={onChanged} />
          <MatchOps key={pick} tid={cur.tid} stageId={cur.stageId} mkey={cur.key} a={cur.a} b={cur.b} />
          <ResultLog key={`rl${pick}`} tid={cur.tid} stageId={cur.stageId} mkey={cur.key} />
        </>
      )}
    </div>
  )
}

interface Hooks {
  discord: string
  tgToken: string
  tgChat: string
  events: Record<string, boolean>
  labels: Record<string, string>
  backupDiscord: string
  backupTgChat: string
  bot: string | null
}

/** Уведомления в Discord (вебхук канала) и Telegram (бот + чат). Секреты хранятся на сервере, не в документе сайта. */
export function HooksAdmin() {
  const [h, setH] = useState<Hooks | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => api<Hooks>('hooks').then(setH, (e) => setMsg(err(e)))
  useEffect(() => {
    load()
  }, [])
  if (!h) return msg ? <div className="error">{msg}</div> : null
  const set = (p: Partial<Hooks>) => setH({ ...h, ...p })
  const save = async () => {
    setMsg('')
    try {
      await api('hooks', { method: 'POST', body: { discord: h.discord, tgToken: h.tgToken, tgChat: h.tgChat, events: h.events, backupDiscord: h.backupDiscord, backupTgChat: h.backupTgChat } })
      await load()
      setMsg('Сохранено')
    } catch (e) {
      setMsg(err(e))
    }
  }
  const test = async () => {
    setMsg('')
    try {
      const r = await api<Record<string, { code: number; info: string }>>('hooktest', { method: 'POST', body: {} })
      setMsg(
        Object.entries(r)
          .map(([k, v]) => `${k === 'discord' ? 'Discord' : 'Telegram'}: ${v.code >= 200 && v.code < 300 ? 'доставлено' : `ошибка ${v.code || ''} ${v.info}`}`)
          .join(' · '),
      )
    } catch (e) {
      setMsg(err(e))
    }
  }
  const setup = async () => {
    setMsg('')
    try {
      const r = await api<{ bot: string }>('tgsetup', { method: 'POST', body: {} })
      await load()
      setMsg(`Бот @${r.bot} подключён: команды работают, капитаны привязывают Telegram в «Моих матчах».`)
    } catch (e) {
      setMsg(err(e))
    }
  }
  return (
    <>
      <h3>Уведомления</h3>
      <p className="muted small">
        Discord: настройки канала → Интеграции → Вебхуки → скопировать URL. Telegram: бот от @BotFather, добавьте его в канал или чат админом; Chat ID канала вида -100… или @имя. Чтобы удалить ключ, введите «-».
      </p>
      <label>
        Discord webhook URL
        <input value={h.discord} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => set({ discord: e.target.value })} />
      </label>
      <div className="form-row">
        <label>
          Токен Telegram-бота
          <input value={h.tgToken} placeholder="123456:ABC…" onChange={(e) => set({ tgToken: e.target.value })} />
        </label>
        <label>
          Chat ID
          <input value={h.tgChat} placeholder="-1001234567890 или @channel" onChange={(e) => set({ tgChat: e.target.value })} />
        </label>
      </div>
      <div className="chips">
        {Object.entries(h.labels).map(([k, l]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={h.events[k] !== false} onChange={(e) => set({ events: { ...h.events, [k]: e.target.checked } })} /> {l}
          </label>
        ))}
      </div>
      <h4>Бэкапы вне серверов</h4>
      <p className="muted small">
        Каждую ночь зашифрованный дамп базы и исходники уходят в отдельный закрытый канал Discord и/или чат Telegram (через бота выше). Ключ расшифровки — /root/.cup-backup.key на основном сервере: сохраните его копию в менеджере паролей.
      </p>
      <div className="form-row">
        <label>
          Discord webhook для бэкапов (закрытый канал)
          <input value={h.backupDiscord} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => set({ backupDiscord: e.target.value })} />
        </label>
        <label>
          Chat ID Telegram для бэкапов
          <input value={h.backupTgChat} placeholder="-1001234567890" onChange={(e) => set({ backupTgChat: e.target.value })} />
        </label>
      </div>
      <h4>Telegram-бот для капитанов</h4>
      <p className="muted small">
        После сохранения токена нажмите «Подключить команды бота»: капитаны привяжут Telegram в разделе «Мои матчи», получат напоминание о чек-ине и смогут пройти его командой /checkin.
        {h.bot ? ` Сейчас: @${h.bot}.` : ''}
      </p>
      <div className="form-actions">
        <button className="btn btn-accent" onClick={save}>
          Сохранить уведомления
        </button>
        <button className="btn btn-ghost" onClick={test}>
          Проверить
        </button>
        <button className="btn btn-ghost" onClick={setup}>
          Подключить команды бота
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </>
  )
}

type Obj = Record<string, unknown>
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
/** Ключ элемента раздела: id, у записи матча — турнир|стадия|слот. */
const keyOf = (x: unknown): string => {
  const o = x as Obj
  if (!o || typeof o !== 'object') return JSON.stringify(x)
  return String(o.id ?? (o.tournamentId != null ? `${o.tournamentId}|${o.stageId}|${o.key}` : JSON.stringify(o)))
}

function mergeObj(b: Obj | undefined, m: Obj, t: Obj | undefined): Obj {
  if (!b || !t) return m
  const o: Obj = { ...t }
  for (const f of new Set([...Object.keys(b), ...Object.keys(m)])) {
    if (same(b[f], m[f])) continue
    if (f in m) o[f] = m[f]
    else delete o[f]
  }
  return o
}

/**
 * Переносит правки черновика (mine относительно base) на свежую версию с сервера (theirs):
 * сервер сам меняет документ (заявки, результаты капитанов, игры OpenDota, техпоражения), и эти изменения не теряются.
 */
export function rebase(base: DB, mine: DB, theirs: DB): DB {
  const B = base as unknown as Obj
  const M = mine as unknown as Obj
  const T = theirs as unknown as Obj
  const out: Obj = { ...T }
  for (const k of new Set([...Object.keys(B), ...Object.keys(M)])) {
    const b = B[k]
    const m = M[k]
    const t = T[k]
    if (same(b, m)) continue
    if (Array.isArray(m) && Array.isArray(b) && Array.isArray(t)) {
      const bm = new Map(b.map((x) => [keyOf(x), x]))
      const mm = new Map(m.map((x) => [keyOf(x), x]))
      const res = new Map(t.map((x) => [keyOf(x), x]))
      for (const [i, x] of mm) {
        if (same(bm.get(i), x)) continue
        res.set(i, x && typeof x === 'object' && !Array.isArray(x) ? mergeObj(bm.get(i) as Obj | undefined, x as Obj, res.get(i) as Obj | undefined) : x)
      }
      for (const i of bm.keys()) if (!mm.has(i)) res.delete(i)
      out[k] = [...res.values()]
    } else if (m && typeof m === 'object' && !Array.isArray(m) && b && typeof b === 'object' && t && typeof t === 'object') {
      out[k] = mergeObj(b as Obj, m as Obj, t as Obj)
    } else if (k in M) out[k] = m
    else delete out[k]
  }
  return out as unknown as DB
}

/** Ручной ввод счёта судьёй или организатором: публикуется сразу и попадает в журнал изменений. */
function SetResult({ m, onDone }: { m: MatchView; onDone: () => Promise<void> }) {
  const { team } = useDB()
  const [sa, setSa] = useState(m.scoreA ?? 0)
  const [sb, setSb] = useState(m.scoreB ?? 0)
  const [status, setStatus] = useState<'scheduled' | 'live' | 'finished'>(m.status === 'live' ? 'live' : 'finished')
  const [note, setNote] = useState(m.record?.note ?? '')
  const [msg, setMsg] = useState('')
  const opts = Array.from({ length: m.bo + 1 }, (_, i) => i)
  return (
    <div className="panel pad form mo-setres">
      <b>Счёт вручную</b>
      <div className="form-row">
        <label>
          {team(m.a)?.name ?? 'A'}
          <select value={sa} onChange={(e) => setSa(+e.target.value)}>
            {opts.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          {team(m.b)?.name ?? 'B'}
          <select value={sb} onChange={(e) => setSb(+e.target.value)}>
            {opts.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="scheduled">не сыгран</option>
            <option value="live">идёт</option>
            <option value="finished">сыгран</option>
          </select>
        </label>
      </div>
      <label>
        Примечание на странице матча
        <input value={note} placeholder="например, техническое поражение" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="form-actions">
        <button
          className="btn btn-accent"
          onClick={async () => {
            setMsg('')
            try {
              await api('setresult', { method: 'POST', body: { t: m.tid, s: m.stageId, k: m.key, scoreA: sa, scoreB: sb, status, note } })
              await onDone()
              setMsg('Сохранено')
            } catch (e) {
              setMsg(err(e))
            }
          }}
        >
          Сохранить счёт
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </div>
  )
}

/** Панель судьи: только результаты (споры по отчётам, счёт, игры OpenDota, жеребьёвка). */
export function RefereePanel({ onLogout }: { onLogout: () => void }) {
  const { published, reload, readonly } = useData()
  return (
    <div className="wrap page admin">
      <div className="page-title-row">
        <h1 className="page-title">Панель судьи</h1>
        <button className="btn btn-ghost" onClick={onLogout}>
          Выйти
        </button>
      </div>
      {readonly && <div className="warn-text">Сайт работает на резервном сервере: изменения сейчас не сохраняются.</div>}
      <p className="muted">Судья решает споры по отчётам капитанов, вносит счёт и игры OpenDota, проводит жеребьёвку сторон. Остальные разделы доступны организатору.</p>
      <ResultsAdmin db={published} dirty={false} onChanged={reload} />
    </div>
  )
}
