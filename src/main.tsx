import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Empty } from './components/ui'
import { AccountProvider } from './lib/account'
import { DataProvider } from './lib/data'
import { Account } from './pages/Account'
import { Admin } from './pages/Admin'
import { OrgPage, Orgs } from './pages/Orgs'
import { Article, News, Rules } from './pages/Content'
import { Register } from './pages/Register'
import { Faq } from './pages/Faq'
import { Home } from './pages/Home'
import { MyMatches } from './pages/My'
import { Rating } from './pages/Rating'
import { MatchPage, Matches } from './pages/Match'
import { ObsIndex, ObsScene } from './pages/ObsRoot'
import { PlayerPage, Players, TeamPage, Teams } from './pages/Teams'
import { TournamentPage, Tournaments } from './pages/Tournaments'
import { Privacy } from './pages/Privacy'
import { Cookies } from './pages/Cookies'
import './styles/theme.css'
import './styles/app.css'
import './styles/msl.css'
import './styles/motion.css'
import './styles/arena.css'

// HashRouter: работает на любом статическом хостинге без настройки редиректов
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <AccountProvider>
      <HashRouter>
        <Routes>
          <Route path="obs/:scene" element={<ObsScene />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="tournaments" element={<Tournaments />} />
            <Route path="t/:id" element={<TournamentPage />} />
            <Route path="t/:tid/m/:stageId/:mkey" element={<MatchPage />} />
            <Route path="t/:id/:tab" element={<TournamentPage />} />
            <Route path="matches" element={<Matches />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/:id" element={<TeamPage />} />
            <Route path="players" element={<Players />} />
            <Route path="players/:id" element={<PlayerPage />} />
            <Route path="agents" element={<Players agents />} />
            <Route path="news" element={<News />} />
            <Route path="news/:id" element={<Article />} />
            <Route path="rules" element={<Rules />} />
            <Route path="faq" element={<Faq />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="cookies" element={<Cookies />} />
            <Route path="orgs" element={<Orgs />} />
            <Route path="orgs/:id" element={<OrgPage />} />
            <Route path="account" element={<Account />} />
            <Route path="my" element={<MyMatches />} />
            <Route path="rating" element={<Rating />} />
            <Route path="register" element={<Register />} />
            <Route path="admin" element={<Admin />} />
            <Route path="obs" element={<ObsIndex />} />
            <Route path="*" element={<div className="wrap page"><Empty>Страница не найдена</Empty></div>} />
          </Route>
        </Routes>
      </HashRouter>
      </AccountProvider>
    </DataProvider>
  </StrictMode>,
)

// PWA: установка на телефон и просмотр последней загруженной сетки без сети (public/sw.js)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined))
}
