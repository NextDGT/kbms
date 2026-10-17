import type { PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'

export function Card({
  className,
  children
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('rounded-2xl border border-ink-200/80 bg-white/70 p-5 shadow-panel backdrop-blur', className)}>
      {children}
    </div>
  )
}
