// Route on ms-lg.ru/* and www.ms-lg.ru/* after enabling Cloudflare proxy.
// Fetch reaches the configured origin. Do not attach to the old domain until tested.
const fallbackStatuses = new Set([502, 503, 504])
const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>MSL — временно недоступен</title><style>html{background:#09090b;color:#f6f6f6;font:16px/1.5 system-ui,sans-serif}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{max-width:650px;border-top:4px solid #e31b23;padding:32px;background:#151519}small{color:#e31b23;letter-spacing:.15em;font-weight:800}h1{font-size:clamp(2rem,8vw,4rem);line-height:1;margin:20px 0}p{color:#b9b9c1}a{display:inline-block;margin:10px 12px 0 0;color:#fff;border:1px solid #e31b23;padding:10px 14px;text-decoration:none}a:first-of-type{background:#e31b23}</style></head><body><main><small>MOSCOW STUDENT'S LEAGUE / STATUS</small><h1>Арена на паузе</h1><p>Сайт временно недоступен. Попробуйте обновить страницу через пару минут. Турнирные данные не изменены.</p><a href="/">Повторить</a><a href="https://t.me/rutmiittournaments">Telegram</a></main></body></html>`

export default {
  async fetch(request) {
    const url = new URL(request.url)
    let response
    try {
      response = await fetch(request)
      if (!fallbackStatuses.has(response.status)) return response
    } catch {
      // Network failure: show the same unavailable state as an origin 5xx.
    }
    const headers = { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Robots-Tag': 'noindex' }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'temporarily_unavailable', message: 'MSL API временно недоступен' }), {
        status: 503, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 503, headers })
    }
    return new Response(request.method === 'HEAD' ? null : page, {
      status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
}
