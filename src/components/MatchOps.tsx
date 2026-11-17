import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useData, useDB } from '../lib/data'
import { useAccount } from '../lib/account'
import { SectionHead } from './ui'
import { Picks } from './Picks'
import type { Seed } from '../lib/types'

/** Игрок в игре OpenDota (сокращённо, см. fxGameData в api/features.php). */
interface GamePlayer {
  acc: number
  rad: boolean
  hero: number
  heroName: string
  heroImg: string
  name: string
  k: number
  d: number
  a: number
  lh: number
  gpm: number
  xpm: number
  dmg: number
  nw: number
}

export interface DotaGame {
  matchId: number
  radiant: string
  dire: string
  winner: string
  radiantWin: boolean
  duration: number
  start: number
  score: [number, number]
  players: GamePlayer[]
  mvp: number | null
}

interface Report {
  id?: string
  teamId: string
  scoreA?: number
  scoreB?: number
  status: 'pending' | 'conflict' | 'applied' | 'rejected'
  createdAt?: string
  games?: string[]
}

interface Info {
  mid: string
  a: string
  b: string
  bo: number
  status: string
  side: 'a' | 'b' | null
  admin: boolean
  start: string | null
  checkinOpen: string | null
  now: string
  checkins: Record<string, string>
  games: DotaGame[]
  reports: Report[]
  autoForfeit: boolean
}

const msk = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Скриншот → JPEG до 1600 px по ширине, не больше ~1,3 МБ (лимит API 1,4 МБ). */
function shrinkShot(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = Math.min(1600, img.width)
      for (let q = 0.85; ; q -= 0.1) {
        const c = document.createElement('canvas')
        c.width = w
        c.height = Math.round((img.height * w) / img.width)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        const data = c.toDataURL('image/jpeg', Math.max(0.4, q))
        if (data.length * 0.75 < 1_300_000 || w < 500) return resolve(data)
        if (q < 0.5) w = Math.round(w * 0.75)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать картинку'))
    }
    img.src = url
  })
}

/** Чек-ин, отчёт капитанов о результате и игры Dota 2 из OpenDota на странице матча. */
export function MatchOps({ tid, stageId, mkey, a, b }: { tid: string; stageId: string; mkey: string; a: Seed; b: Seed }) {
  const { mode, reload, readonly } = useData()
  const { user } = useAccount()
  const [info, setInfo] = useState<Info | null>(null)
  const [msg, setMsg] = useState('')
  const [skew, setSkew] = useState(0)
  const [, tick] = useState(0)
  const q = `t=${encodeURIComponent(tid)}&s=${encodeURIComponent(stageId)}&k=${encodeURIComponent(mkey)}`
  const ready = mode === 'api' && !!a && !!b && a !== 'BYE' && b !== 'BYE'

  const load = () =>
    api<Info>('matchinfo', { query: q })
      .then((r) => {
        setInfo(r)
        setSkew(Date.parse(r.now) - Date.now())
      })
      .catch(() => setInfo(null))

  useEffect(() => {
    if (!ready) return
    load()
    const t = setInterval(() => tick((x) => x + 1), 20_000)
    const l = setInterval(load, 60_000)
    return () => {
      clearInterval(t)
      clearInterval(l)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q, user?.id])

  if (!ready || !info) return null
  const act = async (route: string, body: object, after?: (r: unknown) => void) => {
    setMsg('')
    try {
      const r = await api(route, { method: 'POST', body: { t: tid, s: stageId, k: mkey, ...body } })
      after?.(r)
      await load()
    } catch (e) {
      setMsg(err(e))
    }
  }
  const done = info.status === 'finished'
  const can = !readonly && (!!info.side || info.admin)
  return (
    <>
      {!done && info.start && <Checkin info={info} skew={skew} act={act} />}
      <Picks tid={tid} stageId={stageId} mkey={mkey} a={info.a} b={info.b} status={info.status} />
      {!done && info.side && !readonly && <ReportForm info={info} act={act} onApplied={reload} />}
      {msg && <div className="error">{msg}</div>}
      <Games info={info} canAdd={can} admin={info.admin && !readonly} act={act} onChange={reload} />
    </>
  )
}

type Act = (route: string, body: object, after?: (r: unknown) => void) => Promise<void>

function Checkin({ info, skew, act }: { info: Info; skew: number; act: Act }) {
  const { team } = useDB()
  const now = Date.now() + skew
  const open = Date.parse(info.checkinOpen!)
  const start = Date.parse(info.start!)
  const mine = info.side ? info[info.side] : null
  return (
    <section className="panel pad mo-checkin">
      <div className="mo-head">
        <b>Чек-ин</b>
        <span className="muted small">
          с {msk(info.checkinOpen!)} до {msk(info.start!)} МСК
        </span>
      </div>
      <div className="mo-ci-teams">
        {[info.a, info.b].map((id) => (
          <div key={id} className={info.checkins[id] ? 'ok' : ''}>
            <span>{info.checkins[id] ? '✓' : '…'}</span>
            {team(id)?.name ?? id}
            <small className="muted">{info.checkins[id] ? `в ${msk(info.checkins[id])}` : now > start ? 'не прошла' : 'ожидаем'}</small>
          </div>
        ))}
      </div>
      {mine && !info.checkins[mine] && now >= open && now <= start && (
        <button className="btn btn-accent" onClick={() => act('checkin', {})}>
          Пройти чек-ин за {team(mine)?.name}
        </button>
      )}
      {mine && now < open && <p className="muted small">Кнопка появится за 30 минут до начала матча.</p>}
      <p className="muted small">
        {info.autoForfeit
          ? 'Команда, не прошедшая чек-ин к началу матча, получает техническое поражение.'
          : 'Капитан или владелец команды подтверждает готовность за 30 минут до начала.'}
      </p>
    </section>
  )
}

function ReportForm({ info, act, onApplied }: { info: Info; act: Act; onApplied: () => Promise<void> }) {
  const { team } = useDB()
  const win = Math.floor(info.bo / 2) + 1
  const [sa, setSa] = useState(0)
  const [sb, setSb] = useState(0)
  const [shot, setShot] = useState('')
  const [games, setGames] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState('')
  const mine = info.side ? info[info.side] : ''
  const myRep = info.reports.find((r) => r.teamId === mine)
  const theirs = info.reports.find((r) => r.teamId !== mine)
  const opts = Array.from({ length: info.bo + 1 }, (_, i) => i)
  return (
    <section className="panel pad form mo-report">
      <div className="mo-head">
        <b>Результат матча</b>
        <span className="muted small">Bo{info.bo} · засчитывается, когда обе команды пришлют одинаковый счёт</span>
      </div>
      {myRep && (
        <div className={myRep.status === 'conflict' ? 'warn-text' : 'ok-text'}>
          Ваш отчёт: {myRep.scoreA}:{myRep.scoreB}.{' '}
          {myRep.status === 'conflict'
            ? `Соперник прислал ${theirs?.scoreA}:${theirs?.scoreB}. Организатор проверит скриншоты; можно отправить отчёт заново.`
            : theirs
              ? 'Соперник тоже отправил отчёт.'
              : 'Ждём подтверждения соперника.'}
        </div>
      )}
      {!myRep && theirs && <div className="warn-text">Соперник уже отправил результат. Подтвердите его своим отчётом со скриншотом.</div>}
      <div className="form-row mo-score">
        <label>
          {team(info.a)?.name ?? 'A'}
          <select value={sa} onChange={(e) => setSa(+e.target.value)}>
            {opts.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          {team(info.b)?.name ?? 'B'}
          <select value={sb} onChange={(e) => setSb(+e.target.value)}>
            {opts.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Скриншот итогов (обязательно)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) shrinkShot(f).then(setShot, (er) => setState(err(er)))
          }}
        />
      </label>
      {shot && <img className="mo-shot" src={shot} alt="Скриншот" />}
      <label>
        Match ID игр (необязательно, через пробел) — статистика подтянется из OpenDota
        <input value={games} placeholder="8012345678 8012349999" onChange={(e) => setGames(e.target.value)} />
      </label>
      <div className="form-actions">
        <button
          className="btn btn-accent"
          disabled={busy || !shot || (sa !== win && sb !== win)}
          onClick={async () => {
            setBusy(true)
            setState('')
            await act('report', { scoreA: sa, scoreB: sb, shot, games }, (r) => {
              const st = (r as { state?: string }).state
              setState(st === 'applied' ? 'Результат засчитан: счёт совпал с отчётом соперника.' : st === 'conflict' ? 'Счёт не совпал с отчётом соперника — решит организатор.' : 'Отправлено. Ждём подтверждения соперника.')
              if (st === 'applied') onApplied()
            })
            setBusy(false)
          }}
        >
          {busy ? 'Отправляем…' : 'Отправить результат'}
        </button>
        {sa !== win && sb !== win && <span className="muted small">Победитель серии набирает {win}</span>}
        {state && <span className="small">{state}</span>}
      </div>
    </section>
  )
}

function Games({ info, canAdd, admin, act, onChange }: { info: Info; canAdd: boolean; admin: boolean; act: Act; onChange: () => Promise<void> }) {
  const { team, db } = useDB()
  const [id, setId] = useState('')
  const [side, setSide] = useState<'' | 'a' | 'b'>('')
  const [busy, setBusy] = useState(false)
  if (!info.games.length && !canAdd) return null
  const nick = (acc: number, fallback: string) => db.players.find((p) => p.steamId === String(acc)) ?? { id: '', nick: fallback || 'Аноним' }
  return (
    <section>
      <SectionHead title="Игры (OpenDota)" />
      {info.games.map((g, i) => (
        <div key={g.matchId} className="panel mo-game">
          <div className="panel-head">
            Игра {i + 1} · победа <b>{team(g.winner)?.name ?? g.winner}</b>
            <span className="muted small">
              {g.score[0]}:{g.score[1]} · {mmss(g.duration)}
            </span>
            <a className="mo-od" href={`https://www.opendota.com/matches/${g.matchId}`} target="_blank" rel="noreferrer">
              {g.matchId}
            </a>
            {admin && (
              <button className="btn-x" title="Убрать игру" onClick={() => window.confirm('Убрать игру из матча?') && act('delgame', { matchId: g.matchId }, () => onChange())}>
                ✕
              </button>
            )}
          </div>
          <div className="mo-sides">
            {[true, false].map((rad) => (
              <div key={String(rad)}>
                <div className="mo-side-name">
                  {rad ? 'Radiant' : 'Dire'} · {team(rad ? g.radiant : g.dire)?.name}
                  {rad === g.radiantWin && <span className="mo-win">победа</span>}
                </div>
                <table className="table mo-table">
                  <tbody>
                    {g.players
                      .filter((p) => p.rad === rad)
                      .map((p) => {
                        const pl = nick(p.acc, p.name)
                        return (
                          <tr key={`${p.acc}-${p.hero}`}>
                            <td className="left">
                              {p.heroImg && <img className="mo-hero" src={p.heroImg} alt="" title={p.heroName} loading="lazy" />}
                            </td>
                            <td className="left mo-nick">
                              {pl.id ? <Link to={`/players/${pl.id}`}>{pl.nick}</Link> : pl.nick}
                              {g.mvp != null && g.mvp === (p.acc || p.hero) && <span className="mo-mvp" title="MVP">MVP</span>}
                              <small className="muted">{p.heroName}</small>
                            </td>
                            <td>
                              {p.k}/{p.d}/{p.a}
                            </td>
                            <td className="hide-sm muted">{p.gpm} GPM</td>
                            <td className="hide-sm muted">{(p.dmg / 1000).toFixed(1)}k</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ))}
      {canAdd && (
        <div className="panel pad form-row mo-add">
          <label>
            Match ID или ссылка OpenDota/Dotabuff
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="8012345678" />
          </label>
          <label>
            За Radiant играли
            <select value={side} onChange={(e) => setSide(e.target.value as '' | 'a' | 'b')}>
              <option value="">определить по Steam</option>
              <option value="a">{team(info.a)?.name}</option>
              <option value="b">{team(info.b)?.name}</option>
            </select>
          </label>
          <button
            className="btn btn-ghost"
            disabled={busy || !id.trim()}
            onClick={async () => {
              setBusy(true)
              await act('addgame', { matchId: id, radiant: side }, () => {
                setId('')
                onChange()
              })
              setBusy(false)
            }}
          >
            {busy ? 'Загружаем из OpenDota…' : 'Добавить игру'}
          </button>
        </div>
      )}
    </section>
  )
}
