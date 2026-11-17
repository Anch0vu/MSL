import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConsentValue, serializeConsentValue, CONSENT_VERSION } from '../src/lib/consent.ts'

test('missing or malformed consent is undecided', () => {
  assert.equal(parseConsentValue(undefined), null)
  assert.equal(parseConsentValue(''), null)
  assert.equal(parseConsentValue('garbage'), null)
  assert.equal(parseConsentValue('v999:functional'), null)
})

test('necessary-only consent blocks external media', () => {
  assert.deepEqual(parseConsentValue(`v${CONSENT_VERSION}:necessary`), {
    necessary: true,
    functional: false,
    externalMedia: false,
  })
})

test('functional consent enables external media', () => {
  assert.deepEqual(parseConsentValue(`v${CONSENT_VERSION}:functional`), {
    necessary: true,
    functional: true,
    externalMedia: true,
  })
})

test('serialization is versioned and deterministic', () => {
  assert.equal(serializeConsentValue({ functional: false, externalMedia: false }), `v${CONSENT_VERSION}:necessary`)
  assert.equal(serializeConsentValue({ functional: true, externalMedia: true }), `v${CONSENT_VERSION}:functional`)
})
