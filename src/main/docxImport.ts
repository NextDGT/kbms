import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import {
  childNamed,
  descendants,
  lineRef,
  paragraphLines,
  parseXml,
  readableParagraphs,
  sortTextParts,
  wAttr,
  type TextPartKind
} from './ooxml'
import { plainTextFromBlocks, type PdfBlock } from './pdfBlocks'

const PART_LABEL: Record<Exclude<TextPartKind, 'body'>, string> = {
  header: 'Üst bilgi',
  footer: 'Alt bilgi',
  footnotes: 'Dipnotlar',
  endnotes: 'Sonnotlar',
  comments: 'Yorumlar'
}

function twipsToPt(value: string | null): number {
  const n = Number(value)
  return Number.isFinite(n) ? n / 20 : 0
}

function isOn(node: Element | undefined): boolean {
  if (!node) return false
  const val = wAttr(node, 'val')
  return val == null || !['0', 'false', 'off'].includes(val)
}

function paragraphBlocks(paragraph: Element, ref: (line: number) => string): PdfBlock[] {
  const pPr = childNamed(paragraph, 'pPr')
  const jc = wAttr(childNamed(pPr, 'jc'), 'val')
  const ind = childNamed(pPr, 'ind')
  const indentPt = twipsToPt(wAttr(ind, 'left') ?? wAttr(ind, 'start'))
  const spaceAfterPt = twipsToPt(wAttr(childNamed(pPr, 'spacing'), 'after'))

  const runs = descendants(paragraph, 'r')
  let boldRuns = 0
  let fontSize = 0
  for (const run of runs) {
    const rPr = childNamed(run, 'rPr')
    if (isOn(childNamed(rPr, 'b'))) boldRuns += 1
    if (!fontSize) {
      const halfPoints = Number(wAttr(childNamed(rPr, 'sz'), 'val'))
      if (Number.isFinite(halfPoints) && halfPoints > 0) fontSize = halfPoints / 2
    }
  }

  const base = {
    indentPt: jc === 'center' ? 0 : Math.max(0, Math.round(indentPt)),
    fontSize: fontSize || 11,
    bold: runs.length > 0 && boldRuns * 2 >= runs.length,
    align: jc === 'center' ? ('center' as const) : ('left' as const)
  }

  const lines = paragraphLines(paragraph)
  lines[0]!.pageBreakBefore ||= isOn(childNamed(pPr, 'pageBreakBefore'))
  return lines.map((line, i) => ({
    ...base,
    text: line.segments
      .map((seg) => seg.text)
      .join('')
      .trim(),
    spaceAfterPt: i === lines.length - 1 ? Math.min(72, Math.round(spaceAfterPt)) : 0,
    pageBreakBefore: line.pageBreakBefore,
    ref: ref(i)
  }))
}

/** Drop empty lines; their height becomes space after the line before. */
function compact(blocks: PdfBlock[]): PdfBlock[] {
  const out: PdfBlock[] = []
  let pendingBreak = false
  for (const block of blocks) {
    if (!block.text) {
      const prev = out[out.length - 1]
      if (prev) prev.spaceAfterPt = Math.min(72, prev.spaceAfterPt + block.fontSize * 1.2)
      pendingBreak ||= block.pageBreakBefore
      continue
    }
    out.push({ ...block, pageBreakBefore: out.length > 0 && (block.pageBreakBefore || pendingBreak) })
    pendingBreak = false
  }
  return out
}

function labelBlock(text: string): PdfBlock {
  return {
    text: `— ${text} —`,
    indentPt: 0,
    fontSize: 11,
    bold: true,
    align: 'left',
    spaceAfterPt: 6,
    pageBreakBefore: false
  }
}

export async function loadDocx(filePath: string): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(await readFile(filePath))
    if (!zip.file('word/document.xml')) throw new Error()
    return zip
  } catch {
    throw new Error('DOCX okunamadı')
  }
}

/**
 * Text of a Word document as layout blocks: body first, then headers, footers,
 * footnotes, endnotes and comments under a label line. Text boxes are included.
 */
export async function extractDocxText(
  filePath: string
): Promise<{ text: string; blocks: PdfBlock[] }> {
  const zip = await loadDocx(filePath)
  const blocks: PdfBlock[] = []
  let lastKind: TextPartKind | null = null
  for (const { path, kind } of sortTextParts(Object.keys(zip.files))) {
    const doc = parseXml(await zip.file(path)!.async('string'))
    const partBlocks = compact(
      readableParagraphs(doc).flatMap((paragraph, index) =>
        paragraphBlocks(paragraph, (line) => lineRef(path, index, line))
      )
    )
    if (partBlocks.length === 0) continue
    if (kind !== 'body' && kind !== lastKind) blocks.push(labelBlock(PART_LABEL[kind]))
    lastKind = kind
    blocks.push(...partBlocks)
  }
  return { text: plainTextFromBlocks(blocks), blocks }
}

/** Content the text review cannot see: pictures and embedded files. */
export async function docxWarnings(filePath: string): Promise<string[]> {
  const zip = await loadDocx(filePath)
  const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir)
  const media = names.filter((name) => name.startsWith('word/media/')).length
  const embedded = names.filter((name) => name.startsWith('word/embeddings/')).length
  const warnings: string[] = []
  if (media > 0) {
    warnings.push(
      `Belgede ${media} görsel var. Görsellerin içindeki yazılar taranmaz; anonim belgede aynen kalır.`
    )
  }
  if (embedded > 0) {
    warnings.push(
      `Belgede ${embedded} gömülü dosya/nesne var. İçerikleri taranmaz; anonim belgede aynen kalır.`
    )
  }
  return warnings
}
