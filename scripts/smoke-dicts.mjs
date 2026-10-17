import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function normalizeTr(value) {
  return value
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0307/g, '')
    .replace(/ı/g, 'i')
}

function loadSet(name) {
  return new Set(
    readFileSync(join(root, 'resources/dicts', name), 'utf8')
      .split(/\r?\n/)
      .map((l) => normalizeTr(l.trim()))
      .filter(Boolean)
  )
}

const first = loadSet('first-names.txt')
const last = loadSet('last-names.txt')
const stop = loadSet('stopwords.txt')

function isValidTckn(value) {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = value.split('').map(Number)
  const odd = d[0] + d[2] + d[4] + d[6] + d[8]
  const even = d[1] + d[3] + d[5] + d[7]
  const dig10 = (odd * 7 - even) % 10
  if (dig10 < 0 || d[9] !== dig10) return false
  return d[10] === d.slice(0, 10).reduce((a, b) => a + b, 0) % 10
}

function indexOfTr(text, needle, from = 0) {
  const nLen = needle.length
  const target = normalizeTr(needle)
  for (let i = Math.max(0, from); i <= text.length - nLen; i++) {
    if (normalizeTr(text.slice(i, i + nLen)) === target) return i
  }
  return -1
}

const checks = {
  hasAhmet: first.has(normalizeTr('Ahmet')),
  hasYilmaz: last.has(normalizeTr('Yılmaz')),
  hasNarin: first.has(normalizeTr('NARİN')) && first.has(normalizeTr('NARIN')),
  hasNahit: first.has(normalizeTr('NAHİT')) && first.has(normalizeTr('NAHIT')),
  hasDogus: first.has(normalizeTr('Doğuş')),
  hasBatuhan: first.has(normalizeTr('batuhan')),
  foldIbrahim: normalizeTr('IBRAHIM') === normalizeTr('İbrahim'),
  findNarin: indexOfTr('Sanık NARİN Güran', 'narin') >= 0,
  stopAnkara: stop.has(normalizeTr('Ankara')),
  tckn: isValidTckn('10000000146'),
  dictSizes: { first: first.size, last: last.size, stop: stop.size }
}

console.log(JSON.stringify(checks, null, 2))
if (
  !checks.hasAhmet ||
  !checks.hasYilmaz ||
  !checks.hasNarin ||
  !checks.hasNahit ||
  !checks.hasDogus ||
  !checks.hasBatuhan ||
  !checks.foldIbrahim ||
  !checks.findNarin ||
  !checks.tckn
) {
  console.error('Smoke failed')
  process.exit(1)
}
console.log('dicts smoke ok')
