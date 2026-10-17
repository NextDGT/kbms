import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

/** Parts of a Word package that hold visible text, in reading order. */
export type TextPartKind = 'body' | 'header' | 'footer' | 'footnotes' | 'endnotes' | 'comments'

const TEXT_PART_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/

const KIND_ORDER: TextPartKind[] = ['body', 'header', 'footer', 'footnotes', 'endnotes', 'comments']

export function textPartKind(path: string): TextPartKind | null {
  const m = TEXT_PART_RE.exec(path)
  if (!m) return null
  const name = m[1]!
  if (name === 'document') return 'body'
  if (name.startsWith('header')) return 'header'
  if (name.startsWith('footer')) return 'footer'
  return name as TextPartKind
}

/** Text parts sorted by kind, then by name (header1, header2, …). */
export function sortTextParts(paths: string[]): Array<{ path: string; kind: TextPartKind }> {
  return paths
    .map((path) => ({ path, kind: textPartKind(path) }))
    .filter((p): p is { path: string; kind: TextPartKind } => p.kind != null)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.path.localeCompare(b.path, 'en', { numeric: true })
    )
}

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never)
}

export function elementChildren(node: Node): Element[] {
  const out: Element[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) out.push(child as Element)
  }
  return out
}

export function childNamed(node: Element | undefined, name: string): Element | undefined {
  return node ? elementChildren(node).find((el) => el.localName === name) : undefined
}

/** Every descendant element with this local name, in document order. */
export function descendants(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name) as unknown as ArrayLike<Element>)
}

export function wAttr(node: Element | undefined, name: string): string | null {
  if (!node) return null
  return node.getAttribute(`w:${name}`) || node.getAttribute(name) || null
}

export function hasAncestor(node: Element, name: string, stopAt?: Element): boolean {
  for (let p = node.parentNode as Element | null; p && p !== stopAt; p = p.parentNode as Element | null) {
    if (p.nodeType === 1 && p.localName === name) return true
  }
  return false
}

/**
 * One piece of a paragraph's text. `node` is set for editable text (w:t);
 * tabs, breaks and hyphens are read-only.
 */
export interface Segment {
  text: string
  node?: Element
  pageBreak?: boolean
  lineBreak?: boolean
}

/** Content that is not visible text of this paragraph. */
const SKIP = new Set([
  'del',
  'moveFrom',
  'delText',
  'instrText',
  'rPr',
  'pPr',
  'p',
  'txbxContent',
  'Fallback'
])

/** Text of one paragraph in reading order. Nested paragraphs (text boxes) are left to themselves. */
export function paragraphSegments(paragraph: Element): Segment[] {
  const out: Segment[] = []
  const walk = (node: Element) => {
    for (const el of elementChildren(node)) {
      const name = el.localName
      if (SKIP.has(name)) continue
      if (name === 't') out.push({ text: el.textContent ?? '', node: el })
      else if (name === 'tab' || name === 'ptab') out.push({ text: ' ' })
      else if (name === 'noBreakHyphen') out.push({ text: '-' })
      else if (name === 'br' || name === 'cr') {
        const page = wAttr(el, 'type') === 'page'
        out.push({ text: '\n', lineBreak: !page, pageBreak: page })
      } else walk(el)
    }
  }
  walk(paragraph)
  return out
}

/** A paragraph's text cut at line and page breaks, as the review screen shows it. */
export function paragraphLines(paragraph: Element): Array<{ segments: Segment[]; pageBreakBefore: boolean }> {
  const lines: Array<{ segments: Segment[]; pageBreakBefore: boolean }> = [
    { segments: [], pageBreakBefore: false }
  ]
  for (const seg of paragraphSegments(paragraph)) {
    if (seg.lineBreak || seg.pageBreak) lines.push({ segments: [], pageBreakBefore: Boolean(seg.pageBreak) })
    else lines[lines.length - 1]!.segments.push(seg)
  }
  return lines
}

/**
 * Identity of one line of a readable paragraph: the reader puts it on review lines and
 * the writer finds the same line by it, so a choice made on the screen lands in place.
 */
export function lineRef(part: string, paragraphIndex: number, line: number): string {
  return `${part}#${paragraphIndex}:${line}`
}

/**
 * The paragraph Word shows for this one. A legacy copy under mc:Fallback stands for
 * the paragraph at the same place under the sibling mc:Choice; others stand for themselves.
 */
export function shownParagraph(paragraph: Element): Element {
  let fallback: Element | null = null
  for (let p = paragraph.parentNode as Element | null; p; p = p.parentNode as Element | null) {
    if (p.nodeType === 1 && p.localName === 'Fallback') {
      fallback = p
      break
    }
  }
  const choice = fallback?.parentNode ? childNamed(fallback.parentNode as Element, 'Choice') : undefined
  if (!fallback || !choice) return paragraph
  const index = descendants(fallback, 'p').indexOf(paragraph)
  return descendants(choice, 'p')[index] ?? paragraph
}

/** Paragraphs of a part, skipping the legacy copies Word keeps under mc:Fallback. */
export function readableParagraphs(doc: Document): Element[] {
  return descendants(doc, 'p').filter(
    (p) => p.namespaceURI?.includes('wordprocessingml') && !hasAncestor(p, 'Fallback')
  )
}

/** All paragraphs, including legacy copies; used when every copy must change. */
export function allParagraphs(doc: Document): Element[] {
  return descendants(doc, 'p').filter((p) => p.namespaceURI?.includes('wordprocessingml'))
}

export function setText(node: Element, text: string): void {
  while (node.firstChild) node.removeChild(node.firstChild)
  node.appendChild(node.ownerDocument!.createTextNode(text))
  node.setAttribute('xml:space', 'preserve')
}
