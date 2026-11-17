import { openConsentSettings } from '../lib/consent'

export function Cookies() {
  return (
    <article className="wrap page article legal-page">
      <div className="legal-kicker">MSL / PRIVACY CONTROL</div>
      <h1>Использование cookies</h1>
      <p className="lead">Вы можете пользоваться основными страницами сайта, даже если оставите только необходимые cookies.</p>
      <div className="md">
        <h2>Необходимые</h2>
        <p><code>cupsid</code> поддерживает защищённую сессию аккаунта. <code>msl_consent</code> хранит ваш выбор, чтобы окно не появлялось при каждом переходе.</p>
        <h2>Функциональные</h2>
        <p>Запоминают тему и отдельные настройки интерфейса. В эту же категорию входит разрешение на загрузку встроенного Twitch-плеера.</p>
        <h2>Внешний медиаконтент</h2>
        <p>До разрешения сайт показывает безопасную заглушку вместо iframe. После разрешения браузер устанавливает соединение с Twitch, и сервис может применять собственные технологии хранения.</p>
        <button className="btn btn-accent" onClick={openConsentSettings}>Изменить выбор</button>
      </div>
    </article>
  )
}
