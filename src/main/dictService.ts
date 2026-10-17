import type { IgnoredPhrase } from '../shared/types'
import { requireSession } from './auth'
import { getDb } from './db'
import { formatStoredName, normalizeTr } from '../shared/nameKeys'
import { listBuiltinNames, setUserNameExtras } from './pii/names'

export type UserNameKind = 'AD' | 'SOYAD'
export type DictSource = 'initial' | 'custom'

export interface DictEntry {
  key: string
  kind: UserNameKind
  value: string
  source: DictSource
  createdAt: string | null
}

interface CustomRow {
  id: number
  kind: string
  value: string
  createdAt: string
}

/** Rewrite stored display values. AD stays Title Case or UPPERCASE; SOYAD is uppercase. */
function normalizeStoredCases(userId: number): void {
  const db = getDb()
  const rows = db
    .prepare(`SELECT id, kind, value FROM user_names WHERE user_id = ?`)
    .all(userId) as Array<{ id: number; kind: string; value: string }>
  const update = db.prepare(`UPDATE user_names SET value = ? WHERE id = ? AND user_id = ?`)
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.kind !== 'AD' && row.kind !== 'SOYAD') continue
      const next = formatStoredName(row.kind, row.value)
      if (next && next !== row.value) update.run(next, row.id, userId)
    }
  })
  tx()
}

function syncExtrasToDetector(userId: number): void {
  normalizeStoredCases(userId)
  const db = getDb()
  const rows = db
    .prepare(`SELECT kind, value FROM user_names WHERE user_id = ?`)
    .all(userId) as Array<{ kind: string; value: string }>
  const excluded = db
    .prepare(`SELECT kind, value_norm AS value FROM user_name_exclusions WHERE user_id = ?`)
    .all(userId) as Array<{ kind: string; value: string }>
  const first: string[] = []
  const last: string[] = []
  const excludedFirst: string[] = []
  const excludedLast: string[] = []
  for (const r of rows) {
    if (r.kind === 'AD') first.push(r.value)
    else if (r.kind === 'SOYAD') last.push(r.value)
  }
  for (const r of excluded) {
    if (r.kind === 'AD') excludedFirst.push(r.value)
    else if (r.kind === 'SOYAD') excludedLast.push(r.value)
  }
  setUserNameExtras(first, last, excludedFirst, excludedLast)
}

/** Call after login / register so detection sees custom names. */
export function loadUserDictForSession(): void {
  const { user } = requireSession()
  syncExtrasToDetector(user.id)
}

export function clearUserDictFromDetector(): void {
  setUserNameExtras([], [])
}

function builtinKey(kind: UserNameKind, norm: string): string {
  return `initial:${kind}:${norm}`
}

export function listNames(kind?: UserNameKind): DictEntry[] {
  const { user } = requireSession()
  normalizeStoredCases(user.id)
  const db = getDb()
  const customs = db
    .prepare(
      `SELECT id, kind, value, created_at AS createdAt FROM user_names WHERE user_id = ?`
    )
    .all(user.id) as CustomRow[]
  const exclusions = db
    .prepare(`SELECT kind, value_norm AS norm FROM user_name_exclusions WHERE user_id = ?`)
    .all(user.id) as Array<{ kind: string; norm: string }>
  const excluded = new Set(exclusions.map((e) => `${e.kind}:${e.norm}`))

  const customByNorm = new Map<string, CustomRow>()
  for (const row of customs) {
    customByNorm.set(`${row.kind}:${normalizeTr(row.value)}`, row)
  }

  const rows: DictEntry[] = []
  const covered = new Set<string>()
  for (const entry of listBuiltinNames()) {
    if (kind && entry.kind !== kind) continue
    const token = `${entry.kind}:${entry.norm}`
    if (excluded.has(token)) continue
    covered.add(token)
    rows.push({
      key: builtinKey(entry.kind, entry.norm),
      kind: entry.kind,
      value: formatStoredName(entry.kind, entry.value),
      source: 'initial',
      createdAt: null
    })
  }

  for (const row of customs) {
    const rowKind = row.kind as UserNameKind
    if (kind && rowKind !== kind) continue
    const token = `${row.kind}:${normalizeTr(row.value)}`
    if (excluded.has(token) || covered.has(token)) continue
    rows.push({
      key: `custom:${row.id}`,
      kind: rowKind,
      value: row.value,
      source: 'custom',
      createdAt: row.createdAt
    })
  }

  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.value.localeCompare(b.value, 'tr')
  })
  return rows
}

/**
 * Parse multiline / comma-separated names and insert into the user's custom list.
 * Names already in the initial list are skipped. Re-adding a removed initial name restores it.
 */
export function addUserNames(kind: UserNameKind, rawText: string): { added: number; skipped: number } {
  const { user } = requireSession()
  if (kind !== 'AD' && kind !== 'SOYAD') throw new Error('Geçersiz liste türü')

  const parts = rawText
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2)

  const unique = new Map<string, string>()
  for (const p of parts) {
    const norm = normalizeTr(p)
    if (!norm || norm.length < 2) continue
    if (!unique.has(norm)) unique.set(norm, p)
  }

  const builtin = new Set(
    listBuiltinNames()
      .filter((e) => e.kind === kind)
      .map((e) => e.norm)
  )
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_names (user_id, kind, value_norm, value) VALUES (?, ?, ?, ?)`
  )
  const clearExclusion = db.prepare(
    `DELETE FROM user_name_exclusions WHERE user_id = ? AND kind = ? AND value_norm = ?`
  )
  let added = 0
  const tx = db.transaction(() => {
    for (const [norm, value] of unique) {
      const restored = clearExclusion.run(user.id, kind, norm).changes > 0
      if (builtin.has(norm)) {
        if (restored) added += 1
        continue
      }
      const info = insert.run(user.id, kind, norm, formatStoredName(kind, value))
      if (info.changes > 0) added += 1
    }
  })
  tx()

  syncExtrasToDetector(user.id)
  return { added, skipped: unique.size - added }
}

export function removeName(key: string): void {
  const { user } = requireSession()
  const db = getDb()

  if (key.startsWith('custom:')) {
    const id = Number(key.slice('custom:'.length))
    if (!Number.isInteger(id)) throw new Error('Kayıt bulunamadı')
    const row = db
      .prepare(`SELECT kind, value_norm AS norm FROM user_names WHERE id = ? AND user_id = ?`)
      .get(id, user.id) as { kind: UserNameKind; norm: string } | undefined
    if (!row) throw new Error('Kayıt bulunamadı')
    const builtin = listBuiltinNames().some((e) => e.kind === row.kind && e.norm === row.norm)
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM user_names WHERE id = ? AND user_id = ?`).run(id, user.id)
      if (builtin) {
        db.prepare(
          `INSERT OR IGNORE INTO user_name_exclusions (user_id, kind, value_norm) VALUES (?, ?, ?)`
        ).run(user.id, row.kind, row.norm)
      }
    })
    tx()
    syncExtrasToDetector(user.id)
    return
  }

  const match = /^initial:(AD|SOYAD):(.+)$/.exec(key)
  if (!match) throw new Error('Kayıt bulunamadı')
  const kind = match[1] as UserNameKind
  const norm = match[2]!
  const known = listBuiltinNames().some((e) => e.kind === kind && e.norm === norm)
  if (!known) throw new Error('Kayıt bulunamadı')

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO user_name_exclusions (user_id, kind, value_norm) VALUES (?, ?, ?)`
    ).run(user.id, kind, norm)
    db.prepare(`DELETE FROM user_names WHERE user_id = ? AND kind = ? AND value_norm = ?`).run(
      user.id,
      kind,
      norm
    )
  })
  tx()
  syncExtrasToDetector(user.id)
}

/** Drop user additions and deletions so the list matches the shipped dictionaries. */
export function resetNames(): void {
  const { user } = requireSession()
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM user_names WHERE user_id = ?`).run(user.id)
    db.prepare(`DELETE FROM user_name_exclusions WHERE user_id = ?`).run(user.id)
  })
  tx()
  syncExtrasToDetector(user.id)
}

/** Phrases kept out of every anonymization for the signed-in user. */
export function listIgnoredPhrases(): IgnoredPhrase[] {
  const { user } = requireSession()
  return getDb()
    .prepare(`SELECT id, phrase FROM user_ignored_phrases WHERE user_id = ? ORDER BY phrase`)
    .all(user.id) as IgnoredPhrase[]
}

export function addIgnoredPhrase(raw: string): IgnoredPhrase[] {
  const { user } = requireSession()
  const phrase = raw.trim().replace(/\s+/g, ' ')
  if (phrase.length < 2) throw new Error('İfade en az 2 karakter olmalı')
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_ignored_phrases (user_id, phrase, phrase_norm) VALUES (?, ?, ?)`
    )
    .run(user.id, phrase, normalizeTr(phrase))
  return listIgnoredPhrases()
}

export function removeIgnoredPhrase(id: number): IgnoredPhrase[] {
  const { user } = requireSession()
  getDb().prepare(`DELETE FROM user_ignored_phrases WHERE id = ? AND user_id = ?`).run(id, user.id)
  return listIgnoredPhrases()
}
