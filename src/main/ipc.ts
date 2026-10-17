import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { DocumentFormat, MappingEntry, KeySkip } from '../shared/types'
import { getSession, login, logout, register } from './auth'
import * as dictService from './dictService'
import * as services from './services'

function wrap<T>(fn: () => T | Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((err: unknown) => {
      if (err instanceof UserCancelledError) {
        return { ok: false as const, error: 'USER_CANCELLED' }
      }
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Bilinmeyen hata'
      }
    })
}

function parentWindow(sender: Electron.WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(sender) ?? undefined
}

const DOCUMENT_FILTERS = [{ name: 'PDF veya Word belgesi', extensions: ['pdf', 'docx'] }]

function saveFilters(format: DocumentFormat): Array<{ name: string; extensions: string[] }> {
  return format === 'docx'
    ? [{ name: 'Word belgesi', extensions: ['docx'] }]
    : [{ name: 'PDF', extensions: ['pdf'] }]
}

class UserCancelledError extends Error {
  constructor() {
    super('USER_CANCELLED')
    this.name = 'UserCancelledError'
  }
}

async function pickSavePath(
  sender: Electron.WebContents,
  defaultName: string,
  title: string,
  filters: Array<{ name: string; extensions: string[] }> = [{ name: 'PDF', extensions: ['pdf'] }]
): Promise<string | null> {
  const win = parentWindow(sender)
  const defaultPath = join(app.getPath('downloads'), defaultName)
  const opts = {
    title,
    defaultPath,
    filters
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

export function registerIpc(): void {
  ipcMain.handle('auth:session', () =>
    wrap(() => {
      const s = getSession()
      if (s) dictService.loadUserDictForSession()
      return s ? { user: s.user } : null
    })
  )
  ipcMain.handle('auth:register', (_e, username: string, password: string) =>
    wrap(() => {
      const user = register(username, password)
      dictService.loadUserDictForSession()
      return { user }
    })
  )
  ipcMain.handle('auth:login', (_e, username: string, password: string) =>
    wrap(() => {
      const user = login(username, password)
      dictService.loadUserDictForSession()
      return { user }
    })
  )
  ipcMain.handle('auth:logout', () =>
    wrap(() => {
      logout()
      dictService.clearUserDictFromDetector()
    })
  )

  ipcMain.handle('dict:list', (_e, kind?: 'AD' | 'SOYAD') =>
    wrap(() => dictService.listNames(kind))
  )
  ipcMain.handle('dict:add', (_e, kind: 'AD' | 'SOYAD', text: string) =>
    wrap(() => dictService.addUserNames(kind, text))
  )
  ipcMain.handle('dict:remove', (_e, key: string) => wrap(() => dictService.removeName(key)))
  ipcMain.handle('dict:reset', () => wrap(() => dictService.resetNames()))
  ipcMain.handle('ignored:list', () => wrap(() => dictService.listIgnoredPhrases()))
  ipcMain.handle('ignored:add', (_e, phrase: string) =>
    wrap(() => dictService.addIgnoredPhrase(phrase))
  )
  ipcMain.handle('ignored:remove', (_e, id: number) =>
    wrap(() => dictService.removeIgnoredPhrase(id))
  )

  ipcMain.handle('folders:list', () => wrap(() => services.listFolders()))
  ipcMain.handle('folders:create', (_e, title: string) => wrap(() => services.createFolder(title)))
  ipcMain.handle('folders:rename', (_e, folderId: number, title: string) =>
    wrap(() => services.renameFolder(folderId, title))
  )
  ipcMain.handle('folders:delete', (_e, folderId: number) => wrap(() => services.deleteFolder(folderId)))

  ipcMain.handle('docs:list', (_e, folderId: number) => wrap(() => services.listDocuments(folderId)))
  ipcMain.handle('docs:get', (_e, documentId: number) =>
    wrap(() => services.getDocumentDetail(documentId))
  )
  ipcMain.handle('docs:upload', async (e, folderId: number) =>
    wrap(async () => {
      const win = parentWindow(e.sender)
      const opts = {
        title: 'PDF veya DOCX seç',
        filters: DOCUMENT_FILTERS,
        properties: ['openFile' as const]
      }
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths[0]) throw new UserCancelledError()
      return services.uploadDocument(folderId, result.filePaths[0])
    })
  )
  ipcMain.handle('docs:startEncoding', (_e, documentId: number) =>
    wrap(() => services.startEncoding(documentId))
  )
  ipcMain.handle('docs:preview', (_e, documentId: number, keys: MappingEntry[], skips: KeySkip[]) =>
    wrap(() => services.previewEncoding(documentId, keys, skips))
  )
  ipcMain.handle(
    'docs:produce',
    (
      _e,
      documentId: number,
      keys: MappingEntry[],
      skips: KeySkip[],
      output: DocumentFormat
    ) => wrap(() => services.produceEncoded(documentId, keys, skips, output))
  )
  ipcMain.handle('docs:exportEncoded', async (e, documentId: number) =>
    wrap(async () => {
      const format = services.documentFormat(documentId)
      let filePath = await pickSavePath(
        e.sender,
        `kbms-anonim-${documentId}.${format}`,
        'Üçüncü taraf paketi kaydet',
        saveFilters(format)
      )
      let fallback = false
      if (!filePath) {
        const win = parentWindow(e.sender)
        const ask = win
          ? await dialog.showMessageBox(win, {
              type: 'question',
              buttons: ['İndirilenler’e kaydet', 'Vazgeç'],
              defaultId: 0,
              cancelId: 1,
              title: 'Kayıt konumu',
              message:
                'Dosya konumu seçilmedi. Anonim paketi İndirilenler klasörüne kaydedelim mi?'
            })
          : await dialog.showMessageBox({
              type: 'question',
              buttons: ['İndirilenler’e kaydet', 'Vazgeç'],
              defaultId: 0,
              cancelId: 1,
              title: 'Kayıt konumu',
              message:
                'Dosya konumu seçilmedi. Anonim paketi İndirilenler klasörüne kaydedelim mi?'
            })
        if (ask.response !== 0) throw new UserCancelledError()
        filePath = join(app.getPath('downloads'), `kbms-anonim-${documentId}-${Date.now()}.${format}`)
        fallback = true
      }
      services.exportEncodedCopy(documentId, filePath)
      try {
        shell.showItemInFolder(filePath)
      } catch {
        // ignore folder reveal failures
      }
      return { path: filePath, fallback }
    })
  )
  ipcMain.handle('docs:restore', async (e, documentId: number) =>
    wrap(async () => {
      const win = parentWindow(e.sender)
      const opts = {
        title: 'Dönen anonim belge',
        filters: DOCUMENT_FILTERS,
        properties: ['openFile' as const]
      }
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths[0]) throw new UserCancelledError()
      return services.restoreFromFile(documentId, result.filePaths[0])
    })
  )
  ipcMain.handle('docs:exportRestored', async (e, documentId: number) =>
    wrap(async () => {
      const format = services.documentFormat(documentId)
      let filePath = await pickSavePath(
        e.sender,
        `kbms-geri-yuklenmis-${documentId}.${format}`,
        'Geri yüklenmiş belgeyi kaydet',
        saveFilters(format)
      )
      let fallback = false
      if (!filePath) {
        const win = parentWindow(e.sender)
        const ask = win
          ? await dialog.showMessageBox(win, {
              type: 'question',
              buttons: ['İndirilenler’e kaydet', 'Vazgeç'],
              defaultId: 0,
              cancelId: 1,
              title: 'Kayıt konumu',
              message: 'Dosya konumu seçilmedi. Belgeyi İndirilenler klasörüne kaydedelim mi?'
            })
          : await dialog.showMessageBox({
              type: 'question',
              buttons: ['İndirilenler’e kaydet', 'Vazgeç'],
              defaultId: 0,
              cancelId: 1,
              title: 'Kayıt konumu',
              message: 'Dosya konumu seçilmedi. Belgeyi İndirilenler klasörüne kaydedelim mi?'
            })
        if (ask.response !== 0) throw new UserCancelledError()
        filePath = join(
          app.getPath('downloads'),
          `kbms-geri-yuklenmis-${documentId}-${Date.now()}.${format}`
        )
        fallback = true
      }
      services.exportRestoredCopy(documentId, filePath)
      try {
        shell.showItemInFolder(filePath)
      } catch {
        // ignore
      }
      return { path: filePath, fallback }
    })
  )
}
