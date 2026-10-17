import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { defaultMatch, identityKey } from '@shared/identity'
import type { DocumentFormat, IgnoredPhrase, KeySkip, MappingEntry, PreviewSpan } from '@shared/types'
import { findKey, isNameKind, nameValue, nextToken, renumberKeys } from '../lib/keys'
import { KeyPanel } from './KeyPanel'
import { TextAnnotator } from './TextAnnotator'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

/** What the main process returns when anonymization starts. */
export interface EncodingStart {
  text: string
  pageCount: number
  format: DocumentFormat
  warnings: string[]
  keys: MappingEntry[]
}

const OUTPUT_OPTIONS: Array<{ value: DocumentFormat; label: string; hint: string }> = [
  {
    value: 'docx',
    label: 'DOCX (düzenlenebilir)',
    hint: 'Satırlar paragraf olur; girinti, kalınlık ve hizalama korunur.'
  },
  {
    value: 'pdf',
    label: 'PDF (yerleşim korunur)',
    hint: 'Her satır sayfadaki yerine yazılır. Token isimden uzunsa satır sığacak kadar küçülür.'
  }
]

interface Props {
  documentId: number
  start: EncodingStart
  onCancel: () => void
  onProduced: (documentId: number) => void
}

/**
 * Review screen. Keys and ignored phrases are edited here; the marks in the text come
 * from the main process, computed by the same function that writes the output.
 */
export function EncodingWizard({ documentId, start, onCancel, onProduced }: Props) {
  const [keys, setKeys] = useState<MappingEntry[]>(start.keys)
  /** Places where one key is not applied, by position in the review text. */
  const [skips, setSkips] = useState<KeySkip[]>([])
  const [alwaysIgnored, setAlwaysIgnored] = useState<IgnoredPhrase[]>([])
  const [spans, setSpans] = useState<PreviewSpan[]>([])
  const [skipped, setSkipped] = useState<PreviewSpan[]>([])
  const [output, setOutput] = useState<DocumentFormat>('docx')
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewRun = useRef(0)

  useEffect(() => {
    void window.kbms.ignored
      .list()
      .then(setAlwaysIgnored)
      .catch((err) => setError(err instanceof Error ? err.message : 'Yok sayılan ifadeler okunamadı'))
  }, [])

  // Lasting phrases are read by the main process itself; refresh when they change too.
  useEffect(() => {
    const run = ++previewRun.current
    window.kbms.docs
      .preview(documentId, keys, skips)
      .then((next) => {
        if (run !== previewRun.current) return
        setSpans(next.spans)
        setSkipped(next.skipped)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Önizleme hesaplanamadı'))
  }, [documentId, keys, skips, alwaysIgnored])

  function addKey(kind: 'AD' | 'SOYAD' | 'OZEL', raw: string) {
    const value = isNameKind(kind) ? nameValue(raw) : raw.trim()
    if (!value) return
    const existing = findKey(keys, kind, value)
    if (existing) {
      setSelectedToken(existing.token)
      return
    }
    const token = nextToken(kind, keys)
    updateKeys([...keys, { kind, token, original: value, match: defaultMatch(kind) }])
    setSelectedToken(token)
    if (kind !== 'OZEL') {
      const parts = value.split(/\s+/).filter((part) => part.length >= 2)
      if (parts.length > 0) void window.kbms.dict.add(kind, parts.join('\n'))
    }
  }

  /**
   * Change the keys and keep skips with them: a key whose value was edited takes its
   * skips along; a removed key's skips go.
   */
  function updateKeys(next: MappingEntry[], renamed?: { from: MappingEntry; to: MappingEntry }) {
    const live = new Set(next.map((key) => identityKey(key.kind, key.original)))
    const from = renamed ? identityKey(renamed.from.kind, renamed.from.original) : null
    setKeys(next)
    setSkips((current) =>
      current
        .map((s) =>
          renamed && identityKey(s.kind, s.value) === from
            ? { ...s, kind: renamed.to.kind, value: renamed.to.original }
            : s
        )
        .filter((s) => live.has(identityKey(s.kind, s.value)))
    )
  }

  function removeKey(token: string) {
    updateKeys(keys.filter((key) => key.token !== token))
    if (selectedToken === token) setSelectedToken(null)
  }

  function skip(span: PreviewSpan) {
    const key = keys.find((k) => k.token === span.token)
    if (!key) return
    setSkips([...skips, { start: span.start, end: span.end, kind: key.kind, value: key.original }])
  }

  function unskip(span: PreviewSpan) {
    const key = keys.find((k) => k.token === span.token)
    if (!key) return
    const id = identityKey(key.kind, key.original)
    setSkips(
      skips.filter(
        (s) => !(identityKey(s.kind, s.value) === id && s.start < span.end && span.start < s.end)
      )
    )
  }

  async function ignoreAlways(phrase: string) {
    setError('')
    try {
      setAlwaysIgnored(await window.kbms.ignored.add(phrase))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İfade eklenemedi')
    }
  }

  async function removeAlwaysIgnored(id: number) {
    setError('')
    try {
      setAlwaysIgnored(await window.kbms.ignored.remove(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İfade kaldırılamadı')
    }
  }

  async function produce() {
    setBusy(true)
    setError('')
    try {
      const result = await window.kbms.docs.produce(documentId, keys, skips, output)
      onProduced(result.document.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anonimleştirme başarısız')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink-900">Anonimleştirme</h2>
          <p className="mt-1 text-sm text-ink-600">
            İşaretli yerler üretilen belgede token’a çevrilir; ekranda gördüğünüz çıktının
            kendisidir. Token’lar bu belgeye özeldir.
            {start.format === 'docx'
              ? ' Word belgesi yerinde değiştirilir: biçim, tablo ve görseller korunur; izlenen değişiklikler kabul edilir, yazar ve belge özellikleri temizlenir.'
              : ''}
            {start.pageCount ? ` · ${start.pageCount} sayfa` : ''}
          </p>
        </div>
        <Button variant="outline" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>

      {start.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-sm text-amber-900">
          {start.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50/80 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <TextAnnotator
          text={start.text}
          spans={spans}
          skipped={skipped}
          keys={keys}
          selectedToken={selectedToken}
          onSelectToken={setSelectedToken}
          onAddKey={addKey}
          onRemoveKey={removeKey}
          onSkip={skip}
          onUnskip={unskip}
          onIgnoreAlways={(phrase) => void ignoreAlways(phrase)}
          onRenumber={() => updateKeys(renumberKeys(keys, spans))}
        />

        <div className="space-y-3">
          <KeyPanel
            text={start.text}
            keys={keys}
            spans={spans}
            skipped={skipped}
            alwaysIgnored={alwaysIgnored}
            selectedToken={selectedToken}
            onSelect={setSelectedToken}
            onChange={updateKeys}
            onUnskip={unskip}
            onRemoveAlwaysIgnored={(id) => void removeAlwaysIgnored(id)}
          />
          {start.format === 'pdf' ? (
            <fieldset className="space-y-2 rounded-xl border border-ink-200 bg-white p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Çıktı biçimi
              </legend>
              {OUTPUT_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm text-ink-800">
                  <input
                    className="mt-1"
                    type="radio"
                    name="output"
                    checked={output === option.value}
                    onChange={() => setOutput(option.value)}
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-ink-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button className="w-full" disabled={busy} onClick={() => void produce()}>
            <KeyRound className="h-4 w-4" />
            Anonim belgeyi üret
          </Button>
        </div>
      </div>
    </Card>
  )
}
