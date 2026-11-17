import { useEffect, useMemo, useState } from 'react'
import { api, useData } from '../lib/data'
import { FAQ } from '../lib/faq'

interface Answered {
  id: string
  q: string
  a: string
  at: string
}

export function Faq() {
  const { mode } = useData()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [answered, setAnswered] = useState<Answered[]>([])
  const [form, setForm] = useState({ name: '', contact: '', text: '', website: '' })
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; msg?: string }>({ status: 'idle' })

  useEffect(() => {
    if (mode === 'api') api<Answered[]>('faqq').then(setAnswered, () => undefined)
  }, [mode])

  const catalog = useMemo(() => answered.length ? [{ id: 'organizers', title: 'Ответы организаторов', items: answered.map(({ id, q, a }) => ({ id, q, a })) }, ...FAQ] : FAQ, [answered])
  const groups = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('ru')
    return catalog.filter((g) => cat === 'all' || g.id === cat)
      .map((g) => ({ ...g, items: g.items.filter((i) => !needle || `${i.q} ${i.a}`.toLocaleLowerCase('ru').includes(needle)) }))
      .filter((g) => g.items.length)
  }, [q, cat, catalog])
  const total = catalog.reduce((n, g) => n + g.items.length, 0)

  const send = async () => {
    setState({ status: 'sending' })
    try {
      await api('ask', { method: 'POST', body: form })
      setState({ status: 'done' })
      setForm({ name: '', contact: '', text: '', website: '' })
    } catch (e) {
      setState({ status: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="wrap page faq">
      <h1 className="page-title">Вопросы и ответы</h1>
      <p className="lead">Ответов: {total}. Не нашли своё: форма внизу страницы уходит прямо организатору.</p>
      <div className="faq-tools">
        <label htmlFor="faq-search">Найти ответ по ключевым словам</label>
        <input id="faq-search" className="search" type="search" placeholder="Например, регистрация, результат или трансляция" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="muted small" aria-live="polite">Найдено разделов: {groups.length}. Вопросов: {groups.reduce((n, g) => n + g.items.length, 0)}.</p>
        <div className="chips">
          <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
            Все
          </button>
          {catalog.map((g) => (
            <button key={g.id} className={cat === g.id ? 'on' : ''} onClick={() => setCat(g.id)}>
              {g.title}
            </button>
          ))}
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.id} className="faq-group">
          <h2>{g.title}</h2>
          {g.items.map((i) => (
            <details key={`${g.id}:${i.q}:${q ? 'search' : 'normal'}`} className="faq-item" open={q.trim() ? true : undefined}>
              <summary>{i.q}</summary>
              <p>{i.a}</p>
            </details>
          ))}
        </section>
      ))}
      {!groups.length && <div className="empty">По запросу ничего не найдено. Попробуйте другое слово или задайте вопрос ниже.</div>}

      <section className="panel pad form faq-ask" id="ask">
        <h2>Задать вопрос</h2>
        {mode !== 'api' ? (
          <p className="muted">Форма работает на опубликованном сайте.</p>
        ) : state.status === 'done' ? (
          <p>Вопрос отправлен. Ответ организатора появится в разделе «Ответы организаторов» или придёт на указанный контакт.</p>
        ) : (
          <>
            <div className="form-row">
              <label>
                Имя (необязательно)
                <input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Как с вами связаться
                <input value={form.contact} maxLength={120} placeholder="Telegram, Discord или VK" onChange={(e) => setForm({ ...form, contact: e.target.value })} />
              </label>
            </div>
            <label>
              Вопрос *
              <textarea rows={6} value={form.text} maxLength={1000} placeholder="Опишите, что случилось или что хотите узнать. Для багов приложите логин и что нажимали." onChange={(e) => setForm({ ...form, text: e.target.value })} />
            </label>
            <input className="hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} aria-hidden />
            <div className="muted small">{form.text.length}/1000</div>
            {state.status === 'error' && <div className="error">{state.msg}</div>}
            <button className="btn btn-accent" disabled={!form.text.trim() || state.status === 'sending'} onClick={send}>
              {state.status === 'sending' ? 'Отправка…' : 'Отправить'}
            </button>
          </>
        )}
      </section>
    </div>
  )
}