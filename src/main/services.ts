import { copyFileSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { identityKey } from '../shared/identity'
import { isNumberedToken } from '../shared/tokens'
import type {
  DocumentDetail,
  DocumentFormat,
  DocumentMapping,
  DocumentRecord,
  DocumentRole,
  FolderRecord,
  EncodingPreview,
  KeySkip,
  MappingEntry,
  PiiCandidate,
  PiiKind
} from '../shared/types'
import { requireSession } from './auth'
import { decryptJson, encryptJson } from './crypto'
import { getDb, getFilesRoot } from './db'
import { listIgnoredPhrases } from './dictService'
import { buildDocx } from './docxExport'
import { docxWarnings, extractDocxText } from './docxImport'
import { rewriteDocx } from './docxRewrite'
import { buildPositionedPdf, extractPdfText } from './pdf'
import type { PdfBlock, TextRun } from './pdfBlocks'
import { ocrPagesOf, plainTextFromBlocks } from './pdfBlocks'
import {
  applyDeanonymize,
  applySpans,
  buildMappings,
  checkMappings,
  deanonymizeSpans,
  detectAll,
  planSpans,
  type LineSkip,
  type TextSpan
} from './pii/detect'

type DocRow = {
  id: number
  folder_id: number
  role: DocumentRole
  name: string
  format: DocumentFormat
  body: string | null
  mapping: string | null
  path: string
  source_document_id: number | null
  created_at: string
}

/** Format from the file name. Only PDF and Word documents are read. */
function formatOf(name: string): DocumentFormat {
  const ext = extname(name).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  throw new Error('Yalnızca PDF veya DOCX yüklenebilir')
}

async function extractDocument(
  filePath: string,
  format: DocumentFormat
): Promise<{ text: string; blocks: PdfBlock[] }> {
  if (format === 'docx') {
    const result = await extractDocxText(filePath)
    if (!result.text.trim()) throw new Error('DOCX içinde metin bulunamadı')
    return result
  }
  const result = await extractPdfText(filePath)
  if (!result.text.trim() || result.blocks.length === 0) {
    throw new Error('PDF’te okunabilir metin bulunamadı (metin katmanı yok, OCR da metin çıkaramadı)')
  }
  return result
}

function folderFilesDir(userId: number, folderId: number): string {
  return join(getFilesRoot(), String(userId), String(folderId))
}

function readMapping(row: DocRow): MappingEntry[] {
  if (row.mapping == null) throw new Error('Bu belgede anahtar yok')
  const { key } = requireSession()
  const parsed = decryptJson<DocumentMapping>(row.mapping, key)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error('Geçersiz anahtar kaydı')
  }
  return parsed.entries
}

function assertFolderOwned(folderId: number, userId: number): void {
  const row = getDb()
    .prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
    .get(folderId, userId)
  if (!row) throw new Error('Klasör bulunamadı')
}

function assertDocOwned(documentId: number, userId: number): DocRow {
  const row = getDb()
    .prepare(
      `SELECT d.* FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE d.id = ? AND f.user_id = ?`
    )
    .get(documentId, userId) as DocRow | undefined
  if (!row) throw new Error('Belge bulunamadı')
  return row
}

function mapFolder(row: {
  id: number
  user_id: number
  title: string
  created_at: string
  updated_at: string
  document_count: number
}): FolderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: row.document_count
  }
}

function mapDoc(row: {
  id: number
  folder_id: number
  role: DocumentRole
  name: string
  format: DocumentFormat
  source_document_id: number | null
  created_at: string
}): DocumentRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    role: row.role,
    name: row.name,
    format: row.format,
    sourceDocumentId: row.source_document_id,
    createdAt: row.created_at
  }
}

function touchFolder(folderId: number): void {
  getDb().prepare(`UPDATE folders SET updated_at = datetime('now') WHERE id = ?`).run(folderId)
}

type BlockRow = {
  text: string
  indent_pt: number
  font_size: number
  bold: number
  align: 'left' | 'center'
  space_after_pt: number
  page_break_before: number
  page: number | null
  y_pt: number | null
  page_width_pt: number | null
  page_height_pt: number | null
  runs_json: string | null
}

function loadBlocks(documentId: number): PdfBlock[] {
  const rows = getDb()
    .prepare(
      `SELECT text, indent_pt, font_size, bold, align, space_after_pt, page_break_before,
              page, y_pt, page_width_pt, page_height_pt, runs_json
       FROM document_blocks WHERE document_id = ? ORDER BY seq`
    )
    .all(documentId) as BlockRow[]
  if (rows.length === 0) throw new Error('Belge düzeni yok')
  return rows.map((row) => ({
    text: row.text,
    indentPt: row.indent_pt,
    fontSize: row.font_size,
    bold: Boolean(row.bold),
    align: row.align,
    spaceAfterPt: row.space_after_pt,
    pageBreakBefore: Boolean(row.page_break_before),
    position:
      row.page == null
        ? undefined
        : {
            page: row.page,
            y: row.y_pt!,
            pageWidth: row.page_width_pt!,
            pageHeight: row.page_height_pt!,
            runs: JSON.parse(row.runs_json!) as TextRun[]
          }
  }))
}

function insertBlocks(documentId: number, blocks: PdfBlock[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO document_blocks
      (document_id, seq, text, indent_pt, font_size, bold, align, space_after_pt, page_break_before,
       page, y_pt, page_width_pt, page_height_pt, runs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  blocks.forEach((block, seq) => {
    const pos = block.position
    stmt.run(
      documentId,
      seq,
      block.text,
      block.indentPt,
      block.fontSize,
      block.bold ? 1 : 0,
      block.align,
      block.spaceAfterPt,
      block.pageBreakBefore ? 1 : 0,
      pos?.page ?? null,
      pos?.y ?? null,
      pos?.pageWidth ?? null,
      pos?.pageHeight ?? null,
      pos ? JSON.stringify(pos.runs) : null
    )
  })
}

function pageCountOf(blocks: PdfBlock[]): number {
  return 1 + blocks.filter((block) => block.pageBreakBefore).length
}

export function listFolders(): FolderRecord[] {
  const { user } = requireSession()
  const rows = getDb()
    .prepare(
      `SELECT f.*,
        (SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id) AS document_count
       FROM folders f
       WHERE f.user_id = ?
       ORDER BY f.updated_at DESC`
    )
    .all(user.id) as Array<{
    id: number
    user_id: number
    title: string
    created_at: string
    updated_at: string
    document_count: number
  }>
  return rows.map(mapFolder)
}

export function createFolder(title: string): FolderRecord {
  const { user } = requireSession()
  const trimmed = title.trim() || 'Yeni klasör'
  const info = getDb()
    .prepare('INSERT INTO folders (user_id, title) VALUES (?, ?)')
    .run(user.id, trimmed)
  const id = Number(info.lastInsertRowid)
  return listFolders().find((folder) => folder.id === id)!
}

export function renameFolder(folderId: number, title: string): FolderRecord {
  const { user } = requireSession()
  assertFolderOwned(folderId, user.id)
  getDb()
    .prepare(`UPDATE folders SET title = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(title.trim() || 'Klasör', folderId)
  return listFolders().find((folder) => folder.id === folderId)!
}

export function deleteFolder(folderId: number): void {
  const { user } = requireSession()
  assertFolderOwned(folderId, user.id)
  const database = getDb()
  database.pragma('defer_foreign_keys = ON')
  try {
    database.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
  } finally {
    database.pragma('defer_foreign_keys = OFF')
  }
  rmSync(folderFilesDir(user.id, folderId), { recursive: true, force: true })
}

export function listDocuments(folderId: number): DocumentRecord[] {
  const { user } = requireSession()
  assertFolderOwned(folderId, user.id)
  const rows = getDb()
    .prepare(
      `SELECT id, folder_id, role, name, format, source_document_id, created_at
       FROM documents WHERE folder_id = ? ORDER BY created_at DESC`
    )
    .all(folderId) as Array<{
    id: number
    folder_id: number
    role: DocumentRole
    name: string
    format: DocumentFormat
    source_document_id: number | null
    created_at: string
  }>
  return rows.map(mapDoc)
}

export function getDocumentDetail(documentId: number): DocumentDetail {
  const { user } = requireSession()
  const row = assertDocOwned(documentId, user.id)
  const docs = listDocuments(row.folder_id)
  const text = row.role === 'original' ? plainTextFromBlocks(loadBlocks(row.id)) : (row.body ?? '')
  return {
    document: docs.find((doc) => doc.id === row.id)!,
    text,
    source: docs.find((doc) => doc.id === row.source_document_id) ?? null,
    derived: docs.filter((doc) => doc.sourceDocumentId === row.id),
    keys: row.mapping == null ? [] : readMapping(row)
  }
}

export async function uploadDocument(
  folderId: number,
  sourcePath: string,
  originalName?: string
): Promise<{ document: DocumentRecord }> {
  const { user } = requireSession()
  assertFolderOwned(folderId, user.id)

  const name = originalName || basename(sourcePath)
  const format = formatOf(name)
  const { blocks } = await extractDocument(sourcePath, format)

  const dir = folderFilesDir(user.id, folderId)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${Date.now()}-original.${format}`)
  copyFileSync(sourcePath, dest)

  const database = getDb()
  const documentId = database.transaction(() => {
    const info = database
      .prepare(
        `INSERT INTO documents (folder_id, role, name, format, body, path)
         VALUES (?, 'original', ?, ?, NULL, ?)`
      )
      .run(folderId, name, format, dest)
    const id = Number(info.lastInsertRowid)
    insertBlocks(id, blocks)
    return id
  })()

  touchFolder(folderId)
  return { document: listDocuments(folderId).find((doc) => doc.id === documentId)! }
}

function originalBlocks(documentId: number): { row: DocRow; blocks: PdfBlock[] } {
  const { user } = requireSession()
  const row = assertDocOwned(documentId, user.id)
  if (row.role !== 'original') throw new Error('Anonimleştirme yalnızca orijinal belgede başlar')
  return { row, blocks: loadBlocks(row.id) }
}

function lastingPhrases(): string[] {
  return listIgnoredPhrases().map((p) => p.phrase)
}

const PII_KINDS = new Set<PiiKind>(['AD', 'SOYAD', 'TCKN', 'VKN', 'IBAN', 'EMAIL', 'TEL', 'PLAKA', 'OZEL'])

function checkSkips(skips: KeySkip[]): KeySkip[] {
  return skips.map((skip) => {
    if (
      !Number.isInteger(skip?.start) ||
      !Number.isInteger(skip?.end) ||
      skip.end <= skip.start ||
      !PII_KINDS.has(skip.kind) ||
      typeof skip.value !== 'string'
    ) {
      throw new Error('Geçersiz yok sayma')
    }
    return { start: skip.start, end: skip.end, kind: skip.kind, value: skip.value }
  })
}

/** Skips per line of the review text, in that line's offsets, with their key's identity. */
function skipsByLine(blocks: PdfBlock[], skips: KeySkip[]): LineSkip[][] {
  const out: LineSkip[][] = blocks.map(() => [])
  let offset = 0
  blocks.forEach((block, i) => {
    const end = offset + block.text.length
    for (const skip of skips) {
      if (skip.start < end && offset < skip.end) {
        out[i]!.push({
          start: skip.start - offset,
          end: skip.end - offset,
          identity: identityKey(skip.kind, skip.value)
        })
      }
    }
    offset = end + 1
  })
  return out
}

/**
 * What happens on each line: spans that become tokens, and spans the user skipped.
 * The same lines feed the review screen and every output format.
 */
function encodeLines(
  blocks: PdfBlock[],
  entries: MappingEntry[],
  skips: KeySkip[]
): Array<{ spans: TextSpan[]; skipped: TextSpan[] }> {
  const phrases = lastingPhrases()
  const local = skipsByLine(blocks, skips)
  return blocks.map((block, i) => planSpans(block.text, entries, phrases, local[i]))
}

function pdfWarnings(blocks: PdfBlock[]): string[] {
  const warnings = ['PDF’teki görseller, çizgiler ve tablo kenarlıkları anonim belgeye aktarılmaz.']
  const ocrPages = ocrPagesOf(blocks)
  if (ocrPages.length > 0) {
    warnings.push(
      `Sayfa ${ocrPages.join(', ')} metin katmanı olmadığı için OCR ile okundu. Tanıma hataları ` +
        'kişisel verinin bulunmamasına yol açabilir; metni ve tespitleri gözden geçirin.'
    )
  }
  return warnings
}

export async function startEncoding(documentId: number): Promise<{
  text: string
  pageCount: number
  format: DocumentFormat
  warnings: string[]
  keys: MappingEntry[]
}> {
  const { row, blocks } = originalBlocks(documentId)
  const text = plainTextFromBlocks(blocks)
  if (!text.trim()) throw new Error('Kaynak metin yok')
  const warnings = row.format === 'docx' ? await docxWarnings(row.path) : pdfWarnings(blocks)
  // Detected line by line, as the document is written; offsets are into the joined text.
  const candidates: PiiCandidate[] = []
  let offset = 0
  for (const block of blocks) {
    for (const c of detectAll(block.text)) {
      candidates.push({ ...c, start: c.start + offset, end: c.end + offset })
    }
    offset += block.text.length + 1
  }
  return {
    text,
    pageCount: pageCountOf(blocks),
    format: row.format,
    warnings,
    keys: buildMappings(candidates)
  }
}

/**
 * Spans that will become tokens, and the skipped ones, on the review text. Computed line
 * by line with the same function the output uses, so the screen shows what will be written.
 */
export function previewEncoding(
  documentId: number,
  keys: MappingEntry[],
  skips: KeySkip[]
): EncodingPreview {
  const { blocks } = originalBlocks(documentId)
  const lines = encodeLines(blocks, checkMappings(keys), checkSkips(skips))
  const preview: EncodingPreview = { spans: [], skipped: [] }
  let offset = 0
  blocks.forEach((block, i) => {
    for (const span of lines[i]!.spans) {
      preview.spans.push({ start: span.start + offset, end: span.end + offset, token: span.token })
    }
    for (const span of lines[i]!.skipped) {
      preview.skipped.push({ start: span.start + offset, end: span.end + offset, token: span.token })
    }
    offset += block.text.length + 1
  })
  return preview
}

/**
 * A Word file's lines with their refs, read again from the original. They must match the
 * lines saved at upload, or a choice made on the screen could land on the wrong line.
 */
async function docxLineIndex(row: DocRow, blocks: PdfBlock[]): Promise<Map<string, number>> {
  const fresh = (await extractDocxText(row.path)).blocks
  if (fresh.length !== blocks.length || fresh.some((block, i) => block.text !== blocks[i]!.text)) {
    throw new Error('Belgenin satırları yüklendiği andan farklı okunuyor. Belgeyi yeniden yükleyin.')
  }
  const index = new Map<string, number>()
  fresh.forEach((block, i) => {
    if (block.ref) index.set(block.ref, i)
  })
  return index
}

/**
 * Write the encoded document. A Word original is changed in place and keeps its
 * formatting. A PDF original becomes an editable DOCX or a PDF that keeps each
 * line where it was.
 */
export async function produceEncoded(
  documentId: number,
  keys: MappingEntry[],
  skips: KeySkip[],
  output: DocumentFormat
): Promise<{ document: DocumentRecord }> {
  const { user, key } = requireSession()
  const { row, blocks } = originalBlocks(documentId)
  const format: DocumentFormat = row.format === 'docx' ? 'docx' : output

  const entries = checkMappings(keys)
  // A named token already in the text would be "restored" there too
  const text = plainTextFromBlocks(blocks)
  for (const entry of entries) {
    if (!isNumberedToken(entry.token, entry.kind) && text.includes(entry.token)) {
      throw new Error(`${entry.token} belgede zaten geçiyor; başka bir token adı seçin`)
    }
  }
  const checkedSkips = checkSkips(skips)
  const lines = encodeLines(blocks, entries, checkedSkips)
  const anonBlocks = blocks.map((block, i) => ({
    ...block,
    text: applySpans(block.text, lines[i]!.spans)
  }))
  const body = plainTextFromBlocks(anonBlocks)

  let bytes: Uint8Array
  if (row.format === 'docx') {
    // The writer sees untrimmed paragraph lines; review lines are trimmed.
    const lineIndex = await docxLineIndex(row, blocks)
    const local = skipsByLine(blocks, checkedSkips)
    const phrases = lastingPhrases()
    bytes = await rewriteDocx(
      row.path,
      (text, ref) => {
        const i = ref == null ? undefined : lineIndex.get(ref)
        if (i == null) return planSpans(text, entries, phrases).spans
        const lead = text.length - text.trimStart().length
        const skipped = local[i]!.map((r) => ({ ...r, start: r.start + lead, end: r.end + lead }))
        return planSpans(text, entries, phrases, skipped).spans
      },
      { scrub: true }
    )
  } else if (format === 'pdf') {
    bytes = await buildPositionedPdf(blocks, (_block, i) => lines[i]!.spans)
  } else {
    bytes = await buildDocx(anonBlocks)
  }
  const dir = folderFilesDir(user.id, row.folder_id)
  mkdirSync(dir, { recursive: true })
  const encodedName = `${row.name.replace(/\.(pdf|docx)$/i, '')}-anonim.${format}`
  const mapping: DocumentMapping = { entries }

  const database = getDb()
  const info = database
    .prepare(
      `INSERT INTO documents (folder_id, role, name, format, body, mapping, path, source_document_id)
       VALUES (?, 'encoded', ?, ?, ?, ?, ?, ?)`
    )
    .run(row.folder_id, encodedName, format, body, encryptJson(mapping, key), 'pending', row.id)
  const encodedId = Number(info.lastInsertRowid)
  const encodedPath = join(dir, `${encodedId}.${format}`)
  try {
    writeFileSync(encodedPath, bytes)
    database.prepare('UPDATE documents SET path = ? WHERE id = ?').run(encodedPath, encodedId)
  } catch (err) {
    database.prepare('DELETE FROM documents WHERE id = ?').run(encodedId)
    try {
      unlinkSync(encodedPath)
    } catch {
      // file may not exist yet
    }
    throw err
  }

  touchFolder(row.folder_id)
  return { document: listDocuments(row.folder_id).find((doc) => doc.id === encodedId)! }
}

export function exportEncodedCopy(documentId: number, destPath: string): void {
  const { user } = requireSession()
  const row = assertDocOwned(documentId, user.id)
  if (row.role !== 'encoded') throw new Error('Anonim dosya yok')
  copyFileSync(row.path, destPath)
}

export function documentFormat(documentId: number): DocumentFormat {
  const { user } = requireSession()
  return assertDocOwned(documentId, user.id).format
}

export function exportRestoredCopy(documentId: number, destPath: string): void {
  const { user } = requireSession()
  const row = assertDocOwned(documentId, user.id)
  if (row.role !== 'restored') throw new Error('Geri yüklenmiş dosya yok')
  copyFileSync(row.path, destPath)
}

/**
 * Decode a PDF or DOCX that came back for one encoded document, using that document's keys.
 * A returned DOCX is changed in place and keeps the third party's formatting; a returned
 * PDF is redrawn line by line where it was.
 */
export async function restoreFromFile(
  encodedDocumentId: number,
  sourcePath: string,
  originalName?: string
): Promise<DocumentRecord> {
  const { user } = requireSession()
  const encoded = assertDocOwned(encodedDocumentId, user.id)
  if (encoded.role !== 'encoded') {
    throw new Error('Geri yükleme anonim belgeden yapılır')
  }
  const folderId = encoded.folder_id
  const mappings = readMapping(encoded)

  const name = originalName || basename(sourcePath)
  const format = formatOf(name)
  const { text, blocks } = await extractDocument(sourcePath, format)

  const restoredBlocks = blocks.map((block) => ({
    ...block,
    text: applyDeanonymize(block.text, mappings)
  }))
  const restoredText = plainTextFromBlocks(restoredBlocks)
  const restoredBytes =
    format === 'docx'
      ? await rewriteDocx(sourcePath, (text) => deanonymizeSpans(text, mappings), { scrub: false })
      : await buildPositionedPdf(blocks, (block) => deanonymizeSpans(block.text, mappings))
  const dir = folderFilesDir(user.id, folderId)
  mkdirSync(dir, { recursive: true })

  const database = getDb()
  const insert = database.prepare(
    `INSERT INTO documents (folder_id, role, name, format, body, path, source_document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const returnedInfo = insert.run(folderId, 'returned', name, format, text, 'pending', encoded.id)
  const returnedId = Number(returnedInfo.lastInsertRowid)
  const restoredInfo = insert.run(
    folderId,
    'restored',
    `geri-${name}`,
    format,
    restoredText,
    'pending',
    returnedId
  )
  const restoredId = Number(restoredInfo.lastInsertRowid)
  const returnedPath = join(dir, `${returnedId}.${format}`)
  const restoredPath = join(dir, `${restoredId}.${format}`)
  try {
    copyFileSync(sourcePath, returnedPath)
    writeFileSync(restoredPath, restoredBytes)
    const setPath = database.prepare('UPDATE documents SET path = ? WHERE id = ?')
    setPath.run(returnedPath, returnedId)
    setPath.run(restoredPath, restoredId)
  } catch (err) {
    database.prepare('DELETE FROM documents WHERE id = ?').run(restoredId)
    database.prepare('DELETE FROM documents WHERE id = ?').run(returnedId)
    try {
      unlinkSync(returnedPath)
    } catch {
      // file may not exist yet
    }
    try {
      unlinkSync(restoredPath)
    } catch {
      // file may not exist yet
    }
    throw err
  }

  touchFolder(folderId)
  return listDocuments(folderId).find((doc) => doc.id === restoredId)!
}
