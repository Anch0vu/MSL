import { useState } from 'react'
import { config } from '../config'

/** Ссылка с превью для VK/Telegram: страница API отдаёт og-теги и картинку, человека переадресует на сайт. */
export function shareUrl(q: string): string {
  return new URL(`${config.apiBase}?r=share&${q}`, window.location.origin + window.location.pathname).toString()
}

export function ShareButton({ q, title, className = 'btn btn-ghost' }: { q: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const go = async () => {
    const url = shareUrl(q)
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      window.prompt('Ссылка с превью для соцсетей', url)
    }
  }
  return (
    <button type="button" className={className} onClick={go} title="Ссылка с картинкой-превью для VK и Telegram">
      {copied ? 'Ссылка скопирована' : 'Поделиться'}
    </button>
  )
}
