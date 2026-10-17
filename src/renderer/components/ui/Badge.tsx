import type { PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'

export function Badge({
  className,
  children,
  tone = 'default'
}: PropsWithChildren<{ className?: string; tone?: 'default' | 'ok' | 'warn' | 'muted' }>) {
  const tones = {
    default: 'bg-veil-100 text-veil-800',
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-900',
    muted: 'bg-ink-100 text-ink-600'
  }
  return (
    <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}
