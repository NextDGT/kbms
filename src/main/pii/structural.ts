import type { PiiCandidate, PiiKind } from '../../shared/types'
import { findPlateSpans } from '../../shared/plates'

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = value.split('').map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const dig10 = (odd * 7 - even) % 10
  if (dig10 < 0) return false
  if (d[9] !== dig10) return false
  const sum = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10
  return d[10] === sum
}

export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false
  const digits = value.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const tmp = (digits[i]! + (9 - i)) % 10
    const pow = (tmp * Math.pow(2, 9 - i)) % 9
    sum += tmp !== 0 && pow === 0 ? 9 : pow
  }
  const check = sum % 10 === 0 ? 0 : 10 - (sum % 10)
  return digits[9] === check
}

function pushCandidate(
  list: PiiCandidate[],
  kind: PiiKind,
  value: string,
  start: number,
  end: number,
  approved: boolean
): void {
  if (list.some((c) => overlap(c.start, c.end, start, end))) return
  list.push({
    id: `${kind}-${start}-${end}`,
    kind,
    value,
    start,
    end,
    autoDetected: true,
    approved
  })
}

export function detectStructural(text: string): PiiCandidate[] {
  const found: PiiCandidate[] = []

  const ibanRe = /\bTR[\s-]?(?:\d[\s-]?){24}\b/gi
  for (const m of text.matchAll(ibanRe)) {
    const raw = m[0]
    const start = m.index ?? 0
    const normalized = raw.replace(/[\s-]/g, '').toUpperCase()
    if (normalized.length === 26) {
      // Keep surface form so anonymize can replace in-place
      pushCandidate(found, 'IBAN', raw, start, start + raw.length, true)
    }
  }

  const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  for (const m of text.matchAll(emailRe)) {
    const raw = m[0]
    const start = m.index ?? 0
    pushCandidate(found, 'EMAIL', raw, start, start + raw.length, true)
  }

  // Digit lookarounds keep a phone from matching inside a longer number such as a TCKN
  const phoneRe =
    /(?<![\d+])(?:\+90|0)?[\s.-]?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}|\(?\d{3}\)?[\s.-]?\d{7})(?!\d)/g
  for (const m of text.matchAll(phoneRe)) {
    const raw = m[0]
    const start = m.index ?? 0
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 12) continue
    if (found.some((c) => overlap(c.start, c.end, start, start + raw.length))) continue
    pushCandidate(found, 'TEL', raw.trim(), start, start + raw.length, true)
  }

  for (const span of findPlateSpans(text)) {
    pushCandidate(found, 'PLAKA', span.value, span.start, span.end, true)
  }

  const tcknRe = /\b[1-9]\d{10}\b/g
  for (const m of text.matchAll(tcknRe)) {
    const raw = m[0]
    const start = m.index ?? 0
    if (!isValidTckn(raw)) continue
    pushCandidate(found, 'TCKN', raw, start, start + raw.length, true)
  }

  const vknRe = /\b\d{10}\b/g
  for (const m of text.matchAll(vknRe)) {
    const raw = m[0]
    const start = m.index ?? 0
    if (found.some((c) => overlap(c.start, c.end, start, start + raw.length))) continue
    if (!isValidVkn(raw)) continue
    pushCandidate(found, 'VKN', raw, start, start + raw.length, true)
  }

  return found.sort((a, b) => a.start - b.start)
}
