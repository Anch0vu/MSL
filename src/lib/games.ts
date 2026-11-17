import type { DB, Tournament } from './types'
import { config } from '../config'

export interface GameDef {
  id: string
  name: string
  /** Подсказки для поля «ранг». */
  ranks: string[]
  /** Подсказки для поля «роль». */
  roles: string[]
  /** Что вставлять в ссылку: профиль на трекере. */
  link: string
}

export const GAMES: GameDef[] = [
  { id: 'dota2', name: 'Dota 2', ranks: ['Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'], roles: ['Керри', 'Мид', 'Оффлейн', 'Софт саппорт', 'Хард саппорт'], link: 'Dotabuff / OpenDota' },
  { id: 'cs2', name: 'Counter-Strike 2', ranks: ['FACEIT 1', 'FACEIT 5', 'FACEIT 10', 'Premier 10 000', 'Premier 15 000', 'Premier 20 000'], roles: ['Entry', 'AWP', 'Support', 'Lurker', 'IGL'], link: 'FACEIT / Leetify' },
  { id: 'deadlock', name: 'Deadlock', ranks: ['Initiate', 'Seeker', 'Alchemist', 'Arcanist', 'Ritualist', 'Emissary', 'Archon', 'Oracle', 'Phantom', 'Ascendant', 'Eternus'], roles: ['Carry', 'Support', 'Flex'], link: 'Statlocker' },
  { id: 'valorant', name: 'Valorant', ranks: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'], roles: ['Duelist', 'Initiator', 'Controller', 'Sentinel'], link: 'tracker.gg' },
  { id: 'lol', name: 'League of Legends', ranks: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'], roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'], link: 'op.gg' },
  { id: 'apex', name: 'Apex Legends', ranks: ['Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Predator'], roles: ['Fragger', 'Support', 'IGL'], link: 'apex.tracker.gg' },
  { id: 'fortnite', name: 'Fortnite', ranks: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite', 'Champion', 'Unreal'], roles: [], link: 'fortnitetracker' },
  { id: 'other', name: 'Другая игра', ranks: [], roles: [], link: 'профиль' },
]

export const gameDef = (id?: string) => GAMES.find((g) => g.id === id)
export const gameName = (id?: string) => gameDef(id)?.name ?? ''

/** Дисциплина турнира; без неё — общая из config. */
export const tourGame = (t: Pick<Tournament, 'game'>) => gameName(t.game) || config.game

/** Дисциплины, в которых лига проводит турниры (для подсказок). */
export const leagueGames = (db: DB) => [...new Set(db.tournaments.map((t) => t.game).filter(Boolean))] as string[]
