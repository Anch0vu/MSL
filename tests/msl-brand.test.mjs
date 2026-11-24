import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('MSL brand replaces legacy primary identity', () => {
  const config = read('src/config.ts')
  const css = read('src/styles/msl.css')
  assert.match(config, /Moscow Student's League/)
  assert.match(config, /Независимая студенческая киберспортивная лига/)
  assert.doesNotMatch(config, /Межвузовская/)
  const layout = read('src/components/Layout.tsx')
  assert.doesNotMatch(layout, /miit\.ru|Сайт университета/)
  const manifest = read('public/manifest.webmanifest')
  assert.match(css, /--msl-red:\s*#e31b23/i)
  assert.match(manifest, /Moscow Student's League/)
  assert.match(manifest, /#070707/)
  assert.doesNotMatch(config, /siteName:\s*'КИБЕРЛИГА'/)
})

test('homepage presents MSL as an independent league with dynamic participants', () => {
  const home = read('src/pages/Home.tsx')
  const css = read('src/styles/msl.css')
  for (const fixedName of ['РУТ МИИТ', 'НИУ МГСУ', 'Финансовый университет', 'МГТУ им. Н. Э. Баумана']) {
    assert.ok(!home.includes(fixedName), fixedName)
  }
  assert.match(home, /db\.orgs/)
  assert.match(home, /Независимая студенческая киберспортивная лига/)
  assert.match(home, /brand-art/)
  assert.match(home, /msl-current\.jpg/)
  assert.match(home, /msl-3d-wordmark/)
  assert.doesNotMatch(home, /msl-3d-wordmark[^>]*>\{featured\.name\}/)
  assert.match(home, /current-tour-strip/)
  assert.match(css, /\.hero-title/)
  assert.match(css, /\.current-tour-strip/)
  assert.match(css, /radial-gradient\([^\n]+--msl-red/s)
})

test('hero uses a readable dimensional Moscow Students League wordmark', () => {
  const home = read('src/pages/Home.tsx')
  const arena = read('src/styles/arena.css')
  assert.match(home, /className="msl-3d-wordmark"/)
  assert.match(home, /MOSCOW/)
  assert.match(home, /STUDENT’S LEAGUE/)
  assert.match(arena, /\.msl-3d-wordmark/)
  assert.match(arena, /text-shadow:/)
  assert.match(arena, /-webkit-text-stroke:/)
  assert.doesNotMatch(arena, /font-family:\s*Impact/)
})

test('theme toggle persists an explicit light or dark MSL theme', () => {
  const layout = read('src/components/Layout.tsx')
  const index = read('index.html')
  const msl = read('src/styles/msl.css')
  assert.match(layout, /setAttribute\('data-theme', next \? 'dark' : 'light'\)/)
  assert.match(layout, /aria-pressed=\{dark\}/)
  assert.match(index, /data-theme/)
  assert.match(msl, /html\[data-theme='light'\]/)
  assert.match(msl, /html\[data-theme='dark'\]/)
})

test('tournament editor exposes an explicit finish action', () => {
  const admin = read('src/pages/Admin.tsx')
  assert.match(admin, /Завершить турнир/)
  assert.match(admin, /status:\s*'finished'/)
})

test('cookie settings and legal routes are reachable', () => {
  const main = read('src/main.tsx')
  const layout = read('src/components/Layout.tsx')
  assert.match(main, /path="privacy"/)
  assert.match(main, /path="cookies"/)
  assert.match(layout, /CookieConsent/)
  assert.match(layout, /openConsentSettings/)
})

test('Twitch embed is consent gated', () => {
  const twitch = read('src/components/Twitch.tsx')
  assert.match(twitch, /useConsent/)
  assert.match(twitch, /externalMedia/)
  assert.match(twitch, /Разрешить внешний медиаконтент/)
})

test('service worker always revalidates the application shell', () => {
  const sw = read('public/sw.js')
  assert.doesNotMatch(sw, /cup-v4-20261023-obs-console/)
  assert.match(sw, /fetch\(req, \{ cache: 'no-store' \}\)/)
})

test('deploy uses the build from its own checkout', () => {
  const deploy = read('scripts/deploy-msl.sh')
  assert.doesNotMatch(deploy, /cup-worktrees\/msl-redesign\/dist/)
  assert.match(deploy, /SCRIPT_DIR/)
})
