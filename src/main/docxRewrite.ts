import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import {
  allParagraphs,
  descendants,
  elementChildren,
  lineRef,
  paragraphLines,
  parseXml,
  readableParagraphs,
  serializeXml,
  setText,
  shownParagraph,
  textPartKind
} from './ooxml'
import { applySpans, applySpansToPieces, type TextSpan } from './pii/detect'

/** Elements that only record past revisions. Accepting changes drops them. */
const REVISION_DROP = new Set([
  'del',
  'moveFrom',
  'delText',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd'
])

/** Revision wrappers whose content stays once changes are accepted. */
const REVISION_UNWRAP = new Set(['ins', 'moveTo'])

const CORE_CLEAR = new Set([
  'creator',
  'lastModifiedBy',
  'title',
  'subject',
  'description',
  'keywords',
  'category',
  'contentStatus',
  'identifier',
  'lastPrinted'
])

const APP_CLEAR = new Set(['Company', 'Manager', 'HyperlinkBase'])

function isWordElement(el: Element): boolean {
  return Boolean(el.namespaceURI?.includes('wordprocessingml'))
}

/**
 * Finds what to swap in one line. `ref` names the review line it is (see lineRef), or is
 * null for text the review does not list line by line: field codes, link targets, bound data.
 */
export type LineFinder = (text: string, ref: string | null) => TextSpan[]

/** Each line of a paragraph (split at breaks, as the review screen shows it) is matched on its own. */
function rewriteParagraph(paragraph: Element, ref: (line: number) => string | null, find: LineFinder): void {
  paragraphLines(paragraph).forEach(({ segments }, lineIndex) => {
    const pieces = segments.map((seg) => ({ text: seg.text, editable: Boolean(seg.node) }))
    const spans = find(pieces.map((piece) => piece.text).join(''), ref(lineIndex))
    if (spans.length === 0) return
    applySpansToPieces(pieces, spans).forEach((text, i) => {
      if (text !== segments[i]!.text) setText(segments[i]!.node!, text)
    })
  })
}

function rewriteFields(doc: Document, find: LineFinder): void {
  for (const instr of descendants(doc, 'instrText')) {
    const text = instr.textContent ?? ''
    const next = applySpans(text, find(text, null))
    if (next !== text) setText(instr, next)
  }
  for (const field of descendants(doc, 'fldSimple')) {
    const instr = field.getAttribute('w:instr')
    if (instr) field.setAttribute('w:instr', applySpans(instr, find(instr, null)))
  }
}

function acceptRevisions(doc: Document): void {
  for (const el of descendants(doc, '*')) {
    if (!isWordElement(el) || !el.parentNode) continue
    if (REVISION_DROP.has(el.localName!)) {
      el.parentNode.removeChild(el)
    } else if (REVISION_UNWRAP.has(el.localName!)) {
      const parent = el.parentNode
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
  }
}

/** Revision and comment authors, plus data bindings that would refill content controls. */
function scrubPeople(doc: Document): void {
  for (const el of descendants(doc, '*')) {
    if (el.hasAttribute('w:author')) el.setAttribute('w:author', 'Anonim')
    if (el.hasAttribute('w:initials')) el.setAttribute('w:initials', 'A')
    if (
      (el.localName === 'dataBinding' || el.localName === 'presenceInfo') &&
      isWordElement(el) &&
      el.parentNode
    ) {
      el.parentNode.removeChild(el)
    }
  }
}

function clearText(doc: Document, names: Set<string>): void {
  for (const el of descendants(doc, '*')) {
    if (names.has(el.localName!)) setPlainText(el, '')
  }
}

function setPlainText(el: Element, text: string): void {
  while (el.firstChild) el.removeChild(el.firstChild)
  if (text) el.appendChild(el.ownerDocument!.createTextNode(text))
}

function rewriteTextNodes(node: Node, find: LineFinder): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      const text = child.nodeValue ?? ''
      const next = applySpans(text, find(text, null))
      if (next !== text) child.nodeValue = next
    } else if (child.nodeType === 1) {
      rewriteTextNodes(child, find)
    }
  }
}

function removeElements(doc: Document, names: Set<string>): void {
  for (const el of descendants(doc, '*')) {
    if (names.has(el.localName!) && el.parentNode) el.parentNode.removeChild(el)
  }
}

function removeRelationships(doc: Document, match: (rel: Element) => boolean): void {
  for (const rel of descendants(doc, 'Relationship')) {
    if (match(rel) && rel.parentNode) rel.parentNode.removeChild(rel)
  }
}

/** Keep the XML declaration Word wrote; the serializer may drop it. */
function writeXml(original: string, doc: Document): string {
  const out = serializeXml(doc)
  const decl = /^\s*<\?xml[^>]*\?>/.exec(original)?.[0]
  return decl && !out.startsWith('<?xml') ? `${decl.trim()}\r\n${out}` : out
}

async function editXml(
  zip: JSZip,
  path: string,
  edit: (doc: Document) => void
): Promise<void> {
  const file = zip.file(path)
  if (!file) return
  const original = await file.async('string')
  const doc = parseXml(original)
  edit(doc)
  zip.file(path, writeXml(original, doc))
}

/**
 * Rewrite a Word document in place. Every paragraph of the body, headers, footers,
 * notes, comments and text boxes is passed through `find`; so are field codes and
 * external link targets. Formatting, tables and pictures stay as they are.
 *
 * With `scrub`, tracked changes are accepted (deleted text is gone), authors and
 * document properties are cleared, and the page thumbnail is removed.
 */
export async function rewriteDocx(
  filePath: string,
  find: LineFinder,
  options: { scrub: boolean }
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(filePath))
  const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir)

  const textParts = names.filter(
    (name) => textPartKind(name) != null || name === 'word/glossary/document.xml'
  )
  for (const path of textParts) {
    await editXml(zip, path, (doc) => {
      // Numbered before revisions are accepted, the way the reader numbered them
      const indexOf = new Map(readableParagraphs(doc).map((paragraph, i) => [paragraph, i]))
      if (options.scrub) {
        acceptRevisions(doc)
        scrubPeople(doc)
      }
      for (const paragraph of allParagraphs(doc)) {
        const index = indexOf.get(shownParagraph(paragraph))
        rewriteParagraph(paragraph, (line) => (index == null ? null : lineRef(path, index, line)), find)
      }
      rewriteFields(doc, find)
    })
  }

  for (const path of names.filter((name) => /^word\/(glossary\/)?_rels\/.+\.rels$/.test(name))) {
    await editXml(zip, path, (doc) => {
      for (const rel of descendants(doc, 'Relationship')) {
        const target = rel.getAttribute('Target')
        if (rel.getAttribute('TargetMode') !== 'External' || !target) continue
        rel.setAttribute('Target', applySpans(target, find(target, null)))
      }
    })
  }

  if (options.scrub) await scrubPackage(zip, names, find)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function scrubPackage(zip: JSZip, names: string[], find: LineFinder): Promise<void> {
  await editXml(zip, 'word/people.xml', scrubPeople)
  await editXml(zip, 'docProps/core.xml', (doc) => clearText(doc, CORE_CLEAR))
  await editXml(zip, 'docProps/app.xml', (doc) => {
    clearText(doc, APP_CLEAR)
    for (const titles of descendants(doc, 'TitlesOfParts')) {
      for (const el of descendants(titles, 'lpstr')) setPlainText(el, '')
    }
  })
  await editXml(zip, 'docProps/custom.xml', (doc) => {
    for (const prop of descendants(doc, 'property')) {
      for (const value of elementChildren(prop)) setPlainText(value, '')
    }
  })

  // Template paths and document variables can carry user names and case data.
  await editXml(zip, 'word/settings.xml', (doc) =>
    removeElements(doc, new Set(['attachedTemplate', 'docVars']))
  )
  await editXml(zip, 'word/_rels/settings.xml.rels', (doc) =>
    removeRelationships(doc, (rel) => /\/attachedTemplate$/.test(rel.getAttribute('Type') ?? ''))
  )

  // Data behind bound content controls.
  for (const path of names.filter((name) => /^customXml\/item\d+\.xml$/.test(name))) {
    await editXml(zip, path, (doc) => rewriteTextNodes(doc, find))
  }

  // The saved first-page preview shows the original text.
  const thumbnails = names.filter((name) => /^docProps\/thumbnail\.[a-z]+$/i.test(name))
  for (const path of thumbnails) zip.remove(path)
  if (thumbnails.length > 0) {
    await editXml(zip, '_rels/.rels', (doc) =>
      removeRelationships(doc, (rel) => /thumbnail/i.test(rel.getAttribute('Target') ?? ''))
    )
    await editXml(zip, '[Content_Types].xml', (doc) => {
      for (const override of descendants(doc, 'Override')) {
        if (/thumbnail/i.test(override.getAttribute('PartName') ?? '') && override.parentNode) {
          override.parentNode.removeChild(override)
        }
      }
    })
  }
}
