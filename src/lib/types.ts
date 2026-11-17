export type ID = string

export interface Player {
  id: ID
  nick: string
  name?: string
  role?: string
  teamId?: ID
  faculty?: string
  course?: number
  country?: string
  about?: string
  twitch?: string
  contact?: string
  discord?: string
  /** Рейтинг (ММР), задаётся в личном кабинете. */
  mmr?: number
  /** Аккаунт, которому принадлежит карточка; поля профиля обновляются из кабинета. */
  userId?: string
  /** Версия аватара; картинка отдаётся API (см. avatarUrl). */
  avatar?: number
  /** ММР подтверждён через OpenDota (по Steam ID), а не вписан руками. */
  mmrVerified?: boolean
  /** CS2 Premier, уровень и ELO FACEIT, значок ранга Deadlock (из статистики Steam). */
  csPremier?: number
  faceitLevel?: number
  faceitElo?: number
  dlBadge?: number
  /** Медаль Dota 2: десятки — медаль (1 Рекрут … 8 Титан), единицы — звезда. */
  rankTier?: number
  /** Место в мировом рейтинге (для Титанов). */
  leaderboard?: number
  /** Steam32 account id для ссылок на Dotabuff / OpenDota. */
  steamId?: string
  /** Ищет команду (свободный агент). */
  lft?: boolean
  lftNote?: string
  /** Игровые профили (из личного кабинета). */
  games?: GameEntry[]
  /** Свои контакты и ссылки. */
  links?: { label: string; url: string }[]
  /** Оформление профиля: цвет шапки, узор, подпись. */
  accent?: string
  banner?: string
  tagline?: string
  /** Рамка, эффект аватара, эмодзи и стиль ника (src/lib/persona.ts). */
  persona?: Persona
  /** Бейджи от организатора (ADMIN_BADGES). */
  badges?: string[]
  /** Steam привязан через вход Steam. */
  steamOk?: boolean
}

export interface Persona {
  frame?: string
  effect?: string
  nickFx?: string
  emoji?: string
  accent2?: string
  grad?: number
}

export interface GameEntry {
  /** id дисциплины из GAMES (src/lib/games.ts). */
  g: string
  rank?: string
  role?: string
  url?: string
  main?: boolean
}

export type AwardTier = 'gold' | 'silver' | 'bronze' | 'mvp' | 'special'

/** Награда в витрине игрока/команды: кубок за место или особый приз. */
export interface Award {
  id: ID
  tier: AwardTier
  title: string
  playerId?: ID
  teamId?: ID
  tournamentId?: ID
  date?: string
}

export type OrgKind = 'institute' | 'club' | 'department' | 'other'

/** Организация: институт, студенческий клуб, кафедра. */
export interface Organization {
  id: ID
  name: string
  short?: string
  kind: OrgKind
  description?: string
  site?: string
  /** участников назначает только организатор (служебные, тех. состав) */
  closed?: boolean
}

export interface Team {
  id: ID
  name: string
  tag: string
  color?: string
  faculty?: string
  orgId?: ID
  /** Аккаунт, управляющий командой (id пользователя). */
  ownerId?: string
  captainId?: ID
  about?: string
  contact?: string
  links?: { label: string; url: string }[]
  /** Версии загруженных логотипа и баннера (картинки отдаёт API, см. teamMediaUrl). */
  logo?: number
  banner?: number
  /** Девиз на баннере, год основания, дисциплина (id из games.ts). */
  slogan?: string
  founded?: string
  game?: string
  /** Удобное время игр (ЧЧ:ММ, МСК) и пожелание: учитывается в авто-расписании. */
  playFrom?: string
  playTo?: string
  timeNote?: string
}

/** Сид в сетке: id команды, null — ещё не определена (TBD), "BYE" — пустой слот, соперник проходит дальше. */
export type Seed = ID | null | 'BYE'

export interface GroupDef {
  name: string
  teams: ID[]
}

export interface GroupStage {
  id: ID
  type: 'groups'
  name: string
  bo: number
  /** Сколько команд из каждой группы проходит дальше (подсветка в таблице). */
  advance: number
  groups: GroupDef[]
}

export interface BracketStage {
  id: ID
  type: 'single' | 'double'
  name: string
  /** Размер сетки: 4, 8, 16, 32. */
  size: number
  seeds: Seed[]
  bo: number
  finalBo?: number
  /** Только single: матч за 3-е место. */
  thirdPlace?: boolean
}

export type Stage = GroupStage | BracketStage

export type TournamentStatus = 'upcoming' | 'registration' | 'live' | 'finished'

export interface Tournament {
  id: ID
  name: string
  /** Дисциплина (id из GAMES). */
  game?: string
  short?: string
  status: TournamentStatus
  startDate: string
  endDate?: string
  prize?: string
  format: string
  maxTeams: number
  description: string
  rules?: string
  teams: ID[]
  stages: Stage[]
}

export type MatchStatus = 'scheduled' | 'live' | 'finished'

export interface MapResult {
  name: string
  a: number
  b: number
  /** Игра Dota 2 из OpenDota. */
  matchId?: number
}

/**
 * Запись матча.
 * Для сетки: key = ключ слота (UB1-1, LB2-1, GF, F, 3RD), команды вычисляются автоматически.
 * Для групп: key = произвольный id, teamA/teamB указываются явно.
 */
export interface MatchRecord {
  tournamentId: ID
  stageId: ID
  key: string
  group?: string
  teamA?: ID
  teamB?: ID
  scoreA?: number
  scoreB?: number
  status?: MatchStatus
  date?: string
  maps?: MapResult[]
  stream?: string
  note?: string
}

export interface NewsItem {
  id: ID
  title: string
  date: string
  tag: string
  excerpt: string
  body: string
  tournamentId?: ID
  pinned?: boolean
  /** URL картинки обложки (необязательно). */
  cover?: string
}

export interface Highlight {
  id: ID
  title: string
  url?: string
  date?: string
  tournamentId?: ID
}

export interface Settings {
  /** Основной Twitch-канал лиги (логин). */
  twitchChannel?: string
  discordUrl?: string
  telegramUrl?: string
  vkUrl?: string
  /** Клиентский (client-side) ключ FACEIT Data API: K/D, ADR и уровень FACEIT запрашиваются из браузера. */
  faceitKey?: string
  /** Принимать заявки через сайт. */
  registrationOpen?: boolean
  autoApprove?: boolean
  /** Техническое поражение команде, не прошедшей чек-ин к началу матча. */
  autoForfeit?: boolean
  /** Сезон рейтинга Эло: турниры с этой даты (YYYY-MM-DD) и название сезона. */
  seasonStart?: string
  seasonName?: string
  /** Партнёры лиги (главная и подвал); не задано — DEFAULT_PARTNERS. */
  partners?: Partner[]
}

export interface Partner {
  id: ID
  name: string
  url: string
  /** Подпись при наведении. */
  hint?: string
  /** Ссылка на логотип (необязательно). */
  logo?: string
}

export interface Application {
  id: ID
  kind: 'team' | 'player'
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  tournamentId?: ID
  contact: string
  faculty?: string
  orgId?: ID
  userId?: string
  comment?: string
  team?: { name: string; tag: string }
  captain?: string
  players?: { nick: string; role?: string; twitch?: string }[]
  nick?: string
  role?: string
  twitch?: string
  course?: number
  note?: string
}

export interface DB {
  teams: Team[]
  players: Player[]
  tournaments: Tournament[]
  matches: MatchRecord[]
  news: NewsItem[]
  highlights?: Highlight[]
  settings?: Settings
  orgs?: Organization[]
  awards?: Award[]
  rules: string
}
