import type { PiiCandidate } from './types'

/**
 * Turkish-insensitive fold for name/PII comparison.
 * ASCII I and Turkish İ both become "i"; ı also folds to "i" so NARIN ≈ NARİN ≈ Narin.
 */
export function normalizeTr(value: string): string {
  return value
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0307/g, '') // combining dot (from some İ lowercasings)
    .replace(/ı/g, 'i')
}

const FOLD_CHAR: Record<string, string> = {
  I: 'i',
  İ: 'i',
  ı: 'i',
  i: 'i',
  Ç: 'ç',
  ç: 'ç',
  Ğ: 'ğ',
  ğ: 'ğ',
  Ö: 'ö',
  ö: 'ö',
  Ş: 'ş',
  ş: 'ş',
  Ü: 'ü',
  ü: 'ü'
}

function foldChar(ch: string): string {
  const mapped = FOLD_CHAR[ch]
  if (mapped) return mapped
  const code = ch.charCodeAt(0)
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32)
  if (code < 128) return ch
  const lowered = ch.toLocaleLowerCase('tr-TR').replace(/\u0307/g, '')
  return lowered.length === 1 ? lowered : ch
}

const foldCache = new Map<string, string>()

/** Length-preserving Turkish fold. Same index as the original string. */
export function foldTr(value: string): string {
  const cached = foldCache.get(value)
  if (cached !== undefined) return cached
  const parts = new Array<string>(value.length)
  for (let i = 0; i < value.length; i++) parts[i] = foldChar(value[i]!)
  const folded = parts.join('')
  if (foldCache.size > 8) foldCache.clear()
  foldCache.set(value, folded)
  return folded
}

function isCasedUpper(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.toLocaleUpperCase('tr-TR') &&
    value !== value.toLocaleLowerCase('tr-TR')
  )
}

/** Every letter is uppercase (Turkish locale: İ, I, Ş, Ğ, Ü, Ö, Ç). */
export function isUpperCaseTr(value: string): boolean {
  return value.length >= 2 && isCasedUpper(value)
}

/** First letter uppercase, the rest lowercase. "Ahmet", "İbrahim", "Işık". */
export function isTitleCaseTr(value: string): boolean {
  const chars = Array.from(value)
  if (chars.length < 2) return false
  const first = chars[0] ?? ''
  const rest = chars.slice(1).join('')
  return (
    isCasedUpper(first) &&
    rest === rest.toLocaleLowerCase('tr-TR') &&
    rest !== rest.toLocaleUpperCase('tr-TR')
  )
}

function nameStem(token: string): string {
  const cut = token.search(/['’ʻ]/)
  return cut <= 0 ? token : token.slice(0, cut)
}

/** Same word cut as name detection: letters, optional apostrophe suffix. The span is the stem. */
export function scanNameWords(
  text: string
): Array<{ start: number; end: number; value: string; raw: string }> {
  const wordRe = /[\p{L}]+(?:['’ʻ][\p{L}]+)?/gu
  const out: Array<{ start: number; end: number; value: string; raw: string }> = []
  for (const m of text.matchAll(wordRe)) {
    const raw = m[0]
    const value = nameStem(raw)
    if (!value) continue
    const start = m.index ?? 0
    out.push({ start, end: start + value.length, value, raw })
  }
  return out
}

function toTitleCasePart(part: string): string {
  const chars = Array.from(part.toLocaleLowerCase('tr-TR'))
  const first = chars[0]
  if (!first) return part
  chars[0] = first.toLocaleUpperCase('tr-TR')
  return chars.join('')
}

/**
 * Canonical stored form.
 * AD keeps Title Case or UPPERCASE ("İbrahim", "AHMET"); other forms become Title Case.
 * SOYAD is uppercase ("YILMAZ", "GÜRAN").
 */
export function formatStoredName(kind: 'AD' | 'SOYAD', raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  if (kind === 'SOYAD') return trimmed.toLocaleUpperCase('tr-TR')
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || part === '-' || /^\s+$/.test(part)) return part
      if (isUpperCaseTr(part) || isTitleCaseTr(part)) return part
      return toTitleCasePart(part)
    })
    .join('')
}

/** Title Case or fully uppercase. Lowercase is not a name surface. */
export function isRecognizedNameCase(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  return words.every((word) => {
    const stem = nameStem(word)
    return isUpperCaseTr(stem) || isTitleCaseTr(stem)
  })
}

/**
 * Case-insensitive TR search. Returns start index in `text`, or -1.
 * Matched surface length equals `needle.length` (BMP Turkish letters are 1:1).
 */
export function indexOfTr(text: string, needle: string, from = 0): number {
  const nLen = needle.length
  if (!nLen) return Math.max(0, from)
  if (nLen > text.length) return -1
  const foldedNeedle = foldTr(needle)
  if (foldedNeedle.length !== nLen) return -1
  return foldTr(text).indexOf(foldedNeedle, Math.max(0, from))
}

/** All non-overlapping TR-insensitive occurrences; returns document surface slices. */
export function findAllOccurrencesTr(
  text: string,
  needle: string
): Array<{ start: number; end: number; value: string }> {
  const value = needle.trim()
  if (!value) return []
  const out: Array<{ start: number; end: number; value: string }> = []
  let from = 0
  while (from <= text.length - value.length) {
    const idx = indexOfTr(text, value, from)
    if (idx < 0) break
    const end = idx + value.length
    out.push({ start: idx, end, value: text.slice(idx, end) })
    from = end
  }
  return out
}

/**
 * Whole-word ad/soyad hits, using the same word cut as detection.
 * Title Case and UPPERCASE both count. "Can" does not match "cansız" or "can".
 */
export function findExactNameSpans(
  text: string,
  needle: string
): Array<{ start: number; end: number; value: string }> {
  const parts = needle
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => normalizeTr(nameStem(part)))
    .filter(Boolean)
  if (parts.length === 0) return []
  const words = scanNameWords(text)
  const out: Array<{ start: number; end: number; value: string }> = []
  for (let i = 0; i <= words.length - parts.length; i++) {
    let ok = true
    for (let j = 0; j < parts.length; j++) {
      const word = words[i + j]!
      if (normalizeTr(word.value) !== parts[j] || !isRecognizedNameCase(word.value)) {
        ok = false
        break
      }
      if (j > 0) {
        const gap = text.slice(words[i + j - 1]!.end, word.start)
        if (!/^(?:['’ʻ][\p{L}]+)?\s+$/u.test(gap)) {
          ok = false
          break
        }
      }
    }
    if (!ok) continue
    const start = words[i]!.start
    const end = words[i + parts.length - 1]!.end
    out.push({ start, end, value: text.slice(start, end) })
  }
  return out
}

/** Drop duplicate spans. Ad and soyad stay separate keys. */
export function unifyNameIdentities(candidates: PiiCandidate[]): PiiCandidate[] {
  const seen = new Set<string>()
  const out: PiiCandidate[] = []
  for (const c of candidates.slice().sort((a, b) => a.start - b.start || a.end - b.end)) {
    const key = `${c.kind}:${c.start}:${c.end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}
