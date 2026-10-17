import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { IgnoredPhrasesCard } from '../components/IgnoredPhrasesCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'

type NameKind = 'AD' | 'SOYAD'
type KindFilter = 'ALL' | NameKind

type Entry = {
  key: string
  kind: NameKind
  value: string
  source: 'initial' | 'custom'
  createdAt: string | null
}

export function NamesPage() {
  const [addKind, setAddKind] = useState<NameKind>('AD')
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  async function refresh() {
    setEntries(await window.kbms.dict.list())
  }

  useEffect(() => {
    void refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false))
  }, [])

  function openAdd() {
    setFormError('')
    setText('')
    setAddOpen(true)
  }

  function closeAdd() {
    if (busy) return
    setAddOpen(false)
    setFormError('')
    setText('')
  }

  useEffect(() => {
    if (!addOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAdd()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, busy])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    setNotice('')
    if (!text.trim()) {
      setFormError('En az bir isim girin')
      return
    }
    setBusy(true)
    try {
      const result = await window.kbms.dict.add(addKind, text)
      setText('')
      setKindFilter(addKind)
      setAddOpen(false)
      setNotice(
        result.added > 0
          ? `${result.added} isim eklendi${result.skipped ? ` · ${result.skipped} zaten vardı` : ''}`
          : result.skipped
            ? 'Hepsi zaten listede'
            : 'Eklenecek isim yok'
      )
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Eklenemedi')
    } finally {
      setBusy(false)
    }
  }

  async function remove(key: string) {
    setError('')
    setNotice('')
    try {
      await window.kbms.dict.remove(key)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi')
    }
  }

  async function reset() {
    if (
      !confirm(
        'Ad ve soyad listesi başlangıç verisine dönecek. Eklediğiniz ve sildiğiniz isimler geri alınır.'
      )
    ) {
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await window.kbms.dict.reset()
      setText('')
      setQuery('')
      setKindFilter('ALL')
      setNotice('Liste başlangıç verisine alındı')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sıfırlanamadı')
    } finally {
      setBusy(false)
    }
  }

  const adCount = entries.filter((e) => e.kind === 'AD').length
  const soyadCount = entries.filter((e) => e.kind === 'SOYAD').length

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR')
    return entries.filter((e) => {
      if (kindFilter !== 'ALL' && e.kind !== kindFilter) return false
      if (!q) return true
      return e.value.toLocaleLowerCase('tr-TR').includes(q)
    })
  }, [entries, kindFilter, query])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Ad / soyad</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Tespitte kullanılan ad ve soyad listesi. Yeni isimler + ile eklenir. Sıfırla, listeyi
            başlangıç verisine döndürür.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{adCount} ad</Badge>
          <Badge tone="muted">{soyadCount} soyad</Badge>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reset()}>
            <RotateCcw className="h-4 w-4" />
            Sıfırla
          </Button>
        </div>
      </header>

      {notice ? <p className="mb-4 text-sm text-emerald-800">{notice}</p> : null}
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            className="pl-9"
            placeholder="İsim ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="İsim ara"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <KindButton active={kindFilter === 'ALL'} onClick={() => setKindFilter('ALL')}>
            Tümü
          </KindButton>
          <KindButton active={kindFilter === 'AD'} onClick={() => setKindFilter('AD')}>
            Ad
          </KindButton>
          <KindButton active={kindFilter === 'SOYAD'} onClick={() => setKindFilter('SOYAD')}>
            Soyad
          </KindButton>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink-900 text-sand-50 hover:bg-ink-800 disabled:opacity-50"
            aria-label="İsim ekle"
            title="İsim ekle"
            disabled={busy}
            onClick={openAdd}
          >
            <Plus className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-ink-500">Yükleniyor…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-ink-600">
            {entries.length === 0
              ? 'Liste boş. Sıfırla, başlangıç verisini geri yükler.'
              : 'Aramaya uyan kayıt yok.'}
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-200/80 bg-white/70 shadow-panel backdrop-blur">
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-ink-100 bg-sand-50/95 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">İsim</th>
                  <th className="px-4 py-3 font-medium">Tür</th>
                  <th className="px-4 py-3 font-medium">Kaynak</th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">İşlem</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.key} className="border-b border-ink-100 last:border-0 hover:bg-sand-50/60">
                    <td className="px-4 py-2.5 font-mono text-ink-900">{e.value}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={e.kind === 'AD' ? 'default' : 'muted'}>
                        {e.kind === 'AD' ? 'Ad' : 'Soyad'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={e.source === 'initial' ? 'muted' : 'ok'}>
                        {e.source === 'initial' ? 'Başlangıç' : 'Eklenen'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-ink-300 hover:bg-red-50 hover:text-red-600"
                        aria-label={`${e.value} kaydını sil`}
                        title="Sil"
                        onClick={() => void remove(e.key)}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
            {filtered.length} kayıt
            {filtered.length !== entries.length ? ` · toplam ${entries.length}` : ''}
          </p>
        </div>
      )}

      <IgnoredPhrasesCard />

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/45"
            aria-label="Kapat"
            onClick={closeAdd}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-names-title"
            className="relative w-full max-w-lg rounded-xl border border-ink-200 bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="add-names-title" className="text-lg font-semibold text-ink-950">
                  İsim ekle
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  Her satıra bir isim. Virgül ve noktalı virgül de ayırır. Adlar Title Case ya da
                  büyük harf, soyadlar büyük harf olarak kaydedilir.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                aria-label="Kapat"
                onClick={closeAdd}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
              <div className="flex flex-wrap gap-2">
                <KindButton active={addKind === 'AD'} onClick={() => setAddKind('AD')}>
                  Ad
                </KindButton>
                <KindButton active={addKind === 'SOYAD'} onClick={() => setAddKind('SOYAD')}>
                  Soyad
                </KindButton>
              </div>
              <textarea
                className="min-h-[180px] w-full resize-y rounded-lg border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 outline-none ring-veil-400/40 placeholder:text-ink-400 focus:ring-2"
                placeholder={
                  addKind === 'AD' ? 'Batuhan\nDoğuş\nNarin\nNahit' : 'Güran\nYılmaz\nDemir'
                }
                value={text}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                aria-label="Toplu isim listesi"
              />
              {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={closeAdd}>
                  Vazgeç
                </Button>
                <Button type="submit" disabled={busy}>
                  Listeye ekle
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function KindButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-veil-700 text-sand-50'
          : 'border border-ink-200 bg-white text-ink-700 hover:bg-sand-50'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
