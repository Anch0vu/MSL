import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { openConsentSettings, saveConsent, SETTINGS_EVENT, useConsent } from '../lib/consent'

export function CookieConsent() {
  const consent = useConsent()
  const [open, setOpen] = useState(consent === null)
  const [details, setDetails] = useState(false)
  const [functional, setFunctional] = useState(consent?.functional ?? false)

  useEffect(() => {
    const show = () => {
      setFunctional(consent?.functional ?? false)
      setDetails(true)
      setOpen(true)
    }
    window.addEventListener(SETTINGS_EVENT, show)
    return () => window.removeEventListener(SETTINGS_EVENT, show)
  }, [consent])

  useEffect(() => {
    if (consent === null) setOpen(true)
  }, [consent])

  const commit = (allow: boolean) => {
    saveConsent({ functional: allow, externalMedia: allow })
    setOpen(false)
    setDetails(false)
  }

  if (!open) return null

  return (
    <div className="consent-layer" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-panel">
        <div className="consent-kicker">MSL / PRIVACY CONTROL</div>
        <h2 id="consent-title">Cookies — настоящий выбор, а не заглушка</h2>
        <p>
          Обязательная cookie <code>cupsid</code> нужна для входа и защиты сессии. Внешний Twitch-плеер и функциональное хранилище
          включаются только после вашего разрешения.
        </p>
        {details && (
          <div className="consent-options">
            <label>
              <span><b>Необходимые</b><small>Авторизация, безопасность и сохранение выбранных настроек cookies.</small></span>
              <input type="checkbox" checked disabled />
            </label>
            <label>
              <span><b>Функциональные и внешний медиаконтент</b><small>Тема интерфейса, Twitch-плеер и связанное внешнее содержимое.</small></span>
              <input type="checkbox" checked={functional} onChange={(e) => setFunctional(e.target.checked)} />
            </label>
          </div>
        )}
        <div className="consent-links">
          <Link to="/cookies" onClick={() => setOpen(false)}>Подробнее о cookies</Link>
          <Link to="/privacy" onClick={() => setOpen(false)}>Конфиденциальность</Link>
        </div>
        <div className="consent-actions">
          <button className="btn btn-ghost" onClick={() => commit(false)}>Только необходимые</button>
          {!details && <button className="btn btn-ghost" onClick={() => setDetails(true)}>Настроить</button>}
          {details
            ? <button className="btn btn-accent" onClick={() => commit(functional)}>Сохранить выбор</button>
            : <button className="btn btn-accent" onClick={() => commit(true)}>Разрешить функциональные</button>}
        </div>
      </div>
    </div>
  )
}

export { openConsentSettings }
