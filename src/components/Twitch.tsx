import { useConsent, openConsentSettings } from '../lib/consent'
import { useTwitch, type TwitchStream } from '../lib/data'

/** Плеер Twitch загружается только после согласия на внешний медиаконтент. */
export function TwitchPlayer({ channel, autoplay = false }: { channel: string; autoplay?: boolean }) {
  const consent = useConsent()
  if (!consent?.externalMedia) {
    return (
      <div className="tw-player tw-consent">
        <div>
          <span className="tw-consent-mark">MSL / EXTERNAL MEDIA</span>
          <b>Трансляция заблокирована настройками cookies</b>
          <p>До разрешения браузер не соединяется с Twitch.</p>
          <button className="btn btn-accent" onClick={openConsentSettings}>Разрешить внешний медиаконтент</button>
        </div>
      </div>
    )
  }

  const parent = window.location.hostname || 'localhost'
  const src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&muted=true&autoplay=${autoplay}`
  return (
    <div className="tw-player">
      <iframe src={src} title={`Twitch: ${channel}`} allowFullScreen allow="autoplay; fullscreen" />
    </div>
  )
}

export function TwitchBlock({ channel }: { channel: string }) {
  const streams = useTwitch([channel])
  const live: TwitchStream | undefined = streams?.find((s) => s.channel === channel.toLowerCase())
  return (
    <div className="tw-block">
      <TwitchPlayer channel={channel} autoplay={!!live} />
      <div className="tw-side">
        <div className="tw-status">
          {live ? <span className="badge badge-live"><i className="pulse" />В эфире</span> : <span className="badge">{streams ? 'Не в эфире' : 'Twitch'}</span>}
          <a href={`https://twitch.tv/${channel}`} target="_blank" rel="noreferrer" className="tw-link">twitch.tv/{channel}</a>
        </div>
        {live ? <><h3>{live.title}</h3><p className="muted">{live.game} · {live.viewers} зрителей</p></> : <><h3>Трансляции лиги</h3><p className="muted">Матчи плей-офф и финалы — на канале MSL.</p></>}
        <a className="btn btn-accent" href={`https://twitch.tv/${channel}`} target="_blank" rel="noreferrer">Открыть на Twitch</a>
      </div>
    </div>
  )
}
