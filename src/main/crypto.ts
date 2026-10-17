import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const KEY_LEN = 32

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, 64)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function deriveKey(password: string, saltHex: string): Buffer {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LEN)
}

export function createSalt(): string {
  return randomBytes(16).toString('hex')
}

export function encryptJson(payload: unknown, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptJson<T>(blob: string, key: Buffer): T {
  const [ivHex, tagHex, dataHex] = blob.split(':')
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Geçersiz şifreli veri')
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ])
  return JSON.parse(dec.toString('utf8')) as T
}
