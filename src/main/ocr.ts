import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { app } from 'electron'
import { createCanvas } from '@napi-rs/canvas'
import { createWorker, type Worker } from 'tesseract.js'
import type { RawGlyph } from './pdfBlocks'

const require = createRequire(import.meta.url)

/** Pages are read at 300 DPI; PDF user space is 72 per inch. */
const OCR_SCALE = 300 / 72

/** Words Tesseract is less sure of than this are dropped as noise (specks, stamps, lines). */
const MIN_WORD_CONFIDENCE = 30

/** The page pdf.js hands over: enough to draw it onto a canvas. */
export type RenderablePage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number }
  render: (params: {
    canvasContext: unknown
    viewport: { width: number; height: number }
  }) => { promise: Promise<void> }
}

/** Language data shipped with the app; nothing is downloaded. */
function tessdataDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'tessdata')
  return join(__dirname, '../../resources/tessdata')
}

/**
 * The OCR thread's script. In the packaged app it must be the unpacked copy: a worker
 * thread cannot start from inside app.asar.
 */
function workerScript(): string {
  const script = join(dirname(require.resolve('tesseract.js')), 'worker-script', 'node', 'index.js')
  return script.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

let workerPromise: Promise<Worker> | null = null

function ocrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['tur', 'eng'], undefined, {
      langPath: tessdataDir(),
      workerPath: workerScript(),
      cacheMethod: 'none',
      gzip: false
    }).catch((err: unknown) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/**
 * Read a page that has no text layer. Each recognised word becomes a glyph in PDF points,
 * placed on its line's baseline, so it joins lines the same way text-layer glyphs do.
 */
export async function ocrPage(page: RenderablePage, pageNo: number): Promise<RawGlyph[]> {
  const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: OCR_SCALE })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  // Scans with a transparent background would read as black
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise

  const worker = await ocrWorker()
  const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { blocks: true })

  const glyphs: RawGlyph[] = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const { baseline, rowAttributes } = line
        // Ascender to descender is about one em
        const fontSize =
          (rowAttributes.rowHeight + Math.abs(rowAttributes.descenders)) / OCR_SCALE || 11
        const slope = baseline.x1 !== baseline.x0 ? (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0) : 0
        for (const word of line.words) {
          const str = word.text.trim()
          if (!str || word.confidence < MIN_WORD_CONFIDENCE) continue
          const { x0, x1 } = word.bbox
          const baseY = baseline.y0 + slope * (x0 - baseline.x0)
          glyphs.push({
            str,
            x: x0 / OCR_SCALE,
            y: pageHeight - baseY / OCR_SCALE,
            width: (x1 - x0) / OCR_SCALE,
            fontSize,
            bold: false,
            page: pageNo,
            pageWidth,
            pageHeight,
            ocr: true
          })
        }
      }
    }
  }
  return glyphs
}
