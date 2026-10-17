import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { defaultMatch, identityKey } from '@shared/identity'
import type { IgnoredPhrase, MappingEntry, MatchMode, PiiKind, PreviewSpan } from '@shared/types'
import {
  findExactNameSpans,
  indexOfTr,
  isTitleCaseTr,
  isUpperCaseTr,
  normalizeTr,
  scanNameWords
} from '@shared/nameKeys'
import { findPlateVariants, isValidPlaka } from '@shared/plates'
import { isNumberedToken } from '@shared/tokens'
import { KIND_LABEL, MATCH_LABEL, isNameKind, nameValue, nextToken, tokenName, tokenNameError } from '../lib/keys'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const KINDS = Object.keys(KIND_LABEL) as PiiKind[]
const MODES = Object.keys(MATCH_LABEL) as MatchMode[]

function stem(word: string): string {
  const cut = word.search(/['’ʻ]/)
  return cut > 0 ? word.slice(0, cut) : word
}

type Spelling = { upper: number; title: number }

/**
 * How each name word of the text is written, by its folded form. Built once per text:
 * scanning the whole text for every key on every render froze the screen.
 */
function nameSpellingIndex(text: string): Map<string, Spelling> {
  const index = new Map<string, Spelling>()
  for (const word of scanNameWords(text)) {
    const upper = isUpperCaseTr(word.value)
    if (!upper && !isTitleCaseTr(word.value)) continue
    const norm = normalizeTr(word.value)
    const counts = index.get(norm) ?? { upper: 0, title: 0 }
    if (upper) counts.upper += 1
    else counts.title += 1
    index.set(norm, counts)
  }
  return index
}

/** How a name is written in the text, to help choose a spelling mode. */
function spellingCounts(text: string, index: Map<string, Spelling>, value: string): Spelling {
  const words = value.trim().split(/\s+/)
  if (words.length === 1) return index.get(normalizeTr(stem(words[0]!))) ?? { upper: 0, title: 0 }
  // Several words: rare, so a full scan is fine
  const counts = { upper: 0, title: 0 }
  for (const span of findExactNameSpans(text, value)) {
    const stems = span.value.split(/\s+/).map(stem)
    if (stems.every(isUpperCaseTr)) counts.upper += 1
    else if (stems.every(isTitleCaseTr)) counts.title += 1
  }
  return counts
}

/** The value as a key stores it, or an error when it is not usable. */
function checkValue(
  text: string,
  kind: PiiKind,
  raw: string,
  keys: MappingEntry[],
  except?: MappingEntry
): { value: string } | { error: string } {
  const value = isNameKind(kind) ? nameValue(raw) : raw.trim()
  if (!value) return { error: 'Değer girin' }
  if (kind === 'PLAKA' && !isValidPlaka(value)) return { error: 'Geçerli bir plaka girin (ör. 34 ABC 123)' }
  const found = isNameKind(kind)
    ? findExactNameSpans(text, value).length > 0
    : kind === 'PLAKA'
      ? findPlateVariants(text, value).length > 0
      : indexOfTr(text, value) >= 0
  if (!found) return { error: 'Metin belgede yok' }
  const id = identityKey(kind, value)
  const other = keys.find((key) => key !== except && identityKey(key.kind, key.original) === id)
  if (other) return { error: `Bu değer zaten ${other.token} anahtarında` }
  return { value }
}

function addToDictionary(kind: PiiKind, value: string): void {
  if (!isNameKind(kind)) return
  const parts = value.split(/\s+/).filter((part) => part.length >= 2)
  if (parts.length > 0) void window.kbms.dict.add(kind as 'AD' | 'SOYAD', parts.join('\n'))
}

/** A skipped place with a little of the text around it, for the list. */
function skipContext(text: string, span: PreviewSpan): { before: string; value: string; after: string } {
  const lineStart = text.lastIndexOf('\n', span.start - 1) + 1
  const lineEnd = text.indexOf('\n', span.end)
  const before = text.slice(Math.max(lineStart, span.start - 24), span.start)
  const after = text.slice(span.end, Math.min(lineEnd < 0 ? text.length : lineEnd, span.end + 24))
  return { before, value: text.slice(span.start, span.end), after }
}

interface Props {
  text: string
  keys: MappingEntry[]
  spans: PreviewSpan[]
  skipped: PreviewSpan[]
  alwaysIgnored: IgnoredPhrase[]
  selectedToken: string | null
  onSelect: (token: string | null) => void
  /** `renamed` is set when one key's value or kind was edited, so its skips can follow it. */
  onChange: (keys: MappingEntry[], renamed?: { from: MappingEntry; to: MappingEntry }) => void
  onUnskip: (span: PreviewSpan) => void
  onRemoveAlwaysIgnored: (id: number) => void
}

export function KeyPanel({
  text,
  keys,
  spans,
  skipped,
  alwaysIgnored,
  selectedToken,
  onSelect,
  onChange,
  onUnskip,
  onRemoveAlwaysIgnored
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editKind, setEditKind] = useState<PiiKind>('AD')
  const [editValue, setEditValue] = useState('')
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [adding, setAdding] = useState(false)
  const [addKind, setAddKind] = useState<PiiKind>('AD')
  const [addValue, setAddValue] = useState('')
  const [addName, setAddName] = useState('')
  const [addError, setAddError] = useState('')

  const counts = useMemo(() => {
    const byToken = new Map<string, { count: number; first: number }>()
    for (const span of spans) {
      const hit = byToken.get(span.token)
      if (hit) hit.count += 1
      else byToken.set(span.token, { count: 1, first: span.start })
    }
    return byToken
  }, [spans])

  const spellingIndex = useMemo(() => nameSpellingIndex(text), [text])
  const spellings = useMemo(() => {
    const byToken = new Map<string, Spelling>()
    for (const key of keys) {
      if (isNameKind(key.kind)) byToken.set(key.token, spellingCounts(text, spellingIndex, key.original))
    }
    return byToken
  }, [text, spellingIndex, keys])

  const skippedCount = useMemo(() => {
    const byToken = new Map<string, number>()
    for (const span of skipped) byToken.set(span.token, (byToken.get(span.token) ?? 0) + 1)
    return byToken
  }, [skipped])

  const ordered = useMemo(
    () =>
      [...keys].sort(
        (a, b) =>
          (counts.get(a.token)?.first ?? Number.MAX_SAFE_INTEGER) -
            (counts.get(b.token)?.first ?? Number.MAX_SAFE_INTEGER) ||
          a.token.localeCompare(b.token, 'tr', { numeric: true })
      ),
    [keys, counts]
  )

  useEffect(() => {
    const root = listRef.current
    if (!root || !selectedToken) return
    const el = root.querySelector('[data-key-selected="true"]')
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' })
  }, [selectedToken])

  function update(token: string, change: Partial<MappingEntry>) {
    onChange(keys.map((key) => (key.token === token ? { ...key, ...change } : key)))
  }

  function remove(token: string) {
    onChange(keys.filter((key) => key.token !== token))
    if (selectedToken === token) onSelect(null)
    setEditing(null)
  }

  function openEdit(key: MappingEntry) {
    setAdding(false)
    setEditing(key.token)
    setEditKind(key.kind)
    setEditValue(key.original)
    setEditName(key.kind === 'OZEL' && !isNumberedToken(key.token, key.kind) ? tokenName(key.token) : '')
    setEditError('')
    onSelect(key.token)
  }

  /**
   * Token for a key of this kind. A special mask may be named ([XYZ]); left empty it
   * gets the next number. Other kinds keep their token unless the kind changes.
   */
  function resolveToken(kind: PiiKind, name: string, current?: MappingEntry): { token: string } | { error: string } {
    if (kind === 'OZEL' && name.trim()) {
      const token = `[${name.trim()}]`
      if (token === current?.token) return { token }
      const problem = tokenNameError(name, keys, text, current)
      return problem ? { error: problem } : { token }
    }
    if (current && current.kind === kind && isNumberedToken(current.token, kind)) return { token: current.token }
    return { token: nextToken(kind, keys) }
  }

  function saveEdit(key: MappingEntry) {
    const checked = checkValue(text, editKind, editValue, keys, key)
    if ('error' in checked) {
      setEditError(checked.error)
      return
    }
    const resolved = resolveToken(editKind, editName, key)
    if ('error' in resolved) {
      setEditError(resolved.error)
      return
    }
    const token = resolved.token
    const edited: MappingEntry = {
      kind: editKind,
      token,
      original: checked.value,
      match: editKind === key.kind ? key.match : defaultMatch(editKind)
    }
    onChange(
      keys.map((k) => (k === key ? edited : k)),
      { from: key, to: edited }
    )
    addToDictionary(editKind, checked.value)
    onSelect(token)
    setEditing(null)
  }

  function saveAdd() {
    const checked = checkValue(text, addKind, addValue, keys)
    if ('error' in checked) {
      setAddError(checked.error)
      return
    }
    const resolved = resolveToken(addKind, addName)
    if ('error' in resolved) {
      setAddError(resolved.error)
      return
    }
    const token = resolved.token
    onChange([...keys, { kind: addKind, token, original: checked.value, match: defaultMatch(addKind) }])
    addToDictionary(addKind, checked.value)
    onSelect(token)
    setAdding(false)
  }

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Anahtarlar <span className="text-ink-400">({keys.length})</span>
        </h3>
        <button
          type="button"
          aria-label="Anahtar ekle"
          title="Anahtar ekle"
          onClick={() => {
            setEditing(null)
            setAdding((open) => !open)
            setAddKind('AD')
            setAddValue('')
            setAddName('')
            setAddError('')
          }}
          className={`rounded-md p-1 transition ${
            adding ? 'bg-veil-100 text-veil-800' : 'text-ink-400 hover:bg-ink-900/5 hover:text-ink-700'
          }`}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-veil-300 bg-veil-50/80 p-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-veil-700">
            Yeni anahtar
          </span>
          <KindSelect value={addKind} onChange={setAddKind} />
          <Input
            className="text-xs"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            placeholder="Belgedeki metin"
            aria-label="Değer"
          />
          {addKind === 'OZEL' ? (
            <TokenNameInput value={addName} onChange={setAddName} />
          ) : null}
          {addError ? <p className="text-xs text-red-700">{addError}</p> : null}
          <div className="flex gap-1.5">
            <Button className="flex-1 !py-1.5 text-xs" type="button" onClick={saveAdd}>
              Ekle
            </Button>
            <Button
              className="!px-2 !py-1.5 text-xs"
              variant="outline"
              type="button"
              onClick={() => setAdding(false)}
            >
              İptal
            </Button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 && !adding ? (
        <p className="text-sm text-ink-500">Henüz anahtar yok. Metinde sağ tıklayarak ekleyin.</p>
      ) : (
        <ul ref={listRef} className="max-h-[min(50vh,520px)] space-y-2 overflow-auto pr-1">
          {ordered.map((key) => {
            const count = counts.get(key.token)?.count ?? 0
            const skips = skippedCount.get(key.token) ?? 0
            const selected = key.token === selectedToken
            const name = isNameKind(key.kind)
            const spelling = spellings.get(key.token) ?? null
            // Spellings the chosen mode leaves as they are
            const unmatched =
              spelling && key.match === 'upper'
                ? { count: spelling.title, label: 'Aa' }
                : spelling && key.match === 'title'
                  ? { count: spelling.upper, label: 'AA' }
                  : null
            return (
              <li key={key.token} data-key-selected={selected ? 'true' : undefined}>
                <div
                  className={`rounded-xl border transition ${
                    selected || editing === key.token
                      ? 'border-veil-500 bg-veil-50/90 ring-2 ring-veil-400/30'
                      : 'border-ink-100 bg-sand-50/70 hover:border-ink-200'
                  }`}
                >
                  {editing === key.token ? (
                    <div className="space-y-2 p-2.5">
                      <p className="font-mono text-[10px] text-ink-400">{key.token}</p>
                      <KindSelect value={editKind} onChange={setEditKind} />
                      <Input
                        className="text-xs"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        aria-label="Metin"
                      />
                      {editKind === 'OZEL' ? (
                        <TokenNameInput value={editName} onChange={setEditName} />
                      ) : null}
                      {editError ? <p className="text-xs text-red-700">{editError}</p> : null}
                      <div className="flex gap-1.5">
                        <Button
                          className="flex-1 !px-2 !py-1.5 text-xs"
                          type="button"
                          onClick={() => saveEdit(key)}
                        >
                          Kaydet
                        </Button>
                        <Button
                          className="!px-2 !py-1.5 text-xs"
                          variant="outline"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          İptal
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer px-3 py-2"
                      onClick={() => onSelect(key.token)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelect(key.token)
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-veil-800">{key.token}</span>
                        <div className="flex items-center gap-0.5">
                          <Badge>{KIND_LABEL[key.kind]}</Badge>
                          <IconAction label="Düzenle" onClick={() => openEdit(key)}>
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </IconAction>
                          <IconAction label="Kaldır" danger onClick={() => remove(key.token)}>
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </IconAction>
                        </div>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-ink-700">{key.original}</p>
                      <p className={`mt-1 text-[11px] ${count === 0 ? 'text-red-700' : 'text-ink-500'}`}>
                        {count === 0 ? 'Belgede değişecek yer yok' : `${count} yerde`}
                        {skips > 0 ? ` · ${skips} yok sayıldı` : ''}
                        {spelling && (spelling.upper > 0 || spelling.title > 0)
                          ? ` · metinde ${spelling.upper} AA, ${spelling.title} Aa`
                          : ''}
                      </p>
                      {unmatched && unmatched.count > 0 ? (
                        <p className="mt-0.5 text-[11px] text-amber-800">
                          {unmatched.count} {unmatched.label} yazım eşlenmiyor
                        </p>
                      ) : null}
                      {name ? (
                        <select
                          className="mt-1.5 w-full rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-800"
                          aria-label="Eşleme biçimi"
                          value={key.match}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => update(key.token, { match: e.target.value as MatchMode })}
                        >
                          {MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {MATCH_LABEL[mode]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {skipped.length > 0 ? (
        <div className="space-y-1.5 border-t border-ink-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Yok sayılan yerler <span className="text-ink-400">({skipped.length})</span>
          </h3>
          <ul className="max-h-48 space-y-1 overflow-auto pr-1">
            {skipped.map((span) => {
              const context = skipContext(text, span)
              return (
                <li
                  key={`s-${span.start}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 bg-white px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate text-xs text-ink-600" title={`${span.token}`}>
                    …{context.before}
                    <span className="rounded-sm bg-ink-100 px-0.5 font-medium text-ink-900">
                      {context.value}
                    </span>
                    {context.after}…
                  </span>
                  <IconAction label="Yok saymayı geri al" danger onClick={() => onUnskip(span)}>
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconAction>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {alwaysIgnored.length > 0 ? (
        <div className="space-y-1.5 border-t border-ink-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Her zaman yok sayılan ifadeler
          </h3>
          <ul className="space-y-1">
            {alwaysIgnored.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 bg-white px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-xs text-ink-800" title={item.phrase}>
                  {item.phrase}
                </span>
                <IconAction label="Listeden kaldır" danger onClick={() => onRemoveAlwaysIgnored(item.id)}>
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </IconAction>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}

/** Name for a special mask's token, without brackets. Empty means the next [OZEL_n]. */
function TokenNameInput({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <label className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 font-mono text-xs text-ink-500">
      [
      <input
        className="min-w-0 flex-1 bg-transparent py-2 text-ink-900 outline-none placeholder:text-ink-400"
        value={value}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Token adı (boşsa OZEL_n)"
        aria-label="Token adı"
      />
      ]
    </label>
  )
}

function KindSelect({ value, onChange }: { value: PiiKind; onChange: (kind: PiiKind) => void }) {
  return (
    <select
      className="w-full rounded-lg border border-ink-200 bg-white px-2 py-2 text-xs text-ink-900"
      value={value}
      aria-label="Tür"
      onChange={(e) => onChange(e.target.value as PiiKind)}
    >
      {KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABEL[kind]}
        </option>
      ))}
    </select>
  )
}

function IconAction({
  label,
  onClick,
  danger = false,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`rounded-md p-1 transition ${
        danger
          ? 'text-ink-300 hover:bg-red-50 hover:text-red-600'
          : 'text-ink-300 hover:bg-ink-900/5 hover:text-ink-600'
      }`}
    >
      {children}
    </button>
  )
}
