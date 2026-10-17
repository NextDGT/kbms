import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import fontkit from '@pdf-lib/fontkit'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { Packer, type Document } from 'docx'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { getDb } from '../src/main/db'
import { applySpans } from '../src/main/pii/detect'
import * as services from '../src/main/services'
import type { DocumentRecord, MappingEntry, PreviewSpan } from '../src/shared/types'

const require = createRequire(__filename)

/** Directory for files a test writes; inside the run's temporary directory. */
export function fixturesDir(): string {
  const dir = join(app.getPath('userData'), '..', 'fixtures')
  mkdirSync(dir, { recursive: true })
  return dir
}

let counter = 0

/** Write a Word document built with the docx library and return its path. */
export async function writeDocx(name: string, doc: Document): Promise<string> {
  const path = join(fixturesDir(), `${++counter}-${name}`)
  writeFileSync(path, await Packer.toBuffer(doc))
  return path
}

export interface PdfLine {
  text: string
  x: number
  y: number
  size?: number
  bold?: boolean
}

/** Write a PDF with text drawn at the given places, one array of lines per page. */
export async function writePdf(name: string, pages: PdfLine[][]): Promise<string> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = (file: string) =>
    pdf.embedFont(readFileSync(require.resolve(`pdfjs-dist/standard_fonts/${file}`)), { subset: true })
  const regular = await font('LiberationSans-Regular.ttf')
  const bold = await font('LiberationSans-Bold.ttf')
  for (const lines of pages) {
    const page = pdf.addPage([595.28, 841.89])
    for (const line of lines) {
      page.drawText(line.text, { x: line.x, y: line.y, size: line.size ?? 11, font: line.bold ? bold : regular })
    }
  }
  const path = join(fixturesDir(), `${++counter}-${name}`)
  writeFileSync(path, await pdf.save())
  return path
}

/** Pixels per PDF point for scanned fixtures: 300 DPI. */
const SCAN_SCALE = 300 / 72

/**
 * Write a PDF whose pages are only pictures of the given lines, as a scanner makes:
 * no text layer, so it can only be read by OCR.
 */
export async function writeScannedPdf(name: string, pages: PdfLine[][]): Promise<string> {
  const fontDir = join(require.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb'), '..')
  GlobalFonts.registerFromPath(join(fontDir, 'LiberationSans-Regular.ttf'), 'Scan Sans')
  GlobalFonts.registerFromPath(join(fontDir, 'LiberationSans-Bold.ttf'), 'Scan Sans')
  const [width, height] = [595.28, 841.89]
  const pdf = await PDFDocument.create()
  for (const lines of pages) {
    const canvas = createCanvas(Math.round(width * SCAN_SCALE), Math.round(height * SCAN_SCALE))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000000'
    for (const line of lines) {
      const size = (line.size ?? 11) * SCAN_SCALE
      ctx.font = `${line.bold ? 'bold ' : ''}${size}px "Scan Sans"`
      ctx.fillText(line.text, line.x * SCAN_SCALE, (height - line.y) * SCAN_SCALE)
    }
    const image = await pdf.embedPng(canvas.toBuffer('image/png'))
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  }
  const path = join(fixturesDir(), `${++counter}-${name}`)
  writeFileSync(path, await pdf.save())
  return path
}

/** Upload a file into a new folder; returns the original document. */
export async function upload(path: string): Promise<DocumentRecord> {
  const folder = services.createFolder(`Test ${counter}`)
  return (await services.uploadDocument(folder.id, path)).document
}

export function pathOf(documentId: number): string {
  return (getDb().prepare('SELECT path FROM documents WHERE id = ?').get(documentId) as { path: string }).path
}

/** The review text with the preview's spans swapped: what the output must contain. */
export function previewed(text: string, spans: PreviewSpan[]): string {
  return applySpans(text, spans)
}

/** Keys with every spelling matched, for tests about something other than spelling modes. */
export function anySpelling(keys: MappingEntry[]): MappingEntry[] {
  return keys.map((key) => ({ ...key, match: 'any' as const }))
}

export function keyFor(keys: MappingEntry[], token: string): MappingEntry {
  const key = keys.find((k) => k.token === token)
  if (!key) throw new Error(`Anahtar yok: ${token}`)
  return key
}

/** Every XML part of a Word package, by name; and how many failed to parse. */
export async function xmlParts(path: string): Promise<{ parts: Map<string, string>; broken: string[] }> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const parts = new Map<string, string>()
  const broken: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]!.dir || !/\.(xml|rels)$/.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    parts.set(name, xml)
    let failed = false
    new DOMParser({
      errorHandler: { error: () => (failed = true), fatalError: () => (failed = true) }
    }).parseFromString(xml, 'text/xml')
    if (failed) broken.push(name)
  }
  return { parts, broken }
}

/** Which of the values appear in any XML part, as "part: value". */
export function leaks(parts: Map<string, string>, values: string[]): string[] {
  const found: string[] = []
  for (const [name, xml] of parts) {
    for (const value of values) if (xml.includes(value)) found.push(`${name}: ${value}`)
  }
  return found
}

export async function zipNames(path: string): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(readFileSync(path))).files)
}
