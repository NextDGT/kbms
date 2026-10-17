export type PiiKind =
  | 'AD'
  | 'SOYAD'
  | 'TCKN'
  | 'VKN'
  | 'IBAN'
  | 'EMAIL'
  | 'TEL'
  | 'PLAKA'
  | 'OZEL'

export type DocumentRole = 'original' | 'encoded' | 'returned' | 'restored'
export type DocumentFormat = 'pdf' | 'docx'

export interface UserPublic {
  id: number
  username: string
}

export interface FolderRecord {
  id: number
  userId: number
  title: string
  createdAt: string
  updatedAt: string
  documentCount: number
}

export interface DocumentRecord {
  id: number
  folderId: number
  role: DocumentRole
  name: string
  format: DocumentFormat
  sourceDocumentId: number | null
  createdAt: string
}

export interface PiiCandidate {
  id: string
  kind: PiiKind
  value: string
  start: number
  end: number
  autoDetected: boolean
  /** Structural PII is auto-approved; names start false until user confirms */
  approved: boolean
  /** Optional token override (e.g. [AD_1]); assigned at produce if empty */
  token?: string
}

/**
 * Which spellings of a name a key replaces. `upper` keeps "Türk Ceza Kanunu" when the
 * surname is written TÜRK; `title` does the opposite. Other kinds always use `any`.
 */
export type MatchMode = 'any' | 'upper' | 'title'

export interface MappingEntry {
  kind: PiiKind
  token: string
  original: string
  match: MatchMode
}

/** One place in the review text that will become a token. */
export interface PreviewSpan {
  start: number
  end: number
  token: string
}

/**
 * A place in the review text where one key is not applied. The key is named by its
 * value (kind + value), so renumbering tokens keeps the choice; other keys may still
 * claim the place, e.g. "Türk Marşı" as a special mask over a skipped surname "Türk".
 */
export interface KeySkip {
  start: number
  end: number
  kind: PiiKind
  value: string
}

/** What the review screen shows: places that become tokens, and marked places the user skipped. */
export interface EncodingPreview {
  spans: PreviewSpan[]
  skipped: PreviewSpan[]
}

/** A phrase the user keeps out of every anonymization. */
export interface IgnoredPhrase {
  id: number
  phrase: string
}

/** Keys of one encoded document. Stored encrypted in that document's record. */
export interface DocumentMapping {
  entries: MappingEntry[]
}

/** One document with its text and the documents it came from or led to. */
export interface DocumentDetail {
  document: DocumentRecord
  text: string
  /** The document this one was made from. */
  source: DocumentRecord | null
  /** Documents made from this one. */
  derived: DocumentRecord[]
  /** Keys of an encoded DOCX. Empty for other documents. */
  keys: MappingEntry[]
}

export interface SessionInfo {
  user: UserPublic
}
