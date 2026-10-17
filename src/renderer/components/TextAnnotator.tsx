import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
import type { MappingEntry, PiiKind, PreviewSpan } from '@shared/types'
import { findAllOccurrencesTr, normalizeTr } from '@shared/nameKeys'
import { KIND_LABEL } from '../lib/keys'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const KIND_COLORS: Record<PiiKind, string> = {
  AD: 'bg-amber-300/90 text-ink-950 ring-amber-500',
  SOYAD: 'bg-orange-300/90 text-ink-950 ring-orange-500',
  TCKN: 'bg-rose-300/90 text-ink-950 ring-rose-500',
  VKN: 'bg-fuchsia-300/90 text-ink-950 ring-fuchsia-500',
  IBAN: 'bg-sky-300/90 text-ink-950 ring-sky-500',
  EMAIL: 'bg-violet-300/90 text-ink-950 ring-violet-500',
  TEL: 'bg-emerald-300/90 text-ink-950 ring-emerald-500',
  PLAKA: 'bg-cyan-300/90 text-ink-950 ring-cyan-600',
  OZEL: 'bg-lime-300/90 text-ink-950 ring-lime-600'
}

const SKIPPED_STYLE = 'bg-ink-100/70 text-ink-600 ring-ink-400 ring-dashed'

type Segment =
  | { type: 'text'; value: string; start: number }
  | {
      type: 'mark'
      span: PreviewSpan
      skipped: boolean
      key: MappingEntry | undefined
      value: string
      start: number
    }

type TextRange = { start: number; end: number; value: string }

function buildSegments(
  text: string,
  spans: PreviewSpan[],
  skipped: PreviewSpan[],
  keyOf: Map<string, MappingEntry>
): Segment[] {
  const marks = [
    ...spans.map((span) => ({ span, skipped: false })),
    ...skipped.map((span) => ({ span, skipped: true }))
  ].sort((a, b) => a.span.start - b.span.start)
  const segments: Segment[] = []
  let cursor = 0
  for (const { span, skipped: isSkipped } of marks) {
    if (span.start < cursor || span.end > text.length) continue
    if (span.start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, span.start), start: cursor })
    }
    segments.push({
      type: 'mark',
      span,
      skipped: isSkipped,
      key: keyOf.get(span.token),
      value: text.slice(span.start, span.end),
      start: span.start
    })
    cursor = span.end
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor), start: cursor })
  return segments
}

function trimmedSpan(text: string, start: number, end: number): TextRange | null {
  if (end <= start) return null
  let from = start
  let to = end
  let value = text.slice(from, to)
  from += value.length - value.trimStart().length
  to -= value.length - value.trimEnd().length
  value = text.slice(from, to)
  if (value.length < 2 || value.length > 800) return null
  return { start: from, end: to, value }
}

function tokenSpanAt(text: string, index: number): TextRange | null {
  if (!text) return null
  let at = Math.max(0, Math.min(index, text.length))
  if (at === text.length) at -= 1
  if (at >= 0 && /\s/.test(text[at] ?? '')) {
    if (at > 0 && !/\s/.test(text[at - 1] ?? '')) at -= 1
  }
  if (at < 0 || /\s/.test(text[at] ?? '')) return null
  let start = at
  let end = at + 1
  while (start > 0 && !/\s/.test(text[start - 1] ?? '')) start -= 1
  while (end < text.length && !/\s/.test(text[end] ?? '')) end += 1
  return trimmedSpan(text, start, end)
}

/**
 * Phrase offered when ignoring a mark: the mark and up to two following words on the
 * same line, without the last word's suffix ("Türk Ceza Kanunu'nun" → "Türk Ceza Kanunu").
 */
function suggestPhrase(text: string, start: number, end: number): string {
  const lineEnd = text.indexOf('\n', end)
  const limit = lineEnd < 0 ? text.length : lineEnd
  let to = end
  for (let words = 0; words < 2; words++) {
    const next = /^[ \t]+\S+/.exec(text.slice(to, limit))
    if (!next) break
    to += next[0].length
  }
  return text
    .slice(start, to)
    .replace(/['’ʻ]\p{L}*[^\p{L}\p{N}]*$/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
}

function caretOffset(root: HTMLElement, x: number, y: number): number | null {
  const withCaret = document as Document & {
    caretRangeFromPoint?: (px: number, py: number) => Range | null
    caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null
  }
  const range = withCaret.caretRangeFromPoint?.(x, y) ?? null
  if (range && root.contains(range.startContainer)) {
    const offset = absoluteOffset(root, range.startContainer, range.startOffset)
    if (offset != null) return offset
  }
  const pos = withCaret.caretPositionFromPoint?.(x, y) ?? null
  if (pos && root.contains(pos.offsetNode)) {
    return absoluteOffset(root, pos.offsetNode, pos.offset)
  }
  return null
}

function pointInSelection(x: number, y: number, sel: Selection): boolean {
  if (sel.isCollapsed || sel.rangeCount === 0) return false
  for (const rect of sel.getRangeAt(0).getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true
  }
  return false
}

function absoluteOffset(root: HTMLElement, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const host = container.parentElement?.closest('[data-start]')
    if (!host || !root.contains(host)) return null
    const base = Number(host.getAttribute('data-start'))
    if (!Number.isFinite(base)) return null
    return base + offset
  }
  if (!(container instanceof Element) || !root.contains(container)) return null
  const child = container.childNodes[Math.min(offset, container.childNodes.length)] ?? null
  const at =
    offset <= 0
      ? container
      : container.childNodes[offset - 1] instanceof Element
        ? (container.childNodes[offset - 1] as Element)
        : container.childNodes[offset - 1]?.parentElement
  const host = (child instanceof Element ? child : at)?.closest?.('[data-start]') ?? null
  if (!host || !root.contains(host)) return null
  const base = Number(host.getAttribute('data-start'))
  if (!Number.isFinite(base)) return null
  if (offset <= 0 || host === child) return base
  return base + (host.textContent?.length ?? 0)
}

interface Props {
  text: string
  spans: PreviewSpan[]
  skipped: PreviewSpan[]
  keys: MappingEntry[]
  selectedToken: string | null
  onSelectToken: (token: string | null) => void
  onAddKey: (kind: 'AD' | 'SOYAD' | 'OZEL', value: string) => void
  onRemoveKey: (token: string) => void
  /** Leave this one marked place as it is. */
  onSkip: (span: PreviewSpan) => void
  onUnskip: (span: PreviewSpan) => void
  /** Add a phrase to the lasting list kept out of every anonymization. */
  onIgnoreAlways: (phrase: string) => void
  onRenumber?: () => void
}

type MenuState = TextRange & {
  top: number
  left: number
  mark: PreviewSpan | null
  markSkipped: boolean
}

export function TextAnnotator({
  text,
  spans,
  skipped,
  keys,
  selectedToken,
  onSelectToken,
  onAddKey,
  onRemoveKey,
  onSkip,
  onUnskip,
  onIgnoreAlways,
  onRenumber
}: Props) {
  const rootRef = useRef<HTMLElement>(null)
  const pendingJumpStart = useRef<number | null>(null)
  const [matchIndex, setMatchIndex] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [ignoring, setIgnoring] = useState<{ anchor: PreviewSpan; phrase: string } | null>(null)

  const keyOf = useMemo(() => new Map(keys.map((key) => [key.token, key])), [keys])
  const segments = useMemo(
    () => buildSegments(text, spans, skipped, keyOf),
    [text, spans, skipped, keyOf]
  )

  const matchStarts = useMemo(
    () => (selectedToken ? spans.filter((s) => s.token === selectedToken).map((s) => s.start) : []),
    [spans, selectedToken]
  )

  useEffect(() => {
    const jump = pendingJumpStart.current
    pendingJumpStart.current = null
    const idx = jump == null ? -1 : matchStarts.indexOf(jump)
    setMatchIndex(idx >= 0 ? idx : 0)
  }, [selectedToken])

  useEffect(() => {
    setMatchIndex((i) => Math.min(i, Math.max(0, matchStarts.length - 1)))
  }, [matchStarts.length])

  const activeStart = matchStarts[matchIndex] ?? null

  useEffect(() => {
    if (activeStart == null || !rootRef.current) return
    const el = rootRef.current.querySelector(`[data-match-start="${activeStart}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeStart])

  const goPrev = useCallback(() => {
    if (matchStarts.length === 0) return
    setMatchIndex((i) => (i - 1 + matchStarts.length) % matchStarts.length)
  }, [matchStarts.length])

  const goNext = useCallback(() => {
    if (matchStarts.length === 0) return
    setMatchIndex((i) => (i + 1) % matchStarts.length)
  }, [matchStarts.length])

  useEffect(() => {
    if (!selectedToken || matchStarts.length === 0 || ignoring) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedToken, matchStarts.length, goPrev, goNext, ignoring])

  const openMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const root = rootRef.current
      if (!root) return
      const markEl = event.target instanceof Element ? event.target.closest('mark[data-start]') : null
      const markStart = markEl ? Number(markEl.getAttribute('data-start')) : null
      const skippedMark = markStart == null ? null : (skipped.find((s) => s.start === markStart) ?? null)
      const mark =
        markStart == null ? null : (skippedMark ?? spans.find((s) => s.start === markStart) ?? null)

      let range: TextRange | null = null
      const sel = window.getSelection()
      if (sel && sel.anchorNode && root.contains(sel.anchorNode) && pointInSelection(event.clientX, event.clientY, sel)) {
        const r = sel.getRangeAt(0)
        const start = absoluteOffset(root, r.startContainer, r.startOffset)
        const end = absoluteOffset(root, r.endContainer, r.endOffset)
        if (start != null && end != null) {
          const trimmed = trimmedSpan(text, start, end)
          if (trimmed && trimmed.value === sel.toString().trim()) range = trimmed
        }
      }
      if (!range && mark) range = { start: mark.start, end: mark.end, value: text.slice(mark.start, mark.end) }
      if (!range) {
        const offset = caretOffset(root, event.clientX, event.clientY)
        if (offset != null) range = tokenSpanAt(text, offset)
      }
      if (!range) {
        setMenu(null)
        return
      }
      setMenu({
        ...range,
        mark,
        markSkipped: Boolean(skippedMark),
        top: Math.max(8, Math.min(event.clientY, window.innerHeight - 200)),
        left: Math.max(8, Math.min(event.clientX, window.innerWidth - 230))
      })
    },
    [text, spans, skipped]
  )

  useEffect(() => {
    if (!menu) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-context-menu]')) return
      setMenu(null)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null)
    }
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onPointerDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!ignoring) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setIgnoring(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ignoring])

  function closeMenu() {
    setMenu(null)
    window.getSelection()?.removeAllRanges()
  }

  function addFromMenu(kind: 'AD' | 'SOYAD' | 'OZEL') {
    if (!menu) return
    onAddKey(kind, menu.value)
    closeMenu()
  }

  function startIgnoreAlways() {
    if (!menu?.mark) return
    const anchor = menu.mark
    setIgnoring({ anchor, phrase: suggestPhrase(text, anchor.start, anchor.end) })
    closeMenu()
  }

  const ignoreCheck = useMemo(() => {
    if (!ignoring) return null
    const phrase = ignoring.phrase.trim()
    const hits = phrase.length >= 2 ? findAllOccurrencesTr(text, phrase) : []
    const covers = hits.some((h) => h.start <= ignoring.anchor.start && h.end >= ignoring.anchor.end)
    const anchorText = text.slice(ignoring.anchor.start, ignoring.anchor.end)
    return {
      phrase,
      count: hits.length,
      covers,
      bare: normalizeTr(phrase) === normalizeTr(anchorText)
    }
  }, [ignoring, text])

  function selectMark(span: PreviewSpan) {
    if (span.token === selectedToken) {
      const idx = matchStarts.indexOf(span.start)
      if (idx >= 0) setMatchIndex(idx)
      return
    }
    pendingJumpStart.current = span.start
    onSelectToken(span.token)
  }

  const selectedKey = selectedToken ? keyOf.get(selectedToken) : undefined
  const markTokens = new Set(spans.map((s) => s.token))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span>İşaretler, üretilecek belgede token’a çevrilecek yerlerin kendisidir.</span>
        <Badge tone="ok">{spans.length} yer</Badge>
        {skipped.length > 0 ? <Badge tone="muted">{skipped.length} yok sayıldı</Badge> : null}
        <Badge tone="muted">{markTokens.size} anahtar</Badge>
      </div>

      <div className="relative">
        {onRenumber ? (
          <button
            type="button"
            aria-label="Anahtar sırasını yenile"
            title="Token numaralarını belgedeki sıraya göre yeniden ver"
            onClick={onRenumber}
            className="absolute right-3 top-3 z-10 rounded-lg border border-ink-200 bg-white/95 p-1.5 text-ink-500 shadow-sm transition hover:bg-white hover:text-ink-800"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
        <article
          ref={rootRef}
          className="max-h-[min(62vh,640px)] overflow-auto rounded-2xl border border-ink-200 bg-white p-5 pr-12 text-[15px] leading-7 text-ink-900 shadow-inner"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          onContextMenu={openMenu}
          onScroll={() => setMenu(null)}
        >
          {segments.map((seg, i) => {
            if (seg.type === 'text') {
              return (
                <span key={`t-${seg.start}-${i}`} data-start={seg.start}>
                  {seg.value}
                </span>
              )
            }
            const kind = seg.key?.kind ?? 'OZEL'
            if (seg.skipped) {
              return (
                <mark
                  key={`s-${seg.start}-${seg.span.end}`}
                  data-start={seg.start}
                  title={`Yok sayıldı · ${seg.span.token} · sağ tıkla geri al`}
                  className={`rounded-sm px-0.5 ring-1 ring-inset ${SKIPPED_STYLE}`}
                >
                  {seg.value}
                </mark>
              )
            }
            const inGroup = seg.span.token === selectedToken
            const isActive = inGroup && activeStart === seg.start
            return (
              <mark
                key={`m-${seg.start}-${seg.span.end}`}
                data-start={seg.start}
                data-match-start={inGroup ? seg.start : undefined}
                title={`${KIND_LABEL[kind]} · ${seg.span.token}`}
                className={`cursor-pointer rounded-sm px-0.5 ring-1 ring-inset transition hover:brightness-95 ${KIND_COLORS[kind]} ${
                  isActive
                    ? 'outline outline-[3px] outline-offset-1 outline-veil-700'
                    : inGroup
                      ? 'outline outline-2 outline-offset-1 outline-veil-400/70'
                      : ''
                }`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (e.altKey || e.metaKey) {
                    onRemoveKey(seg.span.token)
                    onSelectToken(null)
                    return
                  }
                  selectMark(seg.span)
                }}
              >
                {seg.value}
              </mark>
            )
          })}
        </article>
      </div>

      {selectedToken && matchStarts.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-sand-50/90 px-3 py-2">
          <p className="min-w-0 truncate font-mono text-xs text-ink-600">
            {selectedToken}
            {selectedKey ? <span className="ml-2 text-ink-500">{selectedKey.original}</span> : null}
            <span className="ml-2 text-ink-400">
              {matchIndex + 1} / {matchStarts.length}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              className="!px-2 !py-1.5"
              aria-label="Önceki eşleşme"
              title="Önceki (←)"
              onClick={goPrev}
              disabled={matchStarts.length < 2}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="!px-2 !py-1.5"
              aria-label="Sonraki eşleşme"
              title="Sonraki (→)"
              onClick={goNext}
              disabled={matchStarts.length < 2}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-400">
          İşarete tıklayın; aynı anahtarın yerleri arasında ← → ile gezinin. Sağ tık: ekle, anahtarı
          yalnız o yerde uygulama veya kaldır. Yok sayılan yer başka bir anahtara (ör. seçip “Özel
          maskele”) açıktır. Alt/⌘+tık anahtarı kaldırır.
        </p>
      )}

      {menu
        ? createPortal(
            <div
              data-context-menu
              role="menu"
              className="fixed z-50 min-w-[13rem] overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg"
              style={{ top: menu.top, left: menu.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {menu.mark && menu.markSkipped ? (
                <>
                  <p className="px-3 pb-1 pt-1.5 font-mono text-[11px] text-ink-400">
                    Yok sayıldı · {menu.mark.token}
                  </p>
                  <MenuItem
                    onClick={() => {
                      onUnskip(menu.mark!)
                      closeMenu()
                    }}
                  >
                    Yok saymayı geri al
                  </MenuItem>
                  <div className="my-1 border-t border-ink-100" />
                </>
              ) : menu.mark ? (
                <>
                  <p className="px-3 pb-1 pt-1.5 font-mono text-[11px] text-ink-400">{menu.mark.token}</p>
                  <MenuItem
                    onClick={() => {
                      onSkip(menu.mark!)
                      closeMenu()
                    }}
                  >
                    Bu yerde {menu.mark.token} uygulama
                  </MenuItem>
                  <MenuItem onClick={startIgnoreAlways}>İfadeyi her zaman yok say…</MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      onRemoveKey(menu.mark!.token)
                      closeMenu()
                    }}
                  >
                    Anahtarı kaldır
                  </MenuItem>
                  <div className="my-1 border-t border-ink-100" />
                </>
              ) : null}
              <MenuItem onClick={() => addFromMenu('AD')}>Ad olarak ekle</MenuItem>
              <MenuItem onClick={() => addFromMenu('SOYAD')}>Soyad olarak ekle</MenuItem>
              <MenuItem onClick={() => addFromMenu('OZEL')}>Özel maskele</MenuItem>
            </div>,
            document.body
          )
        : null}

      {ignoring && ignoreCheck
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-ink-950/45"
                aria-label="Kapat"
                onClick={() => setIgnoring(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ignore-title"
                className="relative w-full max-w-md rounded-xl border border-ink-200 bg-white p-5 shadow-2xl"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="ignore-title" className="text-lg font-semibold text-ink-950">
                      İfadeyi her zaman yok say
                    </h2>
                    <p className="mt-1 text-sm text-ink-600">
                      İfade kalıcı listeye eklenir: bu ve sonraki belgelerde geçtiği her yerde olduğu
                      gibi kalır. Yalnız bir yeri bırakmak için “Bu yerde … uygulama”yı kullanın.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                    aria-label="Kapat"
                    onClick={() => setIgnoring(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!ignoreCheck.covers) return
                    onIgnoreAlways(ignoreCheck.phrase)
                    setIgnoring(null)
                  }}
                >
                  <Input
                    autoFocus
                    aria-label="Yok sayılacak ifade"
                    value={ignoring.phrase}
                    onChange={(e) => setIgnoring({ ...ignoring, phrase: e.target.value })}
                  />
                  <p className={`text-xs ${ignoreCheck.covers ? 'text-ink-500' : 'text-red-700'}`}>
                    {ignoreCheck.covers
                      ? `Metinde ${ignoreCheck.count} kez geçiyor.`
                      : 'İfade, sağ tıkladığınız işaretli yeri içermeli.'}
                  </p>
                  {ignoreCheck.covers && ignoreCheck.bare ? (
                    <p className="text-xs text-amber-800">
                      İfade yalnızca değerin kendisi; bu değer bundan sonra hiçbir belgede token’a çevrilmez.
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIgnoring(null)}>
                      Vazgeç
                    </Button>
                    <Button type="submit" disabled={!ignoreCheck.covers}>
                      Her zaman yok say
                    </Button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

function MenuItem({
  onClick,
  danger = false,
  children
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-sand-100 ${
        danger ? 'text-red-700' : 'text-ink-800'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
