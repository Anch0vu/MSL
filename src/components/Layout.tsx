import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { config } from '../config'
import { useAccount } from '../lib/account'
import { setPreview, useData, useDB, useTwitch } from '../lib/data'
import { allMatches, matchHref } from '../lib/matches'
import { VOIDSOUND_URL, VoidSoundMark } from './VoidSound'
import { PartnerLinks } from './Partners'
import { CookieConsent } from './CookieConsent'
import { MotionRouteFrame } from './Motion'
import { openConsentSettings } from '../lib/consent'

const nav = [
  ['/', 'Главная'],
  ['/tournaments', 'Турниры'],
  ['/matches', 'Матчи'],
  ['/teams', 'Команды'],
  ['/players', 'Игроки'],
  ['/rating', 'Рейтинг'],
  ['/orgs', 'Организации'],
  ['/news', 'Новости'],
  ['/rules', 'Регламент'],
  ['/faq', 'FAQ'],
] as const

export function Logo() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark" aria-hidden>MSL</span>
      <span className="brand-text">
        <b>{config.siteName}</b>
        <small>{config.siteSub}</small>
      </span>
    </Link>
  )
}

function LiveBar() {
  const { db, team } = useDB()
  const live = allMatches(db).filter((m) => m.status === 'live')
  const ch = db.settings?.twitchChannel ?? ''
  const tw = useTwitch(ch ? [ch] : [])?.find((s) => s.channel === ch.toLowerCase())
  if (!live.length && !tw) return null
  return (
    <div className="livebar">
      <div className="wrap livebar-in">
        <span className="livebar-label">
          <i className="pulse" /> Сейчас в эфире
        </span>
        {live.map((m) => (
          <Link key={`${m.tid}${m.key}`} to={matchHref(m)} className="livebar-item">
            {team(m.a)?.tag ?? 'TBD'} <b>{m.scoreA ?? 0}:{m.scoreB ?? 0}</b> {team(m.b)?.tag ?? 'TBD'}
            <small>{m.tournament}</small>
          </Link>
        ))}
        {tw && (
          <a className="livebar-watch" href={`https://twitch.tv/${ch}`} target="_blank" rel="noreferrer">
            Twitch: {tw.viewers} зрителей
          </a>
        )}
        {!tw && live.find((m) => m.record?.stream) && (
          <a className="livebar-watch" href={live.find((m) => m.record?.stream)!.record!.stream} target="_blank" rel="noreferrer">
            Смотреть трансляцию →
          </a>
        )}
      </div>
    </div>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const flip = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#070707' : '#f4f4f2')
    try {
      localStorage.setItem('cup-theme', next ? 'dark' : 'light')
    } catch {
      /* без сохранения */
    }
  }
  return (
    <button type="button" className="theme-btn" onClick={flip} title={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-pressed={dark}>
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}

function AccountDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signout } = useAccount()
  const { db } = useDB()
  const loc = useLocation()
  useEffect(onClose, [loc.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null
  const card = db.players.find((p) => p.userId === user.id)
  const team = db.teams.find((t) => t.id === card?.teamId)
  const mine = db.teams.find((t) => t.ownerId === user.id || db.players.some((p) => p.id === t.captainId && p.userId === user.id))
  const items: [string, string, string][] = [
    ...(card ? ([[`/players/${card.id}`, '👤', 'Профиль игрока']] as [string, string, string][]) : []),
    ['/account', '⚙️', 'Кабинет и настройки'],
    ...(mine ? ([['/account', '🛡️', 'Управление командой']] as [string, string, string][]) : []),
    ['/my', '🎮', 'Мои матчи и чек-ин'],
    ['/agents', '🔎', 'Игроки в поиске команды'],
    ['/register', '📝', 'Подать заявку'],
    ...(user.role ? ([['/admin', '🏆', user.role === 'referee' ? 'Панель судьи' : 'Панель организатора']] as [string, string, string][]) : []),
  ]
  return (
    <div className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer-box">
        <button type="button" className="drawer-x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="drawer-me">
          <i>{(user.nick || user.login).slice(0, 1).toUpperCase()}</i>
          <div>
            <b>{user.nick || user.login}</b>
            <small>
              {user.login}
              {team ? ` · ${team.name}` : ' · без команды'}
            </small>
          </div>
        </div>
        <nav className="drawer-nav">
          {items.map(([to, ico, label]) => (
            <Link key={label} to={to} onClick={onClose}>
              <span>{ico}</span>
              {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={async () => {
              await signout()
              onClose()
            }}
          >
            <span>⎋</span>Выйти
          </button>
        </nav>
      </aside>
    </div>
  )
}

export function Layout() {
  const { db, preview, refresh, mode, readonly } = useData()
  const { user } = useAccount()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const [drawer, setDrawer] = useState(false)
  const dc = db.settings?.discordUrl || config.discordUrl
  const tg = db.settings?.telegramUrl || config.telegramUrl
  const vk = db.settings?.vkUrl
  const tw = db.settings?.twitchChannel
  useEffect(() => {
    setOpen(false)
    window.scrollTo(0, 0)
  }, [loc.pathname])

  return (
    <div className="app">
      {preview && (
        <div className="preview-bar">
          Предпросмотр черновика из админки. Опубликуйте db.json, чтобы изменения увидели все.
          <button
            onClick={() => {
              setPreview(false)
              refresh()
            }}
          >
            Выключить
          </button>
        </div>
      )}
      {user && <AccountDrawer open={drawer} onClose={() => setDrawer(false)} />}
      <header className="header">
        <div className="wrap header-in">
          <Logo />
          <span className="header-tagline">{config.tagline}</span>
          <div className="header-links">
            {(db.settings?.discordUrl || config.discordUrl) && <a href={db.settings?.discordUrl || config.discordUrl}>Discord</a>}
            {(db.settings?.telegramUrl || config.telegramUrl) && <a href={db.settings?.telegramUrl || config.telegramUrl}>Telegram</a>}
            {mode === 'api' && user && <Link to="/my">Мои матчи</Link>}
            {mode === 'api' && (user ? (
              <button type="button" className="user-chip" onClick={() => setDrawer(true)}>
                <i>{(user.nick || user.login).slice(0, 1).toUpperCase()}</i>
                {user.login}
              </button>
            ) : (
              <Link to="/account">Войти</Link>
            ))}
            <Link to="/admin">Организатору</Link>
            <Link to="/register" className="btn btn-accent motion-magnetic">
              Подать заявку
            </Link>
          </div>
          <ThemeToggle />
          <button className="burger" onClick={() => setOpen((o) => !o)} aria-label="Меню" aria-controls="primary-navigation" aria-expanded={open}>
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>
      <div className="navbar">
        <nav id="primary-navigation" className={`wrap nav ${open ? 'open' : ''}`}>
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span className="motion-roll"><span>{label}</span><span aria-hidden>{label}</span></span>
            </NavLink>
          ))}
          {mode === 'api' && user && (
            <Link to="/my" className="nav-cta">
              Мои матчи
            </Link>
          )}
          <Link to="/register" className="nav-cta">
            Подать заявку
          </Link>
          <Link to="/admin" className="nav-cta">
            Организатору
          </Link>
        </nav>
      </div>
      {readonly && (
        <div className="ro-bar">Сайт временно работает на резервном сервере: всё можно смотреть, а вход, заявки и изменения вернутся, когда основной сервер снова будет доступен.</div>
      )}
      <LiveBar />
      <main>
        {user && !user.discord?.trim() && (
          <div className="wrap">
            <div className="warn-text">
              Укажите Discord в <Link to="/account">Кабинете</Link>: по нему с вами свяжутся капитаны и организаторы.
            </div>
          </div>
        )}
        <MotionRouteFrame routeKey={loc.pathname}>
          <Outlet />
        </MotionRouteFrame>
      </main>
      <nav className="arena-bottom-nav" aria-label="Основная мобильная навигация">
        <NavLink to="/" end>Главная</NavLink>
        <NavLink to="/matches">Матчи</NavLink>
        <NavLink to="/tournaments">Турниры</NavLink>
        <NavLink to="/admin">Орга</NavLink>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-controls="primary-navigation" aria-expanded={open}>Меню</button>
      </nav>
      <footer className="footer">
        <div className="wrap footer-top">
          <div>
            <h4>Лига</h4>
            <Link to="/tournaments">Турниры</Link>
            <Link to="/matches">Расписание матчей</Link>
            <Link to="/news">Новости</Link>
            <Link to="/rules">Регламент</Link>
            <Link to="/faq">Вопросы и ответы</Link>
          </div>
          <div>
            <h4>Участникам</h4>
            <Link to="/register">Подать заявку</Link>
            {mode === 'api' && <Link to="/account">Личный кабинет</Link>}
            <Link to="/teams">Команды</Link>
            <Link to="/orgs">Организации</Link>
            <Link to="/players">Игроки</Link>
            <Link to="/agents">Ищут команду</Link>
            <Link to="/rating">Рейтинг команд</Link>
            {mode === 'api' && <Link to="/my">Мои матчи</Link>}
          </div>
          <div>
            <h4>Трансляции</h4>
            {tw ? <a href={`https://twitch.tv/${tw}`} target="_blank" rel="noreferrer">Twitch-канал лиги</a> : <Link to="/matches">Матчи в эфире</Link>}
            <Link to="/">Хайлайты</Link>
          </div>
          <div>
            <h4>Организаторам</h4>
            <Link to="/admin">Панель организатора</Link>
            <Link to="/privacy">Конфиденциальность</Link>
            <Link to="/cookies">Использование cookies</Link>
            <button type="button" className="footer-settings" onClick={openConsentSettings}>Настроить cookies</button>
            {config.contactEmail && <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>}
          </div>
          <div>
            <h4>О лиге</h4>
            <Link to="/faq">Вопросы и ответы</Link>
            <Link to="/rules">Документы лиги</Link>
          </div>
          <div>
            <h4>Партнёры</h4>
            <a className="vs-foot" href={VOIDSOUND_URL} target="_blank" rel="noreferrer" title="Музыка без границ">
              <VoidSoundMark size={18} /> VoidSound
            </a>
            <PartnerLinks />
          </div>
        </div>
        <div className="footer-line" />
        <div className="wrap footer-bottom">
          <Logo />
          <div className="footer-meta">
            <div>© {new Date().getFullYear()} {config.siteName}. {config.footerNote}</div>
            <div className="footer-sub">{config.siteSub}</div>
            <div className="socials">
              {vk && (
                <a href={vk} target="_blank" rel="noreferrer" aria-label="VK">
                  <svg viewBox="0 0 24 24"><text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">VK</text></svg>
                </a>
              )}
              {tg && (
                <a href={tg} target="_blank" rel="noreferrer" aria-label="Telegram">
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4.5 11.4l13.2-5.1c.6-.2 1.1.1.9 1l-2.2 10.4c-.2.7-.6.9-1.200.6l-3.300-2.400-1.600 1.500c-.2.2-.3.3-.7.3l.2-3.400 6.100-5.500c.3-.2-.1-.4-.4-.2l-7.500 4.700-3.200-1c-.7-.2-.7-.7.1-.9z"/></svg>
                </a>
              )}
              {tw && (
                <a href={`https://twitch.tv/${tw}`} target="_blank" rel="noreferrer" aria-label="Twitch">
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 3L3.500 7v12H8v3h3l3-3h4l4-4V3H5zm14 11l-2.500 2.500H12l-3 3v-3H6V5h13v9zM15 8h1.700v4.500H15V8zm-4 0h1.700v4.500H11V8z"/></svg>
                </a>
              )}
              {dc && (
                <a href={dc} target="_blank" rel="noreferrer" aria-label="Discord">
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.500A15 15 0 0015.300 5.400l-.4.800a13 13 0 00-3.900 0l-.4-.8A15 15 0 006.900 6.500C4.500 10 3.900 13.400 4.200 16.700a15 15 0 004.500 2.300l1-1.600a10 10 0 01-1.500-.7l.4-.3a10.700 10.700 0 009 0l.4.3c-.5.3-1 .5-1.500.7l1 1.600a15 15 0 004.500-2.300C21.300 12.800 20.200 9.400 19 6.500zM9.300 14.700c-.8 0-1.400-.7-1.400-1.600s.6-1.600 1.400-1.600 1.400.7 1.400 1.600-.6 1.600-1.400 1.600zm5.400 0c-.8 0-1.400-.7-1.400-1.600s.6-1.600 1.400-1.600 1.400.7 1.400 1.600-.6 1.600-1.400 1.600z"/></svg>
                </a>
              )}
            </div>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </div>
  )
}
