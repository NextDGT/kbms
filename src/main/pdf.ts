import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import * as canvas from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import {
  blocksFromGlyphs,
  plainTextFromBlocks,
  type PdfBlock,
  type RawGlyph,
  type TextRun
} from './pdfBlocks'
import { ocrPage, type RenderablePage } from './ocr'
import { applySpansToPieces, type TextPiece, type TextSpan } from './pii/detect'

const require = createRequire(import.meta.url)

/** Current pdf.js expects web platform pieces the Electron main process does not ship. */
function ensurePdfRuntime(): void {
  const promiseWithTry = Promise as unknown as {
    try?: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>
  }
  if (typeof promiseWithTry.try !== 'function') {
    promiseWithTry.try = (callback, ...args) =>
      new Promise((resolve, reject) => {
        try {
          resolve(callback(...args))
        } catch (err) {
          reject(err)
        }
      })
  }
  const bytes = Uint8Array.prototype as Uint8Array & { toHex?: () => string }
  if (typeof bytes.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value(this: Uint8Array) {
        let hex = ''
        for (const byte of this) hex += byte.toString(16).padStart(2, '0')
        return hex
      }
    })
  }
  const math = Math as Math & { sumPrecise?: (values: Iterable<number>) => number }
  if (typeof math.sumPrecise !== 'function') {
    math.sumPrecise = (values) => {
      let sum = 0
      for (const value of values) sum += value
      return sum
    }
  }
  for (const proto of [Map.prototype, WeakMap.prototype] as Array<
    Map<unknown, unknown> & {
      getOrInsert?: (key: unknown, value: unknown) => unknown
      getOrInsertComputed?: (key: unknown, compute: (key: unknown) => unknown) => unknown
    }
  >) {
    if (typeof proto.getOrInsert !== 'function') {
      Object.defineProperty(proto, 'getOrInsert', {
        value(this: Map<unknown, unknown>, key: unknown, value: unknown) {
          if (!this.has(key)) this.set(key, value)
          return this.get(key)
        }
      })
    }
    if (typeof proto.getOrInsertComputed !== 'function') {
      Object.defineProperty(proto, 'getOrInsertComputed', {
        value(this: Map<unknown, unknown>, key: unknown, compute: (key: unknown) => unknown) {
          if (!this.has(key)) this.set(key, compute(key))
          return this.get(key)
        }
      })
    }
  }
  ensureCanvasGlobals()
}

/** Canvas classes pdf.js needs to lay out and draw pages, taken from @napi-rs/canvas. */
function ensureCanvasGlobals(): void {
  const host = globalThis as Record<string, unknown>
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D'] as const) {
    if (typeof host[name] !== 'function') host[name] = canvas[name]
  }
}

type PdfTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
}

type PdfjsModule = {
  getDocument: (src: {
    data: Uint8Array
    useSystemFonts?: boolean
    isEvalSupported?: boolean
    standardFontDataUrl?: string
  }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<RenderablePage & {
        getOperatorList: () => Promise<unknown>
        commonObjs: { get: (id: string) => PdfFont | undefined }
        getTextContent: () => Promise<{
          items: PdfTextItem[]
          styles: Record<string, { fontFamily?: string }>
        }>
      }>
    }>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      ensurePdfRuntime()
      const entry = require.resolve('pdfjs-dist/build/pdf.mjs')
      const mod = (await import(pathToFileURL(entry).href)) as PdfjsModule
      const worker = require.resolve('pdfjs-dist/build/pdf.worker.mjs')
      mod.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href
      return mod
    })()
  }
  return pdfjsPromise
}

type PdfFont = { name?: string; bold?: boolean; black?: boolean }

/**
 * A page whose text layer holds fewer letters than this is treated as a scan and read by OCR.
 * Scanners often add a short stamp ("Sayfa 1") as text; that alone must not hide the page body.
 */
const MIN_TEXT_LAYER_CHARS = 16

const BOLD_NAME = /bold|black|semibold|heavy/i

/**
 * Weight of a text item. The text layer only gives a generic family ("serif"),
 * so the loaded font's real name (…-BoldMT) is checked when it is available.
 */
function isBoldFont(font: PdfFont | undefined, fontFamily: string | undefined): boolean {
  if (font && (font.bold || font.black || BOLD_NAME.test(font.name ?? ''))) return true
  return Boolean(fontFamily && BOLD_NAME.test(fontFamily))
}

function loadedFont(
  objs: { get: (id: string) => PdfFont | undefined },
  id: string | undefined
): PdfFont | undefined {
  if (!id) return undefined
  try {
    return objs.get(id)
  } catch {
    // font not resolved for this page
    return undefined
  }
}

export async function extractPdfText(
  filePath: string
): Promise<{ text: string; pageCount: number; blocks: PdfBlock[] }> {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await readFile(filePath))
  const fontFile = require.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb')
  const standardFontDataUrl = pathToFileURL(`${dirname(fontFile)}/`).href
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    standardFontDataUrl
  }).promise

  const glyphs: RawGlyph[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const layerChars = content.items.reduce((sum, item) => sum + (item.str ?? '').replace(/\s/g, '').length, 0)
    if (layerChars < MIN_TEXT_LAYER_CHARS) {
      glyphs.push(...(await ocrPage(page, i)))
      continue
    }
    // Loads the page's fonts so their real names can be read below
    await page.getOperatorList()
    for (const item of content.items) {
      const str = item.str ?? ''
      const transform = item.transform
      if (!str.trim() || !transform || transform.length < 6) continue
      const fontSize = Math.abs(transform[3] ?? 0) || item.height || 11
      glyphs.push({
        str,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: item.width ?? 0,
        fontSize,
        bold: isBoldFont(
          loadedFont(page.commonObjs, item.fontName),
          content.styles[item.fontName ?? '']?.fontFamily
        ),
        page: i,
        pageWidth,
        pageHeight
      })
    }
  }

  const blocks = blocksFromGlyphs(glyphs)
  return { text: plainTextFromBlocks(blocks), pageCount: doc.numPages, blocks }
}

/** Smallest share of the original size a run may shrink to so a longer token fits. */
const MIN_FIT_SCALE = 0.6

/** Pieces of a line for span placement: its runs, with the gaps between them read-only. */
function linePieces(block: PdfBlock): Array<TextPiece & { run?: TextRun }> {
  const pieces: Array<TextPiece & { run?: TextRun }> = []
  let pos = 0
  for (const run of block.position!.runs) {
    if (run.start > pos) pieces.push({ text: block.text.slice(pos, run.start), editable: false })
    pieces.push({ text: block.text.slice(run.start, run.end), editable: true, run })
    pos = run.end
  }
  if (pos < block.text.length) pieces.push({ text: block.text.slice(pos), editable: false })
  return pieces
}

/**
 * Draw each line where it stood on the source page. Spans are given for the whole
 * line (by its index in `blocks`), then each run is drawn at its own place and weight, so columns and partly
 * bold lines stay as they were. A run that grew shrinks to its original width.
 * Pictures and rules are not copied.
 */
export async function buildPositionedPdf(
  blocks: PdfBlock[],
  spansFor: (block: PdfBlock, index: number) => TextSpan[]
): Promise<Uint8Array> {
  const lines = blocks.filter((block) => block.text.trim())
  if (lines.some((block) => !block.position)) {
    throw new Error('Satır konumu olmayan belge konumlu PDF olarak yazılamaz')
  }

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setProducer('KBMS')
  pdf.setCreator('KBMS')
  pdf.setKeywords([])

  // Unicode TrueType fonts shipped with pdfjs-dist; cover Turkish letters
  const fontFile = (name: string) =>
    readFile(require.resolve(`pdfjs-dist/standard_fonts/${name}`))
  const regular = await pdf.embedFont(await fontFile('LiberationSans-Regular.ttf'), { subset: true })
  const bold = await pdf.embedFont(await fontFile('LiberationSans-Bold.ttf'), { subset: true })

  const pageCount = Math.max(1, ...lines.map((block) => block.position!.page))
  const sizes = new Map(lines.map((block) => [block.position!.page, block.position!]))
  const fallback = lines[0]?.position ?? { pageWidth: 595.28, pageHeight: 841.89 }
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const size = sizes.get(i + 1) ?? fallback
    return pdf.addPage([size.pageWidth, size.pageHeight])
  })

  blocks.forEach((block, index) => {
    if (!block.text.trim()) return
    const pos = block.position!
    const pieces = linePieces(block)
    const texts = applySpansToPieces(pieces, spansFor(block, index))
    pieces.forEach((piece, i) => {
      const run = piece.run
      const text = toPdfText(texts[i]!).trim()
      if (!run || !text) return
      const font = run.bold ? bold : regular
      let size = block.fontSize
      const width = font.widthOfTextAtSize(text, size)
      if (run.width > 0 && width > run.width * 1.02) {
        size = Math.max(block.fontSize * MIN_FIT_SCALE, (size * run.width) / width)
      }
      pages[pos.page - 1]!.drawText(text, {
        x: run.x,
        y: pos.y,
        size,
        font,
        color: rgb(0.1, 0.12, 0.11)
      })
    })
  })

  return pdf.save({ useObjectStreams: false })
}

/** Keep characters the embedded font can draw; drop control characters. */
function toPdfText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}
