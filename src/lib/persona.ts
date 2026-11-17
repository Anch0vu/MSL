import type { Player } from './types'

/** Персонализация профиля: списки совпадают с PERSONA в api/index.php. */
export const FRAMES: [string, string][] = [
  ['', 'Без рамки'],
  ['accent', 'Цвет профиля'],
  ['gradient', 'Градиент'],
  ['rainbow', 'Радуга'],
  ['neon', 'Неон'],
  ['gold', 'Золото'],
  ['ice', 'Лёд'],
  ['fire', 'Огонь'],
]

export const EFFECTS: [string, string][] = [
  ['', 'Без эффекта'],
  ['pulse', 'Пульс'],
  ['glow', 'Свечение'],
  ['spin', 'Вращение рамки'],
  ['float', 'Парение'],
]

export const NICK_FX: [string, string][] = [
  ['', 'Обычный'],
  ['gradient', 'Градиент'],
  ['glow', 'Свечение'],
  ['shimmer', 'Блик'],
]

export const GRADS = [0, 45, 90, 115, 135, 180, 225, 270, 315]

export const EMOJIS = ['', '🔥', '⚡', '👑', '🎯', '🛡️', '🗡️', '💀', '🐉', '🦊', '🐺', '🌙', '⭐', '💎', '🎧', '🚀', '❄️', '🍀']

export interface BadgeDef {
  name: string
  emoji: string
  desc: string
  c1: string
  c2: string
}

/** Бейджи от организатора (BADGES в api/index.php) и автоматические. */
export const BADGE_DEFS: Record<string, BadgeDef> = {
  team: { name: 'Администрация', emoji: '🛡️', desc: 'Команда Киберлиги', c1: '#ef4444', c2: '#b91c1c' },
  moderator: { name: 'Модератор', emoji: '⚖️', desc: 'Следит за порядком', c1: '#38bdf8', c2: '#1d4ed8' },
  partner: { name: 'VoidSound', emoji: '', desc: 'Партнёр Киберлиги × VoidSound', c1: '#2a2a2a', c2: '#050505' },
  caster: { name: 'Комментатор', emoji: '🎙️', desc: 'Комментирует матчи лиги', c1: '#a78bfa', c2: '#6d28d9' },
  streamer: { name: 'Стример', emoji: '📺', desc: 'Стримит на Twitch', c1: '#c084fc', c2: '#9146ff' },
  mvp: { name: 'MVP', emoji: '⭐', desc: 'Лучший игрок турнира', c1: '#fde68a', c2: '#d97706' },
  founder: { name: 'Основатель', emoji: '🚀', desc: 'Стоял у истоков лиги', c1: '#34d399', c2: '#047857' },
  captain: { name: 'Капитан', emoji: '👑', desc: 'Капитан команды', c1: '#fbbf24', c2: '#b45309' },
  champion: { name: 'Чемпион', emoji: '🏆', desc: 'Победитель турнира лиги', c1: '#fef3c7', c2: '#d97706' },
  veteran: { name: 'Ветеран', emoji: '🎖️', desc: 'Три и больше турниров', c1: '#f59e0b', c2: '#7c2d12' },
  steam: { name: 'Steam', emoji: '✔', desc: 'Steam подтверждён входом', c1: '#2a475e', c2: '#171a21' },
}

export const ADMIN_BADGES = ['team', 'moderator', 'partner', 'caster', 'streamer', 'mvp', 'founder']

/** Классы обёртки аватара: рамка и эффект. Пусто, если игрок ничего не выбрал. */
export function avatarFx(p: Player): string {
  const s = p.persona
  if (!s?.frame && !s?.effect) return ''
  return [s.frame && `fr-${s.frame}`, s.effect && `fx-${s.effect}`].filter(Boolean).join(' ')
}

/** CSS-переменные профиля: основной и второй цвет, направление градиента. */
export function personaVars(p: Player, fallback?: string): React.CSSProperties {
  const v: Record<string, string> = {}
  const tc = p.accent || fallback
  if (tc) v['--tc'] = tc
  if (p.persona?.accent2) v['--tc2'] = p.persona.accent2
  if (p.persona?.grad != null) v['--grad'] = `${p.persona.grad}deg`
  return v as React.CSSProperties
}

export function headClass(p: Player): string {
  return ['profile-head', p.accent && 'has-accent', p.persona?.accent2 && 'has-accent2', p.banner && `banner-${p.banner}`].filter(Boolean).join(' ')
}

export function nickClass(p: Player): string {
  return p.persona?.nickFx ? `nick nick-${p.persona.nickFx}` : 'nick'
}
