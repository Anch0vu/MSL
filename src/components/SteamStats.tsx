import { useEffect, useState } from 'react'
import { api, useData } from '../lib/data'
import { dotabuffUrl, opendotaUrl } from '../lib/dota'
import { fmtDate } from '../lib/matches'
import { deadlockRank, faceitColor, premierColor } from '../lib/ranks'

interface Hero {
  id: number
  name: string
  img: string
}

export interface GameStats {
  dota: null | {
    win: number
    lose: number
    heroes: (Hero & { games: number; win: number })[]
    recent: (Hero & { match: number; k: number; d: number; a: number; won: boolean; at: string; min: number; gpm?: number; xpm?: number })[]
    /** средние за последние n матчей */
    avg?: null | { k: number; d: number; a: number; gpm: number; xpm: number; lh: number; dmg: number; n: number; won: number }
  }
  cs2: null | {
    premier: number | null
    faceit: number | null
    faceitElo: number | null
    leetify: number | null
    winrate: number | null
    matches: number
    aim: number | null
    utility: number | null
    positioning: number | null
    hs: number | null
    recent: { map: string; won: boolean; score: string; at: string | null }[]
  }
  deadlock: null | { matches: number; wins: number; k: number; d: number; a: number; badge: number | null }
  at: string
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const kda = (k: number, d: number, a: number) => ((k + a) / Math.max(1, d)).toFixed(2)
const steam64 = (acc: string) => (BigInt(acc) + 76561197960265728n).toString()

interface Faceit {
  nick: string
  url: string
  level: number | null
  elo: number | null
  kd: number | null
  adr: number | null
  wr: number | null
  matches: number | null
  /** K/D и ADR посчитаны по последним матчам, а не за всё время. */
  recent: number
}

const FC = 'https://open.faceit.com/data/v4'
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

/** FACEIT Data API из браузера (сервер лиги FACEIT закрывает Cloudflare). */
async function loadFaceit(s64: string, key: string): Promise<Faceit | null> {
  const ck = `fc:${s64}`
  try {
    const c = JSON.parse(sessionStorage.getItem(ck) ?? 'null')
    if (c && c.t > Date.now() - 600_000) return c.v
  } catch {
    /* хранилище недоступно */
  }
  const h = { headers: { Authorization: `Bearer ${key}` } }
  const get = (u: string) => fetch(`${FC}${u}`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const p = await get(`/players?game=cs2&game_player_id=${s64}`)
  let v: Faceit | null = null
  if (p?.player_id) {
    const g = p.games?.cs2
    const [life, last] = await Promise.all([get(`/players/${p.player_id}/stats/cs2`), get(`/players/${p.player_id}/games/cs2/stats?limit=20`)])
    const lt = life?.lifetime ?? {}
    const items: Record<string, string>[] = (last?.items ?? []).map((i: { stats: Record<string, string> }) => i.stats ?? {})
    const avg = (k: string) => {
      const xs = items.map((s) => num(s[k])).filter((n): n is number => n != null)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
    }
    const kd = avg('K/D Ratio')
    const adr = avg('ADR')
    v = {
      nick: String(p.nickname ?? ''),
      url: `https://www.faceit.com/ru/players/${encodeURIComponent(String(p.nickname ?? ''))}`,
      level: num(g?.skill_level),
      elo: num(g?.faceit_elo),
      kd: kd != null ? +kd.toFixed(2) : num(lt['Average K/D Ratio']),
      adr: adr != null ? Math.round(adr) : num(lt['ADR']),
      wr: num(lt['Win Rate %']),
      matches: num(lt['Matches']),
      recent: kd != null ? items.length : 0,
    }
  }
  // уровень и ELO сохраняются на сервере, чтобы FACEIT был виден в списках команд и игроков без Leetify
  if (v?.level && v.elo) api('faceit', { method: 'POST', body: { steam: Number(BigInt(s64) - 76561197960265728n), level: v.level, elo: v.elo } }).catch(() => {})
  try {
    sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), v }))
  } catch {
    /* хранилище недоступно */
  }
  return v
}

function Bar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null
  return (
    <div className="stat-bar">
      <span>{label}</span>
      <i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      <b>{value}</b>
    </div>
  )
}

/** Статистика из API по Steam32 id; один запрос на страницу (шапка профиля и блок статистики). */
export function useGameStats(steamId?: string) {
  const { mode } = useData()
  const [s, setS] = useState<GameStats | null>(null)
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load')
  useEffect(() => {
    setS(null)
    if (mode !== 'api' || !steamId) return setState('err')
    let live = true
    setState('load')
    api<GameStats>('gamestats', { query: `steam=${encodeURIComponent(steamId)}` })
      .then((r) => {
        if (!live) return
        setS(r)
        setState('ok')
      })
      .catch(() => live && setState('err'))
    return () => {
      live = false
    }
  }, [steamId, mode])
  return { s, state }
}

/** Автоматическая статистика по привязанному Steam: Dota 2, CS2 (FACEIT/Premier через Leetify), Deadlock. */
export function SteamStats({ steamId, dotaRank, mmr, data }: { steamId: string; dotaRank: string; mmr?: number; data: ReturnType<typeof useGameStats> }) {
  const { mode, db } = useData()
  const fkey = db.settings?.faceitKey ?? ''
  const { s, state } = data
  const [fc, setFc] = useState<Faceit | null>(null)
  useEffect(() => {
    setFc(null)
    if (!fkey || !/^\d+$/.test(steamId)) return
    let live = true
    loadFaceit(steam64(steamId), fkey).then((v) => live && setFc(v))
    return () => {
      live = false
    }
  }, [steamId, fkey])
  if (mode !== 'api' || state === 'err') return null
  if (state === 'load') return <div className="empty small">Загружаем статистику из Steam…</div>
  if (!s || (!s.dota && !s.cs2 && !s.deadlock && !fc)) return <div className="empty small">Публичной статистики по Steam не нашли. Проверьте, что история матчей открыта.</div>
  const s64 = steam64(steamId)
  return (
    <div className="steam-stats">
      {s.dota && (
        <div className="stat-card g-dota2">
          <div className="stat-card-head">
            <b>Dota 2</b>
            <span>{dotaRank && `${dotaRank}${mmr != null ? ` · ${mmr}` : ''}`}</span>
          </div>
          <div className="stat-nums">
            <div>
              <b>{s.dota.win + s.dota.lose}</b>
              <small>матчей</small>
            </div>
            <div>
              <b>{pct(s.dota.win, s.dota.win + s.dota.lose)}%</b>
              <small>побед</small>
            </div>
            {s.dota.avg && (
              <>
                <div>
                  <b>{kda(s.dota.avg.k, s.dota.avg.d, s.dota.avg.a)}</b>
                  <small>
                    KDA · {s.dota.avg.k}/{s.dota.avg.d}/{s.dota.avg.a}
                  </small>
                </div>
                <div>
                  <b>{s.dota.avg.gpm}</b>
                  <small>GPM</small>
                </div>
                <div>
                  <b>{s.dota.avg.xpm}</b>
                  <small>XPM</small>
                </div>
                <div>
                  <b>
                    {s.dota.avg.won}–{s.dota.avg.n - s.dota.avg.won}
                  </b>
                  <small>за {s.dota.avg.n} игр</small>
                </div>
              </>
            )}
          </div>
          {s.dota.heroes.length > 0 && (
            <div className="hero-row">
              {s.dota.heroes.map((h) => (
                <div key={h.id} className="hero" title={`${h.name}: ${h.games} игр, ${pct(h.win, h.games)}% побед`}>
                  {h.img && <img src={h.img} alt="" loading="lazy" />}
                  <small>{h.name}</small>
                  <small className="muted">
                    {h.games} · {pct(h.win, h.games)}%
                  </small>
                </div>
              ))}
            </div>
          )}
          {s.dota.recent.length > 0 && (
            <div className="recent">
              {s.dota.recent.map((m) => (
                <a key={m.match} className={m.won ? 'w' : 'l'} href={`https://www.opendota.com/matches/${m.match}`} target="_blank" rel="noreferrer" title={`${m.name}, ${fmtDate(m.at)}, ${m.min} мин${m.gpm ? `, ${m.gpm} GPM` : ''}`}>
                  {m.img && <img src={m.img} alt="" loading="lazy" />}
                  <span>
                    {m.k}/{m.d}/{m.a}
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="stat-links">
            <a href={dotabuffUrl(steamId)} target="_blank" rel="noreferrer">
              Dotabuff
            </a>
            <a href={opendotaUrl(steamId)} target="_blank" rel="noreferrer">
              OpenDota
            </a>
            <a href={`https://stratz.com/players/${steamId}`} target="_blank" rel="noreferrer">
              STRATZ
            </a>
          </div>
        </div>
      )}
      {(s.cs2 || fc) && (
        <div className="stat-card g-cs2">
          <div className="stat-card-head">
            <b>Counter-Strike 2</b>
            {(fc?.level ?? s.cs2?.faceit) != null && (
              <span className="faceit-lvl" style={{ '--lvl': faceitColor((fc?.level ?? s.cs2?.faceit)!) } as React.CSSProperties} title="Уровень FACEIT">
                {fc?.level ?? s.cs2?.faceit}
              </span>
            )}
          </div>
          <div className="stat-nums">
            {(fc?.elo ?? s.cs2?.faceitElo) != null && (
              <div>
                <b>{fc?.elo ?? s.cs2?.faceitElo}</b>
                <small>FACEIT ELO</small>
              </div>
            )}
            {s.cs2?.premier != null && (
              <div>
                <b style={{ color: premierColor(s.cs2.premier) }}>{s.cs2.premier.toLocaleString('ru-RU')}</b>
                <small>Premier</small>
              </div>
            )}
            {fc?.kd != null && (
              <div>
                <b>{fc.kd.toFixed(2)}</b>
                <small>K/D{fc.recent ? ` · ${fc.recent} игр` : ''}</small>
              </div>
            )}
            {fc?.adr != null && (
              <div>
                <b>{fc.adr}</b>
                <small>ADR</small>
              </div>
            )}
            {s.cs2?.winrate != null ? (
              <div>
                <b>{s.cs2.winrate}%</b>
                <small>побед · {s.cs2.matches}</small>
              </div>
            ) : (
              fc?.wr != null && (
                <div>
                  <b>{fc.wr}%</b>
                  <small>побед на FACEIT · {fc.matches ?? 0}</small>
                </div>
              )
            )}
          </div>
          {s.cs2 && (
            <>
              <Bar label="Аим" value={s.cs2.aim} />
              <Bar label="Позиционка" value={s.cs2.positioning} />
              <Bar label="Гранаты" value={s.cs2.utility} />
              <Bar label="HS %" value={s.cs2.hs} />
              {s.cs2.recent.length > 0 && (
                <div className="recent">
                  {s.cs2.recent.map((m, i) => (
                    <span key={i} className={m.won ? 'w' : 'l'} title={m.at ? fmtDate(m.at) : ''}>
                      <span>{m.map}</span>
                      <span>{m.score}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="stat-links">
            {fc?.nick && (
              <a href={fc.url} target="_blank" rel="noreferrer">
                FACEIT: {fc.nick}
              </a>
            )}
            <a href={`https://csst.at/profile/${s64}`} target="_blank" rel="noreferrer">
              csst.at
            </a>
            <a href={`https://faceitfinder.com/profile/${s64}`} target="_blank" rel="noreferrer">
              FACEIT Finder
            </a>
            <a href={`https://leetify.com/app/profile/${s64}`} target="_blank" rel="noreferrer">
              Leetify
            </a>
            <a href={`https://steamcommunity.com/profiles/${s64}`} target="_blank" rel="noreferrer">
              Steam
            </a>
          </div>
        </div>
      )}
      {s.deadlock && (
        <div className="stat-card g-deadlock">
          <div className="stat-card-head">
            <b>Deadlock</b>
            <span>{deadlockRank(s.deadlock.badge)}</span>
          </div>
          <div className="stat-nums">
            <div>
              <b>{s.deadlock.matches}</b>
              <small>матчей</small>
            </div>
            <div>
              <b>{pct(s.deadlock.wins, s.deadlock.matches)}%</b>
              <small>побед</small>
            </div>
            <div>
              <b>{kda(s.deadlock.k, s.deadlock.d, s.deadlock.a)}</b>
              <small>KDA</small>
            </div>
          </div>
          <div className="stat-links">
            <a href={`https://statlocker.gg/profile/${steamId}`} target="_blank" rel="noreferrer">
              Statlocker
            </a>
            <a href={`https://tracklock.gg/players/${steamId}`} target="_blank" rel="noreferrer">
              Tracklock
            </a>
          </div>
        </div>
      )}
      <p className="muted small stat-src">Данные OpenDota, Leetify и deadlock-api, обновляются раз в 6 часов.</p>
    </div>
  )
}
