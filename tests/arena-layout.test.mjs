import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('homepage presents the MSL Arena sports hierarchy', () => {
  const home = read('src/pages/Home.tsx')
  assert.match(home, /className="arena-home"/)
  assert.match(home, /className="arena-hero/)
  assert.match(home, /className="arena-match-center/)
  assert.match(home, /className="arena-stats"/)
  assert.match(home, /className="arena-tournament-rail/)
  assert.match(home, /Следующий матч|Матч-центр/)
})

test('mobile arena layout keeps primary data readable without page overflow', () => {
  const css = read('src/styles/arena.css')
  assert.match(css, /\.arena-stats\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /@media\s*\(max-width:\s*680px\)/)
  assert.match(css, /\.arena-home\s*\{[^}]*overflow:\s*clip/s)
  assert.match(css, /\.arena-tournament-rail[^}]*overflow-x:\s*auto/s)
})

test('mobile shell provides persistent primary navigation and a compact footer', () => {
  const layout = read('src/components/Layout.tsx')
  const css = read('src/styles/arena.css')
  assert.match(layout, /className="arena-bottom-nav"/)
  assert.match(layout, /id="primary-navigation"/)
  assert.match(layout, /aria-controls="primary-navigation"/)
  for (const label of ['Главная', 'Матчи', 'Турниры', 'Меню']) assert.ok(layout.includes(label), label)
  assert.match(css, /\.arena-bottom-nav\s*\{[^}]*position:\s*fixed/s)
  assert.match(css, /@media\s*\(max-width:\s*680px\)[\s\S]*\.navbar\s*\{[^}]*position:\s*fixed/s)
  assert.match(css, /@media\s*\(max-width:\s*680px\)[\s\S]*\.footer-top/)
})
