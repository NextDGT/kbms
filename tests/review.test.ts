import assert from 'node:assert/strict'
import { Document, Header, Paragraph, Tab, TextRun } from 'docx'
import { addIgnoredPhrase } from '../src/main/dictService'
import { extractDocxText } from '../src/main/docxImport'
import * as services from '../src/main/services'
import type { KeySkip, MappingEntry, PreviewSpan } from '../src/shared/types'
import { renumberKeys, tokenNameError } from '../src/renderer/lib/keys'
import { suite, test } from './harness'
import { anySpelling, keyFor, pathOf, previewed, upload, writeDocx } from './support'

suite('review.test.ts — sihirbaz: önizleme, yok sayma, eşleme biçimi, token adı')

function paragraphs(...lines: string[]): Document {
  return new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] })
}

function skipOf(keys: MappingEntry[], span: PreviewSpan): KeySkip {
  const key = keyFor(keys, span.token)
  return { start: span.start, end: span.end, kind: key.kind, value: key.original }
}

/** Produce a DOCX and check its text is exactly the preview applied to the review text. */
async function assertOutputMatchesPreview(documentId: number, text: string, keys: MappingEntry[], skips: KeySkip[]) {
  const preview = services.previewEncoding(documentId, keys, skips)
  const { document } = await services.produceEncoded(documentId, keys, skips, 'docx')
  const out = (await extractDocxText(pathOf(document.id))).text
  assert.equal(out, previewed(text, preview.spans))
  return { preview, out }
}

test('ilk anahtarlar: soyad AA, ad Aa; değer o yazımla saklanır', async () => {
  const original = await upload(await writeDocx('v.docx', paragraphs('Türk Marşı okundu; Ahmet TÜRK kalktı. AHMET de vardı.')))
  const { keys } = await services.startEncoding(original.id)
  const soyad = keys.find((k) => k.kind === 'SOYAD')!
  const ad = keys.find((k) => k.kind === 'AD')!
  assert.equal(soyad.match, 'upper')
  assert.equal(soyad.original, 'TÜRK', 'ilk görülen "Türk" olsa da AA anahtarı büyük harfle saklanır')
  assert.equal(ad.match, 'title')
  assert.equal(ad.original, 'Ahmet')
})

test('eşleme biçimi: AA, Aa ve AA/Aa', async () => {
  const text = 'Davacı Ahmet TÜRK, Türk Ceza Kanunu uyarınca. Tanık Ayşe Türk.'
  const original = await upload(await writeDocx('m.docx', paragraphs(text)))
  const start = await services.startEncoding(original.id)
  const withMode = (mode: MappingEntry['match']) =>
    start.keys.map((k) => (k.kind === 'SOYAD' ? { ...k, match: mode } : { ...k, match: 'any' as const }))
  const run = (keys: MappingEntry[]) => previewed(start.text, services.previewEncoding(original.id, keys, []).spans)
  assert.equal(run(withMode('upper')), 'Davacı [AD_1] [SOYAD_1], Türk Ceza Kanunu uyarınca. Tanık [AD_2] Türk.')
  assert.equal(run(withMode('title')), 'Davacı [AD_1] TÜRK, [SOYAD_1] Ceza Kanunu uyarınca. Tanık [AD_2] [SOYAD_1].')
  assert.equal(run(withMode('any')), 'Davacı [AD_1] [SOYAD_1], [SOYAD_1] Ceza Kanunu uyarınca. Tanık [AD_2] [SOYAD_1].')
})

test('önizleme ile çıktı birebir aynı: sekmeyle başlayan satır, satır sonu, üst bilgi, konuma göre yok sayma', async () => {
  const doc = new Document({
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph('Başlık: Türk Ceza Kanunu ve Ahmet TÜRK')] }) },
        children: [
          new Paragraph('Davacı Ahmet TÜRK, Türk Ceza Kanunu’nun 37. maddesi.'),
          new Paragraph({ children: [new TextRun({ children: [new Tab(), 'Türk Ceza Kanunu ikinci kez; Ahmet TÜRK.'] })] }),
          new Paragraph({ children: [new TextRun('İlk satır Ahmet.'), new TextRun({ break: 1, text: 'Türk Ceza Kanunu üçüncü kez.' })] })
        ]
      }
    ]
  })
  const original = await upload(await writeDocx('konum.docx', doc))
  const start = await services.startEncoding(original.id)
  const keys = anySpelling(start.keys)
  const turks = services.previewEncoding(original.id, keys, []).spans.filter((s) => start.text.slice(s.start, s.end) === 'Türk')
  assert.equal(turks.length, 4)
  // Skip every "Türk Ceza Kanunu" except the one after the line break
  const lineOf = (pos: number) => start.text.slice(0, pos).split('\n').length - 1
  const lines = start.text.split('\n')
  const skips = turks.filter((s) => !lines[lineOf(s.start)]!.includes('üçüncü')).map((s) => skipOf(keys, s))
  const { preview, out } = await assertOutputMatchesPreview(original.id, start.text, keys, skips)
  assert.equal(preview.skipped.length, 3)
  assert.ok(out.includes('[SOYAD_1] Ceza Kanunu üçüncü kez.'))
  assert.ok(out.includes('Başlık: Türk Ceza Kanunu ve [AD_1] [SOYAD_1]'))
  assert.ok(out.includes('Türk Ceza Kanunu ikinci kez; [AD_1] [SOYAD_1].'))
})

test('yok sayma anahtara bağlı: aynı yeri başka anahtar alabilir, yeniden numaralandırmada korunur', async () => {
  const original = await upload(
    await writeDocx('mars.docx', paragraphs('Törende Türk Marşı okundu; Ahmet TÜRK kalktı.', 'Ayşe Türk oradaydı. Türk Marşı yine çalındı.'))
  )
  const start = await services.startEncoding(original.id)
  let keys = anySpelling(start.keys)
  const first = services.previewEncoding(original.id, keys, []).spans.find((s) => start.text.slice(s.start, s.end) === 'Türk')!
  const skips = [skipOf(keys, first)]
  const show = (k: MappingEntry[]) => previewed(start.text, services.previewEncoding(original.id, k, skips).spans)

  assert.ok(show(keys).startsWith('Törende Türk Marşı okundu; [AD_1] [SOYAD_1] kalktı.'))
  keys = [...keys, { kind: 'OZEL', token: '[OZEL_1]', original: 'Türk Marşı', match: 'any' }]
  assert.equal(show(keys), 'Törende [OZEL_1] okundu; [AD_1] [SOYAD_1] kalktı.\n[AD_2] [SOYAD_1] oradaydı. [OZEL_1] yine çalındı.')
  const renamed = keys.filter((k) => k.kind !== 'OZEL').map((k) => (k.kind === 'SOYAD' ? { ...k, token: '[SOYAD_9]' } : k))
  assert.ok(show(renamed).startsWith('Törende Türk Marşı okundu; [AD_1] [SOYAD_9] kalktı.'))
  await assertOutputMatchesPreview(original.id, start.text, keys, skips)
})

test('kalıcı yok sayılan ifade uygulanır; elle eklenen değer dedektör tanımasa da değişir', async () => {
  const original = await upload(await writeDocx('kalici.docx', paragraphs('Türk Medeni Kanunu ve Ahmet TÜRK. Dosya no 12345.')))
  const start = await services.startEncoding(original.id)
  addIgnoredPhrase('Türk Medeni Kanunu')
  const keys: MappingEntry[] = [
    ...anySpelling(start.keys),
    { kind: 'OZEL', token: '[OZEL_1]', original: '12345', match: 'any' }
  ]
  const { out } = await assertOutputMatchesPreview(original.id, start.text, keys, [])
  assert.equal(out, 'Türk Medeni Kanunu ve [AD_1] [SOYAD_1]. Dosya no [OZEL_1].')
})

test('hatalı anahtar ve yok sayma reddedilir', async () => {
  const original = await upload(await writeDocx('hata.docx', paragraphs('Ahmet TÜRK')))
  const { keys } = await services.startEncoding(original.id)
  assert.throws(() => services.previewEncoding(original.id, [...keys, { ...keys[0]!, token: '[AD_9]' }], []), /Aynı değer/)
  assert.throws(() => services.previewEncoding(original.id, [{ ...keys[0]!, token: '[SOYAD_1]' }], []), /Geçersiz token/)
  assert.throws(
    () => services.previewEncoding(original.id, keys, [{ start: 5, end: 2, kind: 'AD', value: 'x' }]),
    /Geçersiz yok sayma/
  )
})

test('özel maske kendi adını taşır; kurallar arayüzde ve ana süreçte uygulanır', async () => {
  const text = 'Törende Türk Marşı okundu; Ahmet TÜRK kalktı. Not: [ABC] etiketi.'
  const original = await upload(await writeDocx('ad.docx', paragraphs(text)))
  const start = await services.startEncoding(original.id)
  const named: MappingEntry = { kind: 'OZEL', token: '[XYZ]', original: 'Türk Marşı', match: 'any' }
  const keys = [...start.keys, named]

  assert.equal(tokenNameError('XYZ', start.keys, start.text), null)
  assert.match(tokenNameError('AD_7', start.keys, start.text)!, /başka bir türün/)
  assert.match(tokenNameError('ABC', start.keys, start.text)!, /belgede zaten/)
  assert.match(tokenNameError('XYZ', keys, start.text)!, /başka bir anahtarda/)

  for (const bad of ['[AD_7]', '[ABC]', '[X Y]']) {
    await assert.rejects(services.produceEncoded(original.id, [...start.keys, { ...named, token: bad }], [], 'docx'))
  }
  const renumbered = renumberKeys(keys, services.previewEncoding(original.id, keys, []).spans)
  assert.ok(renumbered.some((k) => k.token === '[XYZ]'), 'yeniden numaralandırma adı korur')

  const { document: anon } = await services.produceEncoded(original.id, keys, [], 'docx')
  assert.equal((await extractDocxText(pathOf(anon.id))).text, 'Törende [XYZ] okundu; [AD_1] [SOYAD_1] kalktı. Not: [ABC] etiketi.')
  const restored = await services.restoreFromFile(anon.id, pathOf(anon.id))
  assert.equal(services.getDocumentDetail(restored.id).text, text, 'geri yükleme özgün yazımı yazar')
})
