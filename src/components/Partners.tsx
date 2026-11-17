import { useDB } from '../lib/data'
import type { Partner } from '../lib/types'
import { VOIDSOUND_URL, VoidSoundMark } from './VoidSound'

/** Партнёры по умолчанию, пока список не задан в админке (Настройки → Партнёры). VoidSound показан отдельно, см. VoidSound.tsx. */
export const DEFAULT_PARTNERS: Partner[] = [{ id: 'fl', name: 'FL Logistics', url: 'https://t.me/fllogistics', hint: 'Оригинальные вещи по низким ценам', logo: `${import.meta.env.BASE_URL}partners/fl-logistics.svg` }]

export function usePartners(): Partner[] {
  const { db } = useDB()
  return (db.settings?.partners ?? DEFAULT_PARTNERS).filter((p) => p.name && p.url)
}

const initials = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Mark({ p }: { p: Partner }) {
  const logo = p.logo || DEFAULT_PARTNERS.find((d) => d.id === p.id || d.name === p.name)?.logo
  return logo ? <img className="pt-logo" src={logo} alt="" loading="lazy" /> : <span className="pt-mark">{initials(p.name)}</span>
}

/** Карточки партнёров одной строкой: VoidSound первым, подпись под названием. */
export function PartnerStrip() {
  const list = usePartners()
  return (
    <div className="pt-strip">
      <a className="pt-card pt-vs" href={VOIDSOUND_URL} target="_blank" rel="noreferrer">
        <span className="pt-mark">
          <VoidSoundMark size={14} />
        </span>
        <span className="pt-txt">
          <b>VoidSound</b>
          <small>Музыка для катки и эфиров</small>
        </span>
      </a>
      {list.map((p) => (
        <a key={p.id} className="pt-card" href={p.url} target="_blank" rel="noreferrer">
          <Mark p={p} />
          <span className="pt-txt">
            <b>{p.name}</b>
            {p.hint && <small>{p.hint}</small>}
          </span>
        </a>
      ))}
    </div>
  )
}

export function PartnerLinks() {
  return (
    <>
      {usePartners().map((p) => (
        <a key={p.id} className="pt-foot" href={p.url} target="_blank" rel="noreferrer" title={p.hint}>
          {(p.logo || DEFAULT_PARTNERS.find((d) => d.id === p.id || d.name === p.name)?.logo) && (
            <img className="pt-foot-logo" src={p.logo || DEFAULT_PARTNERS.find((d) => d.id === p.id || d.name === p.name)?.logo} alt="" loading="lazy" />
          )}
          {p.name}
        </a>
      ))}
    </>
  )
}
