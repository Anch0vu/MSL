import { config } from '../config'

/** Подписка на расписание (Google, Apple, Outlook): webcal-ссылка на .ics из API и прямая ссылка на файл. */
export function CalendarLink({ q, className = 'btn btn-ghost' }: { q: string; className?: string }) {
  const https = new URL(`${config.apiBase}?r=ics&${q}`, window.location.href).href
  const webcal = https.replace(/^https?:/, 'webcal:')
  return (
    <span className="cal-link">
      <a className={className} href={webcal} title="Подписаться: матчи появятся в календаре и будут обновляться сами">
        📅 В календарь
      </a>
      <a className="cal-ics" href={https} title="Файл .ics: если календарь не открылся, добавьте его по этой ссылке (Google Календарь → Добавить по URL)">
        .ics
      </a>
    </span>
  )
}
