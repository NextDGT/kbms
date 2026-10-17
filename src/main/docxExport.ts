import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import type { PdfBlock } from './pdfBlocks'

function paragraph(block: PdfBlock): Paragraph {
  const size = Math.max(16, Math.round((block.fontSize || 11) * 2))
  return new Paragraph({
    alignment: block.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    pageBreakBefore: block.pageBreakBefore || undefined,
    spacing: { after: Math.round(Math.max(0, block.spaceAfterPt) * 20) },
    indent:
      block.align === 'left' && block.indentPt > 1
        ? { left: Math.round(block.indentPt * 20) }
        : undefined,
    children: [
      new TextRun({
        text: block.text,
        font: 'Calibri',
        size,
        bold: block.bold
      })
    ]
  })
}

export async function buildDocx(blocks: PdfBlock[]): Promise<Buffer> {
  const children = blocks.filter((block) => block.text.trim()).map(paragraph)
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun('')] }))
  }
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 850, right: 850 }
          }
        },
        children
      }
    ]
  })
  return Buffer.from(await Packer.toBuffer(doc))
}
