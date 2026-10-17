import type { LabelHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'

export function Label({
  className,
  children,
  ...props
}: PropsWithChildren<LabelHTMLAttributes<HTMLLabelElement>>) {
  return (
    <label className={cn('mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500', className)} {...props}>
      {children}
    </label>
  )
}
