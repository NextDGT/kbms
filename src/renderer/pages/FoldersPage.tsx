import { FormEvent, useEffect, useState } from 'react'
import { Folder, Plus, Trash2, X } from 'lucide-react'
import type { FolderRecord } from '@shared/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'

interface Props {
  onOpen: (folderId: number) => void
}

export function FoldersPage({ onOpen }: Props) {
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      setFolders(await window.kbms.folders.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yüklenemedi')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen])

  function openCreate() {
    setTitle('')
    setFormError('')
    setCreateOpen(true)
  }

  function closeCreate() {
    setCreateOpen(false)
    setFormError('')
  }

  async function createFolder(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setFormError('Klasör adı girin')
      return
    }
    setBusy(true)
    setFormError('')
    try {
      const created = await window.kbms.folders.create(trimmed)
      onOpen(created.id)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Oluşturulamadı')
    } finally {
      setBusy(false)
    }
  }

  async function removeFolder(id: number) {
    if (!confirm('Klasör ve içindeki tüm belgeler silinecek. Emin misiniz?')) return
    await window.kbms.folders.delete(id)
    await refresh()
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Klasörler</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Klasör belgeleri bir arada tutar. Her anonimleştirme kendi token’larıyla ayrı bir anonim
            belge üretir.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink-900 text-sand-50 hover:bg-ink-800"
          aria-label="Yeni klasör"
          title="Yeni klasör"
          onClick={openCreate}
        >
          <Plus className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </header>

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50/80 text-red-800">{error}</Card>
      ) : null}

      {loading ? (
        <p className="text-ink-500">Yükleniyor…</p>
      ) : folders.length === 0 ? (
        <Card>
          <p className="text-ink-600">Henüz klasör yok. + ile ilk klasörünüzü oluşturun.</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {folders.map((folder) => (
            <li key={folder.id}>
              <Card className="flex flex-wrap items-center justify-between gap-4 py-4">
                <button
                  className="flex items-start gap-3 text-left"
                  type="button"
                  onClick={() => onOpen(folder.id)}
                >
                  <Folder className="mt-1 h-5 w-5 shrink-0 text-veil-600" />
                  <span>
                    <h2 className="font-display text-xl text-ink-900">{folder.title}</h2>
                    <p className="mt-1 text-sm text-ink-500">
                      Güncellendi {folder.updatedAt} · {folder.documentCount} belge
                    </p>
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <Badge tone="muted">{folder.documentCount} belge</Badge>
                  <Button variant="ghost" onClick={() => onOpen(folder.id)}>
                    Aç
                  </Button>
                  <Button variant="ghost" aria-label="Sil" onClick={() => void removeFolder(folder.id)}>
                    <Trash2 className="h-4 w-4 text-red-700" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/45"
            aria-label="Kapat"
            onClick={closeCreate}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-folder-title"
            className="relative w-full max-w-md rounded-xl border border-ink-200 bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="create-folder-title" className="text-lg font-semibold text-ink-950">
                Yeni klasör
              </h2>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                aria-label="Kapat"
                onClick={closeCreate}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-3" onSubmit={(e) => void createFolder(e)}>
              <Input
                autoFocus
                aria-label="Klasör adı"
                placeholder="Klasör adı"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={closeCreate}>
                  Vazgeç
                </Button>
                <Button type="submit" disabled={busy || !title.trim()}>
                  Oluştur
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
