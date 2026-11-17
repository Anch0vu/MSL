import { useState } from 'react'
import { api, teamMediaUrl } from '../lib/data'
import { coverImage } from '../lib/image'
import type { Team } from '../lib/types'
import { TeamLogo } from './ui'

type Kind = 'logo' | 'banner'

/** Загрузка логотипа (256×256, PNG) и баннера (1600×400, JPEG) команды. onDone получает новую версию картинки (0 — удалена). */
export function TeamMediaEdit({ team, onDone }: { team: Team; onDone: (kind: Kind, v: number) => void }) {
  const [busy, setBusy] = useState<Kind | ''>('')
  const [err, setErr] = useState('')
  const send = async (kind: Kind, body: { data?: string; remove?: boolean }) => {
    setErr('')
    setBusy(kind)
    try {
      const r = await api<{ v: number }>('teammedia', { method: 'POST', body: { team: team.id, kind, ...body } })
      onDone(kind, r.v)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const pick = (kind: Kind) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = kind === 'logo' ? await coverImage(file, 256, 256, 'image/png') : await coverImage(file, 1600, 400)
      await send(kind, { data })
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    }
  }
  const banner = teamMediaUrl(team, 'banner')
  return (
    <div className="media-edit">
      <div className="me-logo">
        <TeamLogo team={team} size={72} />
        <label className="btn btn-ghost">
          {busy === 'logo' ? 'Загрузка…' : 'Логотип'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick('logo')} />
        </label>
        {team.logo ? (
          <button type="button" className="btn btn-ghost" onClick={() => send('logo', { remove: true })}>
            Убрать
          </button>
        ) : null}
      </div>
      <div className="me-banner">
        <div className="me-banner-prev" style={{ '--tc': team.color, backgroundImage: banner ? `url("${banner}")` : undefined } as React.CSSProperties}>
          {!banner && <span>Баннер 1600×400</span>}
        </div>
        <label className="btn btn-ghost">
          {busy === 'banner' ? 'Загрузка…' : 'Баннер'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick('banner')} />
        </label>
        {team.banner ? (
          <button type="button" className="btn btn-ghost" onClick={() => send('banner', { remove: true })}>
            Убрать
          </button>
        ) : null}
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  )
}
