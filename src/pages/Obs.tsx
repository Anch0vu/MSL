import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bracket } from '../components/Bracket'
import { GroupTables } from '../components/GroupTable'
import { UcIco, UniBracket } from '../components/UniBracket'
import { usePartners } from '../components/Partners'
import { TeamLogo } from '../components/ui'
import { VoidSoundMark } from '../components/VoidSound'
import { config } from '../config'
import { api, teamMediaUrl, useData, useDB } from '../lib/data'
import { readObsKey, onObsKeyChange } from '../lib/obsKeys'
import { seriesOf, useObs } from '../lib/obsState'
import { OBS_SCENES, obsScenePath } from '../lib/obsScenes'
import { tourGame } from '../lib/games'
import { allMatches, byDate, fmtDate, fmtRange, type MatchView } from '../lib/matches'
import type { BracketStage, Team } from '../lib/types'
import '../styles/obs.css'

/*
 * Оверлеи для OBS (источник «Браузер», 1920×1080, прозрачный фон).
 * Данные берутся с сайта и обновляются каждые 10 секунд.
 * Параметры в адресе: t — турнир, m — матч (tid/stageId/key), остальное см. на странице /obs.
 */

const W = 1920
const H = 1080

/** Сцена 1920×1080, вписанная в окно источника; фон страницы прозрачный. */
export function Stage({ children, cls = '' }: { children?: ReactNode; cls?: string }) {
  const [k, setK] = useState(1)
  useEffect(() => {
    document.documentElement.classList.add('obs-root')
    const fit = () => setK(Math.min(window.innerWidth / W, window.innerHeight / H))
    fit()
    window.addEventListener('resize', fit)
    return () => {
      document.documentElement.classList.remove('obs-root')
      window.removeEventListener('resize', fit)
    }
  }, [])
  return (
    <div className="obs-stage" style={k === 1 ? undefined : { transform: `scale(${k})` }}>
      <div className={`obs ${cls}`}>{children}</div>
    </div>
  )
}

/** Перечитывает данные сайта, чтобы счёт и сетка менялись без перезагрузки источника. */
export function useLive(sec = 10) {
  const { reload, mode } = useData()
  useEffect(() => {
    if (mode !== 'api') return
    const t = setInterval(() => reload(), sec * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sec])
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Матч из ?m=tid/stageId/key, иначе текущий live, иначе ближайший. */
export function usePickMatch(): MatchView | undefined {
  const { db } = useDB()
  const [q] = useSearchParams()
  const m = q.get('m')
  const t = q.get('t')
  const { state } = useObs()
  const list = allMatches(db).filter((x) => (!t || x.tid === t) && x.status !== 'bye')
  if (q.get('demo') && db.teams.length >= 2) {
    // пробный матч двух первых команд: чтобы посмотреть оформление, пока в сетке нет матчей
    const tour = db.tournaments.find((x) => x.id === t) ?? db.tournaments[0]
    return {
      tid: tour?.id ?? '',
      tournament: tour?.name ?? '',
      stageId: 'demo',
      stage: 'Гранд-финал',
      key: 'demo',
      label: 'Гранд-финал',
      a: db.teams[0].id,
      b: db.teams[1].id,
      hintA: '',
      hintB: '',
      scoreA: 2,
      scoreB: 1,
      status: 'scheduled',
      date: new Date().toISOString().slice(0, 16),
      bo: 5,
    } as unknown as MatchView
  }
  if (m) return list.find((x) => `${x.tid}/${x.stageId}/${x.key}` === m)
  const L = state.live
  const picked = L && list.find((x) => x.tid === L.tid && x.stageId === L.stageId && x.key === L.key)
  if (picked) return picked
  return list.find((x) => x.status === 'live') ?? [...list].sort(byDate).find((x) => x.status === 'scheduled' && x.a !== 'BYE' && x.b !== 'BYE')
}

export function useTour() {
  const { db } = useDB()
  const [q] = useSearchParams()
  const { state } = useObs()
  const id = q.get('t') || (!q.get('demo') ? state.live?.tid : undefined)
  return id ? db.tournaments.find((t) => t.id === id) : db.tournaments.find((t) => t.status === 'live') ?? db.tournaments[0]
}

function Brand({ big }: { big?: boolean }) {
  return (
    <div className={`obs-brand${big ? ' big' : ''}`}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <path d="M3 3h34v28l-8 6H3z" fill="#e31b23" />
        <text x="20" y="25" fill="#fff" textAnchor="middle" fontSize="12" fontWeight="900">MSL</text>
      </svg>
      <div>
        <b>MOSCOW STUDENT&apos;S LEAGUE</b>
        <small>INDEPENDENT STUDENT ESPORTS</small>
      </div>
    </div>
  )
}

export function PartnersBar({ cls = '' }: { cls?: string }) {
  const list = usePartners()
  return (
    <div className={`obs-partners ${cls}`}>
      <span className="obs-partners-t">Партнёры</span>
      <span className="obs-pt vs">
        <VoidSoundMark size={22} /> VoidSound
      </span>
      {list.map((p) => (
        <span key={p.id} className="obs-pt">
          {p.logo ? <img src={p.logo} alt="" /> : null}
          {p.name}
        </span>
      ))}
    </div>
  )
}

function TeamPlate({ team, hint, side, score, win }: { team?: Team; hint: string; side: 'a' | 'b'; score?: number; win?: boolean }) {
  return (
    <div className={`obs-plate ${side}${win ? ' win' : ''}`} style={{ '--tc': team?.color ?? '#3a4658' } as React.CSSProperties}>
      <TeamLogo team={team} size={52} />
      <div className="obs-plate-name">
        <b>{team?.name ?? hint}</b>
        {team?.tag && <small>{team.tag}</small>}
      </div>
      {score != null && <span className="obs-plate-score">{score}</span>}
    </div>
  )
}

function Upcoming({ n = 4 }: { n?: number }) {
  const { db, team } = useDB()
  const tour = useTour()
  const list = allMatches(db)
    .filter((m) => (!tour || m.tid === tour.id) && (m.status === 'scheduled' || m.status === 'live') && m.a !== 'BYE' && m.b !== 'BYE')
    .sort(byDate)
    .slice(0, n)
  if (!list.length) return null
  return (
    <div className="obs-upcoming">
      <h3>Расписание</h3>
      {list.map((m) => (
        <div key={`${m.stageId}/${m.key}`} className={`obs-up-row${m.status === 'live' ? ' live' : ''}`}>
          <span className="obs-up-time">{m.status === 'live' ? 'LIVE' : m.date ? fmtDate(m.date).split(', ')[1] ?? fmtDate(m.date) : 'TBD'}</span>
          <span className="obs-up-team">
            <TeamLogo team={team(m.a)} size={30} /> <span>{team(m.a)?.name ?? m.hintA}</span>
          </span>
          <span className="obs-up-vs">Bo{m.bo}</span>
          <span className="obs-up-team r">
            <span>{team(m.b)?.name ?? m.hintB}</span> <TeamLogo team={team(m.b)} size={30} />
          </span>
        </div>
      ))}
    </div>
  )
}

function Countdown() {
  const [q] = useSearchParams()
  const now = useNow()
  const target = useMemo(() => {
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
  if (!target) return null
  const left = Math.max(0, Math.round((target - now) / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  return <div className="obs-count">{left > 0 ? `${mm}:${ss}` : 'Начинаем'}</div>
}

/** Фоновые линии в стиле лиги (SVG, масштабируется без потерь). */
function Lines() {
  return (
    <svg className="obs-lines" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="obs-g" x1="0" x2="1">
          <stop offset="0" stopColor="#e31b23" stopOpacity="0" />
          <stop offset=".5" stopColor="#e31b23" stopOpacity=".55" />
          <stop offset="1" stopColor="#e31b23" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} className="obs-line" style={{ animationDelay: `${-i * 1.7}s` }} d={`M-200 ${820 + i * 40} L700 ${420 + i * 40} L2200 ${420 + i * 40}`} stroke="url(#obs-g)" strokeWidth="2" fill="none" />
      ))}
    </svg>
  )
}

function Starting() {
  useLive(30)
  const tour = useTour()
  const [q] = useSearchParams()
  return (
    <Stage cls="obs-full">
      <Lines />
      <div className="obs-top">
        <Brand />
        <span className="obs-chip">{tour?.name}</span>
      </div>
      <div className="obs-center">
        <div className="obs-kicker">{q.get('title') || 'Трансляция скоро начнётся'}</div>
        <Countdown />
        <div className="obs-sub">{q.get('sub') || tour?.format}</div>
      </div>
      <div className="obs-side">
        <Upcoming />
      </div>
      <PartnersBar />
    </Stage>
  )
}

/** Вписывает сетку любого размера в отведённую область. */
function FitBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const b = box.current
    const i = inner.current
    if (!b || !i) return
    setK(Math.min(1.3, b.clientWidth / i.scrollWidth, b.clientHeight / i.scrollHeight))
  })
  return (
    <div ref={box} className="obs-bracket">
      <div ref={inner} className="obs-bracket-in" style={{ transform: `scale(${k})` }}>
        {children}
      </div>
    </div>
  )
}

function Brb() {
  useLive(15)
  const tour = useTour()
  const [q] = useSearchParams()
  const stage = tour?.stages.find((s) => s.type !== 'groups') ?? tour?.stages[0]
  return (
    <Stage cls="obs-full">
      <Lines />
      <div className="obs-top">
        <Brand />
        <span className="obs-chip">{q.get('title') || 'Технический перерыв'}</span>
      </div>
      <div className="obs-brb">
        {stage && stage.type !== 'groups' && tour ? (
          <FitBox>
            <Bracket stage={stage} tid={tour.id} />
          </FitBox>
        ) : (
          <div className="obs-kicker">Скоро вернёмся</div>
        )}
        <Upcoming n={5} />
      </div>
      <PartnersBar />
    </Stage>
  )
}

function Ending() {
  useLive(30)
  const { db } = useDB()
  const tour = useTour()
  const [q] = useSearchParams()
  const s = db.settings ?? {}
  const links = [s.twitchChannel && `twitch.tv/${s.twitchChannel}`, s.telegramUrl?.replace(/^https?:\/\//, ''), s.discordUrl?.replace(/^https?:\/\//, ''), s.vkUrl?.replace(/^https?:\/\//, ''), 'cup.rut-miit.su'].filter(Boolean)
  return (
    <Stage cls="obs-full">
      <Lines />
      <div className="obs-top">
        <Brand />
        <span className="obs-chip">{tour?.name}</span>
      </div>
      <div className="obs-center">
        <div className="obs-kicker">{q.get('title') || 'Спасибо, что были с нами'}</div>
        <div className="obs-sub">{q.get('next') ? `Следующий игровой день: ${q.get('next')}` : 'Следите за анонсами лиги'}</div>
        <div className="obs-links">
          {links.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>
      <div className="obs-side">
        <Upcoming />
      </div>
      <PartnersBar />
    </Stage>
  )
}

/** Сцена комментаторов: окна под камеры вырезаны в SVG-подложке, камеры ставятся в OBS под источник. */
function Casters() {
  useLive()
  const { team } = useDB()
  const m = usePickMatch()
  const [q] = useSearchParams()
  const n = Math.min(3, Math.max(1, Number(q.get('cams')) || 2))
  const cw = n === 1 ? 1100 : n === 2 ? 780 : 560
  const ch = Math.round((cw * 9) / 16)
  const gap = 40
  const x0 = (W - (n * cw + (n - 1) * gap)) / 2
  const y0 = 230
  const holes = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch }))
  const path = `M0 0H${W}V${H}H0Z ` + holes.map((r) => `M${r.x} ${r.y}v${r.h}h${r.w}v-${r.h}Z`).join(' ')
  return (
    <Stage cls="obs-casters">
      <svg className="obs-mask" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <linearGradient id="obs-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#06122e" />
            <stop offset="1" stopColor="#0b2a6b" />
          </linearGradient>
        </defs>
        <path d={path} fill="url(#obs-bg)" fillRule="evenodd" />
        {holes.map((r, i) => (
          <rect key={i} x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} fill="none" stroke="#2f7bff" strokeWidth="3" />
        ))}
      </svg>
      <div className="obs-top">
        <Brand />
        <span className="obs-chip">{m ? `${m.tournament} · ${m.stage}${m.label ? ` · ${m.label}` : ''}` : 'Студия'}</span>
      </div>
      {holes.map((r, i) => {
        const name = q.get(`c${i + 1}`)
        return name ? (
          <div key={i} className="obs-cam-name" style={{ left: r.x, top: r.y + r.h - 4, width: r.w }}>
            <span>{name}</span>
            {q.get(`r${i + 1}`) && <small>{q.get(`r${i + 1}`)}</small>}
          </div>
        ) : null
      })}
      {m && (
        <div className="obs-versus" style={{ top: y0 + ch + 90 }}>
          <TeamPlate team={team(m.a)} hint={m.hintA} side="a" score={m.scoreA} />
          <span className="obs-vs">VS<small>Bo{m.bo}</small></span>
          <TeamPlate team={team(m.b)} hint={m.hintB} side="b" score={m.scoreB} />
        </div>
      )}
      <PartnersBar />
    </Stage>
  )
}

/** HUD поверх игры: для Dota 2 две плашки по бокам верхней панели игры, для остальных дисциплин компактная полоса сверху. */
function Hud() {
  useLive(5)
  const { team } = useDB()
  const m = usePickMatch()
  const [q] = useSearchParams()
  const tour = useTour()
  if (!m)
    return (
      <Stage cls="obs-hud">
        <div className="uh uh-idle">
          <i />
          <b>{tour?.name ?? config.siteName}</b>
          <span>ожидаем матч</span>
        </div>
      </Stage>
    )
  const a = team(m.a)
  const b = team(m.b)
  const sa = Number(q.get('sa') ?? m.scoreA ?? 0)
  const sb = Number(q.get('sb') ?? m.scoreB ?? 0)
  const need = Math.ceil(m.bo / 2)
  const pips = (s: number) => (
    <span className="uh-pips">
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < s ? 'on' : ''} style={vars({ '--i': i })} />
      ))}
    </span>
  )
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
          <span className="uh-mid">BO{m.bo}</span>
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
          <span>{m.label || m.stage}</span>
          <em>{m.tournament}</em>
        </div>
      </div>
    </Stage>
  )
}

/** Плашка с именем (lower third): выезжает при показе источника. */
function Lower() {
  const [q] = useSearchParams()
  return (
    <Stage cls="obs-hud">
      <div className="obs-lower">
        <i className="obs-lower-bar" />
        <div>
          <b>{q.get('name') || 'Имя Фамилия'}</b>
          <span>{q.get('role') || 'Комментатор'}</span>
        </div>
        {q.get('social') && <small>{q.get('social')}</small>}
      </div>
    </Stage>
  )
}

const PICK_TITLE: Record<string, string> = { dota2: 'Пики и баны', cs2: 'Вето карт', valorant: 'Пики и баны карт', lol: 'Пики и баны', deadlock: 'Драфт' }

/** Пики и баны / вето / драфт: рамка вокруг экрана игры, центр прозрачный. Подпись зависит от дисциплины (?game=, ?title=). */
function Picks() {
  useLive()
  const { db, team } = useDB()
  const m = usePickMatch()
  const [q] = useSearchParams()
  const game = q.get('game') || db.tournaments.find((t) => t.id === m?.tid)?.game || ''
  const title = q.get('title') || PICK_TITLE[game] || 'Драфт'
  const a = m ? team(m.a) : undefined
  const b = m ? team(m.b) : undefined
  const sa = Number(q.get('sa') ?? m?.scoreA ?? 0)
  const sb = Number(q.get('sb') ?? m?.scoreB ?? 0)
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
            <span className="uh-ptitle">{title}</span>
            <span className="uh-pstage">{m ? `${m.label || m.stage} · Bo${m.bo}` : 'Ожидаем матч'}</span>
          </div>
          <div className="uh-pteam b">
            <span className={`uh-psc${sb > sa ? ' uh-ld' : ''}`}>{sb}</span>
            <b>{b?.name ?? m?.hintB ?? 'Команда B'}</b>
            {m && <UcIco seed={m.b} size={84} />}
          </div>
        </div>
        <div className="uh-pbot">
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden>
            <rect width="40" height="40" fill="#e31b23" />
            <path d="M11 27 L24 14 M17 27 L28 16 M23 27 L29 21 M20 13 H28 V21" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="square" />
          </svg>
          <b>MSL</b>
          <PartnersBar cls="uh-pp" />
        </div>
      </div>
    </Stage>
  )
}

/** Stinger-переход: 1,2 с, точка смены сцены на 0,6 с. Видео с альфа-каналом рендерится из этой страницы. */
function Stinger() {
  const [q] = useSearchParams()
  const [k, setK] = useState(0)
  useEffect(() => {
    if (!q.get('loop')) return
    const t = setInterval(() => setK((x) => x + 1), 2000)
    return () => clearInterval(t)
  }, [q])
  return (
    <Stage cls="obs-hud">
      <div key={k} className={`obs-sting${q.get('paused') ? ' paused' : ''}`} style={q.get('t') ? ({ '--t': `-${q.get('t')}ms` } as React.CSSProperties) : undefined}>
        <i className="s1" />
        <i className="s2" />
        <i className="s3" />
        <div className="sting-scan" />
        <div className="obs-sting-logo">
          <span className="sting-wordmark">MSL / ON AIR</span>
          <Brand big />
          <span className="obs-sting-x">
            × <VoidSoundMark size={44} /> VoidSound
          </span>
        </div>
      </div>
    </Stage>
  )
}

/** Перезапускает анимацию каждые loop секунд (?loop=10), иначе играет один раз и замирает на последнем кадре. */
function useReplay(name: string) {
  const [q] = useSearchParams()
  const { state } = useObs()
  const [k, setK] = useState(0)
  useEffect(() => {
    const sec = Number(q.get('loop'))
    if (!sec) return
    const t = setInterval(() => setK((x) => x + 1), sec * 1000)
    return () => clearInterval(t)
  }, [q])
  return `${k}.${state.fire?.[name] ?? 0}`
}

export const vars = (o: Record<string, string | number | undefined>) => o as React.CSSProperties

/* Оформление в стиле Uniswap Cup: белый холст, чёрное, один розовый акцент, моно-цифры, прямые углы. */
export function UcHead({ chip }: { chip?: string }) {
  const tour = useTour()
  return (
    <div className="ucs-head">
      <div className="ucs-left">
        <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden>
          <rect width="40" height="40" fill="#e31b23" />
          <path d="M11 27 L24 14 M17 27 L28 16 M23 27 L29 21 M20 13 H28 V21" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="square" />
        </svg>
        <span className="ucs-chip">{chip ?? tour?.name}</span>
      </div>
      <div className="ucs-word">
        <b>MSL</b>
        <span>· CUP ·</span>
      </div>
      <span className="ucs-chip dark">LIVESTREAM</span>
    </div>
  )
}

function UcLogo({ team, size }: { team?: Team; size: number }) {
  const img = teamMediaUrl(team, 'logo')
  return (
    <span className="ucs-logo" style={{ width: size, height: size, fontSize: size * 0.3 }}>
      {img ? <img src={img} alt="" /> : team ? team.tag.slice(0, 3) : '?'}
    </span>
  )
}

/** Заставка трансляции: розовая шторка, название лиги по буквам, кольцо рисуется линией. Около 4 секунд. */
function Intro() {
  useLive(30)
  const tour = useTour()
  const [q] = useSearchParams()
  const k = useReplay('intro')
  const title = q.get('title') || tour?.name || ''
  const sub = q.get('sub') || (tour ? fmtRange(tour.startDate, tour.endDate) : '')
  const tags = [sub, tour ? tourGame(tour) : '', tour?.format ?? ''].filter(Boolean)
  return (
    <Stage cls="uc ucs">
      <div key={k} className="ucs-in">
        <svg className="ucs-ring" viewBox="0 0 700 700" aria-hidden>
          <circle cx="350" cy="350" r="340" />
        </svg>
        <h1 className="ucs-big">
          {Array.from(config.siteName.toUpperCase()).map((ch, i) => (
            <span key={i} style={vars({ '--i': i })}>
              {ch}
            </span>
          ))}
        </h1>
        <div className="ucs-dot">· CUP ·</div>
        <div className="ucs-title">{title}</div>
        <div className="ucs-tags">
          {tags.map((c, i) => (
            <span key={c} style={vars({ '--i': i })}>
              {c}
            </span>
          ))}
        </div>
        <i className="ucs-wipe" />
        <PartnersBar />
      </div>
    </Stage>
  )
}

function TeamSide({ t, hint, cls, children }: { t?: Team; hint: string; cls: 'a' | 'b'; children?: ReactNode }) {
  return (
    <div className={`ucs-team ${cls}`}>
      <UcLogo team={t} size={290} />
      <b>{t?.name ?? hint}</b>
      {children}
    </div>
  )
}

/** Анонс матча: логотипы и составы по краям, «Final VS» посередине. */
function Versus() {
  useLive(10)
  const { db, team } = useDB()
  const m = usePickMatch()
  const k = useReplay('versus')
  if (!m) return <Stage cls="uc ucs" />
  const roster = (t?: Team) => db.players.filter((p) => t && p.teamId === t.id).slice(0, 6)
  const list = (t?: Team) => (
    <ul>
      {roster(t).map((p, i) => (
        <li key={p.id} style={vars({ '--i': i })}>
          <i>{String(i + 1).padStart(2, '0')}</i>
          <b>{p.nick}</b>
          {p.role && <small>{p.role}</small>}
        </li>
      ))}
    </ul>
  )
  const a = team(m.a)
  const b = team(m.b)
  return (
    <Stage cls="uc ucs">
      <div key={k} className="ucs-vs">
        <UcHead chip={m.tournament} />
        <div className="ucs-grid">
          <TeamSide t={a} hint={m.hintA} cls="a">
            {list(a)}
          </TeamSide>
          <div className="ucs-mid">
            <span className="ucs-ftag">{m.label || m.stage}</span>
            <span className="ucs-vst">VS</span>
            <span className="ucs-bo">Bo{m.bo}</span>
            <span className="ucs-date">
              {fmtDate(m.date, false)} {m.date?.split('T')[1] && <u>{m.date.split('T')[1].slice(0, 5)} МСК</u>}
            </span>
          </div>
          <TeamSide t={b} hint={m.hintB} cls="b">
            {list(b)}
          </TeamSide>
        </div>
        <PartnersBar />
      </div>
    </Stage>
  )
}

/** Итог матча: счёт в квадратах, победитель в розовом. Счёт вручную: ?sa=2&sb=1. */
function Result() {
  useLive(5)
  const { team } = useDB()
  const m = usePickMatch()
  const [q] = useSearchParams()
  const k = useReplay('result')
  const { state } = useObs()
  if (!m) return <Stage cls="uc ucs" />
  const a = team(m.a)
  const b = team(m.b)
  const { sa, sb } = seriesOf(state, q, m)
  const side = (t: Team | undefined, hint: string, score: number, win: boolean, cls: 'a' | 'b') => (
    <TeamSide t={t} hint={hint} cls={cls}>
      {win && <span className="ucs-winner">WINNER</span>}
      <span className={`ucs-score${win ? ' win' : ''}`}>{score}</span>
    </TeamSide>
  )
  return (
    <Stage cls="uc ucs ucs-res">
      <div key={k} className="ucs-vs">
        <UcHead chip={m.tournament} />
        <div className="ucs-grid">
          {side(a, m.hintA, sa, sa > sb, 'a')}
          <div className="ucs-mid">
            <span className="ucs-ftag">{m.label || m.stage}</span>
            <span className="ucs-vst">VS</span>
            <span className="ucs-bo">Bo{m.bo}</span>
          </div>
          {side(b, m.hintB, sb, sb > sa, 'b')}
        </div>
        <PartnersBar />
      </div>
    </Stage>
  )
}

/** Сетка турнира на весь экран: одиночная симметрично от центра, двойная прежним видом. ?s= этап. */
function BracketScene() {
  useLive(10)
  const tour = useTour()
  const [q] = useSearchParams()
  const stages = tour?.stages ?? []
  const { db } = useDB()
  const demo: BracketStage | undefined = q.get('demo') ? { id: 'demo', type: 'single', name: 'Плей-офф', size: 8, bo: 3, finalBo: 5, thirdPlace: true, seeds: db.teams.slice(0, 8).map((t) => t.id) } : undefined
  const stage = q.get('demo') ? demo : stages.find((s) => s.id === q.get('s')) ?? stages[0]
  return (
    <Stage cls="uc ucs">
      <UcHead />
      <div className="ucs-br">
        {tour && stage ? <FitBox>{stage.type === 'groups' ? <div className="obs-group-board"><h2>{stage.name}</h2><GroupTables stage={stage} tid={tour.id} /><p>И — сыграно · В — победы · Н — ничьи · П — поражения · +/− — разница карт · О — очки</p></div> : stage.type === 'single' ? <UniBracket stage={stage} tid={tour.id} /> : <Bracket stage={stage} tid={tour.id} />}</FitBox> : <div className="obs-bracket-empty"><b>Сетка ещё не опубликована</b><span>{tour ? 'Этапы и участники появятся после публикации организатором.' : 'Турнир пока не выбран.'}</span></div>}
      </div>
      <PartnersBar />
    </Stage>
  )
}

export const SCENES: Record<string, () => JSX.Element> = { bracket: BracketScene, intro: Intro, versus: Versus, result: Result, starting: Starting, casters: Casters, hud: Hud, brb: Brb, ending: Ending, lower: Lower, picks: Picks, stinger: Stinger }

export function ObsScene() {
  const { scene = '' } = useParams()
  const [params] = useSearchParams()
  const key = params.get('obskey') || ''
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    setAllowed(null)
    api<{ authorized: boolean }>('obsaccess', { method: 'POST', body: { key } })
      .then((res) => { if (active) setAllowed(res.authorized === true) })
      .catch(() => { if (active) setAllowed(false) })
    return () => { active = false }
  }, [key])
  if (allowed === null) return <div className="wrap page">Проверяем доступ к сцене…</div>
  if (!allowed) return <div className="wrap page"><h1>Доступ ограничен</h1><p>Получите ссылку на сцену у организатора.</p></div>
  const S = SCENES[scene]
  return S ? <S /> : <div className="wrap page">Нет такой сцены</div>
}

/** Страница со ссылками для OBS. */
export function ObsIndex({ children }: { children?: ReactNode }) {
  const [key, setKey] = useState(readObsKey)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    let active = true
    api<{ authorized: boolean }>('obsauth')
      .then((res) => { if (active) setAuthorized(res.authorized) })
      .catch(() => { if (active) setAuthorized(false) })
    return () => { active = false }
  }, [])
  useEffect(() => onObsKeyChange(() => setKey(readObsKey())), [])
  if (authorized === null) return <div className="wrap page">Проверка прав оператора…</div>
  if (!authorized) return <div className="wrap page narrow"><h1>Доступ к OBS закрыт</h1><p>Войдите в аккаунт организатора, судьи или оператора эфира.</p><p><Link to="/account">Личный кабинет</Link></p></div>
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${obsScenePath(id, key)}`)
      setCopied(id)
    } catch { setCopied('error:' + id) }
  }
  return (
    <div className="wrap page obs-index">
      <div className="obs-intro"><span className="obs-eyebrow">Центр трансляции</span><h1 className="page-title">Пульт и графика OBS</h1>
        <p className="muted">Выберите матч, настройте графику и добавьте сцены в OBS Studio. Изменения с пульта появятся в источниках автоматически.</p>
      </div>
      <ol className="obs-steps" aria-label="Подготовка эфира">
        <li><b>1. Подключите OBS</b><span>Создайте ключ устройства и скопируйте ссылку сцены.</span></li>
        <li><b>2. Выберите матч</b><span>Задайте счёт, карты и подписи в пульте ниже.</span></li>
        <li><b>3. Проверьте картинку</b><span>Откройте превью, затем добавьте источник «Браузер» в OBS.</span></li>
      </ol>
      <details className="obs-setup"><summary>Настройка OBS · 1920 × 1080 · 60 FPS</summary>
        <p>Источник «Браузер»: ширина 1920, высота 1080, пользовательский CSS — пустой. В OBS → Настройки → Видео выберите 60 FPS. Если для источника задана пользовательская частота кадров, также установите 60.</p>
        <p>Включите аппаратное ускорение браузерного источника в настройках OBS. Сравните замер в превью со статистикой OBS: пропущенными кадрами и задержкой отрисовки. Счётчик браузера измеряет графику страницы, а не FPS записи.</p>
      </details>
      {children}
      <section className="obs-library" aria-label="Сцены и ссылки">
        <h2>Сцены и ссылки для OBS</h2>
        <p className="muted">Одна ссылка на каждый источник. Обычные ссылки следуют пульту; тестовые данные и счётчик FPS включаются только в превью.</p>
        {!key && <p className="obs-notice">Создайте ключ устройства выше, чтобы копировать рабочие ссылки.</p>}
        {['До матча', 'В эфире', 'После матча'].map(group => <div className="obs-scene-group" key={group}>
          <h3>{group}</h3><div className="obs-scene-grid">
            {OBS_SCENES.filter(item => item.group === group).map(item => {
              const path = obsScenePath(item.id, key)
              return <article key={item.id} className="panel pad obs-item">
                <div><span className="obs-scene-id">{item.id}</span><h4>{item.title}</h4><p className="muted small">{item.description}</p></div>
                <div className="form-actions">
                  <button className="btn btn-ghost" disabled={!key} onClick={() => void copy(item.id)}>{copied === item.id ? 'Скопировано' : copied === 'error:' + item.id ? 'Не скопировано' : 'Копировать ссылку'}</button>
                  {key && <Link className="btn btn-ghost" to={path.slice(1)} target="_blank" rel="noreferrer">Открыть</Link>}
                </div>
                {key && <details className="obs-source-url"><summary>Адрес источника</summary><code>{location.origin}{location.pathname}{path}</code></details>}
              </article>
            })}
          </div>
        </div>)}
      </section>
      <div className="panel pad obs-item obs-stinger-download">
        <div><b>Stinger-переход MSL</b><p className="muted small">Готовый анимированный источник: 1920 × 1080, 60 FPS, длительность 1,2 с, точка смены сцены — 600 мс. Откройте источник для проверки или захвата в WebM с альфа-каналом.</p></div>
        {key ? <Link className="btn btn-accent" to={obsScenePath('stinger', key).slice(1)} target="_blank" rel="noreferrer">Открыть переход</Link> : <button className="btn btn-accent" disabled>Открыть переход</button>}
      </div>
    </div>
  )
}
