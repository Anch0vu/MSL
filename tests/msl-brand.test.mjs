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
  assert.match(home, /hero-title hero-brand-title/)
  assert.doesNotMatch(home, /hero-title[^>]*>\{featured\.name\}/)
  assert.match(home, /current-tour-strip/)
  assert.match(css, /\.hero-brand-title/)
  assert.match(css, /\.current-tour-strip/)
  assert.match(css, /radial-gradient\([^\n]+--msl-red/s)
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
