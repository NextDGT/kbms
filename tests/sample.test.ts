import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractDocxText } from '../src/main/docxImport'
import { extractPdfText } from '../src/main/pdf'
import * as services from '../src/main/services'
import { skipTest, suite, test } from './harness'
import { pathOf, previewed, upload } from './support'

suite('sample.test.ts — gerçek belge (ornek-dosyalar, repoda yok)')

// A real indictment kept out of git; the test runs only where the file exists.
const SAMPLE = join(process.cwd(), 'ornek-dosyalar', '785977685-NARI-N-GU-RAN-I-DDI-ANAMESI.pdf')

if (!existsSync(SAMPLE)) {
  skipTest('örnek iddianame', 'ornek-dosyalar/ içinde yok')
} else {
  test('örnek iddianame: önizleme = DOCX çıktısı; konumlu PDF tüm sayfaları ve satırları korur; geri yükleme tokensız', async () => {
    const original = await upload(SAMPLE)
    const start = await services.startEncoding(original.id)
    const preview = services.previewEncoding(original.id, start.keys, [])

    const { document: docx } = await services.produceEncoded(original.id, start.keys, [], 'docx')
    assert.equal((await extractDocxText(pathOf(docx.id))).text, previewed(start.text, preview.spans))

    const source = await extractPdfText(SAMPLE)
    const { document: pdf } = await services.produceEncoded(original.id, start.keys, [], 'pdf')
    const out = await extractPdfText(pathOf(pdf.id))
    assert.equal(out.pageCount, source.pageCount)
    assert.equal(out.blocks.length, source.blocks.length)

    const restored = await services.restoreFromFile(pdf.id, pathOf(pdf.id))
    assert.ok(!/\[[A-Z]+_\d+\]/.test(services.getDocumentDetail(restored.id).text))
  })
}
