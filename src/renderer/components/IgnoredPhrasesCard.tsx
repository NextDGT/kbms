import { FormEvent, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { IgnoredPhrase } from '@shared/types'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'

/** Phrases kept out of every anonymization ("Türk Ceza Kanunu"). */
export function IgnoredPhrasesCard() {
  const [phrases, setPhrases] = useState<IgnoredPhrase[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.kbms.ignored
      .list()
      .then(setPhrases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Yüklenemedi'))
  }, [])

  async function run(action: () => Promise<IgnoredPhrase[]>) {
    setBusy(true)
    setError('')
    try {
      setPhrases(await action())
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem başarısız')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await run(() => window.kbms.ignored.add(draft))) setDraft('')
  }

  return (
    <Card className="mt-8 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-ink-950">Yok sayılan ifadeler</h2>
        <p className="mt-1 text-sm text-ink-600">
          Bu ifadeler her anonimleştirmede olduğu gibi kalır; içlerindeki kelimeler token’a çevrilmez.
          Örnek: “Türk Ceza Kanunu” içindeki “Türk” soyad sayılmaz.
        </p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => void add(e)}>
        <Input
          placeholder="İfade ekle"
          aria-label="Yok sayılacak ifade"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={busy || draft.trim().length < 2}>
          Ekle
        </Button>
      </form>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {phrases.length === 0 ? (
        <p className="text-sm text-ink-500">Henüz ifade yok.</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {phrases.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-ink-900">{item.phrase}</span>
              <button
                type="button"
                className="rounded-md p-1.5 text-ink-300 hover:bg-red-50 hover:text-red-600"
                aria-label={`${item.phrase} ifadesini sil`}
                title="Sil"
                disabled={busy}
                onClick={() => void run(() => window.kbms.ignored.remove(item.id))}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
