import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Download, FileText, FileUp, KeyRound, RefreshCcw } from 'lucide-react'
import type { DocumentDetail, DocumentRecord } from '@shared/types'
import { EncodingWizard, type EncodingStart } from '../components/EncodingWizard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ROLE_LABEL, roleTone } from '../lib/documents'

interface Props {
  documentId: number
  onBack: () => void
  onOpenDocument: (documentId: number) => void
}

/** What this document is, in the words of the folder workflow. */
function roleSummary(doc: DocumentRecord): string {
  if (doc.role === 'original') {
    return 'Yüklenen orijinal belge. Anonimleştirme bu belgeden başlar; her anonimleştirme yeni bir anonim belge yazar.'
  }
  if (doc.role === 'encoded') {
    return 'Üretilen anonim belge. Üçüncü tarafa yalnızca bu dosya verilir; anahtarlar bu kayıtta şifreli durur ve pakete girmez. Dönen PDF veya DOCX buradan geri yüklenir.'
  }
  if (doc.role === 'returned') {
    return 'Üçüncü taraftan dönen anonim belge. Token’lar kaynak anonim belgenin anahtarlarıyla çözüldü.'
  }
  return 'Dönen belgenin token’ları çözülmüş hali.'
}

type DetailKind = 'original' | 'anon' | 'incoming'

function detailKind(doc: DocumentRecord): DetailKind {
  if (doc.role === 'original') return 'original'
  return doc.role === 'encoded' ? 'anon' : 'incoming'
}

const DERIVED_TITLE: Record<DetailKind, string> = {
  original: 'Üretilen anonim belgeler',
  anon: 'Dönen belgeler',
  incoming: 'Geri yüklenmiş belge'
}

const DERIVED_EMPTY: Record<DetailKind, string> = {
  original: 'Henüz anonim belge üretilmedi.',
  anon: 'Henüz dönen belge yüklenmedi.',
  incoming: 'Geri yüklenmiş belge yok.'
}

function isCancel(msg: string): boolean {
  return msg === 'USER_CANCELLED'
}

export function DocumentDetailPage({ documentId, onBack, onOpenDocument }: Props) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [wizard, setWizard] = useState<EncodingStart | null>(null)
  const [exportAck, setExportAck] = useState(false)

  useEffect(() => {
    setDetail(null)
    setWizard(null)
    setError('')
    void window.kbms.docs
      .get(documentId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Belge açılamadı'))
  }, [documentId])

  async function startEncoding() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setWizard(await window.kbms.docs.startEncoding(documentId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anonimleştirme başlatılamadı')
    } finally {
      setBusy(false)
    }
  }

  async function exportEncoded() {
    if (!exportAck) {
      const ok = window.confirm(
        'Bu paket üçüncü tarafa verilebilir.\n\nGeri dönüş anahtarları pakete dahil değildir; yalnızca anonim metin dışa aktarılır (KVKK).\n\nDevam edilsin mi?'
      )
      if (!ok) return
      setExportAck(true)
    }
    setError('')
    setNotice('Paket kaydediliyor…')
    try {
      const result = await window.kbms.docs.exportEncoded(documentId)
      setNotice(
        result.fallback
          ? `Kayıt diyaloğu kullanılamadı; dosya İndirilenler’e yazıldı:\n${result.path}`
          : `Üçüncü taraf paketi kaydedildi:\n${result.path}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export başarısız'
      setNotice('')
      if (!isCancel(msg)) setError(msg)
    }
  }

  async function restoreIncoming() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const doc = await window.kbms.docs.restore(documentId)
      onOpenDocument(doc.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Geri yükleme başarısız'
      if (!isCancel(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function exportRestored() {
    setError('')
    setNotice('Kaydediliyor…')
    try {
      const result = await window.kbms.docs.exportRestored(documentId)
      setNotice(
        result.fallback
          ? `Kayıt diyaloğu kullanılamadı; dosya İndirilenler’e yazıldı:\n${result.path}`
          : `Geri yüklenmiş belge kaydedildi:\n${result.path}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kayıt başarısız'
      setNotice('')
      if (!isCancel(msg)) setError(msg)
    }
  }

  const doc = detail?.document

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <Button variant="ghost" className="mb-2 -ml-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Klasöre dön
        </Button>
        {doc ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-950">{doc.name}</h1>
              <Badge tone={roleTone(doc)}>{ROLE_LABEL[doc.role]}</Badge>
              <span className="text-xs uppercase tracking-wide text-ink-400">{doc.format}</span>
            </div>
            <p className="mt-1 text-sm text-ink-500">Eklendi {doc.createdAt}</p>
            <p className="mt-2 max-w-3xl text-sm text-ink-600">{roleSummary(doc)}</p>
          </>
        ) : null}
      </div>

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50/80 text-red-800 whitespace-pre-wrap">
          {error}
        </Card>
      ) : null}
      {notice ? (
        <Card className="mb-4 border-veil-200 bg-veil-50/80 text-veil-900 whitespace-pre-wrap">
          {notice}
        </Card>
      ) : null}

      {!detail ? (
        error ? null : <p className="text-ink-500">Yükleniyor…</p>
      ) : wizard ? (
        <EncodingWizard
          documentId={documentId}
          start={wizard}
          onCancel={() => setWizard(null)}
          onProduced={(id) => {
            setWizard(null)
            onOpenDocument(id)
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-display text-xl text-ink-900">
              <FileText className="h-5 w-5 text-veil-700" />
              Metin
            </h2>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-100 bg-sand-50/50 p-4 font-mono text-xs leading-relaxed text-ink-800">
              {detail.text || 'Metin yok.'}
            </pre>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-3">
              <h2 className="font-display text-xl text-ink-900">İşlemler</h2>
              {detail.document.role === 'original' ? (
                <Button className="w-full" disabled={busy} onClick={() => void startEncoding()}>
                  <FileUp className="h-4 w-4" />
                  Anonimleştir
                </Button>
              ) : null}
              {detail.document.role === 'encoded' ? (
                <>
                  <label className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-ink-800">
                    <input
                      className="mt-0.5"
                      type="checkbox"
                      checked={exportAck}
                      onChange={(e) => setExportAck(e.target.checked)}
                    />
                    <span>
                      Bu paket üçüncü tarafa verilebilir. Geri dönüş anahtarları pakete dahil
                      değildir; yalnızca anonim metin dışa aktarılır (KVKK).
                    </span>
                  </label>
                  <Button className="w-full" disabled={busy} onClick={() => void exportEncoded()}>
                    <Download className="h-4 w-4" />
                    Üçüncü taraf export
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void restoreIncoming()}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Dönen belgeyi geri yükle
                  </Button>
                </>
              ) : null}
              {detail.document.role === 'returned' ? (
                <p className="text-sm text-ink-500">
                  Bu belge için işlem yok. Çözülmüş hali geri yüklenmiş belgededir.
                </p>
              ) : null}
              {detail.document.role === 'restored' ? (
                <Button className="w-full" disabled={busy} onClick={() => void exportRestored()}>
                  <Download className="h-4 w-4" />
                  Geri yüklenmişi indir
                </Button>
              ) : null}
            </Card>

            {detail.source ? (
              <RelatedCard title="Kaynak belge" docs={[detail.source]} onOpen={onOpenDocument} />
            ) : null}
            {detail.document.role !== 'restored' ? (
              <RelatedCard
                title={DERIVED_TITLE[detailKind(detail.document)]}
                docs={detail.derived}
                empty={DERIVED_EMPTY[detailKind(detail.document)]}
                onOpen={onOpenDocument}
              />
            ) : null}

            {detail.keys.length > 0 ? (
              <Card>
                <h2 className="mb-3 flex items-center gap-2 font-display text-xl text-ink-900">
                  <KeyRound className="h-5 w-5 text-veil-700" />
                  Bu belgedeki anahtarlar
                </h2>
                <ul className="grid gap-2">
                  {detail.keys.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.token}`}
                      className="rounded-lg border border-ink-100 bg-sand-50/50 px-3 py-2 font-mono text-xs text-ink-700"
                    >
                      <span className="text-veil-700">{entry.token}</span>
                      <span className="mx-2 text-ink-300">←</span>
                      <span>{entry.original}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function RelatedCard({
  title,
  docs,
  empty,
  onOpen
}: {
  title: string
  docs: DocumentRecord[]
  empty?: string
  onOpen: (documentId: number) => void
}) {
  return (
    <Card>
      <h2 className="mb-3 font-display text-xl text-ink-900">{title}</h2>
      {docs.length === 0 ? (
        <p className="text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink-100 bg-white px-3 py-2 text-left text-sm hover:bg-sand-50"
                onClick={() => onOpen(doc.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink-900">{doc.name}</span>
                  <span className="text-xs text-ink-500">{doc.createdAt}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
