import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, type User } from '../lib/account'
import { PlayerAvatar } from '../components/ui'
import { api, useData, useDB } from '../lib/data'
import { dotabuffUrl, rankLabel } from '../lib/dota'
import { config } from '../config'
import { TeamMediaEdit } from '../components/TeamMediaEdit'
import { GAMES, gameDef } from '../lib/games'
import type { GameEntry, Persona, Player } from '../lib/types'
import { EFFECTS, EMOJIS, FRAMES, GRADS, NICK_FX, headClass, nickClass, personaVars } from '../lib/persona'

const ACCENTS = ['', '#0054b8', '#1f8a4c', '#c0392b', '#8e44ad', '#d35400', '#16a085', '#2c3e50', '#b7950b', '#e84393']
const BANNERS: [string, string][] = [
  ['', 'Без узора'],
  ['stripes', 'Полосы'],
  ['grid', 'Сетка'],
  ['dots', 'Точки'],
  ['waves', 'Волны'],
  ['glow', 'Свечение'],
  ['aurora', 'Аврора'],
  ['mesh', 'Мэш'],
  ['carbon', 'Карбон'],
  ['void', 'Void'],
]

const STEAM_ERR: Record<string, string> = {
  expired: 'Вход через Steam устарел, попробуйте ещё раз',
  failed: 'Steam не подтвердил вход',
  taken: 'Этот Steam уже привязан к другому аккаунту',
  closed: 'Регистрация временно закрыта',
}
const steamUrl = `${config.apiBase}?r=steamlogin`

function SteamButton({ label }: { label: string }) {
  return (
    <a className="btn btn-steam" href={steamUrl}>
      {label}
    </a>
  )
}

const POSITIONS = ['Керри', 'Мид', 'Оффлейн', 'Софт саппорт', 'Хард саппорт', 'Капитан', 'Универсал', 'Запасной']

/** Сжимает выбранную картинку до квадрата 256×256 (JPEG) перед загрузкой. */
function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = c.height = 256
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать картинку'))
    }
    img.src = url
  })
}

function AuthForm() {
  const { setUser } = useAccount()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [f, setF] = useState({ login: '', password: '', name: '', website: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ user: User }>(mode === 'in' ? 'signin' : 'signup', { method: 'POST', body: f })
      setUser(r.user)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="seg">
        <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>
          Вход
        </button>
        <button className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>
          Регистрация
        </button>
      </div>
      <form
        className="panel pad form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Логин
          <input value={f.login} maxLength={24} autoComplete="username" onChange={set('login')} />
        </label>
        {mode === 'up' && (
          <label>
            Имя
            <input value={f.name} maxLength={60} autoComplete="name" onChange={set('name')} />
          </label>
        )}
        <label>
          Пароль{mode === 'up' ? ' (от 8 символов)' : ''}
          <input type="password" value={f.password} maxLength={128} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} onChange={set('password')} />
        </label>
        <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden />
        {err && <div className="error">{err}</div>}
        <div className="form-actions">
          <button className="btn btn-accent" disabled={busy || !f.login || !f.password}>
            {mode === 'in' ? 'Войти' : 'Создать аккаунт'}
          </button>
          <SteamButton label="Войти через Steam" />
          <span className="muted small">
            Уже есть аккаунт с паролем? Войдите по паролю и привяжите Steam в кабинете, иначе создастся второй аккаунт. Забыли пароль — напишите организатору, он задаст новый.
          </span>
        </div>
      </form>
    </>
  )
}

function Profile({ user }: { user: User }) {
  const { setUser, signout } = useAccount()
  const { db } = useDB()
  const { reload } = useData()
  const [f, setF] = useState(user)
  const [msg, setMsg] = useState('')
  const set = (k: keyof User) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setMsg('')
    try {
      const r = await api<{ user: User; warning?: string }>('account', { method: 'POST', body: f })
      setUser(r.user)
      setF(r.user)
      await reload()
      setMsg(r.warning || 'Сохранено')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const uploadAvatar = async (file?: File) => {
    if (!file) return
    setMsg('')
    try {
      const r = await api<{ user: User }>('avatar', { method: 'POST', body: { data: await resizeAvatar(file) } })
      setUser(r.user)
      setF((x) => ({ ...x, avatar: r.user.avatar }))
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const syncDota = async () => {
    setMsg('')
    try {
      const r = await api<{ user: User }>('dotasync', { method: 'POST', body: {} })
      setUser(r.user)
      setF((x) => ({ ...x, rankTier: r.user.rankTier, leaderboard: r.user.leaderboard, dotaMmr: r.user.dotaMmr, dotaName: r.user.dotaName, dotaAt: r.user.dotaAt }))
      await reload()
      setMsg('Ранг обновлён')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const removeAvatar = async () => {
    const r = await api<{ user: User }>('avatar', { method: 'POST', body: { remove: true } })
    setUser(r.user)
    setF((x) => ({ ...x, avatar: 0 }))
    await reload()
  }
  const org = db.orgs?.find((o) => o.id === user.orgId)
  const me = db.players.find((p) => p.userId === user.id)
  const setGame = (i: number, patch: Partial<GameEntry>) => setF({ ...f, games: f.games.map((g, j) => (j === i ? { ...g, ...patch } : patch.main ? { ...g, main: false } : g)) })
  const setLink = (i: number, k: 'label' | 'url', v: string) => setF({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })
  const freeGame = GAMES.find((g) => !f.games.some((x) => x.g === g.id))?.id ?? 'other'
  const pz: Persona = f.persona ?? {}
  const setP = (patch: Partial<Persona>) => setF({ ...f, persona: { ...pz, ...patch } })
  const prev: Player = { ...(me ?? { id: '' }), nick: f.nick || user.login, userId: user.id, avatar: f.avatar, accent: f.accent, banner: f.banner, tagline: f.tagline, persona: pz }
  return (
    <div className="panel pad form">
      {!user.discord.trim() && <div className="warn-text">Укажите Discord: без него не получится сохранить профиль, зарегистрировать или забрать команду.</div>}
      <div className="avatar-edit">
        <PlayerAvatar p={me ?? { id: '', nick: f.nick || user.login, userId: user.id, avatar: f.avatar }} cls="big" />
        <label className="btn btn-ghost">
          Загрузить аватар
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadAvatar(e.target.files?.[0])} />
        </label>
        {f.avatar > 0 && (
          <button className="btn btn-ghost" onClick={removeAvatar}>
            Убрать
          </button>
        )}
      </div>
      <div className="form-row">
        <label>
          Имя
          <input value={f.name} maxLength={60} onChange={set('name')} />
        </label>
        <label>
          Ник
          <input value={f.nick} maxLength={32} onChange={set('nick')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Организация
          <select value={f.orgId} onChange={set('orgId')}>
            <option value="">—</option>
            {(db.orgs ?? []).map((o) => (
              <option key={o.id} value={o.id} disabled={o.closed && o.id !== user.orgId}>
                {o.name}
                {o.closed ? ' (назначает организатор)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Telegram или другой контакт
          <input value={f.contact} maxLength={120} onChange={set('contact')} />
        </label>
        <label>
          Twitch
          <input value={f.twitch} maxLength={40} placeholder="логин" onChange={set('twitch')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Позиция
          <input value={f.position} maxLength={32} list="positions" onChange={set('position')} />
          <datalist id="positions">
            {POSITIONS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label>
          ММР{user.dotaMmr != null ? ' (из OpenDota)' : ''}
          {user.dotaMmr != null ? (
            <input value={user.dotaMmr} disabled />
          ) : (
            <input type="number" min={0} max={20000} value={f.mmr ?? ''} onChange={(e) => setF({ ...f, mmr: e.target.value === '' ? null : Number(e.target.value) })} />
          )}
        </label>
        <label>
          Discord *
          <input value={f.discord} maxLength={64} required placeholder="ник в Discord" onChange={set('discord')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Steam ID или ссылка на Dotabuff / OpenDota{user.steamVerified ? ' (привязан через вход Steam)' : ''}
          <input value={f.steam} maxLength={120} placeholder="https://www.dotabuff.com/players/…" disabled={user.steamVerified} onChange={set('steam')} />
        </label>
        {!user.steamVerified && <SteamButton label="Привязать Steam" />}
      </div>
      {user.steam && (
        <div className="dota-line muted small">
          {user.rankTier ? <b>{rankLabel(user.rankTier, user.leaderboard)}</b> : <span>Ранг скрыт или не откалиброван</span>}
          {user.dotaMmr != null && <span>ММР ≈ {user.dotaMmr}</span>}
          {user.dotaName && <span>{user.dotaName}</span>}
          <a href={dotabuffUrl(user.steam)} target="_blank" rel="noreferrer">
            Dotabuff
          </a>
          <button type="button" className="btn btn-ghost" onClick={syncDota}>
            Обновить ранг
          </button>
        </div>
      )}
      <p className="muted small">ММР подтягивается из OpenDota по медали. Если ранг не виден, в Dota 2 включите «Общедоступная история матчей» в настройках.</p>
      <label className="check">
        <input type="checkbox" checked={f.lft} onChange={(e) => setF({ ...f, lft: e.target.checked })} /> Ищу команду (показывать в списке свободных агентов)
      </label>
      {f.lft && (
        <label>
          Пара слов для капитанов
          <input value={f.lftNote} maxLength={200} placeholder="Позиции, время для игры, опыт" onChange={set('lftNote')} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={f.showContact} onChange={(e) => setF({ ...f, showContact: e.target.checked })} /> Показывать Telegram на публичной странице игрока (Discord виден всегда)
      </label>
      <label>
        О себе
        <textarea rows={3} value={f.bio} maxLength={500} onChange={set('bio')} />
      </label>

      <h3>Игры</h3>
      {f.games.map((g, i) => {
        const def = gameDef(g.g)
        return (
          <div key={i} className="form-row game-row">
            <select value={g.g} onChange={(e) => setGame(i, { g: e.target.value })}>
              {GAMES.map((x) => (
                <option key={x.id} value={x.id} disabled={x.id !== g.g && f.games.some((y) => y.g === x.id)}>
                  {x.name}
                </option>
              ))}
            </select>
            <input placeholder={g.g === 'dota2' ? 'Ранг (из OpenDota, если указан Steam)' : 'Ранг'} value={g.rank ?? ''} maxLength={40} list={`ranks-${i}`} onChange={(e) => setGame(i, { rank: e.target.value })} />
            <datalist id={`ranks-${i}`}>
              {def?.ranks.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <input placeholder="Роль" value={g.role ?? ''} maxLength={32} list={`roles-${i}`} onChange={(e) => setGame(i, { role: e.target.value })} />
            <datalist id={`roles-${i}`}>
              {def?.roles.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <input placeholder={`Ссылка: ${def?.link ?? 'профиль'}`} value={g.url ?? ''} maxLength={200} onChange={(e) => setGame(i, { url: e.target.value })} />
            <label className="check">
              <input type="radio" checked={!!g.main} onChange={() => setGame(i, { main: true })} /> основная
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => setF({ ...f, games: f.games.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        )
      })}
      {f.games.length < 6 && (
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setF({ ...f, games: [...f.games, { g: freeGame, main: f.games.length === 0 }] })}>
            + Игра
          </button>
        </div>
      )}

      <h3>Контакты и ссылки</h3>
      <p className="muted small">Видны всем на странице игрока: Telegram, VK, Steam, FACEIT, YouTube и любые другие (только https://).</p>
      {f.links.map((l, i) => (
        <div key={i} className="form-row">
          <input placeholder="Подпись" value={l.label} maxLength={32} onChange={(e) => setLink(i, 'label', e.target.value)} />
          <input placeholder="https://…" value={l.url} maxLength={200} onChange={(e) => setLink(i, 'url', e.target.value)} />
          <button type="button" className="btn btn-ghost" onClick={() => setF({ ...f, links: f.links.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      {f.links.length < 8 && (
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setF({ ...f, links: [...f.links, { label: '', url: '' }] })}>
            + Ссылка
          </button>
        </div>
      )}

      <h3>Оформление профиля</h3>
      <label>
        Подпись под ником
        <input value={f.tagline} maxLength={80} placeholder="Например: «играю за команду мечты»" onChange={set('tagline')} />
      </label>
      <div className="swatches" role="radiogroup" aria-label="Цвет шапки">
        {ACCENTS.map((c) => (
          <button
            key={c || 'none'}
            type="button"
            className={`swatch${f.accent === c ? ' on' : ''}${c ? '' : ' none'}`}
            style={c ? { background: c } : undefined}
            title={c ? c : 'Цвет команды'}
            onClick={() => setF({ ...f, accent: c })}
          />
        ))}
      </div>
      <div className="seg">
        {BANNERS.map(([id, label]) => (
          <button key={id || 'none'} type="button" className={f.banner === id ? 'on' : ''} onClick={() => setF({ ...f, banner: id })}>
            {label}
          </button>
        ))}
      </div>
      <h3>Персонализация</h3>
      <div className="form-row">
        <label>
          Рамка аватара
          <select value={pz.frame ?? ''} onChange={(e) => setP({ frame: e.target.value || undefined })}>
            {FRAMES.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Эффект аватара
          <select value={pz.effect ?? ''} onChange={(e) => setP({ effect: e.target.value || undefined })}>
            {EFFECTS.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Стиль ника
          <select value={pz.nickFx ?? ''} onChange={(e) => setP({ nickFx: e.target.value || undefined })}>
            {NICK_FX.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Второй цвет градиента
          <span className="color-pick">
            <input type="color" value={pz.accent2 || '#e894ff'} onChange={(e) => setP({ accent2: e.target.value })} />
            {pz.accent2 && (
              <button type="button" className="btn btn-ghost" onClick={() => setP({ accent2: undefined })}>
                Сбросить
              </button>
            )}
          </span>
        </label>
        <label>
          Направление градиента
          <select value={pz.grad ?? ''} onChange={(e) => setP({ grad: e.target.value === '' ? undefined : Number(e.target.value) })}>
            <option value="">По умолчанию</option>
            {GRADS.map((g) => (
              <option key={g} value={g}>
                {g}°
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="emoji-pick" role="radiogroup" aria-label="Эмодзи у ника">
        {EMOJIS.map((em) => (
          <button key={em || 'none'} type="button" className={(pz.emoji ?? '') === em ? 'on' : ''} onClick={() => setP({ emoji: em || undefined })}>
            {em || '∅'}
          </button>
        ))}
      </div>
      <div className={`${headClass(prev)} profile-preview`} style={personaVars(prev)}>
        <div className="wrap profile-preview-in">
          <PlayerAvatar p={prev} cls="big" />
          <div>
            <b className={nickClass(prev)}>
              {pz.emoji && <span className="nick-emoji">{pz.emoji}</span>}
              <span>{prev.nick}</span>
            </b>
            {f.tagline && <small>{f.tagline}</small>}
          </div>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-accent" onClick={save}>
          Сохранить
        </button>
        <button className="btn btn-ghost" onClick={signout}>
          Выйти
        </button>
        {msg && <span className="muted small">{msg}</span>}
        {org && (
          <Link className="muted small" to={`/orgs/${org.id}`}>
            {org.name}
          </Link>
        )}
        {me && (
          <Link className="muted small" to={`/players/${me.id}`}>
            Публичный профиль
          </Link>
        )}
      </div>
    </div>
  )
}

/** Команда, созданная организатором, привязывается к капитану по нику: аккаунт и ник капитана в составе должны совпасть. */
function ClaimTeam({ user }: { user: User }) {
  const { db } = useDB()
  const { reload } = useData()
  // свободна, если капитан в составе без аккаунта или капитан не назначен вовсе
  const free = db.teams.filter((t) => !t.ownerId && (t.captainId ? db.players.some((p) => p.id === t.captainId && !p.userId) : db.players.some((p) => p.teamId === t.id && !p.userId)))
  const [tid, setTid] = useState('')
  const [msg, setMsg] = useState('')
  const cap = db.players.find((p) => p.id === db.teams.find((t) => t.id === tid)?.captainId)
  const claim = async () => {
    setMsg('')
    try {
      await api('claimteam', { method: 'POST', body: { team: tid } })
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="panel pad form">
      <h2>Моя команда</h2>
      {free.length > 0 && (
        <>
          <p>
            Команда уже зарегистрирована или её создал организатор? Выберите её здесь, заново регистрировать не нужно.
          </p>
          <label>
            Команда
            <select value={tid} onChange={(e) => setTid(e.target.value)}>
              <option value="">выберите</option>
              {free.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {tid && !cap && (
            <p className="muted small">
              Капитан не назначен: им станет игрок состава с ником <b>{user.nick || 'не указан'}</b> из вашего профиля.
            </p>
          )}
          {cap && (
            <p className="muted small">
              Ник капитана в составе: <b>{cap.nick}</b>. Ваш ник в профиле: <b>{user.nick || 'не указан'}</b>. Они должны совпасть, иначе правьте ник выше в «Профиле».
            </p>
          )}
          {msg && <div className="error">{msg}</div>}
          <button className="btn btn-accent" disabled={!tid} onClick={claim}>
            Это моя команда
          </button>
          <p className="muted small">Команды нет в списке? Зарегистрируйте новую.</p>
        </>
      )}
      {free.length === 0 && <p>Команды нет. Зарегистрируйте её, она сразу привяжется к вашему аккаунту.</p>}
      <Link className={free.length ? 'btn btn-ghost' : 'btn btn-accent'} to="/register">
        Зарегистрировать новую команду
      </Link>
    </div>
  )
}

type TeamForm = { name: string; tag: string; color: string; about: string; contact: string; slogan: string; founded: string; playFrom: string; playTo: string; timeNote: string; links: { label: string; url: string }[]; roles: Record<string, string> }

function MyTeam({ user }: { user: User }) {
  const { db } = useDB()
  const { reload } = useData()
  // управляет владелец команды (подал заявку) или капитан, чья карточка привязана к аккаунту
  const team = db.teams.find((t) => t.ownerId === user.id || db.players.some((p) => p.id === t.captainId && p.userId === user.id))
  const roster = team ? db.players.filter((p) => p.teamId === team.id) : []
  const [f, setF] = useState<TeamForm>({ name: '', tag: '', color: '#0054b8', about: '', contact: '', slogan: '', founded: '', playFrom: '', playTo: '', timeNote: '', links: [], roles: {} })
  const [state, setState] = useState<'idle' | 'dirty' | 'saving' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const [nick, setNick] = useState('')
  const [role, setRole] = useState('')
  const [invite, setInvite] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const formOf = (): TeamForm =>
    team
      ? {
          name: team.name,
          tag: team.tag,
          color: team.color ?? '#0054b8',
          about: team.about ?? '',
          contact: team.contact ?? '',
          slogan: team.slogan ?? '',
          founded: team.founded ?? '',
          playFrom: team.playFrom ?? '',
          playTo: team.playTo ?? '',
          timeNote: team.timeNote ?? '',
          links: team.links ?? [],
          roles: Object.fromEntries(roster.filter((p) => !p.userId).map((p) => [p.id, p.role ?? ''])),
        }
      : f
  useEffect(() => {
    if (team) setF(formOf())
    setState('idle')
  }, [team?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // после действий над составом подтягиваем роли новых игроков без аккаунта, не трогая набранный текст
  useEffect(() => {
    if (!team) return
    setF((cur) => {
      const roles = { ...cur.roles }
      for (const p of roster) if (!p.userId && roles[p.id] === undefined) roles[p.id] = p.role ?? ''
      return { ...cur, roles }
    })
  }, [roster.map((p) => p.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!team) return <ClaimTeam user={user} />

  const save = async (next: TeamForm = f) => {
    window.clearTimeout(timer.current)
    setState('saving')
    setMsg('')
    try {
      await api('myteam', { method: 'POST', body: { ...next, team: team.id } })
      await reload()
      setState('ok')
    } catch (e) {
      setState('err')
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  // любая правка формы сохраняется сама через 1,2 с, отдельная кнопка нужна только для явного сохранения
  const edit = (patch: Partial<TeamForm>) => {
    const next = { ...f, ...patch }
    setF(next)
    setState('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => save(next), 1200)
  }
  const act = async (body: Record<string, unknown>, done?: () => void) => {
    setMsg('')
    try {
      await api('myteam', { method: 'POST', body: { ...body, team: team.id } })
      await reload()
      done?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const setLink = (i: number, k: 'label' | 'url', v: string) => edit({ links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })
  const status = { idle: '', dirty: 'Есть несохранённые правки…', saving: 'Сохраняю…', ok: 'Сохранено', err: '' }[state]
  return (
    <div className="panel pad form my-team">
      <h2>
        Моя команда: <Link to={`/teams/${team.id}`}>{team.name}</Link>
      </h2>
      <div className="form-row">
        <label>
          Название
          <input value={f.name} maxLength={40} onChange={(e) => edit({ name: e.target.value })} />
        </label>
        <label>
          Тег
          <input value={f.tag} maxLength={4} onChange={(e) => edit({ tag: e.target.value.toUpperCase() })} />
        </label>
        <label>
          Цвет
          <input type="color" value={f.color} onChange={(e) => edit({ color: e.target.value })} />
        </label>
      </div>
      <label>
        О команде
        <textarea rows={3} value={f.about} maxLength={800} onChange={(e) => edit({ about: e.target.value })} />
      </label>
      <label>
        Контакт команды
        <input value={f.contact} maxLength={120} onChange={(e) => edit({ contact: e.target.value })} />
      </label>
      <div className="form-row">
        <label>
          Девиз на баннере
          <input value={f.slogan} maxLength={60} placeholder="One team, one goal" onChange={(e) => edit({ slogan: e.target.value })} />
        </label>
        <label>
          Год основания
          <input value={f.founded} maxLength={4} placeholder="2026" onChange={(e) => edit({ founded: e.target.value.replace(/\D/g, '') })} />
        </label>
      </div>
      <h3>Удобное время игр (МСК)</h3>
      <div className="form-row">
        <label>
          С
          <input type="time" value={f.playFrom} onChange={(e) => edit({ playFrom: e.target.value })} />
        </label>
        <label>
          До
          <input type="time" value={f.playTo} onChange={(e) => edit({ playTo: e.target.value })} />
        </label>
        <label style={{ flex: 3 }}>
          Пожелание организаторам
          <input value={f.timeNote} maxLength={200} placeholder="Например: по будням не раньше 19:00, в субботу свободны весь день" onChange={(e) => edit({ timeNote: e.target.value })} />
        </label>
      </div>
      <p className="muted small">Организаторы учитывают это при расстановке матчей. Матчи вне вашего окна подсвечиваются в админке.</p>
      <TeamMediaEdit team={team} onDone={() => reload()} />
      <h3>
        Состав ({roster.length}/10)
      </h3>
      <table className="table">
        <tbody>
          {roster.map((p) => (
            <tr key={p.id}>
              <td className="left">
                <b>{p.nick}</b>
                {p.id === team.captainId && <span className="muted small"> · капитан</span>}
                {p.userId && <span className="badge badge-registration" style={{ marginLeft: 8 }}>аккаунт</span>}
              </td>
              <td className="left">
                {p.userId ? (
                  <span className="muted small">{p.role || 'роль не указана'} · игрок меняет в своём кабинете</span>
                ) : (
                  <input value={f.roles[p.id] ?? ''} maxLength={32} list="team-positions" placeholder="Роль" onChange={(e) => edit({ roles: { ...f.roles, [p.id]: e.target.value } })} />
                )}
              </td>
              <td className="my-team-act">
                {p.id !== team.captainId && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      title="Передать капитанство"
                      onClick={() => window.confirm(`Передать капитанство игроку ${p.nick}?${p.userId ? '' : ' У него нет аккаунта: управлять командой будете вы, пока он не привяжет аккаунт.'}`) && act({ action: 'setcaptain', id: p.id })}
                    >
                      ♛
                    </button>
                    <button type="button" className="btn btn-ghost" title="Убрать из состава" onClick={() => window.confirm(`Убрать ${p.nick} из состава?`) && act({ action: 'removeplayer', id: p.id })}>
                      ✕
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="team-positions">
        {POSITIONS.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <div className="form-row my-team-add">
        <label>
          Добавить игрока без аккаунта
          <input value={nick} maxLength={32} placeholder="Ник" onChange={(e) => setNick(e.target.value)} />
        </label>
        <label>
          Роль
          <input value={role} maxLength={32} list="team-positions" placeholder="Позиция" onChange={(e) => setRole(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={nick.trim().length < 2}
          onClick={() =>
            act({ action: 'addplayer', nick: nick.trim(), role: role.trim() }, () => {
              setNick('')
              setRole('')
            })
          }
        >
          Добавить
        </button>
      </div>
      <div className="form-row my-team-add">
        <label>
          Пригласить игрока с аккаунтом (только без команды)
          <input value={invite} maxLength={32} placeholder="Ник игрока на сайте" onChange={(e) => setInvite(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost" disabled={invite.trim().length < 2} onClick={() => act({ action: 'invite', nick: invite.trim() }, () => setInvite(''))}>
          Добавить в состав
        </button>
      </div>
      <h3>Ссылки</h3>
      {f.links.map((l, i) => (
        <div key={i} className="form-row">
          <input placeholder="Название" value={l.label} maxLength={40} onChange={(e) => setLink(i, 'label', e.target.value)} />
          <input placeholder="https://…" value={l.url} maxLength={200} onChange={(e) => setLink(i, 'url', e.target.value)} />
          <button className="btn btn-ghost" onClick={() => edit({ links: f.links.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <div className="form-actions my-team-bar">
        {f.links.length < 6 && (
          <button className="btn btn-ghost" onClick={() => edit({ links: [...f.links, { label: '', url: '' }] })}>
            + Ссылка
          </button>
        )}
        <button className="btn btn-accent" disabled={state === 'saving'} onClick={() => save()}>
          Сохранить
        </button>
        {status && <span className="muted small">{status}</span>}
        {msg && <span className="error">{msg}</span>}
      </div>
    </div>
  )
}

export function Account() {
  const { mode } = useData()
  const { user, ready } = useAccount()
  const steamErr = STEAM_ERR[new URLSearchParams(window.location.search).get('steam') ?? '']
  return (
    <div className="wrap page narrow">
      <h1 className="page-title">{user ? `Кабинет: ${user.login}` : 'Личный кабинет'}</h1>
      {steamErr && <div className="error">{steamErr}</div>}
      {mode !== 'api' ? (
        <div className="empty">Кабинет работает только при подключённом API.</div>
      ) : !ready ? (
        <div className="empty">Загрузка…</div>
      ) : user ? (
        <>
          <div className="acc-links">
            <Link to="/my" className="btn btn-ghost">
              Мои матчи, чек-ин и Telegram →
            </Link>
            {user.role && (
              <Link to="/admin" className="btn btn-ghost">
                {user.role === 'referee' ? 'Панель судьи' : 'Панель организатора'} →
              </Link>
            )}
          </div>
          <Profile user={user} />
          <MyTeam user={user} />
        </>
      ) : (
        <AuthForm />
      )}
    </div>
  )
}
