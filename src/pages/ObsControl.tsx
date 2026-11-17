import { useEffect, useMemo, useRef, useState } from 'react'
import { api, useDB } from '../lib/data'
import { readObsKey, onObsKeyChange } from '../lib/obsKeys'
import { allMatches, byDate, type MatchView } from '../lib/matches'
import { CS2_POOL, VETO_TEMPLATES, useObs, type ObsCaster, type ObsDraft, type ObsMap, type ObsVetoStep, type Side } from '../lib/obsState'
import { useHeroes } from './ObsLive'
import { OBS_SCENES, obsScenePath, obsSceneTitle } from '../lib/obsScenes'
import '../styles/obs2.css'

/*
 * Пульт режиссёра: всё, что нужно в эфире, без правки адресов в OBS.
 * Меняет общее состояние (lib/obsState.ts); сцены подхватывают его за 1–2 секунды.
 */

type Tab = 'live' | 'veto' | 'draft' | 'studio' | 'break'

const TABS: [Tab, string][] = [
  ['live', 'Матч и счёт'],
  ['veto', 'Вето карт'],
  ['draft', 'Драфт Dota 2'],
  ['studio', 'Студия'],
  ['break', 'Перерыв'],
]

/** Three-way reconciliation: keep edited fields, update untouched fields from the server. */
function mergeDraft(current: unknown, before: unknown, next: unknown): unknown {
  if (JSON.stringify(current) === JSON.stringify(before)) return next
  if (!current || !before || !next || typeof current !== 'object' || typeof before !== 'object' || typeof next !== 'object') return current
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(next))
    return current.map((value, i) => mergeDraft(value, before[i], next[i]))
  if (Array.isArray(current) || Array.isArray(before) || Array.isArray(next)) return current
  const local = current as Record<string, unknown>, old = before as Record<string, unknown>, remote = next as Record<string, unknown>
  return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .map(key => [key, mergeDraft(local[key], old[key], remote[key])]))
}

function useDraftValue<T>(value: T) {
  const [draft, setDraft] = useState(value)
  const signature = JSON.stringify(value)
  const previous = useRef(signature)
  useEffect(() => {
    const oldSignature = previous.current
    previous.current = signature
    setDraft(current => mergeDraft(current, JSON.parse(oldSignature), JSON.parse(signature)) as T)
  }, [signature])
  return [draft, setDraft] as const
}

const other = (s: string) => (s === 'CT' ? 'T' : s === 'T' ? 'CT' : s)

export function ObsPanel() {
  const { db, team } = useDB()
  const { state, can, ok, loaded, patch } = useObs(1500)
  const heroes = useHeroes()
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem('obs-tab'); return TABS.some(([id]) => id === saved) ? saved as Tab : 'live'
    } catch {
      return 'live'
    }
  })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [mayPublishResult, setMayPublishResult] = useState(false)
  useEffect(() => {
    let active = true
    api<{ admin: boolean; role?: string }>('me')
      .then((r) => { if (active) setMayPublishResult(r.admin || r.role === 'referee') })
      .catch(() => { if (active) setMayPublishResult(false) })
    return () => { active = false }
  }, [])

  const matches = useMemo(
    () => allMatches(db).filter((m) => m.status !== 'bye' && m.a !== 'BYE' && m.b !== 'BYE').sort(byDate),
    [db],
  )
  const keyOf = (m: MatchView) => `${m.tid}/${m.stageId}/${m.key}`
  const sel = state.live
  const cur: MatchView | undefined =
    (sel && matches.find((m) => m.tid === sel.tid && m.stageId === sel.stageId && m.key === sel.key)) ??
    matches.find((m) => m.status === 'live') ??
    matches.find((m) => m.status === 'scheduled')
  const tag = (s: Side | 'd' | undefined) => {
    if (s !== 'a' && s !== 'b') return ''
    if (!cur) return s.toUpperCase()
    const seed = s === 'a' ? cur.a : cur.b
    return team(seed)?.tag ?? (s === 'a' ? cur.hintA : cur.hintB) ?? s.toUpperCase()
  }

  const flash = (t: string) => {
    setMsg(t)
    setTimeout(() => setMsg((x) => (x === t ? '' : x)), 4000)
  }
  const set = async (p: Parameters<typeof patch>[0]) => {
    setBusy(true)
    try {
      await patch(p)
      flash('Изменения сохранены')
      return true
    } catch (e) {
      flash(`Не сохранилось: ${e instanceof Error ? e.message : String(e)}`)
      return false
    } finally {
      setBusy(false)
    }
  }
  const goTab = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem('obs-tab', t)
    } catch {
      /* без запоминания вкладки */
    }
  }
  const fire = (name: string) => set({ fire: { ...(state.fire ?? {}), [name]: Date.now() } })

  if (!loaded) return <div className="ocp panel pad muted">Загружаю состояние эфира…</div>
  if (!can)
    return (
      <div className="ocp panel pad">
        <b>Пульт режиссёра</b>
        <p className="muted small">Управление эфиром доступно только организаторам, судьям и операторам эфира после входа.</p>
      </div>
    )

  // ---------- матч и счёт ----------
  const sa = state.series?.a ?? cur?.scoreA ?? 0
  const sb = state.series?.b ?? cur?.scoreB ?? 0
  const bo = state.bo ?? cur?.bo ?? 1
  const maps: ObsMap[] = state.maps ?? []

  const pickMatch = (k: string) => {
    const m = matches.find((x) => keyOf(x) === k)
    if (!m) return
    void set({
      live: { tid: m.tid, stageId: m.stageId, key: m.key },
      series: { a: m.scoreA ?? 0, b: m.scoreB ?? 0 },
      bo: m.bo,
      maps: null,
      veto: null,
      draft: null,
    })
  }
  const bump = (who: Side, d: number) => {
    const next = { a: sa, b: sb }
    next[who] = Math.max(0, next[who] + d)
    void set({ series: next })
  }
  const writeSite = async (status: 'live' | 'finished') => {
    if (!cur) return
    setBusy(true)
    try {
      await api('setresult', { method: 'POST', body: { t: cur.tid, s: cur.stageId, k: cur.key, scoreA: sa, scoreB: sb, status } })
      flash(status === 'finished' ? 'Матч завершён, счёт записан на сайт' : 'Счёт записан, матч идёт')
    } catch (e) {
      flash(`Сайт не принял счёт: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  const seriesFromMaps = (list: ObsMap[]) => ({
    a: list.filter((x) => x.status === 'done' && (x.a ?? 0) > (x.b ?? 0)).length,
    b: list.filter((x) => x.status === 'done' && (x.b ?? 0) > (x.a ?? 0)).length,
  })
  const setMaps = (list: ObsMap[], extra: Record<string, unknown> = {}) => set({ maps: list, ...extra })
  const editMap = (i: number, p: Partial<ObsMap>) => setMaps(maps.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const finishMap = (i: number) => {
    const list: ObsMap[] = maps.map((x, k) => (k === i ? { ...x, status: 'done' as const } : x))
    const nx = list.findIndex((x) => x.status !== 'done')
    if (nx >= 0) list[nx] = { ...list[nx], status: 'live' }
    void setMaps(list, { series: seriesFromMaps(list), fire: { ...(state.fire ?? {}), mapresult: Date.now() } })
  }
  const addMap = (name: string) => {
    if (!name.trim()) return
    void setMaps([...maps, { name: name.trim(), status: maps.some((x) => x.status === 'live') ? 'next' : 'live' }])
  }

  const LiveTab = (
    <>
      <div className="ocp-sec">
        <label className="ocp-l">Матч в эфире</label>
        <select className="ocp-in" value={cur ? keyOf(cur) : ''} onChange={(e) => pickMatch(e.target.value)}>
          {!cur && <option value="">— нет матчей —</option>}
          {matches.map((m) => (
            <option key={keyOf(m)} value={keyOf(m)}>
              {m.status === 'live' ? '● ' : ''}
              {m.tournament} · {m.label || m.stage} · {team(m.a)?.tag ?? m.hintA} — {team(m.b)?.tag ?? m.hintB}
            </option>
          ))}
        </select>
        <p className="muted small">Выбор матча сбрасывает карты, вето и драфт. Сцены hud, versus, result, veto, draft берут этот матч, пока в адресе нет m=…</p>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Счёт серии</label>
        <div className="ocp-score">
          <div>
            <b>{tag('a') || 'A'}</b>
            <button className="btn btn-ghost" onClick={() => bump('a', -1)}>−</button>
            <output>{sa}</output>
            <button className="btn btn-accent" onClick={() => bump('a', 1)}>+</button>
          </div>
          <select className="ocp-in bo" value={bo} onChange={(e) => void set({ bo: Number(e.target.value) })}>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>
                Bo{n}
              </option>
            ))}
          </select>
          <div>
            <b>{tag('b') || 'B'}</b>
            <button className="btn btn-ghost" onClick={() => bump('b', -1)}>−</button>
            <output>{sb}</output>
            <button className="btn btn-accent" onClick={() => bump('b', 1)}>+</button>
          </div>
        </div>
        {mayPublishResult && <div className="ocp-row">
          <button className="btn btn-ghost" disabled={busy || !cur} onClick={() => void writeSite('live')}>
            Записать на сайт: матч идёт
          </button>
          <button
            className={`btn ${confirm ? 'btn-accent' : 'btn-ghost'}`}
            disabled={busy || !cur}
            onClick={() => (confirm ? void writeSite('finished') : setConfirm(true))}
            onBlur={() => setConfirm(false)}
          >
            {confirm ? `Точно? ${sa}:${sb}, завершить` : 'Записать на сайт: завершить матч'}
          </button>
        </div>}
        <p className="muted small">Сцены показывают счёт с пульта сразу. Только судья или организатор может записывать официальный результат матча на сайт.</p>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Карты серии</label>
        {maps.length === 0 && <p className="muted small">Пусто. Соберите карты из вето или добавьте вручную (для Dota и других игр это игры серии: «Игра 1»…).</p>}
        {maps.map((x, i) => (
          <div key={i} className={`ocp-map ${x.status ?? 'next'}`}>
            <i>{i + 1}</i>
            <input className="ocp-in name" value={x.name} onChange={(e) => editMap(i, { name: e.target.value })} />
            <input className="ocp-in n" type="number" min={0} value={x.a ?? 0} onChange={(e) => editMap(i, { a: Number(e.target.value) })} />
            <span>:</span>
            <input className="ocp-in n" type="number" min={0} value={x.b ?? 0} onChange={(e) => editMap(i, { b: Number(e.target.value) })} />
            <button className="btn btn-ghost" disabled={x.status === 'live'} onClick={() => editMap(i, { status: 'live' })}>
              Идёт
            </button>
            <button className="btn btn-accent" disabled={x.status === 'done'} onClick={() => finishMap(i)}>
              Завершить
            </button>
            <button className="btn btn-ghost" aria-label="Убрать карту" onClick={() => void setMaps(maps.filter((_, k) => k !== i))}>
              ×
            </button>
          </div>
        ))}
        <AddMap onAdd={addMap} n={maps.length + 1} />
        <p className="muted small">«Завершить» отмечает карту сыгранной, пересчитывает счёт серии, включает следующую карту и показывает сцену mapresult.</p>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Показать заново (анимация сцены)</label>
        <div className="ocp-row">
          {[
            ['intro', 'Заставка'],
            ['versus', 'Анонс матча'],
            ['result', 'Итог матча'],
            ['mapresult', 'Итог карты'],
          ].map(([k, t]) => (
            <button key={k} className="btn btn-ghost" onClick={() => void fire(k)}>
              {t}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  // ---------- вето карт ----------
  const mode = state.vetoMode ?? 'bo3'
  const tpl = VETO_TEMPLATES[mode]
  const steps: ObsVetoStep[] = state.veto ?? []
  const pool = state.pool?.length ? state.pool : CS2_POOL
  const nextStep = tpl[steps.length]
  const sideIdx = (() => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].action !== 'ban' && !steps[i].side) return i
    return -1
  })()
  const addStep = (name: string) => {
    if (!nextStep) return
    const st: ObsVetoStep[] = [...steps, { team: nextStep.team, action: nextStep.action, map: name }]
    const rest = pool.filter((p) => !st.some((s) => s.map.toLowerCase() === p.toLowerCase()))
    const nx = tpl[st.length]
    if (nx?.action === 'decider' && rest.length === 1) st.push({ team: 'd', action: 'decider', map: rest[0] })
    void set({ veto: st })
  }
  const setSide = (who: Side, side: string) => {
    if (sideIdx < 0) return
    void set({ veto: steps.map((s, i) => (i === sideIdx ? { ...s, sideTeam: who, side } : s)) })
  }
  const mapsFromVeto = () => {
    const list: ObsMap[] = steps
      .filter((s) => s.action !== 'ban')
      .map((s, i) => ({
        name: s.map,
        picker: s.team,
        status: i === 0 ? ('live' as const) : ('next' as const),
        sideA: s.side && s.sideTeam ? (s.sideTeam === 'a' ? s.side : other(s.side)) : undefined,
      }))
    void set({ maps: list, series: { a: 0, b: 0 } })
  }
  const stepLabel = (s: ObsVetoStep) => (s.action === 'decider' ? 'DECIDER' : `${tag(s.team)} ${s.action.toUpperCase()}`)

  const VetoTab = (
    <>
      <div className="ocp-sec">
        <label className="ocp-l">Формат</label>
        <div className="ocp-row">
          {(['bo1', 'bo3', 'bo5'] as const).map((k) => (
            <button key={k} className={`btn ${mode === k ? 'btn-accent' : 'btn-ghost'}`} onClick={() => void set({ vetoMode: k, veto: null })}>
              {k.toUpperCase()}
            </button>
          ))}
          <button className="btn btn-ghost" disabled={!steps.length} onClick={() => void set({ veto: steps.slice(0, -1) })}>
            Отменить шаг
          </button>
          <button className="btn btn-ghost" disabled={!steps.length} onClick={() => void set({ veto: null })}>
            Сбросить
          </button>
        </div>
        <ol className="ocp-tpl">
          {tpl.map((t, i) => (
            <li key={i} className={i < steps.length ? 'done' : i === steps.length ? 'cur' : ''}>
              {t.action === 'decider' ? 'DECIDER' : `${tag(t.team) || t.team.toUpperCase()} ${t.action.toUpperCase()}`}
              {steps[i] && <b> {steps[i].map}</b>}
            </li>
          ))}
        </ol>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">
          {nextStep ? (nextStep.action === 'decider' ? 'Осталась последняя карта' : `Сейчас: ${tag(nextStep.team)} — ${nextStep.action === 'ban' ? 'убирает' : 'выбирает'} карту`) : 'Вето завершено'}
        </label>
        <div className="ocp-pool">
          {pool.map((p) => {
            const hit = steps.findIndex((s) => s.map.toLowerCase() === p.toLowerCase())
            return (
              <button
                key={p}
                className={`btn ${hit >= 0 ? `ocp-used ${steps[hit].action}` : 'btn-ghost'}`}
                disabled={hit >= 0 || !nextStep}
                onClick={() => addStep(p)}
              >
                {p}
                {hit >= 0 && <small>#{hit + 1}</small>}
              </button>
            )
          })}
        </div>
        {sideIdx >= 0 && (
          <>
            <label className="ocp-l">Сторона на карте «{steps[sideIdx].map}»</label>
            <div className="ocp-row">
              {(['a', 'b'] as const).flatMap((w) =>
                ['CT', 'T'].map((s) => (
                  <button key={w + s} className="btn btn-ghost" onClick={() => setSide(w, s)}>
                    {tag(w)} · {s}
                  </button>
                )),
              )}
            </div>
          </>
        )}
        {steps.length > 0 && <p className="muted small">Шаги: {steps.map(stepLabel).join(' → ')}</p>}
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Пул карт (через запятую)</label>
        <PoolEditor value={pool} onSave={(v) => void set({ pool: v, veto: null })} onReset={() => void set({ pool: null, veto: null })} />
        <div className="ocp-row">
          <button className="btn btn-accent" disabled={!steps.some((s) => s.action !== 'ban')} onClick={mapsFromVeto}>
            Собрать карты серии из вето
          </button>
        </div>
      </div>
    </>
  )

  // ---------- драфт Dota 2 ----------
  const d: ObsDraft = state.draft ?? { a: { bans: [], picks: [] }, b: { bans: [], picks: [] } }
  const bu = (
    <DraftEditor
      d={d}
      heroes={heroes}
      tagA={tag('a') || 'A'}
      tagB={tag('b') || 'B'}
      onSave={(nd) => void set({ draft: nd })}
    />
  )

  // ---------- студия ----------
  const StudioTab = <Studio state={state} onSet={(p) => void set(p)} />

  // ---------- перерыв ----------
  const BreakTab = <Break brk={state.brk} onSet={(b) => set({ brk: b })} />

  return (
    <div className="ocp panel pad">
      <div className="ocp-head">
        <b>Пульт режиссёра</b>
        <span className={`ocp-dot ${ok ? 'ok' : 'bad'}`} role="status">{busy ? 'Сохраняю изменения…' : ok ? 'Синхронизировано со сценами' : 'Нет связи · показано последнее состояние'}</span>
        {msg && <span className="ocp-msg" role="status">{msg}</span>}
      </div>
      <div className="ocp-layout"><div className="ocp-controls">
      <div className="ocp-tabs" role="tablist" aria-label="Управление эфиром">
        {TABS.map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'live' && LiveTab}
      {tab === 'veto' && VetoTab}
      {tab === 'draft' && bu}
      {tab === 'studio' && StudioTab}
      {tab === 'break' && BreakTab}
      </div><Preview /></div>
    </div>
  )
}

function AddMap({ onAdd, n }: { onAdd: (name: string) => void; n: number }) {
  const [v, setV] = useState('')
  return (
    <div className="ocp-row">
      <input className="ocp-in" placeholder={`Название карты или игры (например «Игра ${n}»)`} value={v} onChange={(e) => setV(e.target.value)} />
      <button
        className="btn btn-ghost"
        onClick={() => {
          onAdd(v || `Игра ${n}`)
          setV('')
        }}
      >
        Добавить
      </button>
    </div>
  )
}

function PoolEditor({ value, onSave, onReset }: { value: string[]; onSave: (v: string[]) => void; onReset: () => void }) {
  const [v, setV] = useState(value.join(', '))
  useEffect(() => setV(value.join(', ')), [value])
  return (
    <div className="ocp-row">
      <input className="ocp-in" value={v} onChange={(e) => setV(e.target.value)} />
      <button
        className="btn btn-ghost"
        onClick={() =>
          onSave(
            v
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, 12),
          )
        }
      >
        Применить
      </button>
      <button className="btn btn-ghost" onClick={onReset}>
        CS2 по умолчанию
      </button>
    </div>
  )
}

function DraftEditor({ d, heroes, tagA, tagB, onSave }: { d: ObsDraft; heroes: Record<number, { id: number; name: string; img: string }>; tagA: string; tagB: string; onSave: (d: ObsDraft) => void }) {
  const [side, setSide] = useState<Side>('a')
  const [kind, setKind] = useState<'picks' | 'bans'>('picks')
  const [q, setQ] = useState('')
  const all = useMemo(() => Object.values(heroes).sort((x, y) => x.name.localeCompare(y.name)), [heroes])
  const used = new Set([...d.a.picks, ...d.a.bans, ...d.b.picks, ...d.b.bans])
  const list = all.filter((h) => !q.trim() || h.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60)
  const max = kind === 'picks' ? 5 : 7
  const add = (id: number) => {
    if (d[side][kind].length >= max || used.has(id)) return
    const nd: ObsDraft = { ...d, a: { ...d.a }, b: { ...d.b } }
    nd[side] = { ...nd[side], [kind]: [...nd[side][kind], id] }
    onSave(nd)
  }
  const del = (s: Side, k: 'picks' | 'bans', id: number) => {
    const nd: ObsDraft = { ...d, a: { ...d.a }, b: { ...d.b } }
    nd[s] = { ...nd[s], [k]: nd[s][k].filter((x) => x !== id) }
    onSave(nd)
  }
  const chips = (s: Side, k: 'picks' | 'bans') => (
    <div className="ocp-chips">
      <small>
        {s === 'a' ? tagA : tagB} · {k === 'picks' ? 'пики' : 'баны'}
      </small>
      {d[s][k].map((id) => (
        <button key={id} className="ocp-hero on" title="Убрать" onClick={() => del(s, k, id)}>
          {heroes[id] ? <img src={heroes[id].img} alt="" /> : null}
          <span>{heroes[id]?.name ?? id}</span>
        </button>
      ))}
    </div>
  )
  return (
    <>
      <div className="ocp-sec">
        <label className="ocp-l">Сторона команды {tagA}</label>
        <div className="ocp-row">
          {(['radiant', 'dire'] as const).map((s) => (
            <button key={s} className={`btn ${d.sideA === s ? 'btn-accent' : 'btn-ghost'}`} onClick={() => onSave({ ...d, sideA: s })}>
              {s === 'radiant' ? 'Radiant' : 'Dire'}
            </button>
          ))}
          {(['ban', 'pick', 'done'] as const).map((p) => (
            <button key={p} className={`btn ${d.phase === p ? 'btn-accent' : 'btn-ghost'}`} onClick={() => onSave({ ...d, phase: p })}>
              {p === 'ban' ? 'Фаза: баны' : p === 'pick' ? 'Фаза: пики' : 'Готово'}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => onSave({ a: { bans: [], picks: [] }, b: { bans: [], picks: [] }, sideA: d.sideA })}>
            Очистить драфт
          </button>
        </div>
      </div>
      <div className="ocp-sec">
        <label className="ocp-l">Куда добавлять героя</label>
        <div className="ocp-row">
          {(['a', 'b'] as const).flatMap((s) =>
            (['picks', 'bans'] as const).map((k) => (
              <button key={s + k} className={`btn ${side === s && kind === k ? 'btn-accent' : 'btn-ghost'}`} onClick={() => (setSide(s), setKind(k))}>
                {s === 'a' ? tagA : tagB} · {k === 'picks' ? 'пик' : 'бан'} ({d[s][k].length}/{k === 'picks' ? 5 : 7})
              </button>
            )),
          )}
        </div>
        <input className="ocp-in" placeholder="Поиск героя…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ocp-heroes">
          {list.map((h) => (
            <button key={h.id} className={`ocp-hero${used.has(h.id) ? ' used' : ''}`} disabled={used.has(h.id) || d[side][kind].length >= max} onClick={() => add(h.id)}>
              <img src={h.img} alt="" loading="lazy" />
              <span>{h.name}</span>
            </button>
          ))}
          {!all.length && <p className="muted small">Справочник героев загружается…</p>}
        </div>
      </div>
      <div className="ocp-sec">
        {chips('a', 'picks')}
        {chips('a', 'bans')}
        {chips('b', 'picks')}
        {chips('b', 'bans')}
        <p className="muted small">Нажмите на героя в списке выше, чтобы убрать его.</p>
      </div>
    </>
  )
}

function Studio({ state, onSet }: { state: ReturnType<typeof useObs>['state']; onSet: (p: Record<string, unknown>) => void }) {
  const [cast, setCast] = useDraftValue<ObsCaster[]>(Array.from({ length: 3 }, (_, i) => state.casters?.[i] ?? { name: '', role: '', social: '' }))
  const L = state.lower
  const [lw, setLw] = useDraftValue({ name: L?.name ?? '', role: L?.role ?? '', social: L?.social ?? '', hold: L?.hold ?? 8 })
  const [tk, setTk] = useDraftValue((state.ticker?.items ?? []).join('\n'))
  const items = () => tk.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12)
  const editCast = (i: number, p: Partial<ObsCaster>) => setCast(cast.map((c, k) => (k === i ? { ...c, ...p } : c)))
  return (
    <>
      <div className="ocp-sec">
        <label className="ocp-l">Комментаторы (сцена casters: окон столько, сколько заполнено имён)</label>
        {cast.map((c, i) => (
          <div key={i} className="ocp-row">
            <input className="ocp-in" placeholder={`Имя ${i + 1}`} value={c.name} onChange={(e) => editCast(i, { name: e.target.value })} />
            <input className="ocp-in" placeholder="Роль" value={c.role} onChange={(e) => editCast(i, { role: e.target.value })} />
            <input className="ocp-in" placeholder="@ник" value={c.social ?? ''} onChange={(e) => editCast(i, { social: e.target.value })} />
            <button className="btn btn-ghost" onClick={() => setLw({ ...lw, name: c.name, role: c.role, social: c.social ?? '' })}>
              В плашку
            </button>
          </div>
        ))}
        <div className="ocp-row">
          <button className="btn btn-accent" onClick={() => onSet({ casters: cast })}>
            Сохранить состав
          </button>
        </div>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Плашка с именем (сцена lower)</label>
        <div className="ocp-row">
          <input className="ocp-in" placeholder="Имя" value={lw.name} onChange={(e) => setLw({ ...lw, name: e.target.value })} />
          <input className="ocp-in" placeholder="Роль" value={lw.role} onChange={(e) => setLw({ ...lw, role: e.target.value })} />
          <input className="ocp-in" placeholder="@ник" value={lw.social} onChange={(e) => setLw({ ...lw, social: e.target.value })} />
          <input className="ocp-in n" type="number" min={0} max={120} title="Секунд на экране, 0 — пока не скроете" value={lw.hold} onChange={(e) => setLw({ ...lw, hold: Number(e.target.value) })} />
        </div>
        <div className="ocp-row">
          <button className="btn btn-accent" disabled={!lw.name.trim()} onClick={() => onSet({ lower: { ...lw, fire: Date.now(), on: true } })}>
            Показать плашку
          </button>
          <button className="btn btn-ghost" onClick={() => onSet({ lower: { ...lw, fire: L?.fire ?? 0, on: false } })}>
            Скрыть
          </button>
        </div>
      </div>

      <div className="ocp-sec">
        <label className="ocp-l">Бегущая строка (сцена ticker), по строке на пункт</label>
        <textarea className="ocp-in" rows={4} value={tk} onChange={(e) => setTk(e.target.value)} />
        <div className="ocp-row">
          <button className="btn btn-accent" onClick={() => onSet({ ticker: { on: true, items: items() } })}>
            Показать
          </button>
          <button className="btn btn-ghost" onClick={() => onSet({ ticker: { on: false, items: items() } })}>
            Скрыть
          </button>
          <span className="muted small">{state.ticker?.on ? 'сейчас на экране' : 'сейчас скрыта'}</span>
        </div>
      </div>
    </>
  )
}

function Break({ brk, onSet }: { brk: { title?: string; sub?: string; until?: string } | undefined; onSet: (b: { title?: string; sub?: string; until?: string } | null) => Promise<boolean> }) {
  const [title, setTitle] = useDraftValue(brk?.title ?? '')
  const [sub, setSub] = useDraftValue(brk?.sub ?? '')
  const [at, setAt] = useState('')
  const resetBreak = async () => {
    if (await onSet(null)) { setTitle(''); setSub(''); setAt('') }
  }
  const until = brk?.until ? Date.parse(brk.until) : 0
  const mk = (u: string | undefined) => ({ title: title || undefined, sub: sub || undefined, until: u })
  const inMin = (n: number) => onSet(mk(new Date(Date.now() + n * 60_000).toISOString()))
  const atTime = () => {
    if (!/^\d{1,2}:\d{2}$/.test(at)) return
    const [h, m] = at.split(':').map(Number)
    const t = new Date()
    t.setHours(h, m, 0, 0)
    if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1)
    onSet(mk(t.toISOString()))
  }
  return (
    <div className="ocp-sec">
      <label className="ocp-l">Текст на сценах starting и brb</label>
      <div className="ocp-row">
        <input className="ocp-in" placeholder="Заголовок (например «Скоро начнём»)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="ocp-in" placeholder="Подпись" value={sub} onChange={(e) => setSub(e.target.value)} />
      </div>
      <label className="ocp-l">Таймер {until > Date.now() ? `· до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '· не задан'}</label>
      <div className="ocp-row">
        {[3, 5, 10, 15, 30].map((n) => (
          <button key={n} className="btn btn-ghost" onClick={() => inMin(n)}>
            {n} мин
          </button>
        ))}
        <input className="ocp-in n" type="time" value={at} onChange={(e) => setAt(e.target.value)} />
        <button className="btn btn-ghost" disabled={!at} onClick={atTime}>
          До времени
        </button>
      </div>
      <div className="ocp-row">
        <button className="btn btn-accent" onClick={() => onSet(mk(brk?.until))}>
          Сохранить текст
        </button>
        <button className="btn btn-ghost" onClick={() => void resetBreak()}>
          Сбросить всё
        </button>
      </div>
      <p className="muted small">Адрес сильнее пульта: если в ссылке есть ?min=, ?at=, ?title=, берётся он.</p>
    </div>
  )
}

function Preview() {
  const [scene, setScene] = useState('hud')
  const [on, setOn] = useState(false)
  const [demo, setDemo] = useState(false)
  const [perf, setPerf] = useState(false)
  const [copied, setCopied] = useState('')
  const [sceneKey, setSceneKey] = useState(readObsKey)
  useEffect(() => onObsKeyChange(() => setSceneKey(readObsKey())), [])
  const path = obsScenePath(scene, sceneKey, { demo, perf })
  const sourcePath = obsScenePath(scene, sceneKey)
  const url = `${location.origin}${location.pathname}${sourcePath}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied('Ссылка скопирована') }
    catch { setCopied('Не удалось скопировать. Раскройте адрес источника ниже.') }
  }
  return (
    <aside className="ocp-sec ocp-preview" aria-label="Предпросмотр сцены">
      <div className="ocp-preview-head"><b>Предпросмотр</b><span className="muted small">1920 × 1080</span></div>
      <label className="ocp-l" htmlFor="obs-preview-scene">Сцена</label>
      <select id="obs-preview-scene" className="ocp-in" value={scene} onChange={(e) => { setScene(e.target.value); setCopied('') }}>
        {OBS_SCENES.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <div className="ocp-preview-options">
        <label className="ocp-chk"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Тестовые данные</label>
        <label className="ocp-chk"><input aria-label="Замер FPS в предпросмотре" type="checkbox" checked={perf} onChange={(e) => setPerf(e.target.checked)} /> Замер FPS</label>
      </div>
      <div className="ocp-prev">
        {on && sceneKey ? <iframe key={path} title={`Предпросмотр: ${obsSceneTitle(scene)}`} src={path} /> :
          <div className="ocp-preview-empty"><b>{obsSceneTitle(scene)}</b><span>{sceneKey ? 'Включите превью, чтобы проверить графику' : 'Создайте ключ устройства, чтобы включить превью'}</span></div>}
      </div>
      <div className="ocp-row">
        <button className="btn btn-accent" disabled={!sceneKey} onClick={() => setOn(!on)}>{on ? 'Скрыть превью' : 'Показать превью'}</button>
        {sceneKey && <a className="btn btn-ghost" href={path} target="_blank" rel="noreferrer">Открыть превью</a>}
      </div>
      <button className="btn btn-ghost" disabled={!sceneKey} onClick={() => void copy()}>Копировать ссылку для OBS</button>
      {copied && <p className="small" role="status">{copied}</p>}
      <p className="muted small">Ссылка для OBS следует пульту. Тестовые данные и FPS включаются только здесь; они не попадают в скопированную ссылку.</p>
      {sceneKey && <details className="obs-source-url"><summary>Адрес источника</summary><code className="ocp-url">{url}</code></details>}
      {perf && <p className="muted small">Замер показывает кадры страницы. FPS видеозаписи проверяйте в OBS → Статистика.</p>}
    </aside>
  )
}
