import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/data'
import { ObsIndex as LinkList, SCENES } from './Obs'
import { ObsPanel } from './ObsControl'
import { ObsFpsProbe } from './ObsFpsProbe'
import { ObsKeys } from './ObsKeys'
import { LIVE_SCENES } from './ObsLive'

/* Сцены Obs.tsx (заставка, анонс, итог, сетка) и управляемые с пульта сцены ObsLive.tsx; вторые главнее. */
const ALL: Record<string, () => JSX.Element> = { ...SCENES, ...LIVE_SCENES }

export function ObsScene() {
  const { scene = '' } = useParams()
  const [params] = useSearchParams()
  const key = params.get('obskey') || ''
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    setAllowed(null)
    const verify = () => api<{ authorized: boolean }>('obsaccess', { method: 'POST', body: { key } })
      .then(({ authorized }) => { if (active) setAllowed(authorized === true) })
      .catch(() => { if (active) setAllowed(false) })
    void verify()
    const interval = window.setInterval(() => { void verify() }, 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [key])
  if (allowed === null) return <div className="wrap page">Проверка доступа к OBS…</div>
  if (!allowed) return <div className="wrap page"><h1>Доступ ограничен</h1><p>Сцена доступна только команде организаторов.</p></div>
  const S = ALL[scene]
  return S ? <><S />{params.get('perf') === '1' && <ObsFpsProbe />}</> : <div className="wrap page">Нет такой сцены</div>
}

/** Страница /obs: пульт режиссёра и ссылки на сцены. */
export function ObsIndex() {
  return (
    <LinkList>
      <ObsKeys />
      <ObsPanel />
    </LinkList>
  )
}
