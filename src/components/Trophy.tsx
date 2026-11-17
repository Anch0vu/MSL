import { Link } from 'react-router-dom'
import type { Award, AwardTier, DB } from '../lib/types'

export const TIERS: [AwardTier, string][] = [
  ['gold', 'Чемпион'],
  ['silver', '2 место'],
  ['bronze', '3 место'],
  ['mvp', 'MVP'],
  ['special', 'Особая награда'],
]

/** Кубок (SVG) цвета награды. */
export function TrophyIcon({ tier, size = 44 }: { tier: AwardTier; size?: number }) {
  if (tier === 'mvp' || tier === 'special')
    return (
      <svg className={`trophy t-${tier}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="20" r="13" />
        <path d="M17 31l-4 13 11-5 11 5-4-13" />
        <path className="shine" d="M24 12l2.4 5 5.4.6-4 3.7 1.1 5.4L24 24l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />
      </svg>
    )
  return (
    <svg className={`trophy t-${tier}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M14 6h20v10c0 6.6-4.5 12-10 12S14 22.6 14 16z" />
      <path d="M14 9H7c0 6 3 9.5 7.5 10M34 9h7c0 6-3 9.5-7.5 10" fill="none" strokeWidth="3" />
      <rect x="21" y="27" width="6" height="8" />
      <rect x="14" y="35" width="20" height="6" rx="1" />
      <path className="shine" d="M18 9h3v8c0 2 .8 4 2 5-3-.5-5-3-5-6z" />
    </svg>
  )
}

/** Витрина наград игрока или команды. */
export function TrophyShelf({ db, awards, empty }: { db: DB; awards: Award[]; empty?: string }) {
  if (!awards.length) return empty ? <div className="empty small">{empty}</div> : null
  const order: Record<AwardTier, number> = { gold: 0, silver: 1, bronze: 2, mvp: 3, special: 4 }
  return (
    <div className="trophy-shelf">
      {[...awards]
        .sort((a, b) => order[a.tier] - order[b.tier] || (b.date ?? '').localeCompare(a.date ?? ''))
        .map((a) => {
          const t = db.tournaments.find((x) => x.id === a.tournamentId)
          return (
            <div key={a.id} className="trophy-card" title={a.title}>
              <TrophyIcon tier={a.tier} />
              <b>{a.title}</b>
              {t ? <Link to={`/t/${t.id}`}>{t.name}</Link> : a.date && <small>{a.date}</small>}
            </div>
          )
        })}
    </div>
  )
}
