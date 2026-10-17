/**
 * Keys are written as [AD_1], [PLAKA_2], [OZEL_1]. A special mask may carry its own
 * name instead, e.g. [XYZ]; the brackets keep it apart from ordinary words on restore.
 */

const TOKEN_RE = /^\[([A-Z]+)_(\d+)\]$/

export function formatToken(kind: string, n: number): string {
  return `[${kind}_${n}]`
}

export function tokenNumber(token?: string): number | null {
  if (!token) return null
  const m = token.trim().toUpperCase().match(TOKEN_RE)
  if (!m) return null
  return Number(m[2])
}

/** Whether the token is the numbered form of this kind: [AD_3] for AD. */
export function isNumberedToken(token: string, kind: string): boolean {
  return tokenNumber(token) != null && token.trim().toUpperCase().startsWith(`[${kind}_`)
}

const LABEL_RE = /^[\p{L}\p{N}_-]{1,40}$/u
const OTHER_NUMBERED_RE = /^(AD|SOYAD|TCKN|VKN|IBAN|EMAIL|TEL|PLAKA)_\d+$/i

/**
 * Why a special mask token cannot be used, or null. Its name may not look like another
 * kind's numbered token, which that kind could hand out again.
 */
export function customTokenError(token: string): string | null {
  const name = token.startsWith('[') && token.endsWith(']') ? token.slice(1, -1) : ''
  if (!LABEL_RE.test(name)) return 'Token adı harf, rakam, _ ve - içerebilir (en çok 40 karakter)'
  if (OTHER_NUMBERED_RE.test(name)) return 'Bu ad başka bir türün token biçimi'
  return null
}
