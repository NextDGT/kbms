import { contextBridge, ipcRenderer } from 'electron'
import type {
  DocumentDetail,
  DocumentFormat,
  DocumentRecord,
  FolderRecord,
  EncodingPreview,
  IgnoredPhrase,
  MappingEntry,
  KeySkip,
  SessionInfo,
  UserPublic
} from '../shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api = {
  auth: {
    session: () => invoke<SessionInfo | null>('auth:session'),
    register: (username: string, password: string) =>
      invoke<{ user: UserPublic }>('auth:register', username, password),
    login: (username: string, password: string) =>
      invoke<{ user: UserPublic }>('auth:login', username, password),
    logout: () => invoke<void>('auth:logout')
  },
  folders: {
    list: () => invoke<FolderRecord[]>('folders:list'),
    create: (title: string) => invoke<FolderRecord>('folders:create', title),
    rename: (folderId: number, title: string) =>
      invoke<FolderRecord>('folders:rename', folderId, title),
    delete: (folderId: number) => invoke<void>('folders:delete', folderId)
  },
  docs: {
    list: (folderId: number) => invoke<DocumentRecord[]>('docs:list', folderId),
    get: (documentId: number) => invoke<DocumentDetail>('docs:get', documentId),
    upload: (folderId: number) => invoke<{ document: DocumentRecord }>('docs:upload', folderId),
    startEncoding: (documentId: number) =>
      invoke<{
        text: string
        pageCount: number
        format: DocumentFormat
        warnings: string[]
        keys: MappingEntry[]
      }>('docs:startEncoding', documentId),
    preview: (documentId: number, keys: MappingEntry[], skips: KeySkip[]) =>
      invoke<EncodingPreview>('docs:preview', documentId, keys, skips),
    produce: (
      documentId: number,
      keys: MappingEntry[],
      skips: KeySkip[],
      output: DocumentFormat
    ) => invoke<{ document: DocumentRecord }>('docs:produce', documentId, keys, skips, output),
    exportEncoded: (documentId: number) =>
      invoke<{ path: string; fallback?: boolean }>('docs:exportEncoded', documentId),
    restore: (documentId: number) => invoke<DocumentRecord>('docs:restore', documentId),
    exportRestored: (documentId: number) =>
      invoke<{ path: string; fallback?: boolean }>('docs:exportRestored', documentId)
  },
  dict: {
    list: (kind?: 'AD' | 'SOYAD') =>
      invoke<
        Array<{
          key: string
          kind: 'AD' | 'SOYAD'
          value: string
          source: 'initial' | 'custom'
          createdAt: string | null
        }>
      >('dict:list', kind),
    add: (kind: 'AD' | 'SOYAD', text: string) =>
      invoke<{ added: number; skipped: number }>('dict:add', kind, text),
    remove: (key: string) => invoke<void>('dict:remove', key),
    reset: () => invoke<void>('dict:reset')
  },
  ignored: {
    list: () => invoke<IgnoredPhrase[]>('ignored:list'),
    add: (phrase: string) => invoke<IgnoredPhrase[]>('ignored:add', phrase),
    remove: (id: number) => invoke<IgnoredPhrase[]>('ignored:remove', id)
  }
}

contextBridge.exposeInMainWorld('kbms', api)

export type KbmsApi = typeof api
