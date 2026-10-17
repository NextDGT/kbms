import assert from 'node:assert/strict'
import { applySpansToPieces, deanonymizeSpans, applySpans } from '../src/main/pii/detect'
import { detectStructural } from '../src/main/pii/structural'
import { customTokenError } from '../src/shared/tokens'
import { suite, test } from './harness'

suite('detect.test.ts — tespit ve token kuralları')

const found = (text: string) => detectStructural(text).map((c) => `${c.kind}:${c.value}`)

test('TCKN, telefon sanılıp parçası açıkta bırakılmaz', () => {
  assert.deepEqual(found('TCKN 10000000146 burada'), ['TCKN:10000000146'])
})

test('telefon biçimleri tanınır', () => {
  assert.deepEqual(found('Tel: 0532 123 45 67'), ['TEL:0532 123 45 67'])
  assert.deepEqual(found('Tel: +90 532 123 45 67'), ['TEL:+90 532 123 45 67'])
  assert.deepEqual(found('Tel:05321234567'), ['TEL:05321234567'])
  assert.deepEqual(found('0212-555-12-34'), ['TEL:0212-555-12-34'])
})

test('IBAN, e-posta ve plaka tanınır', () => {
  assert.deepEqual(found('IBAN TR33 0006 1005 1978 6457 8413 26'), ['IBAN:TR33 0006 1005 1978 6457 8413 26'])
  assert.deepEqual(found('posta ahmet@ornek.com'), ['EMAIL:ahmet@ornek.com'])
  assert.deepEqual(found('araç 34 ABC 123 plakalı'), ['PLAKA:34 ABC 123'])
})

test('token parçalara dağıtılır: ilk parçaya yazılır, kalanı silinir', () => {
  // "Ah" + "met" + " YILMAZ" — Word often splits a name into runs
  const pieces = [
    { text: 'Ah', editable: true },
    { text: 'met', editable: true },
    { text: '\t', editable: false },
    { text: 'YILMAZ', editable: true }
  ]
  const out = applySpansToPieces(pieces, [
    { start: 0, end: 5, token: '[AD_1]' },
    { start: 6, end: 12, token: '[SOYAD_1]' }
  ])
  assert.deepEqual(out, ['[AD_1]', '', '\t', '[SOYAD_1]'])
})

test('geri yükleme uzun token’ı önce çözer', () => {
  const mappings = [
    { kind: 'AD' as const, token: '[AD_1]', original: 'Ali', match: 'any' as const },
    { kind: 'AD' as const, token: '[AD_11]', original: 'Veli', match: 'any' as const }
  ]
  const text = '[AD_11] ve [AD_1]'
  assert.equal(applySpans(text, deanonymizeSpans(text, mappings)), 'Veli ve Ali')
})

test('özel token adı kuralları', () => {
  assert.equal(customTokenError('[XYZ]'), null)
  assert.equal(customTokenError('[Müvekkil-2]'), null)
  assert.ok(customTokenError('XYZ'), 'köşeli parantez zorunlu')
  assert.ok(customTokenError('[X Y]'), 'boşluk yok')
  assert.ok(customTokenError('[AD_7]'), 'başka türün numaralı biçimi')
  assert.ok(customTokenError(`[${'a'.repeat(41)}]`), 'en çok 40 karakter')
})
