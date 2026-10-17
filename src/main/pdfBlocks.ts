export type PdfBlock = {
  text: string
  /** Extra left indent in points, relative to the page's leftmost line. */
  indentPt: number
  fontSize: number
  bold: boolean
  align: 'left' | 'center'
  spaceAfterPt: number
  pageBreakBefore: boolean
  /** Where the line sat on its PDF page. Only blocks read from a PDF have it. */
  position?: BlockPosition
  /** Which Word paragraph line this is (see lineRef). Only blocks read from a DOCX have it. */
  ref?: string
}

/**
 * Where a line sat on its PDF page, in points from the page's bottom left.
 * `runs` cover the line's text piece by piece; text between runs is a gap.
 */
export type BlockPosition = {
  page: number
  y: number
  pageWidth: number
  pageHeight: number
  runs: TextRun[]
}

/** A stretch of a line drawn as one: same weight, no gap inside. */
export type TextRun = {
  start: number
  end: number
  x: number
  width: number
  bold: boolean
  /** Read by OCR from a page without a text layer. */
  ocr?: boolean
}

export type RawGlyph = {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
  bold: boolean
  page: number
  pageWidth: number
  pageHeight: number
  ocr?: boolean
}

type Line = {
  text: string
  runs: TextRun[]
  x: number
  width: number
  y: number
  fontSize: number
  bold: boolean
  page: number
  pageWidth: number
  pageHeight: number
}

function joinGlyphs(items: RawGlyph[]): Line | null {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let text = ''
  let cursor = 0
  const runs: TextRun[] = []
  for (const item of sorted) {
    let piece = item.str.replace(/\s+/g, ' ')
    if (!text || text.endsWith(' ')) piece = piece.trimStart()
    if (!piece) continue
    const gap = item.x - cursor
    const spaced =
      Boolean(text) &&
      !text.endsWith(' ') &&
      !piece.startsWith(' ') &&
      gap > Math.max(1.2, item.fontSize * 0.18)
    if (spaced) text += ' '
    const start = text.length
    text += piece
    cursor = item.x + Math.max(item.width, 0)
    const prev = runs[runs.length - 1]
    if (prev && !spaced && prev.end === start && prev.bold === item.bold) {
      prev.end = text.length
      prev.width = cursor - prev.x
    } else {
      runs.push({
        start,
        end: text.length,
        x: item.x,
        width: cursor - item.x,
        bold: item.bold,
        ...(item.ocr ? { ocr: true } : {})
      })
    }
  }
  const trimmed = text.trimEnd()
  for (const run of runs) run.end = Math.min(run.end, trimmed.length)
  const kept = runs.filter((run) => run.end > run.start)
  if (!trimmed || kept.length === 0) return null
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const sizes = sorted.map((item) => item.fontSize).sort((a, b) => a - b)
  const fontSize = sizes[Math.floor(sizes.length / 2)] ?? 11
  const boldCount = sorted.filter((item) => item.bold).length
  return {
    text: trimmed,
    runs: kept,
    x: first.x,
    width: Math.max(1, last.x + last.width - first.x),
    y: first.y,
    fontSize,
    bold: boldCount * 2 >= sorted.length,
    page: first.page,
    pageWidth: first.pageWidth,
    pageHeight: first.pageHeight
  }
}

function linesFromGlyphs(glyphs: RawGlyph[]): Line[] {
  const byPage = new Map<number, RawGlyph[]>()
  for (const glyph of glyphs) {
    if (!glyph.str.trim()) continue
    const list = byPage.get(glyph.page) ?? []
    list.push(glyph)
    byPage.set(glyph.page, list)
  }

  const lines: Line[] = []
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const items = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x)
    const groups: Array<{ y: number; items: RawGlyph[] }> = []
    for (const item of items) {
      const group = groups.find((entry) => Math.abs(entry.y - item.y) <= 3)
      if (group) {
        group.items.push(item)
        group.y = (group.y * (group.items.length - 1) + item.y) / group.items.length
      } else {
        groups.push({ y: item.y, items: [item] })
      }
    }
    groups.sort((a, b) => b.y - a.y)
    for (const group of groups) {
      const line = joinGlyphs(group.items)
      if (line) lines.push(line)
    }
  }
  return lines
}

/** Turn positioned PDF glyphs into paragraphs that keep left indent and line gaps. */
export function blocksFromGlyphs(glyphs: RawGlyph[]): PdfBlock[] {
  const lines = linesFromGlyphs(glyphs)
  const blocks: PdfBlock[] = []
  let prev: Line | null = null

  for (const line of lines) {
    const pageLines = lines.filter((entry) => entry.page === line.page)
    const bodyLeft = Math.min(...pageLines.map((entry) => entry.x))
    const rightGap = line.pageWidth - (line.x + line.width)
    const sharedColumn = pageLines.filter((entry) => Math.abs(entry.x - line.x) <= 4).length
    const centered =
      Math.abs(line.x - rightGap) < 28 && line.x > bodyLeft + 20 && sharedColumn < 3
    const pageBreakBefore = prev != null && line.page !== prev.page
    let spaceAfterPt = 0
    const next = lines[lines.indexOf(line) + 1]
    if (next && next.page === line.page) {
      const pitch = line.y - next.y
      const expected = Math.max(line.fontSize, next.fontSize) * 1.2
      spaceAfterPt = Math.max(0, Math.min(72, Math.round(pitch - expected)))
    }
    blocks.push({
      text: line.text,
      indentPt: centered ? 0 : Math.max(0, Math.round(line.x - bodyLeft)),
      fontSize: Math.round(line.fontSize * 2) / 2,
      bold: line.bold,
      align: centered ? 'center' : 'left',
      spaceAfterPt,
      pageBreakBefore,
      position: {
        page: line.page,
        y: line.y,
        pageWidth: line.pageWidth,
        pageHeight: line.pageHeight,
        runs: line.runs
      }
    })
    prev = line
  }
  return blocks
}

/** Pages (1-based) whose text was read by OCR. */
export function ocrPagesOf(blocks: PdfBlock[]): number[] {
  const pages = new Set<number>()
  for (const block of blocks) {
    if (block.position?.runs.some((run) => run.ocr)) pages.add(block.position.page)
  }
  return [...pages].sort((a, b) => a - b)
}

/** Lines joined by newlines. Offsets into this text are what the review screen uses. */
export function plainTextFromBlocks(blocks: PdfBlock[]): string {
  return blocks.map((block) => block.text).join('\n')
}
