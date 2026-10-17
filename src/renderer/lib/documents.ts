import type { DocumentRecord } from '@shared/types'

export const ROLE_LABEL: Record<DocumentRecord['role'], string> = {
  original: 'orijinal',
  encoded: 'anonim',
  returned: 'dönen',
  restored: 'geri yüklenmiş'
}

export function roleTone(doc: DocumentRecord): 'ok' | 'warn' | 'default' | 'muted' {
  if (doc.role === 'encoded') return 'ok'
  if (doc.role === 'returned') return 'warn'
  if (doc.role === 'restored') return 'default'
  return 'muted'
}
