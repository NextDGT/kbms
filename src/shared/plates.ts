/** Turkish civilian plate: il (01–81) + 1–3 letters + digits, with the issued length pairs. */

const PLATE_LETTERS = 'A-PR-VYZ'

export interface PlateParts {
  il: string
  letters: string
  digits: string
}

export function compactPlaka(value: string): string {
  return value.replace(/[\s.\-]/g, '').toLocaleUpperCase('tr-TR')
}

export function parsePlaka(value: string): PlateParts | null {
  const compact = compactPlaka(value)
  const m = compact.match(/^(0[1-9]|[1-7]\d|8[01])([A-PR-VYZ]{1,3})(\d{2,5})$/)
  if (!m) return null
  const il = m[1]!
  const letters = m[2]!
  const digits = m[3]!
  const ok =
    (letters.length === 1 && (digits.length === 4 || digits.length === 5)) ||
    (letters.length === 2 && (digits.length === 3 || digits.length === 4)) ||
    (letters.length === 3 && (digits.length === 2 || digits.length === 3))
  if (!ok) return null
  return { il, letters, digits }
}

export function isValidPlaka(value: string): boolean {
  return parsePlaka(value) != null
}

/** Same vehicle number, ignoring spaces, dots, hyphens and letter case. */
export function plakaKey(value: string): string | null {
  const parts = parsePlaka(value)
  if (!parts) return null
  return `${parts.il}${parts.letters}${parts.digits}`
}

function plateBodyPattern(il: string, letters: string, digits: string): string {
  return `${il}[\\s.\\-]*${letters}[\\s.\\-]*${digits}`
}

/** Occurrences of one plate number, any spacing / case. */
export function findPlateVariants(
  text: string,
  sample: string
): Array<{ start: number; end: number; value: string }> {
  const parts = parsePlaka(sample)
  if (!parts) return []
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${plateBodyPattern(parts.il, parts.letters, parts.digits)})(?![\\p{L}\\p{N}])`,
    'giu'
  )
  const out: Array<{ start: number; end: number; value: string }> = []
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const start = m.index ?? 0
    if (!isValidPlaka(raw)) continue
    out.push({ start, end: start + raw.length, value: raw })
  }
  return out
}

export function findPlateSpans(
  text: string
): Array<{ start: number; end: number; value: string }> {
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])((?:0[1-9]|[1-7]\\d|8[01])[\\s.\\-]*[${PLATE_LETTERS}]{1,3}[\\s.\\-]*\\d{2,5})(?![\\p{L}\\p{N}])`,
    'giu'
  )
  const out: Array<{ start: number; end: number; value: string }> = []
  const seen = new Set<number>()
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const start = m.index ?? 0
    if (!isValidPlaka(raw) || seen.has(start)) continue
    seen.add(start)
    out.push({ start, end: start + raw.length, value: raw })
  }
  return out
}
