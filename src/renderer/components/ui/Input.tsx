import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-ink-200 bg-white/80 px-3 py-2.5 text-sm text-ink-900 outline-none ring-veil-500/30 placeholder:text-ink-400 focus:border-veil-500 focus:ring-2',
        className
      )}
      {...props}
    />
  )
}
