import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/data'
import { readObsKey, setObsKey } from '../lib/obsKeys'

interface KeyInfo {
  id: string
  owner_id: string | null
  owner_login: string | null
  label: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
}
interface KeyList { keys: KeyInfo[]; canManageAll: boolean }
interface CreatedKey { id: string; key: string; label: string }

export function ObsKeys() {
  const [list, setList] = useState<KeyInfo[]>([])
  const [manageAll, setManageAll] = useState(false)
  const [label, setLabel] = useState('')
  const [days, setDays] = useState(30)
  const [current, setCurrent] = useState(readObsKey)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [justIssued, setJustIssued] = useState(false)

  const refresh = useCallback(async () => {
    const response = await api<KeyList>('obskeys')
    setList(response.keys)
    setManageAll(response.canManageAll)
  }, [])
  useEffect(() => { void refresh().catch((e) => setError(String(e))) }, [refresh])

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api<CreatedKey>('obskeys-create', {
        method: 'POST', body: { label: label.trim() || 'OBS Studio', days },
      })
      setObsKey(result.key)
      setCurrent(result.key)
      setJustIssued(true)
      setLabel('')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const revoke = async (id: string) => {
    if (!window.confirm('Отозвать ключ? Сцены с ним перестанут работать.')) return
    setBusy(true)
    setError('')
    try {
      await api('obskeys-revoke', { method: 'POST', body: { id } })
      // We cannot recover a key from its ID, but we can clear stale local credentials.
      setObsKey('')
      setCurrent('')
      setJustIssued(false)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <details className="panel pad obs-key-panel" aria-label="Доступ к OBS" open={!current}>
      <summary><b>Подключение OBS и ключи устройств</b><span className="small muted">{current ? 'Ключ готов · ссылки доступны' : 'Создайте ключ для источников «Браузер»'}</span></summary>
      <h2>Доступ операторов OBS</h2>
      <p className="muted">Каждому оператору выдаётся своя роль и отдельный ключ для браузерных сцен. Ключи действуют независимо: их можно отозвать без смены ссылок других операторов.</p>
      <div className="obs-key-form">
        <label>Название устройства или эфира
          <input value={label} maxLength={80} placeholder="Например, OBS режиссёра" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>Срок действия
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 день</option>
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </label>
        <button className="btn btn-accent" disabled={busy} onClick={() => void create()}>Создать ключ сцены</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {current ? (
        <div className="obs-key-ready">
          <p><b>{justIssued ? 'Новый ключ создан.' : 'Ключ сохранён в этой вкладке.'}</b> Ссылки на сцены ниже и в пульте уже содержат его.</p>
          <p className="small muted">Ключ показывается целиком только при создании. Не публикуйте OBS-ссылки и не отправляйте их зрителям. Закрытие вкладки очищает локальную копию, но не отзывает ключ в OBS Studio.</p>
          <button className="btn btn-ghost" onClick={() => { setObsKey(''); setCurrent(''); setJustIssued(false) }}>Скрыть ключ в этой вкладке</button>
        </div>
      ) : <p className="small muted">Чтобы получить рабочие ссылки для OBS, создайте ключ. Старые общие ссылки больше не действуют.</p>}
      <h3>Выданные ключи</h3>
      <div className="obs-key-list">
        {list.length === 0 && <p className="muted">Ключей пока нет.</p>}
        {list.map((item) => {
          const inactive = !!item.revoked_at || new Date(item.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()
          return (
            <div className="obs-key-row" key={item.id}>
              <div>
                <b>{item.label}</b>
                <div className="small muted">{manageAll ? `${item.owner_login || 'По паролю организатора'} · ` : ''}ID {item.id} · до {item.expires_at} UTC</div>
                <div className="small muted">{item.revoked_at ? 'Отозван' : inactive ? 'Срок истёк' : 'Активен'}{item.last_used_at ? ` · использован ${item.last_used_at} UTC` : ''}</div>
              </div>
              {!item.revoked_at && <button className="btn btn-ghost" disabled={busy} onClick={() => void revoke(item.id)}>Отозвать</button>}
            </div>
          )
        })}
      </div>
      {manageAll && <p className="small muted">Назначение роли «Оператор эфира»: панель организатора → Аккаунты → Роль. Эта роль не разрешает изменять результаты матчей и турнирные данные.</p>}
    </details>
  )
}
