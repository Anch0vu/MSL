import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('registration exposes team organization and free-agent routes', () => {
  const page = read('src/pages/Register.tsx')
  assert.match(page, /type Kind = 'team' \| 'organization' \| 'player'/)
  assert.match(page, /useSearchParams/)
  for (const label of ['Команда', 'Организация', 'Игрок без команды']) assert.ok(page.includes(label), label)
  assert.match(page, /organization: \{/)
})

test('application model and API support organization moderation', () => {
  const types = read('src/lib/types.ts')
  const api = read('api/index.php')
  assert.match(types, /kind: 'team' \| 'organization' \| 'player'/)
  assert.match(api, /\['team', 'organization', 'player'\]/)
  assert.match(api, /\$app\['kind'\] === 'organization'/)
  assert.match(api, /\$db\['orgs'\]\[\]/)
  assert.match(api, /\$res\['orgId'\]/)
  const page = read('src/pages/Register.tsx')
  assert.match(page, /orgId\?: string/)
  assert.match(page, /to={`\/orgs\/\$\{state\.orgId\}`}/)
  assert.match(page, /kind !== 'organization'[\s\S]*?<\/div>}\s*<label>\s*Контакт для связи/)
  assert.match(api, /\$row\['players'\] = json_encode/)
  assert.match(api, /'description' => \$orgData\['description'\]/)
})
