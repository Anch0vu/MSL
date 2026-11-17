import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('motion primitives provide visible fallbacks and clean browser work', () => {
  const motion = read('src/components/Motion.tsx')
  assert.match(motion, /export function MotionReveal/)
  assert.match(motion, /export function AnimatedNumber/)
  assert.match(motion, /export function HeroMotion/)
  assert.match(motion, /export function ScrambleText/)
  assert.match(motion, /aria-hidden/)
  assert.match(motion, /IntersectionObserver/)
  assert.match(motion, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(motion, /cancelAnimationFrame/)
  assert.match(motion, /observer\.disconnect\(\)/)
})

test('public composition uses the coherent MSL motion vocabulary', () => {
  const home = read('src/pages/Home.tsx')
  const motion = read('src/components/Motion.tsx')
  const layout = read('src/components/Layout.tsx')
  const main = read('src/main.tsx')
  const css = read('src/styles/motion.css')
  assert.match(home, /HeroMotion/)
  assert.match(home, /MotionReveal/)
  assert.match(home, /AnimatedNumber/)
  assert.match(home, /ScrambleText/)
  assert.match(layout, /MotionRouteFrame/)
  assert.match(layout, /motion-roll[^\n]+aria-hidden/s)
  assert.match(main, /styles\/motion\.css/)
  for (const token of ['motion-reveal', 'hero-motion', 'motion-magnetic', 'motion-roll', 'motion-tab-pill']) {
    assert.ok(css.includes(token), token)
  }
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(css, /hover:\s*hover/)
  assert.match(css, /pointer:\s*fine/)
  assert.match(css, /\.brand-mark\s*\{[^}]*position:\s*relative/s)
  assert.doesNotMatch(css, /calc\([^)]*var\([^)]*\)\s*\*/)
  assert.doesNotMatch(css, /content:\s*attr\(data-label\)/)
  assert.match(motion, /className="sr-only"/)
})

test('motion suite is part of the default test command', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.scripts.test, /motion\.test\.mjs/)
})
