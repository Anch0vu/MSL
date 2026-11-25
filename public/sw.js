// Сервис-воркер Киберлиги: сайт ставится на телефон как приложение, а сетка, матчи и команды
// открываются без сети в последней загруженной версии. Остальное API всегда идёт в сеть.
const CACHE = 'cup-msl-v2-20261125'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png', './data/db.json']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(req, key) {
  const c = await caches.open(CACHE)
  try {
    const res = await fetch(req, { cache: 'no-store' })
    if (res.ok) await c.put(key || req, res.clone())
    return res
  } catch (err) {
    const hit = await c.match(key || req)
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE)
  const hit = await c.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) await c.put(req, res.clone())
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/obs')) return
  if (url.pathname.startsWith('/api/')) {
    if (url.searchParams.get('r') === 'db') e.respondWith(networkFirst(req, './api/?r=db'))
    return
  }
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, './'))
  // файлы сборки с хешем в имени не меняются
  if (url.pathname.startsWith('/assets/')) return e.respondWith(cacheFirst(req))
  e.respondWith(networkFirst(req))
})
