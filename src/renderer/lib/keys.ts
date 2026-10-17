import { identityKey } from '@shared/identity'
import type { MappingEntry, MatchMode, PiiKind, PreviewSpan } from '@shared/types'
import { customTokenError, formatToken, isNumberedToken, tokenNumber } from '@shared/tokens'

export const KIND_LABEL: Record<PiiKind, string> = {
  AD: 'Ad',
  SOYAD: 'Soyad',
  TCKN: 'TCKN',
  VKN: 'VKN',
  IBAN: 'IBAN',
  EMAIL: 'E-posta',
  TEL: 'Telefon',
  PLAKA: 'Plaka',
  OZEL: 'Özel'
}

export const MATCH_LABEL: Record<MatchMode, string> = {
  any: 'AA/Aa',
  upper: 'AA',
  title: 'Aa'
}

export function isNameKind(kind: PiiKind): boolean {
  return kind === 'AD' || kind === 'SOYAD'
}

/** Name as a key stores it: apostrophe suffixes and stray punctuation dropped ("Ahmet'in," → "Ahmet"). */
export function nameValue(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      const cut = word.search(/['’ʻ]/)
      const stem = cut > 0 ? word.slice(0, cut) : word
      return stem.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    })
    .filter(Boolean)
    .join(' ')
}

export function findKey(keys: MappingEntry[], kind: PiiKind, value: string): MappingEntry | undefined {
  const id = identityKey(kind, value)
  return keys.find((key) => identityKey(key.kind, key.original) === id)
}

/** Next free number for a kind: [AD_4] after [AD_1]…[AD_3]. */
export function nextToken(kind: PiiKind, keys: MappingEntry[]): string {
  const used = keys
    .filter((key) => key.kind === kind)
    .map((key) => tokenNumber(key.token) ?? 0)
  return formatToken(kind, Math.max(0, ...used) + 1)
}

/** Number keys per kind in the order they first appear in the text; keys not found go last. */
export function renumberKeys(keys: MappingEntry[], spans: PreviewSpan[]): MappingEntry[] {
  const firstAt = new Map<string, number>()
  for (const span of spans) {
    if (!firstAt.has(span.token)) firstAt.set(span.token, span.start)
  }
  const ordered = keys
    .map((key, i) => ({ key, at: firstAt.get(key.token) ?? Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
  const counters: Partial<Record<PiiKind, number>> = {}
  const renumbered = new Map<MappingEntry, string>()
  // Named special masks ([XYZ]) keep their names and take no number
  for (const { key } of ordered) {
    if (!isNumberedToken(key.token, key.kind)) continue
    counters[key.kind] = (counters[key.kind] ?? 0) + 1
    renumbered.set(key, formatToken(key.kind, counters[key.kind]!))
  }
  return keys.map((key) => ({ ...key, token: renumbered.get(key) ?? key.token }))
}

/** Why this name cannot be a special mask's token here, or null. `name` is without brackets. */
export function tokenNameError(
  name: string,
  keys: MappingEntry[],
  text: string,
  except?: MappingEntry
): string | null {
  const token = `[${name.trim()}]`
  const problem = customTokenError(token)
  if (problem) return problem
  if (keys.some((key) => key !== except && key.token === token)) return `${token} başka bir anahtarda`
  if (text.includes(token)) return `${token} belgede zaten geçiyor; geri yüklemede karışır`
  return null
}

/** The name inside a token: "[XYZ]" → "XYZ". */
export function tokenName(token: string): string {
  return token.replace(/^\[|\]$/g, '')
}
