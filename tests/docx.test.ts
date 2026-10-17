import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  ImageRun,
  InsertedTextRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  Textbox
} from 'docx'
import JSZip from 'jszip'
import { extractDocxText } from '../src/main/docxImport'
import * as services from '../src/main/services'
import { suite, test } from './harness'
import { fixturesDir, leaks, pathOf, upload, writeDocx, xmlParts, zipNames } from './support'

suite('docx.test.ts — Word belgesi yerinde')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** Personal data placed in every corner of a Word package: body, header, footer, notes, comments, text box, link, properties, revisions. */
const SECRETS = ['Ahmet', 'AHMET', 'YILMAZ', 'Yılmaz', '10000000146', 'ahmet@ornek.com', 'SİLİNMİŞ', 'Ayşe', 'KAYA', 'Gizli Ltd']

function richDocument(): Document {
  return new Document({
    creator: 'Ahmet Yılmaz',
    lastModifiedBy: 'Ahmet Yılmaz',
    title: 'Ahmet YILMAZ dosyası',
    description: 'Gizli Ltd',
    comments: {
      children: [
        {
          id: 0,
          author: 'Ahmet Yılmaz',
          initials: 'AY',
          date: new Date(),
          children: [new Paragraph('Ayşe KAYA ile görüşüldü')]
        }
      ]
    },
    footnotes: { 1: { children: [new Paragraph('Dipnot: Ayşe KAYA beyanı.')] } },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph('Dosya sahibi: Ahmet YILMAZ')] }) },
        footers: { default: new Footer({ children: [new Paragraph('İletişim ahmet@ornek.com')] }) },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'DİLEKÇE', bold: true, size: 32, color: 'C00000', font: 'Times New Roman' })]
          }),
          new Paragraph({
            children: [
              new TextRun('Davacı '),
              new TextRun({ text: 'Ah', italics: true }),
              new TextRun({ text: 'met', bold: true }),
              new TextRun(' YILMAZ'),
              new FootnoteReferenceRun(1),
              new TextRun(' adına '),
              new InsertedTextRun({ text: 'eklenen ', id: 1, author: 'Ahmet Yılmaz', date: '2026-01-01T00:00:00Z' }),
              new DeletedTextRun({ text: 'SİLİNMİŞ Ahmet', id: 2, author: 'Ahmet Yılmaz', date: '2026-01-01T00:00:00Z' }),
              new TextRun('başvuru.')
            ]
          }),
          new Paragraph({
            children: [
              new CommentRangeStart(0),
              new TextRun('Yorumlu metin'),
              new CommentRangeEnd(0),
              new TextRun({ children: [new CommentReference(0)] })
            ]
          }),
          new Paragraph({
            indent: { left: 720 },
            children: [
              new TextRun('E-posta: '),
              new ExternalHyperlink({
                link: 'mailto:ahmet@ornek.com',
                children: [new TextRun({ text: 'ahmet@ornek.com', style: 'Hyperlink' })]
              })
            ]
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('TCKN')] }),
                  new TableCell({ children: [new Paragraph('10000000146')] })
                ]
              })
            ]
          }),
          new Paragraph({ children: [new ImageRun({ type: 'png', data: PNG, transformation: { width: 20, height: 20 } })] }),
          new Textbox({
            alignment: AlignmentType.LEFT,
            style: { width: '200pt', height: '50pt' },
            children: [new Paragraph('Kutu: Ayşe KAYA')]
          })
        ]
      }
    ]
  })
}

async function anonymizeRich() {
  const source = await writeDocx('zengin.docx', richDocument())
  const original = await upload(source)
  const start = await services.startEncoding(original.id)
  const { document: anon } = await services.produceEncoded(original.id, start.keys, [], 'docx')
  return { source, original, start, anon }
}

test('kaynak belge gerçekten her köşede kişisel veri taşıyor (test kendini doğrular)', async () => {
  const source = await writeDocx('zengin.docx', richDocument())
  const { parts } = await xmlParts(source)
  for (const part of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'word/footnotes.xml', 'word/comments.xml', 'docProps/core.xml']) {
    assert.ok(leaks(new Map([[part, parts.get(part) ?? '']]), SECRETS).length > 0, `${part} veri içermeli`)
  }
})

test('sihirbaz metni üst/alt bilgi, dipnot, yorum ve metin kutusunu gösterir; görsel uyarısı verir', async () => {
  const source = await writeDocx('zengin.docx', richDocument())
  const original = await upload(source)
  const start = await services.startEncoding(original.id)
  for (const part of ['Dosya sahibi: Ahmet YILMAZ', 'İletişim ahmet@ornek.com', 'Dipnot: Ayşe KAYA', 'Ayşe KAYA ile görüşüldü', 'Kutu: Ayşe KAYA']) {
    assert.ok(start.text.includes(part), `metinde olmalı: ${part}`)
  }
  assert.ok(!start.text.includes('SİLİNMİŞ'), 'silinmiş revizyon gösterilmez')
  assert.ok(start.warnings.some((w) => w.includes('görsel')))
})

test('anonim DOCX’in hiçbir XML parçasında özgün değer kalmaz', async () => {
  const { anon } = await anonymizeRich()
  const { parts, broken } = await xmlParts(pathOf(anon.id))
  assert.deepEqual(broken, [], 'bozuk XML yok')
  assert.deepEqual(leaks(parts, SECRETS), [])
})

test('biçim, tablo ve görsel korunur; revizyonlar kabul edilir; yazar ve özellikler temizlenir', async () => {
  const { anon } = await anonymizeRich()
  const { parts } = await xmlParts(pathOf(anon.id))
  const body = parts.get('word/document.xml')!
  assert.ok(body.includes('C00000') && body.includes('Times New Roman'), 'başlık rengi ve yazı tipi')
  assert.ok(body.includes('<w:tbl>'), 'tablo')
  assert.ok((await zipNames(pathOf(anon.id))).some((n) => n.startsWith('word/media/')), 'görsel')
  assert.ok(!/<w:(ins|del) /.test(body), 'revizyon işareti kalmaz')
  assert.ok(body.includes('eklenen'), 'eklenen metin kabul edilir')
  for (const [name, xml] of parts) {
    for (const m of xml.matchAll(/w:author="([^"]*)"/g)) assert.equal(m[1], 'Anonim', `${name} yazarı`)
  }
  assert.match(parts.get('docProps/core.xml')!, /<dc:creator\/>/)
})

test('anonim metin tokenlarla yazılır', async () => {
  const { anon } = await anonymizeRich()
  const text = (await extractDocxText(pathOf(anon.id))).text
  assert.ok(text.includes('Davacı [AD_1] [SOYAD_1] adına'), text)
  assert.ok(text.includes('[TCKN_1]'))
  assert.ok(text.includes('[EMAIL_1]'))
})

test('dönen DOCX geri yüklenir; Word’ün böldüğü token da çözülür ve biçim korunur', async () => {
  const { start, anon } = await anonymizeRich()
  // The third party bolds part of a token, so Word splits it across runs
  const zip = await JSZip.loadAsync(readFileSync(pathOf(anon.id)))
  const xml = await zip.file('word/document.xml')!.async('string')
  assert.ok(xml.includes('[SOYAD_1]'))
  zip.file('word/document.xml', xml.replace('[SOYAD_1]', '[SOY</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>AD_1]'))
  const returned = join(fixturesDir(), 'donen.docx')
  writeFileSync(returned, await zip.generateAsync({ type: 'nodebuffer' }))

  const restored = await services.restoreFromFile(anon.id, returned)
  assert.equal(restored.format, 'docx')
  const text = (await extractDocxText(pathOf(restored.id))).text
  assert.ok(!/\[[A-Z]+_\d+\]/.test(text), `token kalmamalı:\n${text}`)
  assert.ok(text.includes('Davacı Ahmet YILMAZ adına'))
  assert.ok(text.includes('Dosya sahibi: Ahmet YILMAZ'))
  const { parts } = await xmlParts(pathOf(restored.id))
  assert.ok(parts.get('word/document.xml')!.includes('C00000'), 'biçim korunur')
  assert.ok(start.keys.length > 0)
})

test('belge ilişkileri: orijinal → anonim → dönen → geri yüklenmiş', async () => {
  const { original, anon } = await anonymizeRich()
  const restored = await services.restoreFromFile(anon.id, pathOf(anon.id))
  const restoredDetail = services.getDocumentDetail(restored.id)
  const returned = restoredDetail.source!
  assert.equal(returned.role, 'returned')
  assert.equal(services.getDocumentDetail(returned.id).source?.id, anon.id)
  assert.equal(services.getDocumentDetail(anon.id).source?.id, original.id)
  assert.deepEqual(services.getDocumentDetail(original.id).derived.map((d) => d.id), [anon.id])
  await assert.rejects(services.restoreFromFile(original.id, pathOf(anon.id)), /anonim belgeden/)
})
