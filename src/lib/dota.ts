const MEDALS = ['', 'Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан']

/** Название медали Dota 2 по rank_tier OpenDota: «Властелин 3», «Титан #120». */
export function rankLabel(tier?: number | null, leaderboard?: number | null): string {
  if (!tier) return ''
  const medal = Math.floor(tier / 10)
  const name = MEDALS[medal] ?? ''
  if (medal >= 8) return leaderboard ? `${name} #${leaderboard}` : name
  const star = tier % 10
  return star ? `${name} ${star}` : name
}

export const dotabuffUrl = (id: string) => `https://www.dotabuff.com/players/${id}`
export const opendotaUrl = (id: string) => `https://www.opendota.com/players/${id}`
