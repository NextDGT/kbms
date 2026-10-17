import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractDocxText } from '../src/main/docxImport'
import { extractPdfText } from '../src/main/pdf'
import * as services from '../src/main/services'
import { suite, test } from './harness'
import {
  fixturesDir,
  keyFor,
  pathOf,
  previewed,
  upload,
  writePdf,
  writeScannedPdf,
  type PdfLine
} from './support'

suite('pdf.test.ts — PDF okuma, konumlu çıktı, geri yükleme')

/** A form-like page: bold labels in one column, values in another; Turkish letters; a second page. */
const PAGES: PdfLine[][] = [
  [
    { text: 'DAVACI', x: 72, y: 760, bold: true },
    { text: ': Ahmet TÜRK', x: 250, y: 760 },
    { text: 'TELEFON', x: 72, y: 740, bold: true },
    { text: ': 0532 123 45 67', x: 250, y: 740 },
    { text: 'Türk Ceza Kanunu uygulanır; TCKN 10000000146.', x: 72, y: 700 },
    { text: 'Şüpheli İbrahim ÇAKIR, ğüşıöç harfleri.', x: 72, y: 680 }
  ],
  [{ text: 'İkinci sayfa: Ahmet TÜRK', x: 100, y: 500 }]
]

async function encodePdf() {
  const original = await upload(await writePdf('form.pdf', PAGES))
  const start = await services.startEncoding(original.id)
  return { original, start }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1.5

test('PDF satırları sütun parçaları, konum ve kalınlıkla okunur', async () => {
  const { original, start } = await encodePdf()
  const { blocks } = await extractPdfText(pathOf(original.id))
  assert.equal(start.pageCount, 2)
  const first = blocks[0]!
  assert.equal(first.text, 'DAVACI : Ahmet TÜRK')
  assert.deepEqual(
    first.position!.runs.map((r) => [Math.round(r.x), r.bold]),
    [
      [72, true],
      [250, false]
    ]
  )
  assert.ok(start.text.includes('ğüşıöç'))
})

test('konumlu PDF: sayfa, sütun ve kalınlık korunur; anahtar değerleri kalmaz; Türkçe harfler korunur', async () => {
  const { original, start } = await encodePdf()
  const { document: anon } = await services.produceEncoded(original.id, start.keys, [], 'pdf')
  assert.equal(anon.format, 'pdf')
  const out = await extractPdfText(pathOf(anon.id))
  assert.equal(out.pageCount, 2)
  const first = out.blocks[0]!
  assert.ok(first.text.startsWith('DAVACI : [AD_1]'), first.text)
  assert.ok(near(first.position!.runs[0]!.x, 72) && first.position!.runs[0]!.bold, 'etiket yerinde ve kalın')
  assert.ok(near(first.position!.runs[1]!.x, 250) && !first.position!.runs[1]!.bold, 'değer sütunu yerinde')
  for (const key of start.keys) assert.ok(!out.text.includes(key.original), `kalmamalı: ${key.original}`)
  assert.ok(out.text.includes('uygulanır') && out.text.includes('ğüşıöç'))
})

test('PDF’ten DOCX: önizleme ile birebir aynı; yok sayılan yer korunur', async () => {
  const { original, start } = await encodePdf()
  const tckn = services.previewEncoding(original.id, start.keys, []).spans.find((s) => s.token === '[TCKN_1]')!
  const key = keyFor(start.keys, tckn.token)
  const skips = [{ start: tckn.start, end: tckn.end, kind: key.kind, value: key.original }]
  const preview = services.previewEncoding(original.id, start.keys, skips)
  const { document } = await services.produceEncoded(original.id, start.keys, skips, 'docx')
  const out = (await extractDocxText(pathOf(document.id))).text
  assert.equal(out, previewed(start.text, preview.spans))
  assert.ok(out.includes('10000000146'), 'yok sayılan TCKN kalır')
})

test('dönen PDF geri yüklenir: tokenlar çözülür, metin özgünüyle aynı olur', async () => {
  const { original, start } = await encodePdf()
  const { document: anon } = await services.produceEncoded(original.id, start.keys, [], 'pdf')
  const restored = await services.restoreFromFile(anon.id, pathOf(anon.id))
  assert.equal(restored.format, 'pdf')
  const text = (await extractPdfText(pathOf(restored.id))).text
  assert.equal(text, start.text)
})

test('taranmış PDF OCR ile okunur: satırlar yerinde, kişisel veri bulunur, uyarı verilir', async () => {
  const original = await upload(
    await writeScannedPdf('tarama.pdf', [
      [
        { text: 'DAVACI', x: 72, y: 760, size: 12, bold: true },
        { text: ': Ahmet TÜRK', x: 250, y: 760, size: 12 },
        { text: 'Şüpheli İbrahim ÇAKIR, TCKN 10000000146.', x: 72, y: 720, size: 12 },
        { text: 'IBAN TR33 0006 1005 1978 6457 8413 26', x: 72, y: 700, size: 12 }
      ],
      [{ text: 'İkinci sayfa: Ahmet TÜRK', x: 100, y: 500, size: 12 }]
    ])
  )
  const start = await services.startEncoding(original.id)
  assert.equal(start.pageCount, 2)
  const lines = start.text.split('\n')
  assert.equal(lines[0], 'DAVACI : Ahmet TÜRK')
  assert.ok(start.text.includes('Şüpheli İbrahim ÇAKIR'), start.text)
  assert.ok(start.warnings.some((w) => /OCR/.test(w) && w.includes('1, 2')), start.warnings.join(' | '))
  const tokens = start.keys.map((k) => k.token)
  for (const token of ['[AD_1]', '[SOYAD_1]', '[TCKN_1]', '[IBAN_1]']) {
    assert.ok(tokens.includes(token), `${token} bulunmalı: ${tokens.join(', ')}`)
  }

  const { blocks } = await extractPdfText(pathOf(original.id))
  const first = blocks[0]!.position!
  assert.equal(first.page, 1)
  assert.ok(Math.abs(first.y - 760) < 3, `satır yüksekliği: ${first.y}`)
  assert.ok(Math.abs(first.runs[0]!.x - 72) < 3, `satır başı: ${first.runs[0]!.x}`)
  assert.ok(Math.abs(blocks[0]!.fontSize - 12) <= 2, `yazı boyu: ${blocks[0]!.fontSize}`)

  const { document: anon } = await services.produceEncoded(original.id, start.keys, [], 'pdf')
  const out = await extractPdfText(pathOf(anon.id))
  for (const key of start.keys) assert.ok(!out.text.includes(key.original), `kalmamalı: ${key.original}`)
  assert.ok(out.text.startsWith('DAVACI : [AD_1]'), out.text)
})

test('okunabilir metni olmayan PDF ve desteklenmeyen dosya reddedilir', async () => {
  const blank = await writePdf('bos.pdf', [[]])
  await assert.rejects(upload(blank), /okunabilir metin/)
  const txt = join(fixturesDir(), 'not.txt')
  writeFileSync(txt, 'Ahmet')
  await assert.rejects(upload(txt), /Yalnızca PDF veya DOCX/)
})
