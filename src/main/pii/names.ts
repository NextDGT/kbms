import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PiiCandidate, PiiKind } from '../../shared/types'
import { isTitleCaseTr, isUpperCaseTr, normalizeTr, scanNameWords } from '../../shared/nameKeys'

let firstNames: Set<string> | null = null
let lastNames: Set<string> | null = null
let stopwords: Set<string> | null = null
let userFirstNames = new Set<string>()
let userLastNames = new Set<string>()
let userExcludedFirst = new Set<string>()
let userExcludedLast = new Set<string>()

export type BuiltinNameKind = 'AD' | 'SOYAD'

export interface BuiltinNameEntry {
  kind: BuiltinNameKind
  value: string
  norm: string
}

let builtinEntries: BuiltinNameEntry[] | null = null

function dictDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dicts')
  }
  return join(__dirname, '../../resources/dicts')
}

function loadLines(filename: string): string[] {
  const raw = readFileSync(join(dictDir(), filename), 'utf8')
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function loadSet(filename: string): Set<string> {
  return new Set(loadLines(filename).map((l) => normalizeTr(l)).filter(Boolean))
}

function loadEntries(filename: string, kind: BuiltinNameKind): BuiltinNameEntry[] {
  const seen = new Set<string>()
  const out: BuiltinNameEntry[] = []
  for (const value of loadLines(filename)) {
    const norm = normalizeTr(value)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push({ kind, value, norm })
  }
  return out
}

/** Shipped first/last name lists. This is the reset baseline. */
export function listBuiltinNames(): BuiltinNameEntry[] {
  if (!builtinEntries) {
    builtinEntries = [
      ...loadEntries('first-names.txt', 'AD'),
      ...loadEntries('last-names.txt', 'SOYAD')
    ]
  }
  return builtinEntries
}

function ensureDicts(): void {
  if (firstNames && lastNames && stopwords) return
  firstNames = loadSet('first-names.txt')
  lastNames = loadSet('last-names.txt')
  stopwords = loadSet('stopwords.txt')
}

/** Custom names and hidden builtin names for the signed-in user. */
let extrasVersion = 0

/** Changes whenever the signed-in user's names change, so cached detections can be dropped. */
export function nameListVersion(): number {
  return extrasVersion
}

export function setUserNameExtras(
  first: string[],
  last: string[],
  excludedFirst: string[] = [],
  excludedLast: string[] = []
): void {
  extrasVersion += 1
  const fold = (values: string[]) =>
    new Set(values.map((v) => normalizeTr(v)).filter((v) => v.length >= 2))
  userFirstNames = fold(first)
  userLastNames = fold(last)
  userExcludedFirst = fold(excludedFirst)
  userExcludedLast = fold(excludedLast)
}

/** Strip Turkish apostrophe suffixes: Ahmet'in → Ahmet */
export function nameBase(token: string): string {
  const cut = token.search(/['’ʻ]/)
  if (cut <= 0) return token
  return token.slice(0, cut)
}

function listedFirst(norm: string): boolean {
  if (stopwords!.has(norm) || norm.length < 2 || userExcludedFirst.has(norm)) return false
  return firstNames!.has(norm) || userFirstNames.has(norm)
}

function listedLast(norm: string): boolean {
  if (stopwords!.has(norm) || norm.length < 2 || userExcludedLast.has(norm)) return false
  return lastNames!.has(norm) || userLastNames.has(norm)
}

/**
 * 1. UPPERCASE + soyad listesi → SOYAD
 * 2. Title Case + ad listesi → AD
 * 3. UPPERCASE + ad listesi → AD
 * 4. Title Case + soyad listesi → SOYAD
 */
function classifyName(token: string): 'AD' | 'SOYAD' | null {
  ensureDicts()
  const base = nameBase(token)
  const norm = normalizeTr(base)
  const upper = isUpperCaseTr(base)
  const title = isTitleCaseTr(base)
  if (upper && listedLast(norm)) return 'SOYAD'
  if (title && listedFirst(norm)) return 'AD'
  if (upper && listedFirst(norm)) return 'AD'
  if (title && listedLast(norm)) return 'SOYAD'
  return null
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** Each word on its own, classified by the name-list priority. */
export function detectNameCandidates(text: string, occupied: PiiCandidate[]): PiiCandidate[] {
  ensureDicts()
  const found: PiiCandidate[] = []

  for (const word of scanNameWords(text)) {
    if (occupied.some((c) => overlap(c.start, c.end, word.start, word.end))) continue
    if (found.some((c) => overlap(c.start, c.end, word.start, word.end))) continue

    const kind = classifyName(word.raw)
    if (!kind) continue
    found.push({
      id: `${kind}-${word.start}-${word.end}`,
      kind,
      value: word.value,
      start: word.start,
      end: word.end,
      autoDetected: true,
      approved: true
    })
  }

  return found
}

export function isNameKind(kind: PiiKind): boolean {
  return kind === 'AD' || kind === 'SOYAD'
}
