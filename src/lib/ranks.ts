import { gameDef } from './games'

/** Цвет уровня FACEIT 1–10. */
export const faceitColor = (lvl: number) => (lvl >= 10 ? '#fe1f00' : lvl >= 8 ? '#ff6309' : lvl >= 4 ? '#ffc800' : lvl >= 2 ? '#1ce400' : '#9aa4ad')

/** Цвет рейтинга Premier по диапазонам игры. */
export const premierColor = (r: number) =>
  r >= 30000 ? '#d6b500' : r >= 25000 ? '#eb4b4b' : r >= 20000 ? '#d32ce6' : r >= 15000 ? '#8847ff' : r >= 10000 ? '#4b69ff' : r >= 5000 ? '#5e98d9' : '#b0c3d9'

/** Значок ранга Deadlock: десятки — ранг (1 Initiate … 11 Eternus), единицы — ступень. */
export function deadlockRank(badge?: number | null) {
  if (!badge) return ''
  const name = gameDef('deadlock')?.ranks[Math.floor(badge / 10) - 1]
  return name ? `${name} ${badge % 10}` : ''
}
