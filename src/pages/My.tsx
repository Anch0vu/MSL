import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarLink } from '../components/Calendar'
import { Empty, TeamLogo } from '../components/ui'
import { useAccount } from '../lib/account'
import { api, useData, useDB } from '../lib/data'
import { matchHref } from '../lib/matches'

interface MyMatch {
  t: string
  s: string
  k: string
  tour: string
  stage: string
  a: string
  b: string
  bo: number
  status: 'scheduled' | 'live' | 'finished'
  scoreA: number | null
  scoreB: number | null
  start: string | null
  team: string
  manage: boolean
  checkedIn: boolean
  oppCheckedIn: boolean
  report: string | null
  oppReport: string | null
}

interface Mine {
  teams: { id: string; name: string; manage: boolean }[]
  matches: MyMatch[]
  tg: { linked: boolean; bot: string | null }
  now: string
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const hm = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Кабинет капитана: матчи своих команд, чек-ин и отчёты, привязка Telegram, календарь. */
export function MyMatches() {
  const { mode } = useData()
  const { user, ready } = useAccount()
  const [d, setD] = useState<Mine | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => api<Mine>('mymatches').then(setD, (e) => setMsg(err(e)))
  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
  if (mode !== 'api') return <div className="wrap page"><Empty>Раздел работает только при подключённом API.</Empty></div>
  if (!ready) return <div className="wrap page"><Empty>Загрузка…</Empty></div>
  if (!user)
    return (
      <div className="wrap page narrow">
        <h1 className="page-title">Мои матчи</h1>
        <div className="panel pad">
          Войдите в <Link to="/account">личный кабинет</Link>, чтобы видеть матчи своих команд, проходить чек-ин и привязать Telegram.
        </div>
      </div>
    )
  const now = d ? Date.parse(d.now) : Date.now()
  const upcoming = d?.matches.filter((m) => m.status !== 'finished') ?? []
  const done = d?.matches.filter((m) => m.status === 'finished') ?? []
  return (
    <div className="wrap page">
      <h1 className="page-title">Мои матчи</h1>
      {msg && <div className="error">{msg}</div>}
      {d && (
        <>
          {d.teams.length ? (
            <div className="my-teams">
              {d.teams.map((t) => (
                <div key={t.id} className="panel my-team">
                  <Link to={`/teams/${t.id}`}>{t.name}</Link>
                  {t.manage && <span className="badge badge-registration">капитан</span>}
                  <CalendarLink q={`team=${encodeURIComponent(t.id)}`} className="btn btn-ghost btn-sm" />
                </div>
              ))}
            </div>
          ) : (
            <div className="panel pad">
              Вы пока не в составе команды. <Link to="/register">Подайте заявку</Link> или найдите команду в разделе <Link to="/agents">«Ищут команду»</Link>.
            </div>
          )}
          <TgBlock tg={d.tg} reload={load} />
          <section>
            <h2 className="my-h">Ближайшие</h2>
            {upcoming.length ? upcoming.map((m) => <Row key={`${m.t}|${m.s}|${m.k}`} m={m} now={now} />) : <Empty>Назначенных матчей нет</Empty>}
          </section>
          {done.length > 0 && (
            <section>
              <h2 className="my-h">Сыгранные</h2>
              {done.map((m) => (
                <Row key={`${m.t}|${m.s}|${m.k}`} m={m} now={now} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Row({ m, now }: { m: MyMatch; now: number }) {
  const { team } = useDB()
  const start = m.start ? Date.parse(m.start) : null
  const tags: [string, string][] = []
  if (m.status === 'scheduled' && start && m.manage) {
    if (now < start - 1800_000) tags.push(['', `чек-ин с ${hm(start - 1800_000)}`])
    else if (now <= start) tags.push(m.checkedIn ? ['ok', '✓ чек-ин пройден'] : ['warn', 'пройдите чек-ин'])
    if (m.oppCheckedIn) tags.push(['', 'соперник отметился'])
  }
  if (m.status !== 'scheduled' && m.manage && m.status !== 'finished') {
    if (m.report === 'conflict') tags.push(['warn', 'спор по счёту'])
    else if (m.report) tags.push(['ok', 'отчёт отправлен'])
    else tags.push(['warn', m.oppReport ? 'соперник прислал счёт — подтвердите' : 'отправьте результат'])
  }
  const mine = m.team === m.a ? 'a' : 'b'
  const won = m.status === 'finished' && m.scoreA != null && m.scoreB != null ? (mine === 'a' ? m.scoreA > m.scoreB : m.scoreB > m.scoreA) : null
  return (
    <Link to={matchHref({ tid: m.t, stageId: m.s, key: m.k })} className={`panel my-row${m.status === 'live' ? ' live' : ''}${won === true ? ' won' : won === false ? ' lost' : ''}`}>
      <span className="my-when">{m.status === 'live' ? 'идёт сейчас' : m.start ? when(m.start) : 'время не назначено'}</span>
      <span className="my-vs">
        <TeamLogo team={team(m.a)} size={22} />
        <b className={m.team === m.a ? 'me' : ''}>{team(m.a)?.name ?? m.a}</b>
        <span className="my-score">{m.status === 'scheduled' ? 'vs' : `${m.scoreA ?? 0}:${m.scoreB ?? 0}`}</span>
        <b className={m.team === m.b ? 'me' : ''}>{team(m.b)?.name ?? m.b}</b>
        <TeamLogo team={team(m.b)} size={22} />
      </span>
      <span className="muted small">
        {m.tour}
        {m.stage ? ` · ${m.stage}` : ''} · Bo{m.bo}
      </span>
      {tags.length > 0 && (
        <span className="my-tags">
          {tags.map(([c, t]) => (
            <span key={t} className={`my-tag ${c}`}>
              {t}
            </span>
          ))}
        </span>
      )}
    </Link>
  )
}

function TgBlock({ tg, reload }: { tg: Mine['tg']; reload: () => void }) {
  const { readonly } = useData()
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('')
  if (!tg.bot && !tg.linked)
    return <div className="panel pad my-tg muted small">Telegram-бот лиги ещё не подключён организатором. Когда он появится, здесь можно будет включить напоминания о чек-ине.</div>
  return (
    <div className="panel pad my-tg">
      <b>Telegram</b>
      {tg.linked ? (
        <>
          <span className="ok-text">Привязан: бот напомнит о чек-ине, а пройти его можно командой /checkin.</span>
          <button
            className="btn btn-ghost"
            disabled={readonly}
            onClick={async () => {
              await api('tgunlink', { method: 'POST', body: {} }).catch((e) => setMsg(err(e)))
              reload()
            }}
          >
            Отвязать
          </button>
        </>
      ) : url ? (
        <>
          <a className="btn btn-accent" href={url} target="_blank" rel="noreferrer">
            Открыть бота
          </a>
          <span className="muted small">Нажмите «Start» в Telegram. Ссылка действует 15 минут, потом обновите страницу.</span>
        </>
      ) : (
        <>
          <span className="muted small">Бот пришлёт напоминание за 30 минут до матча, чек-ин можно пройти командой /checkin, расписание — /next.</span>
          <button
            className="btn btn-accent"
            disabled={readonly}
            onClick={async () => {
              setMsg('')
              try {
                setUrl((await api<{ url: string }>('tglink', { method: 'POST', body: {} })).url)
              } catch (e) {
                setMsg(err(e))
              }
            }}
          >
            Привязать Telegram
          </button>
        </>
      )}
      {tg.bot && (
        <a className="muted small" href={`https://t.me/${tg.bot}`} target="_blank" rel="noreferrer">
          @{tg.bot}
        </a>
      )}
      {msg && <span className="error">{msg}</span>}
    </div>
  )
}
