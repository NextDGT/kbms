import { normalizeTr } from './nameKeys'
import { plakaKey } from './plates'
import type { MatchMode, PiiKind } from './types'

/** Same person or value within a document. IBAN ignores spaces; plates ignore separators. */
export function identityKey(kind: PiiKind, value: string): string {
  if (kind === 'IBAN') return `${kind}:${value.replace(/[\s-]/g, '').toUpperCase()}`
  if (kind === 'PLAKA') return `${kind}:${plakaKey(value) ?? normalizeTr(value)}`
  return `${kind}:${normalizeTr(value)}`
}

/**
 * Spelling a new key starts with. Turkish legal texts write surnames in capitals
 * (Ahmet TÜRK), so a surname matches AA and a first name Aa; other kinds match any spelling.
 */
export function defaultMatch(kind: PiiKind): MatchMode {
  if (kind === 'SOYAD') return 'upper'
  if (kind === 'AD') return 'title'
  return 'any'
}
