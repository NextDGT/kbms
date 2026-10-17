import { defaultMatch, identityKey } from '../../shared/identity'
import type { MappingEntry, MatchMode, PiiCandidate, PiiKind } from '../../shared/types'
import {
  findAllOccurrencesTr,
  findExactNameSpans,
  foldTr,
  isTitleCaseTr,
  isUpperCaseTr,
  unifyNameIdentities
} from '../../shared/nameKeys'
import { findPlateVariants } from '../../shared/plates'
import { customTokenError, formatToken, isNumberedToken } from '../../shared/tokens'
import { detectNameCandidates, nameListVersion } from './names'
import { detectStructural } from './structural'

export function detectAll(text: string): PiiCandidate[] {
  const structural = detectStructural(text)
  const names = detectNameCandidates(text, structural)
  return unifyNameIdentities([...structural, ...names].sort((a, b) => a.start - b.start))
}

function isNameKind(kind: PiiKind): boolean {
  return kind === 'AD' || kind === 'SOYAD'
}

/**
 * A name as its spelling mode writes it. Every place an AA key replaces is in capitals,
 * so restoring writes capitals there ("Türk" stored for an AA key would come back wrong).
 */
function spelledAs(match: MatchMode, value: string): string {
  if (match === 'upper') return value.toLocaleUpperCase('tr-TR')
  if (match !== 'title') return value
  return value
    .split(/(\s+)/)
    .map((word) => {
      const lower = word.toLocaleLowerCase('tr-TR')
      return lower.charAt(0).toLocaleUpperCase('tr-TR') + lower.slice(1)
    })
    .join('')
}

/** First keys of a document: one per value, numbered per kind in text order. */
export function buildMappings(candidates: PiiCandidate[]): MappingEntry[] {
  const byIdentity = new Map<string, MappingEntry>()
  const counters: Record<string, number> = {}
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    const key = identityKey(c.kind, c.value)
    if (byIdentity.has(key)) continue
    counters[c.kind] = (counters[c.kind] ?? 0) + 1
    const match = defaultMatch(c.kind)
    byIdentity.set(key, {
      kind: c.kind,
      token: formatToken(c.kind, counters[c.kind]!),
      original: spelledAs(match, c.value),
      match
    })
  }
  return Array.from(byIdentity.values())
}

const MATCH_MODES = new Set<MatchMode>(['any', 'upper', 'title'])


/** Keys sent from the review screen: one token per value, one value per token, tokens of their kind. */
export function checkMappings(entries: MappingEntry[]): MappingEntry[] {
  const identities = new Set<string>()
  const tokens = new Set<string>()
  return entries.map((entry) => {
    const original = entry.original?.trim()
    if (!original) throw new Error('Boş anahtar değeri')
    if (entry.kind === 'OZEL') {
      const problem = customTokenError(entry.token ?? '')
      if (problem) throw new Error(`${entry.token}: ${problem}`)
    } else if (!isNumberedToken(entry.token ?? '', entry.kind)) {
      throw new Error(`Geçersiz token: ${entry.token}`)
    }
    const identity = identityKey(entry.kind, original)
    if (identities.has(identity)) throw new Error(`Aynı değer iki kez: ${original}`)
    if (tokens.has(entry.token)) throw new Error(`Aynı token iki kez: ${entry.token}`)
    identities.add(identity)
    tokens.add(entry.token)
    const match = isNameKind(entry.kind) && MATCH_MODES.has(entry.match) ? entry.match : 'any'
    return { kind: entry.kind, token: entry.token, original: spelledAs(match, original), match }
  })
}

/** A piece of text to swap for another; offsets are into the text it was found in. */
export interface TextSpan {
  start: number
  end: number
  token: string
}

/** A slice of a longer text. Read-only pieces (tabs, column gaps) never change. */
export interface TextPiece {
  text: string
  editable: boolean
}

/**
 * Apply spans found in the joined text to the pieces it was cut from. A token goes
 * into the first editable piece its span touches; the rest of the span is removed
 * from the other pieces, so each piece keeps its own formatting or position.
 */
export function applySpansToPieces(pieces: TextPiece[], spans: TextSpan[]): string[] {
  const starts: number[] = []
  let pos = 0
  for (const piece of pieces) {
    starts.push(pos)
    pos += piece.text.length
  }
  const texts = pieces.map((piece) => piece.text)
  // Spans run last to first, so text before each span is still at its original offset.
  for (const span of orderedSpans(spans)) {
    let placed = false
    pieces.forEach((piece, i) => {
      const pieceStart = starts[i]!
      const pieceEnd = pieceStart + piece.text.length
      if (!piece.editable || pieceEnd <= span.start || pieceStart >= span.end) return
      const from = Math.max(span.start, pieceStart) - pieceStart
      const to = Math.min(span.end, pieceEnd) - pieceStart
      const current = texts[i]!
      texts[i] = current.slice(0, from) + (placed ? '' : span.token) + current.slice(to)
      placed = true
    })
  }
  return texts
}

/** Swap spans, last first, skipping any span that overlaps one already applied. */
export function applySpans(text: string, spans: TextSpan[]): string {
  let out = text
  for (const span of orderedSpans(spans)) {
    out = out.slice(0, span.start) + span.token + out.slice(span.end)
  }
  return out
}

/** Non-overlapping spans from last to first, so earlier offsets stay valid while editing. */
export function orderedSpans(spans: TextSpan[]): TextSpan[] {
  const ordered = spans
    .filter((s) => s.end > s.start)
    .slice()
    .sort((a, b) => b.start - a.start || b.end - a.end)
  const out: TextSpan[] = []
  let guard = Number.POSITIVE_INFINITY
  for (const span of ordered) {
    if (span.end > guard) continue
    out.push(span)
    guard = span.start
  }
  return out
}

function wordStem(word: string): string {
  const cut = word.search(/['’ʻ]/)
  return cut <= 0 ? word : word.slice(0, cut)
}

/** Whether this spelling of a name is one the key replaces. */
function spellingMatches(entry: MappingEntry, surface: string): boolean {
  if (entry.match === 'any' || !isNameKind(entry.kind)) return true
  const words = surface.trim().split(/\s+/).map(wordStem)
  return entry.match === 'upper' ? words.every(isUpperCaseTr) : words.every(isTitleCaseTr)
}

/**
 * Every place the key's own value is written, whether or not a detector found it.
 * `folded` is the line through foldTr; a value that cannot be in it is skipped cheaply.
 */
function literalSpans(
  text: string,
  folded: string,
  { entry, probe }: PreparedEntry
): Array<{ start: number; end: number }> {
  if (probe != null && !folded.includes(probe)) return []
  if (isNameKind(entry.kind)) return findExactNameSpans(text, entry.original)
  if (entry.kind === 'PLAKA') return findPlateVariants(text, entry.original)
  const spans = findAllOccurrencesTr(text, entry.original)
  if (entry.kind === 'OZEL') return spans
  // Numbers and addresses stand alone: 12345 is not inside 9123456
  return spans.filter(
    (span) =>
      !/[\p{L}\p{N}]/u.test(text[span.start - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[span.end] ?? '')
  )
}

/** A key with what every line needs from it, worked out once per key list. */
interface PreparedEntry {
  entry: MappingEntry
  identity: string
  /** Folded text that must be in a line for the value to be there; null when spacing may vary (plates). */
  probe: string | null
}

const preparedLists = new WeakMap<MappingEntry[], { list: PreparedEntry[]; byIdentity: Map<string, PreparedEntry> }>()

/** The same key list is matched against every line of a document; prepare it once. */
function prepare(entries: MappingEntry[]) {
  let prepared = preparedLists.get(entries)
  if (!prepared) {
    const list = entries.map((entry) => {
      const first = isNameKind(entry.kind) ? wordStem(entry.original.split(/\s+/)[0]!) : entry.original
      return {
        entry,
        identity: identityKey(entry.kind, entry.original),
        probe: entry.kind === 'PLAKA' ? null : foldTr(first.trim())
      }
    })
    prepared = { list, byIdentity: new Map(list.map((p) => [p.identity, p])) }
    preparedLists.set(entries, prepared)
  }
  return prepared
}

/** Longest spans first, then earliest; no two overlap. Sorted by position. */
function pickSpans(spans: TextSpan[]): TextSpan[] {
  const picked: TextSpan[] = []
  const ranked = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  for (const span of ranked) {
    if (picked.some((p) => span.start < p.end && p.start < span.end)) continue
    picked.push(span)
  }
  return picked.sort((a, b) => a.start - b.start)
}

const detectedLines = new Map<string, PiiCandidate[]>()
let detectedFor = -1
const DETECTED_LIMIT = 20_000

/**
 * Detector hits in one line. They do not depend on the keys, so the review screen can
 * recompute its marks after every change without detecting again; the cache is dropped
 * when the user's name list changes.
 */
function detectLine(text: string): PiiCandidate[] {
  const version = nameListVersion()
  if (version !== detectedFor || detectedLines.size > DETECTED_LIMIT) {
    detectedLines.clear()
    detectedFor = version
  }
  let hits = detectedLines.get(text)
  if (!hits) {
    const structural = detectStructural(text)
    hits = [...structural, ...detectNameCandidates(text, structural)]
    detectedLines.set(text, hits)
  }
  return hits
}

/** A place in one line where the key with this identity is not applied. */
export interface LineSkip {
  start: number
  end: number
  identity: string
}

/**
 * What becomes a token in one line or paragraph, and which of the key's spans the user
 * skipped there. This is the only place that decides; the review screen shows exactly
 * these spans.
 *
 * A key replaces every place its value is written (and the forms detectors know, such
 * as an IBAN with other spacing), limited by the key's spelling mode. Nothing inside an
 * ignored phrase is replaced. A skip removes only its own key's span, before overlaps are
 * settled, so another key can still take the place.
 */
export function planSpans(
  text: string,
  entries: MappingEntry[],
  ignored: string[] = [],
  skips: LineSkip[] = []
): { spans: TextSpan[]; skipped: TextSpan[] } {
  const { list, byIdentity } = prepare(entries)
  const hits: Array<TextSpan & { identity: string }> = []
  const add = ({ entry, identity }: PreparedEntry, start: number, end: number) => {
    if (end <= start || !spellingMatches(entry, text.slice(start, end))) return
    hits.push({ start, end, token: entry.token, identity })
  }

  for (const c of detectLine(text)) {
    const prepared = byIdentity.get(identityKey(c.kind, c.value))
    if (prepared) add(prepared, c.start, c.end)
  }
  const folded = foldTr(text)
  for (const prepared of list) {
    for (const span of literalSpans(text, folded, prepared)) add(prepared, span.start, span.end)
  }

  const kept = ignored.flatMap((phrase) => findAllOccurrencesTr(text, phrase))
  const live = hits.filter((h) => !kept.some((k) => h.start < k.end && k.start < h.end))
  const isSkipped = (h: TextSpan & { identity: string }) =>
    skips.some((s) => s.identity === h.identity && h.start < s.end && s.start < h.end)
  const strip = ({ start, end, token }: TextSpan) => ({ start, end, token })
  const spans = pickSpans(live.filter((h) => !isSkipped(h)).map(strip))
  const skipped = pickSpans(live.filter(isSkipped).map(strip)).filter(
    (h) => !spans.some((p) => h.start < p.end && p.start < h.end)
  )
  return { spans, skipped }
}

/** Token occurrences with the original value to put back. Longer tokens win. */
export function deanonymizeSpans(text: string, mappings: MappingEntry[]): TextSpan[] {
  if (mappings.length === 0) return []
  const originalOf = new Map(mappings.map((m) => [m.token, m.original]))
  const pattern = [...originalOf.keys()]
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const spans: TextSpan[] = []
  for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
    const start = m.index ?? 0
    spans.push({ start, end: start + m[0].length, token: originalOf.get(m[0])! })
  }
  return spans
}

export function applyDeanonymize(text: string, mappings: MappingEntry[]): string {
  return applySpans(text, deanonymizeSpans(text, mappings))
}
