/** Позиции Dota 2: цвет и иконка для карточек состава. Роль игрока — свободный текст, распознаём по словам. */
export interface RoleDef {
  key: 'carry' | 'mid' | 'offlane' | 'soft' | 'hard' | 'other'
  label: string
  color: string
}

const DEFS: Record<RoleDef['key'], Omit<RoleDef, 'key'>> = {
  carry: { label: 'Carry', color: '#e5383b' },
  mid: { label: 'Mid', color: '#4c6fff' },
  offlane: { label: 'Offlane', color: '#2fbf71' },
  soft: { label: 'Support', color: '#f2c230' },
  hard: { label: 'Hard Support', color: '#a35cff' },
  other: { label: '', color: '#8a94a6' },
}

export function roleDef(role?: string): RoleDef {
  const r = (role ?? '').toLowerCase()
  const key: RoleDef['key'] = /хард\s*сап|фулл\s*сап|full\s*sup|hard\s*sup|pos\.?\s*5|поз\w*\s*5|\b5\s*поз/.test(r)
    ? 'hard'
    : /керри|кэрри|carry|pos\.?\s*1|поз\w*\s*1|\b1\s*поз/.test(r)
      ? 'carry'
      : /мид|mid|pos\.?\s*2|поз\w*\s*2|\b2\s*поз/.test(r)
        ? 'mid'
        : /офф?лейн|хардлайн|offlane|pos\.?\s*3|поз\w*\s*3|\b3\s*поз/.test(r)
          ? 'offlane'
          : /сап+орт|support|роумер|роам|pos\.?\s*4|поз\w*\s*4|\b4\s*поз/.test(r)
            ? 'soft'
            : 'other'
  const d = DEFS[key]
  return { key, label: key === 'other' ? role ?? '' : d.label, color: d.color }
}

/** Контурная иконка позиции (24×24, цвет — currentColor). */
export function RoleIcon({ k }: { k: RoleDef['key'] }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      {k === 'carry' && (
        <g {...p}>
          <path d="M14.5 3.5H20.5V9.5L10 20l-3.5-3.5z" />
          <path d="M4 20l3-3M5.5 14.5l4 4" />
        </g>
      )}
      {k === 'mid' && <path {...p} d="M12 2.5l3 6.5 6.5 3-6.5 3-3 6.5-3-6.5-6.5-3 6.5-3z" />}
      {k === 'offlane' && <path {...p} d="M12 3l8 3v5.5c0 4.6-3.3 8.3-8 9.5-4.7-1.2-8-4.9-8-9.5V6z" />}
      {k === 'soft' && <path {...p} d="M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9z" />}
      {k === 'hard' && (
        <g {...p}>
          <path d="M12 20c-4-2-6.5-5-6.5-9 2.5 0 5 1.5 6.5 4 1.5-2.5 4-4 6.5-4 0 4-2.5 7-6.5 9z" />
          <path d="M12 15c-1.5-2-1.8-5-0-8.5 1.8 3.5 1.5 6.5 0 8.5z" />
        </g>
      )}
      {k === 'other' && (
        <g {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
        </g>
      )}
    </svg>
  )
}
