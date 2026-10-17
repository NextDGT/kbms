import type { UserPublic } from '../shared/types'
import { createSalt, deriveKey, hashPassword, verifyPassword } from './crypto'
import { getDb } from './db'

export interface ActiveSession {
  user: UserPublic
  key: Buffer
}

let session: ActiveSession | null = null

export function getSession(): ActiveSession | null {
  return session
}

export function requireSession(): ActiveSession {
  if (!session) throw new Error('Oturum gerekli')
  return session
}

export function logout(): void {
  session = null
}

export function register(username: string, password: string): UserPublic {
  const trimmed = username.trim()
  if (trimmed.length < 3) throw new Error('Kullanıcı adı en az 3 karakter olmalı')
  if (password.length < 6) throw new Error('Parola en az 6 karakter olmalı')

  const database = getDb()
  const existing = database.prepare('SELECT id FROM users WHERE username = ?').get(trimmed)
  if (existing) throw new Error('Bu kullanıcı adı zaten var')

  const keySalt = createSalt()
  const passwordHash = hashPassword(password)
  const info = database
    .prepare('INSERT INTO users (username, password_hash, key_salt) VALUES (?, ?, ?)')
    .run(trimmed, passwordHash, keySalt)

  const user: UserPublic = { id: Number(info.lastInsertRowid), username: trimmed }
  session = { user, key: deriveKey(password, keySalt) }
  return user
}

export function login(username: string, password: string): UserPublic {
  const database = getDb()
  const row = database
    .prepare('SELECT id, username, password_hash, key_salt FROM users WHERE username = ?')
    .get(username.trim()) as
    | { id: number; username: string; password_hash: string; key_salt: string }
    | undefined

  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error('Kullanıcı adı veya parola hatalı')
  }

  const user: UserPublic = { id: row.id, username: row.username }
  session = { user, key: deriveKey(password, row.key_salt) }
  return user
}
