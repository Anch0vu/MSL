import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UcIco } from '../components/UniBracket'
import { api, useDB } from '../lib/data'
import { allMatches, byDate, fmtDate, type MatchView } from '../lib/matches'
import { CS2_POOL, seriesOf, useObs, type ObsMap, type ObsState } from '../lib/obsState'
import type { Seed } from '../lib/types'
import { PartnersBar, Stage, UcHead, useLive, useNow, usePickMatch, useTour, vars } from './Obs'
import '../styles/obs2.css'

/*
 * Сцены трансляции в стиле Unicup, управляемые с пульта (lib/obsState.ts).
 * Всё, что можно задать в адресе (?title=, ?min=…), по-прежнему работает: адрес сильнее пульта.
 */

// ---------- общие куски ----------

export interface Hero {
  id: number
  name: string
  img: string
}

let heroReq: Promise<Record<number, Hero>> | null = null

/** Справочник героев Dota 2 (id → имя и картинка): один запрос на страницу. */
export function useHeroes(): Record<number, Hero> {
  const [map, setMap] = useState<Record<number, Hero>>({})
  useEffect(() => {
    heroReq ??= api<Hero[]>('obsheroes')
      .then((l) => Object.fromEntries(l.map((h) => [h.id, h])) as Record<number, Hero>)
      .catch(() => {
        heroReq = null
        return {} as Record<number, Hero>
      })
    let alive = true
    void heroReq.then((m) => alive && setMap(m))
    return () => {
      alive = false
    }
  }, [])
  return map
}

/** Серия: адрес → пульт → запись матча на сайте. */
export function useSeries(m: MatchView | undefined, q: URLSearchParams) {
  const { state } = useObs()
  return seriesOf(state, q, m)
}

/** Цель отсчёта: ?at=19:00, ?min=10 или «до» из пульта (ISO). */
function useCountTarget(): number {
  const [q] = useSearchParams()
  const { state } = useObs()
  const until = state.brk?.until
  const fromUrl = useMemo(() => {
    const at = q.get('at')
    const min = Number(q.get('min'))
    if (at && /^\d{1,2}:\d{2}$/.test(at)) {
      const [h, m] = at.split(':').map(Number)
      const d = new Date()
      d.setHours(h, m, 0, 0)
      return d.getTime()
    }
    return min > 0 ? Date.now() + min * 60_000 : 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (fromUrl) return fromUrl
  const t = until ? Date.parse(until) : 0
  return Number.isFinite(t) ? t : 0
}

function Clock({ target }: { target: number }) {
  const now = useNow()
  if (!target) return null
  const left = Math.max(0, Math.round((target - now) / 1000))
  const txt = left > 0 ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : 'LIVE'
  return (
    <div className="o2-clock" aria-label={txt}>
      {Array.from(txt).map((ch, i) => (
        <span key={`${i}${ch}`}>{ch}</span>
      ))}
    </div>
  )
}

function Ring() {
  return <i className="o2-ring" aria-hidden />
}

function Row({ m, i }: { m: MatchView; i: number }) {
  const { team } = useDB()
  const a = team(m.a)
  const b = team(m.b)
  const when = m.status === 'live' ? 'LIVE' : m.date ? (fmtDate(m.date, true).split(', ')[1] ?? fmtDate(m.date, true)) : 'TBD'
  return (
    <div className={`o2-row${m.status === 'live' ? ' live' : ''}`} style={vars({ '--i': i })}>
      <span className="t">{when}</span>
      <span className="o2-team">
        <UcIco seed={m.a} size={34} />
        <b>{a?.tag ?? m.hintA}</b>
      </span>
      <span className="bo">Bo{m.bo}</span>
      <span className="o2-team r">
        <UcIco seed={m.b} size={34} />
        <b>{b?.tag ?? m.hintB}</b>
      </span>
    </div>
  )
}

function Upcoming({ n = 5, title = 'Расписание' }: { n?: number; title?: string }) {
  const { db } = useDB()
  const tour = useTour()
  const list = allMatches(db)
    .filter((m) => (!tour || m.tid === tour.id) && (m.status === 'scheduled' || m.status === 'live') && m.a !== 'BYE' && m.b !== 'BYE')
    .sort(byDate)
    .slice(0, n)
  return (
    <div className="o2-sched">
      <div className="o2-h">{title}</div>
      {!list.length && <div className="o2-empty">Расписание появится позже</div>}
      {list.map((m, i) => (
        <Row key={`${m.stageId}/${m.key}`} m={m} i={i} />
      ))}
    </div>
  )
}

// ---------- ожидание, перерыв, финал ----------

export function Starting() {
  useLive(30)
  const tour = useTour()
  const [q] = useSearchParams()
  const { state } = useObs()
  const target = useCountTarget()
  return (
    <Stage cls="uc ucs">
      <UcHead />
      <Ring />
      <div className="o2-left">
        <div className="o2-kicker">
          <span>{q.get('title') || state.brk?.title || 'Трансляция скоро начнётся'}</span>
        </div>
        {target ? <Clock target={target} /> : <div className="o2-big">STARTING SOON</div>}
        <div className="o2-sub">{q.get('sub') || state.brk?.sub || tour?.format}</div>
      </div>
      <div className="o2-right">
        <Upcoming n={5} />
      </div>
      <PartnersBar />
    </Stage>
  )
}

export function Brb() {
  useLive(15)
  const [q] = useSearchParams()
  const { state } = useObs()
  const target = useCountTarget()
  return (
    <Stage cls="uc ucs">
      <UcHead chip="BREAK" />
      <Ring />
      <div className="o2-left">
        <div className="o2-kicker">
          <span>{q.get('title') || state.brk?.title || 'Технический перерыв'}</span>
        </div>
        {target ? <Clock target={target} /> : <div className="o2-big">BE RIGHT BACK</div>}
        <div className="o2-sub">{q.get('sub') || state.brk?.sub || 'Скоро вернёмся'}</div>
      </div>
      <div className="o2-right">
        <Upcoming n={5} title="Дальше в эфире" />
      </div>
      <PartnersBar />
    </Stage>
  )
}

export function Ending() {
  useLive(30)
  const { db } = useDB()
  const [q] = useSearchParams()
  const s = db.settings ?? {}
  const links = [s.twitchChannel && `twitch.tv/${s.twitchChannel}`, s.telegramUrl?.replace(/^https?:\/\//, ''), s.discordUrl?.replace(/^https?:\/\//, ''), s.vkUrl?.replace(/^https?:\/\//, ''), 'cup.rut-miit.su'].filter(Boolean) as string[]
  return (
    <Stage cls="uc ucs">
      <UcHead />
      <Ring />
      <div className="o2-left">
        <div className="o2-kicker">
          <span>{q.get('title') || 'Спасибо, что были с нами'}</span>
        </div>
        <div className="o2-big">THANKS FOR WATCHING</div>
        <div className="o2-sub">{q.get('next') ? `Следующий игровой день: ${q.get('next')}` : 'Следите за анонсами лиги'}</div>
        <div className="o2-links">
          {links.map((l, i) => (
            <span key={l} style={vars({ '--i': i })}>
              {l}
            </span>
          ))}
        </div>
      </div>
      <div className="o2-right">
        <Upcoming n={4} title="Ближайшие матчи" />
      </div>
      <PartnersBar />
    </Stage>
  )
}

/** Расписание на весь экран, для перерывов между матчами. */
export function Schedule() {
  useLive(20)
  return (
    <Stage cls="uc ucs">
      <UcHead chip="SCHEDULE" />
      <div className="o2-wide">
        <Upcoming n={9} title="Расписание матчей" />
      </div>
      <PartnersBar />
    </Stage>
  )
}

// ---------- комментаторы ----------

export function Casters() {
  useLive()
  const [q] = useSearchParams()
  const { state } = useObs()
  const m = usePickMatch()
  const { team } = useDB()
  const fromState = state.casters?.filter((c) => c.name.trim()) ?? []
  const n = Math.min(3, Math.max(1, Number(q.get('cams')) || fromState.length || 2))
  const cw = n === 1 ? 960 : n === 2 ? 780 : 560
  const ch = Math.round((cw * 9) / 16)
  const gap = 40
  const x0 = (1920 - (n * cw + (n - 1) * gap)) / 2
  const y0 = 190
  const holes = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch }))
  const path = 'M0 0H1920V1080H0Z ' + holes.map((r) => `M${r.x} ${r.y}v${r.h}h${r.w}v-${r.h}Z`).join(' ')
  const a = m ? team(m.a) : undefined
  const b = m ? team(m.b) : undefined
  return (
    <Stage cls="uc ucs o2-cast">
      <svg className="o2-mask" viewBox="0 0 1920 1080" aria-hidden>
        <path d={path} fill="#fff" fillRule="evenodd" />
        {holes.map((r, i) => (
          <g key={i} stroke="#f50db4" strokeWidth="6" fill="none">
            <path d={`M${r.x - 10} ${r.y + 50}V${r.y - 10}H${r.x + 50}`} />
            <path d={`M${r.x + r.w + 10} ${r.y + r.h - 50}V${r.y + r.h + 10}H${r.x + r.w - 50}`} />
          </g>
        ))}
      </svg>
      <UcHead chip={m ? m.tournament : 'STUDIO'} />
      {holes.map((r, i) => {
        const c = fromState[i]
        const name = q.get(`c${i + 1}`) || c?.name
        const role = q.get(`r${i + 1}`) || c?.role
        const social = c?.social
        return name ? (
          <div key={i} className="o2-plate" style={{ left: r.x, top: r.y + r.h + 18, width: r.w, ['--i' as string]: i }}>
            <b>{name}</b>
            {role && <span>{role}</span>}
            {social && <small>{social}</small>}
          </div>
        ) : null
      })}
      {m && (
        <div className="o2-strip" style={{ top: y0 + ch + 150 }}>
          <span className="o2-team">
            <UcIco seed={m.a} size={56} />
            <b>{a?.name ?? m.hintA}</b>
          </span>
          <span className="o2-vs">
            <i>{m.label || m.stage}</i>
            <b>VS</b>
            <em>Bo{m.bo}</em>
          </span>
          <span className="o2-team r">
            <UcIco seed={m.b} size={56} />
            <b>{b?.name ?? m.hintB}</b>
          </span>
        </div>
      )}
      <PartnersBar />
    </Stage>
  )
}

// ---------- плашка с именем и бегущая строка ----------

export function Lower() {
  const [q] = useSearchParams()
  const { state } = useObs()
  const L = state.lower
  const url = q.get('name')
  const name = url ?? L?.name ?? ''
  const role = url ? (q.get('role') ?? '') : (L?.role ?? '')
  const social = url ? (q.get('social') ?? '') : (L?.social ?? '')
  const hold = url ? Number(q.get('hold') ?? 0) : (L?.hold ?? 8)
  const fire = url ? 1 : (L?.fire ?? 0)
  const [vis, setVis] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (!fire) return
    // при загрузке сцены показываем только свежий запуск, иначе плашка «залипает» после перезапуска OBS
    const fresh = Date.now() - fire < Math.max(hold, 1) * 1000
    if (first.current && !url && !fresh && hold > 0) {
      first.current = false
      return
    }
    first.current = false
    setVis(true)
    if (hold <= 0) return
    const t = setTimeout(() => setVis(false), hold * 1000)
    return () => clearTimeout(t)
  }, [fire, hold, url])
  const on = vis && (url ? true : L?.on !== false)
  return (
    <Stage cls="obs-hud">
      <div className={`o2-lower${on ? ' in' : ''}`}>
        <i />
        <div>
          <b>{name}</b>
          <span>{role}</span>
        </div>
        {social && <small>{social}</small>}
      </div>
    </Stage>
  )
}

export function Ticker() {
  const { state } = useObs()
  const t = state.ticker
  const items = (t?.items ?? []).filter((x) => x.trim())
  const on = !!t?.on && items.length > 0
  const text = items.join('   ///   ')
  return (
    <Stage cls="obs-hud">
      <div className={`o2-ticker${on ? ' in' : ''}`}>
        <span className="o2-tk-label">INFO</span>
        <div className="o2-tk-run">
          <div style={{ animationDuration: `${Math.max(18, text.length * 0.2)}s` }}>
            <span>{text}</span>
            <span>{text}</span>
          </div>
        </div>
      </div>
    </Stage>
  )
}

// ---------- HUD ----------

/** Счёт серии поверх игры: тег, логотип, квадраты счёта, результаты карт и название текущей карты. */
export function Hud() {
  useLive(5)
  const { team } = useDB()
  const m = usePickMatch()
  const [q] = useSearchParams()
  const { state } = useObs()
  const tour = useTour()
  const { sa, sb, bo } = useSeries(m, q)
  if (!m)
    return (
      <Stage cls="obs-hud">
        <div className="uh uh-idle">
          <i />
          <b>{tour?.name ?? 'КИБЕРЛИГА'}</b>
          <span>ожидаем матч</span>
        </div>
      </Stage>
    )
  const a = team(m.a)
  const b = team(m.b)
  const need = Math.ceil(bo / 2)
  const pips = (s: number) => (
    <span className="uh-pips">
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < s ? 'on' : ''} style={vars({ '--i': i })} />
      ))}
    </span>
  )
  const maps = state.maps ?? []
  const cur = maps.findIndex((x) => x.status === 'live')
  const idx = cur >= 0 ? cur : maps.findIndex((x) => x.status !== 'done')
  const curMap = idx >= 0 ? maps[idx] : undefined
  return (
    <Stage cls="obs-hud">
      <div className="uh uh-hud">
        <div className="uh-bar">
          <div className="uh-side a">
            <UcIco seed={m.a} size={64} />
            <div className="uh-nm">
              <b>{a?.tag || a?.name || m.hintA}</b>
              {pips(sa)}
            </div>
          </div>
          <span key={`a${sa}`} className={`uh-sc${sa > sb ? ' uh-ld' : ''}`}>
            {sa}
          </span>
          <span className="uh-mid">BO{bo}</span>
          <span key={`b${sb}`} className={`uh-sc${sb > sa ? ' uh-ld' : ''}`}>
            {sb}
          </span>
          <div className="uh-side b">
            <UcIco seed={m.b} size={64} />
            <div className="uh-nm">
              <b>{b?.tag || b?.name || m.hintB}</b>
              {pips(sb)}
            </div>
          </div>
        </div>
        <div className="uh-sub">
          <span>{curMap ? `MAP ${idx + 1} · ${curMap.name}` : m.label || m.stage}</span>
          <em>{m.tournament}</em>
        </div>
        {maps.length > 0 && (
          <div className="o2-hmaps">
            {maps.map((x, i) => (
              <span key={i} className={`${x.status ?? 'next'}${i === idx ? ' cur' : ''}`}>
                <i>{i + 1}</i>
                {x.name}
                {x.status === 'done' && (
                  <u className={(x.a ?? 0) > (x.b ?? 0) ? 'a' : 'b'}>
                    {x.a ?? 0}:{x.b ?? 0}
                  </u>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </Stage>
  )
}

// ---------- вето карт ----------

function tagOf(team: (s: Seed) => { tag: string } | undefined, m: MatchView | undefined, who?: string): string {
  if (who !== 'a' && who !== 'b') return ''
  if (!m) return who.toUpperCase()
  const t = team(who === 'a' ? m.a : m.b)
  return t?.tag ?? (who === 'a' ? 'A' : 'B')
}

export function Veto() {
  useLive(30)
  const { team } = useDB()
  const m = usePickMatch()
  const { state } = useObs()
  const [q] = useSearchParams()
  const pool = state.pool?.length ? state.pool : CS2_POOL
  const steps = state.veto ?? []
  const byMap = new Map(steps.map((s, i) => [s.map.toLowerCase(), { s, i }]))
  const mode = (q.get('mode') ?? state.vetoMode ?? 'bo3').toUpperCase()
  const t = (who?: string) => tagOf(team, m, who)
  const last = steps.slice(-4)
  return (
    <Stage cls="uc ucs">
      <UcHead chip={m?.tournament} />
      <div className="o2-vhead">
        <span className="o2-team">
          {m && <UcIco seed={m.a} size={76} />}
          <b>{m ? (team(m.a)?.name ?? m.hintA) : 'Team A'}</b>
        </span>
        <span className="o2-vtitle">
          <i>MAP VETO</i>
          <em>{mode}</em>
        </span>
        <span className="o2-team r">
          {m && <UcIco seed={m.b} size={76} />}
          <b>{m ? (team(m.b)?.name ?? m.hintB) : 'Team B'}</b>
        </span>
      </div>
      <div className="o2-vgrid" style={vars({ '--n': pool.length })}>
        {pool.map((name, k) => {
          const hit = byMap.get(name.toLowerCase())
          const s = hit?.s
          const cls = s ? s.action : 'free'
          return (
            <div key={name} className={`o2-vcard ${cls}`} style={vars({ '--i': k })}>
              <i className="n">{String(k + 1).padStart(2, '0')}</i>
              {hit && <i className="o">#{hit.i + 1}</i>}
              <b>{name}</b>
              {s && (
                <div className="st" key={`${s.action}${s.team}`}>
                  <span className="tag">
                    {s.action === 'decider' ? 'DECIDER' : `${s.action.toUpperCase()} · ${t(s.team)}`}
                  </span>
                  {s.action === 'pick' && s.side && s.sideTeam && (
                    <span className="side">
                      {t(s.sideTeam)} · {s.side}
                    </span>
                  )}
                  {s.action === 'decider' && s.side && s.sideTeam && (
                    <span className="side">
                      {t(s.sideTeam)} · {s.side}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="o2-vlog">
        {last.map((s, i) => (
          <span key={`${steps.length}-${i}`} style={vars({ '--i': i })}>
            <i>{String(steps.length - last.length + i + 1).padStart(2, '0')}</i>
            {s.action === 'decider' ? 'DECIDER' : `${t(s.team)} ${s.action.toUpperCase()}`} <b>{s.map}</b>
          </span>
        ))}
      </div>
      <PartnersBar />
    </Stage>
  )
}

// ---------- драфт Dota 2 ----------

function DraftCol({ side, tag, picks, bans, heroes, sideName }: { side: 'a' | 'b'; tag: string; picks: number[]; bans: number[]; heroes: Record<number, Hero>; sideName?: string }) {
  return (
    <div className={`o2-dcol ${side}`}>
      <div className="o2-dh">
        <b>{tag}</b>
        {sideName && <span>{sideName}</span>}
      </div>
      <div className="o2-picks">
        {Array.from({ length: 5 }, (_, i) => {
          const h = heroes[picks[i]]
          return (
            <div key={`${i}-${picks[i] ?? 'x'}`} className={`o2-pick${h ? ' on' : ''}`} style={vars({ '--i': i })}>
              {h ? <img src={h.img} alt="" /> : <i>{i + 1}</i>}
              <b>{h?.name ?? ''}</b>
            </div>
          )
        })}
      </div>
      <div className="o2-bans">
        {Array.from({ length: 7 }, (_, i) => {
          const h = heroes[bans[i]]
          return (
            <div key={`${i}-${bans[i] ?? 'x'}`} className={`o2-ban${h ? ' on' : ''}`} style={vars({ '--i': i })} title={h?.name}>
              {h && <img src={h.img} alt="" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Пики и баны Dota 2: колонки героев по краям, центр прозрачный под клиент игры. */
export function Draft() {
  useLive(30)
  const { team } = useDB()
  const m = usePickMatch()
  const { state } = useObs()
  const [q] = useSearchParams()
  const heroes = useHeroes()
  const { sa, sb } = useSeries(m, q)
  const d = state.draft
  const a = m ? team(m.a) : undefined
  const b = m ? team(m.b) : undefined
  const sideName = (s: 'a' | 'b') => {
    if (!d?.sideA) return undefined
    const radiant = (d.sideA === 'radiant') === (s === 'a')
    return radiant ? 'RADIANT' : 'DIRE'
  }
  return (
    <Stage cls="obs-hud">
      <div className="uh uh-picks">
        <div className="uh-ptop">
          <div className="uh-pteam a">
            {m && <UcIco seed={m.a} size={84} />}
            <b>{a?.name ?? m?.hintA ?? 'Команда A'}</b>
            <span className={`uh-psc${sa > sb ? ' uh-ld' : ''}`}>{sa}</span>
          </div>
          <div className="uh-pmid">
            <span className="uh-ptitle">{d?.phase === 'ban' ? 'Баны' : d?.phase === 'pick' ? 'Пики' : 'Пики и баны'}</span>
            <span className="uh-pstage">{m ? `${m.label || m.stage} · Bo${m.bo}` : 'Ожидаем матч'}</span>
          </div>
          <div className="uh-pteam b">
            <span className={`uh-psc${sb > sa ? ' uh-ld' : ''}`}>{sb}</span>
            <b>{b?.name ?? m?.hintB ?? 'Команда B'}</b>
            {m && <UcIco seed={m.b} size={84} />}
          </div>
        </div>
        <DraftCol side="a" tag={a?.tag ?? 'A'} picks={d?.a.picks ?? []} bans={d?.a.bans ?? []} heroes={heroes} sideName={sideName('a')} />
        <DraftCol side="b" tag={b?.tag ?? 'B'} picks={d?.b.picks ?? []} bans={d?.b.bans ?? []} heroes={heroes} sideName={sideName('b')} />
        <div className="uh-pbot">
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden>
            <rect width="40" height="40" fill="#f50db4" />
            <path d="M11 27 L24 14 M17 27 L28 16 M23 27 L29 21 M20 13 H28 V21" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="square" />
          </svg>
          <b>КИБЕРЛИГА</b>
          <PartnersBar cls="uh-pp" />
        </div>
      </div>
    </Stage>
  )
}

/** Подбирает сцену по игре: Dota 2 — драфт на героях, остальное — вето карт. */
export function Picks() {
  const { state } = useObs()
  const [q] = useSearchParams()
  const tour = useTour()
  const mode = q.get('mode') ?? (state.draft && !state.veto?.length ? 'draft' : '')
  const game = q.get('game') || tour?.game || ''
  if (mode === 'draft' || (!mode && game === 'dota2')) return <Draft />
  return <Veto />
}

// ---------- итог карты ----------

export function MapResult() {
  useLive(5)
  const { team } = useDB()
  const m = usePickMatch()
  const { state } = useObs()
  const [q] = useSearchParams()
  const maps: ObsMap[] = state.maps ?? []
  const want = q.get('n') ? Number(q.get('n')) - 1 : -1
  let idx = want
  if (idx < 0) for (let i = maps.length - 1; i >= 0; i--) if (maps[i].status === 'done') { idx = i; break }
  const mp = maps[idx]
  const { sa, sb, bo } = useSeries(m, q)
  const next = maps.find((x, i) => i > idx && x.status !== 'done')
  const a = m ? team(m.a) : undefined
  const b = m ? team(m.b) : undefined
  const fire = state.fire?.mapresult ?? 0
  if (!m || !mp) return <Stage cls="uc ucs" />
  const ma = mp.a ?? 0
  const mb = mp.b ?? 0
  return (
    <Stage cls="uc ucs">
      <div key={`${idx}-${fire}-${ma}-${mb}`} className="o2-mr">
        <UcHead chip={m.tournament} />
        <div className="o2-mr-tag">
          <span>MAP {idx + 1}</span>
          <b>{mp.name}</b>
        </div>
        <div className="o2-mr-grid">
          <div className="o2-mr-team a">
            <UcIco seed={m.a} size={200} />
            <b>{a?.name ?? m.hintA}</b>
            {ma > mb && <u>WINNER</u>}
          </div>
          <div className="o2-mr-score">
            <span className={ma > mb ? 'w' : ''}>{ma}</span>
            <i>:</i>
            <span className={mb > ma ? 'w' : ''}>{mb}</span>
          </div>
          <div className="o2-mr-team b">
            <UcIco seed={m.b} size={200} />
            <b>{b?.name ?? m.hintB}</b>
            {mb > ma && <u>WINNER</u>}
          </div>
        </div>
        <div className="o2-mr-series">
          <span>SERIES</span>
          <b>
            {sa} — {sb}
          </b>
          <em>Bo{bo}</em>
          {next && <span className="nx">NEXT · {next.name}</span>}
        </div>
        <PartnersBar />
      </div>
    </Stage>
  )
}

export const LIVE_SCENES: Record<string, () => JSX.Element> = {
  starting: Starting,
  brb: Brb,
  ending: Ending,
  schedule: Schedule,
  casters: Casters,
  lower: Lower,
  ticker: Ticker,
  hud: Hud,
  veto: Veto,
  draft: Draft,
  picks: Picks,
  mapresult: MapResult,
}

export type { ObsState, ReactNode }
