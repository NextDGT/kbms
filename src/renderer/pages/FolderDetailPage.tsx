import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, FileText, Pencil, Upload, X } from 'lucide-react'
import type { DocumentRecord, FolderRecord } from '@shared/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { ROLE_LABEL, roleTone } from '../lib/documents'

interface Props {
  folderId: number
  onBack: () => void
  onOpenDocument: (documentId: number) => void
}

export function FolderDetailPage({ folderId, onBack, onOpenDocument }: Props) {
  const [folderInfo, setFolderInfo] = useState<FolderRecord | null>(null)
  const [docs, setDocs] = useState<DocumentRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** Title being typed while renaming; null when not renaming. */
  const [titleDraft, setTitleDraft] = useState<string | null>(null)

  async function refresh() {
    const folders = await window.kbms.folders.list()
    setFolderInfo(folders.find((folder) => folder.id === folderId) ?? null)
    setDocs(await window.kbms.docs.list(folderId))
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Hata'))
  }, [folderId])

  async function saveTitle() {
    const title = titleDraft?.trim()
    if (!title) return
    if (title === folderInfo?.title) {
      setTitleDraft(null)
      return
    }
    setError('')
    setBusy(true)
    try {
      setFolderInfo(await window.kbms.folders.rename(folderId, title))
      setTitleDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Klasör adı değiştirilemedi')
    } finally {
      setBusy(false)
    }
  }

  async function upload() {
    setError('')
    setBusy(true)
    try {
      const { document } = await window.kbms.docs.upload(folderId)
      onOpenDocument(document.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Yükleme başarısız'
      if (msg === 'USER_CANCELLED') return
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Button variant="ghost" className="mb-2 -ml-2" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Klasörlere dön
          </Button>
          {titleDraft == null ? (
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-950">
                {folderInfo?.title ?? 'Klasör'}
              </h1>
              <Button
                variant="ghost"
                aria-label="Klasör adını düzenle"
                title="Klasör adını düzenle"
                disabled={!folderInfo || busy}
                onClick={() => setTitleDraft(folderInfo?.title ?? '')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                void saveTitle()
              }}
            >
              <Input
                autoFocus
                aria-label="Klasör adı"
                className="w-72 text-lg font-semibold"
                value={titleDraft}
                maxLength={120}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTitleDraft(null)
                }}
              />
              <Button
                type="submit"
                variant="ghost"
                aria-label="Kaydet"
                title="Kaydet"
                disabled={busy || !titleDraft.trim()}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label="Vazgeç"
                title="Vazgeç"
                onClick={() => setTitleDraft(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </form>
          )}
          <p className="mt-1 text-sm text-ink-500">
            {docs.length} belge
          </p>
        </div>
        <Button disabled={busy} onClick={() => void upload()}>
          <Upload className="h-4 w-4" />
          Belge yükle
        </Button>
      </div>

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50/80 text-red-800 whitespace-pre-wrap">
          {error}
        </Card>
      ) : null}

      <h2 className="mb-3 font-display text-2xl text-ink-900">Klasördeki belgeler</h2>
      {docs.length === 0 ? (
        <Card>
          <p className="text-ink-600">Bu klasörde henüz belge yok. PDF veya DOCX yükleyin.</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => onOpenDocument(doc.id)}
              >
                <Card className="flex items-center justify-between gap-4 py-4 transition-colors hover:border-veil-300 hover:bg-white">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-veil-600" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-medium text-ink-900">{doc.name}</h3>
                        <Badge tone={roleTone(doc)}>{ROLE_LABEL[doc.role]}</Badge>
                        <span className="text-xs uppercase tracking-wide text-ink-400">
                          {doc.format}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-500">{doc.createdAt}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
