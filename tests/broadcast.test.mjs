import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('OBS package uses independent MSL branding instead of legacy university blue', () => {
  const obs = read('src/pages/Obs.tsx')
  const css = read('src/styles/obs.css')
  assert.match(obs, /MSL/)
  assert.doesNotMatch(obs, /КИБЕРЛИГА/)
  assert.doesNotMatch(obs, /#f50db4/i)
  assert.match(css, /--msl-broadcast-red:\s*#e31b23/i)
  assert.match(css, /--msl-broadcast-black:\s*#070707/i)
})

test('stinger provides layered diagonal wipe scan and documented cut point', () => {
  const obs = read('src/pages/Obs.tsx')
  const css = read('src/styles/obs.css')
  assert.match(obs, /className="sting-scan"/)
  assert.match(obs, /className="sting-wordmark"/)
  assert.match(css, /--cut-point:\s*600ms/)
  assert.match(css, /@keyframes msl-sting-scan/)
  assert.match(css, /clip-path:\s*polygon/)
  assert.doesNotMatch(obs, /sting-scan" \/>\\\\n/)
  assert.match(css, /paused \.sting-scan/)
  for (const selector of ['.obs-brand small', '.obs-plate', '.obs-hud-bar', '.obs-lower']) assert.ok(css.includes(selector), selector)
})

test('OBS setup does not advertise a missing downloadable stinger asset', () => {
  const obs = read('src/pages/Obs.tsx')
  assert.doesNotMatch(obs, /href="obs\/stinger\.webm"/)
  assert.match(obs, /Открыть переход/)
})
